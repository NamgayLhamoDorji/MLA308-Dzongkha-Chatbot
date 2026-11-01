"""Core logic: any input -> English -> LLM -> Dzongkha. No web code in here."""
import re
import numpy as np
from text_utils import is_dzongkha, normalize, shape_paragraphs, split_dzongkha, split_english

DOC_SYSTEM = ("You answer questions about a document. Answer the question directly in your own words. "
              "Never repeat or translate the excerpts. Use them only to find facts. "
              "If they do not cover the question, say so, then answer from general knowledge if you can. "
              "Use short, simple, clear English sentences.")
CHAT_SYSTEM = ("You are a friendly assistant that replies to the user. Never repeat or translate the user's message. "
               "If the user only says hello or hi, reply with exactly: Hello! How can I help you? "
               "If the user tells you their name, greet them back by name and ask how you can help. "
               "Your name is Dzongkha Assistant. You are a Dzongkha chat assistant that answers questions, "
               "summarizes documents and translates between Dzongkha and English. "
               "If the user asks who you are or what your name is, say this. Never write a placeholder such as [Name]. "
               "If the user asks how you are, say you are fine and ask how they are. "
               "Answer in short, simple, clear English sentences.")
SIMPLE = (" Write for translation: very simple words, one idea per sentence, no more than 15 words "
          "per sentence, no idioms, no abbreviations, and write numbers as digits.")
DOC_SYSTEM += SIMPLE
# Questions like "what is your name?" always get the same answer. Change INTRO to change it.
INTRO = ("My name is Dzongkha Assistant. I can answer your questions, summarize your documents, "
         "and translate between Dzongkha and English. How can I help you?")
_ASKS_WHO = re.compile(r"\b(?:your name|who are you|who is this|introduce yourself|what are you called|what should i call you)\b", re.I)
CHAT_SYSTEM += SIMPLE
# Summaries are written differently from answers: longer, connected sentences and more paragraphs.
# Change "30 to 40 words" to make the sentences shorter or longer, and the numbers in auto_paragraphs()
# to get fewer or more paragraphs.
PLAIN = " Use plain words, no idioms, no abbreviations, and write numbers as digits."
FLOW = (" Write the summary as smooth, connected prose with long, detailed sentences of about 30 to 40 words each. "
        "Combine several related points into one sentence, using words such as because, which, while, although and so that. "
        "Do not write short choppy sentences, sentence fragments, bullet points or lists. "
        "Use only facts from the text and add nothing new." + PLAIN)


SHORT_TEXT_WORDS = 350   # below this the text is summarized in one go


def auto_paragraphs(words):
    """How many paragraphs a summary gets when nobody asks for a number: more for longer texts."""
    return 2 if words < 80 else 3 if words < 180 else 4 if words < 1000 else 5


def sentences_per_paragraph(words):
    return "3 to 4" if words < 1000 else "4 to 5"


def _words(s):
    return re.findall(r"[a-z0-9]{3,}", s.lower())


class Engine:
    def __init__(self, translator, ask, embed=None):
        self.tr, self.ask, self.embed = translator, ask, embed

    # ---- translation
    def to_en(self, text):
        if not is_dzongkha(text):
            return text
        return self.tr.translate(text, "dz", "en").replace("\n", " ")

    def to_dz(self, text, chat=False):
        """chat=True uses the chat route (Google first). Documents and summaries use the default route."""
        mode = "chat" if chat else None
        out = []
        for l in text.split("\n"):
            l = re.sub(r"^\s*[-*•]\s*", "", l).strip()
            out.append(normalize(self.tr.translate(l, "en", "dz", mode=mode)) if l else "")
        return "\n".join(out).strip()

    def document_to_english(self, raw, progress=None):
        """Translate only the Dzongkha lines; English lines pass through unchanged."""
        plan, total = [], 0
        for l in (x for x in raw.split("\n") if x.strip()):
            if is_dzongkha(l):
                n = len(split_dzongkha(l))
                plan.append((l, n))
                total += n
            else:
                plan.append((l, 0))
        out, done = [], 0
        for l, n in plan:
            if n:
                cb = (lambda i, k, base=done: progress(base + i, total)) if progress else None
                out.append(self.tr.translate(l, "dz", "en", progress=cb))
                done += n
            else:
                out.append(l)
        return "\n".join(out)

    # ---- retrieval
    def embed_chunks(self, chunks):
        if not self.embed or not chunks:
            return None
        try:
            v = np.array(self.embed(chunks), dtype="float32")
            return v / (np.linalg.norm(v, axis=1, keepdims=True) + 1e-9)
        except Exception as e:
            print("Embeddings unavailable, using keyword search:", e)
            return None

    def retrieve(self, question, items, k=4):
        """items: list of (doc_name, chunk_text, vector_or_None). Returns excerpt strings."""
        if not items:
            return []
        scores = None
        if self.embed and all(v is not None for _, _, v in items):
            try:
                q = np.array(self.embed([question]), dtype="float32")[0]
                q = q / (np.linalg.norm(q) + 1e-9)
                scores = [float(np.dot(v, q)) for _, _, v in items]
            except Exception:
                scores = None
        if scores is None:
            qw = set(_words(question))
            scores = []
            for _, c, _ in items:
                cw = _words(c)
                scores.append(sum(1 for w in cw if w in qw) / (len(cw) ** 0.5 + 1))
        top = sorted(sorted(range(len(items)), key=lambda i: -scores[i])[:k])   # keep document order
        multi = len({n for n, _, _ in items}) > 1
        return [(f"[{items[i][0]}] " if multi else "") + items[i][1] for i in top]

    # ---- LLM tasks (all in English)
    def _condense(self, notes, limit):
        """Merge neighbouring notes (keeping their order) until at most `limit` remain."""
        while len(notes) > limit:
            merged = []
            for i in range(0, len(notes), 4):
                part = notes[i:i + 4]
                merged.append(part[0] if len(part) == 1 else self.ask(
                    "Combine these notes into one summary of 4 to 6 complete sentences. "
                    "Keep every important point:\n\n" + "\n".join("- " + n for n in part) + PLAIN))
            notes = merged
        return notes

    def summarize_chunks(self, chunks, progress=None, request=None, paragraphs=None):
        """Reads EVERY part of the document. With a paragraph count, each paragraph covers its own
        stretch of the document, so the end is never left out."""
        if not chunks:
            return ""
        words = sum(len(c.split()) for c in chunks)
        if not paragraphs:   # nobody asked for a number: choose one from the length of the text
            paragraphs = auto_paragraphs(words)
        if words >= SHORT_TEXT_WORDS:
            # Cut the text into at least one part per paragraph (and about 400 words per part), so every
            # paragraph is written from its own stretch of the document and the paragraphs do not repeat.
            sents = [s for c in chunks for s in split_english(c)]
            n_parts = max(paragraphs, -(-words // 400))
            size, extra = divmod(len(sents), n_parts)
            groups, i = [], 0
            for k in range(n_parts):
                j = i + size + (1 if k < extra else 0)
                if j > i:
                    groups.append(" ".join(sents[i:j]))
                i = j
        else:
            groups = [" ".join(chunks)]
        per = sentences_per_paragraph(words)
        if len(groups) == 1:   # a short text: nothing to condense, so the summary is written straight from the text
            notes = [groups[0]]
        else:
            notes = []
            for i, g in enumerate(groups):
                if progress:
                    progress(f"Reading part {i + 1} of {len(groups)}")
                notes.append(self.ask("Summarize the key points of this text in 4 to 6 complete sentences:\n\n" + g + PLAIN))
        if paragraphs and paragraphs > 1 and len(notes) >= paragraphs:
            size, extra = divmod(len(notes), paragraphs)
            paras, i = [], 0
            for k in range(paragraphs):
                j = i + size + (1 if k < extra else 0)
                part = self._condense(notes[i:j], 8)
                i = j
                if progress:
                    progress(f"Writing paragraph {k + 1} of {paragraphs}")
                para = self.ask(f"Write ONE paragraph of {per} full, flowing sentences that summarizes these notes. "
                                "Start directly with the content. Do not begin with 'This document', 'The text' or 'The case study', "
                                "and do not say that it is a summary. Include specific names, numbers and findings from the notes. "
                                "Write only the paragraph.\n\n" + "\n".join("- " + n for n in part) + FLOW)
                paras.append(" ".join(para.split()))
            return "\n\n".join(paras)
        notes = self._condense(notes, 6)
        if progress:
            progress("Writing the summary")
        want = f"Write exactly {paragraphs} paragraphs, with {per} full sentences in each paragraph. "
        ans = self.ask(
            "Here are notes about a document, in order from its beginning to its end:\n\n" +
            "\n".join("- " + n for n in notes) +
            "\n\nUser request: " + (request or "Summarize the document.") +
            "\nFollow the request exactly, using only these notes. Cover the whole document, from beginning to end. "
            "Separate paragraphs with a blank line. " + want + FLOW)
        return shape_paragraphs(ans, paragraphs) if paragraphs else ans

    def answer(self, q_en, excerpts, history=None):
        if excerpts:
            prompt = "Document excerpts:\n\n" + "\n\n---\n\n".join(excerpts) + "\n\nQuestion: " + q_en
            return self.ask(prompt, system=DOC_SYSTEM, history=history)
        if _ASKS_WHO.search(q_en):   # a fixed answer: a small model mixes up its own name with the user's
            return INTRO
        return self.ask(q_en, system=CHAT_SYSTEM, history=history)
    
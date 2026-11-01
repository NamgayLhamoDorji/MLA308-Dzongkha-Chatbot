"""Text helpers for the Dzongkha assistant: cleaning, sentence splitting, chunking, Word/PDF text,
summary-request detection, paragraph shaping.

NOTE: this file was rebuilt after the original was overwritten. It was written from how server.py,
translate.py and pipeline.py call it, so small details (for example exactly how paragraphs are
re-split) may differ from your original."""
import io
import re
import unicodedata
import zipfile
from xml.etree import ElementTree

TSHEG = "་"
SHAD = "།༎"          # shad and double shad


# ------------------------------------------------------------------ basics
def normalize(text):
    """Unicode NFC, tsheg variants unified, invisible characters removed, spaces collapsed."""
    text = unicodedata.normalize("NFC", text or "")
    text = text.replace("༌", TSHEG)                       # non-breaking tsheg -> tsheg
    text = re.sub("[​﻿­]", "", text)             # zero-width space, BOM, soft hyphen
    text = text.replace(" ", " ").replace("　", " ")
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = re.sub(r" ?\n ?", "\n", text)
    return text.strip()


def is_dzongkha(text):
    """True when the text is mostly Tibetan-script letters."""
    tib = len(re.findall("[ཀ-ྼ]", text or ""))
    lat = len(re.findall("[A-Za-z]", text or ""))
    return tib > 0 and tib >= lat


def syllables(text):
    """Number of Dzongkha syllables (the unit used instead of words)."""
    return sum(1 for t in re.split("[་།༎\\s]+", text or "") if re.search("[ཀ-ྼ]", t))


# ------------------------------------------------------------------ sentences and chunks
_EN_SPLIT = re.compile(r"(?<=[.!?])\s+(?=[A-Z\"'(•*-])")
_DZ_SPLIT = re.compile("(?<=[།༎])(?![།༎])\\s*")


def split_sentences(text, lang="en"):
    """One sentence per item. Lines are kept apart (bullets, headings); Dzongkha splits after each shad."""
    out = []
    for line in normalize(text).split("\n"):
        line = line.strip()
        if not line:
            continue
        parts = _DZ_SPLIT.split(line) if lang == "dz" else _EN_SPLIT.split(line)
        out += [p.strip() for p in parts if p and p.strip(" " + SHAD)]
    return out


def split_english(text):
    return split_sentences(text, "en")


def split_dzongkha(text):
    """Dzongkha sentences. Uses the same splitting as Translator.translate(), so the sentence
    counts used for the progress display match the sentences that actually get translated."""
    return split_sentences(text, "dz")


def chunk_text(sentences, max_words=300):
    """Group sentences into chunks of about max_words words, never cutting a sentence."""
    chunks, cur, n = [], [], 0
    for s in sentences:
        w = len(s.split())
        if cur and n + w > max_words:
            chunks.append(" ".join(cur))
            cur, n = [], 0
        cur.append(s)
        n += w
    if cur:
        chunks.append(" ".join(cur))
    return chunks


def join_lines(text):
    """Undo the hard line wraps of PDF text: lines that continue a sentence are joined,
    a sentence end (shad, full stop, ?, !, :) or a blank line starts a new line."""
    paras, cur = [], ""
    for line in normalize(text).split("\n"):
        line = line.strip()
        if not line:
            if cur:
                paras.append(cur)
                cur = ""
            continue
        if not cur:
            cur = line
        elif re.search("[།༎.!?:;]$", cur):
            paras.append(cur)
            cur = line
        elif cur.endswith(TSHEG):
            cur += line
        elif re.search("[A-Za-z]-$", cur) and line[:1].islower():
            cur = cur[:-1] + line                               # hyphenated word at a line end
        else:
            cur += " " + line
    if cur:
        paras.append(cur)
    return "\n".join(paras)


# ------------------------------------------------------------------ paragraph shaping
def _even_groups(items, n):
    """Split a list into n consecutive groups of (almost) equal size, keeping the order."""
    size, extra = divmod(len(items), n)
    groups, i = [], 0
    for k in range(n):
        j = i + size + (1 if k < extra else 0)
        groups.append(items[i:j])
        i = j
    return groups


def shape_paragraphs(text, n):
    """Make an LLM answer have exactly n paragraphs (separated by one blank line).
    Markdown bullets and bold marks are removed. If the model wrote more paragraphs than asked,
    neighbouring ones are merged. If it wrote fewer, the sentences are spread evenly over n
    paragraphs. If there are fewer sentences than n, the paragraphs it has are kept."""
    text = re.sub(r"\*\*|__", "", text or "")
    text = re.sub(r"(?m)^\s*(?:[-*•]|\d+[.)])\s+", "", text)
    text = re.sub(r"(?m)^\s*#+\s*", "", text)
    paras = [" ".join(p.split()) for p in re.split(r"\n\s*\n", text.strip()) if p.strip()]
    if not paras:
        return ""
    if not n or n < 1 or len(paras) == n:
        return "\n\n".join(paras)
    if len(paras) > n:
        return "\n\n".join(" ".join(g) for g in _even_groups(paras, n))
    sentences = split_english(" ".join(paras))
    if len(sentences) < n:
        return "\n\n".join(paras)
    return "\n\n".join(" ".join(g) for g in _even_groups(sentences, n))


# ------------------------------------------------------------------ Word files
def docx_to_text(data):
    """Plain text of a .docx file, one paragraph per line. Raises ValueError for unreadable files."""
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            xml = z.read("word/document.xml")
        root = ElementTree.fromstring(xml)
    except (zipfile.BadZipFile, KeyError, ElementTree.ParseError):
        raise ValueError("This Word file could not be read. Please save it as .docx and try again.")
    ns = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    paras = []
    for p in root.iter(ns + "p"):
        parts = []
        for el in p.iter():
            if el.tag == ns + "t":
                parts.append(el.text or "")
            elif el.tag == ns + "tab":
                parts.append("\t")
            elif el.tag in (ns + "br", ns + "cr"):
                parts.append("\n")
        paras.append("".join(parts))
    return "\n".join(paras)


# ------------------------------------------------------------------ summary requests
_SUMMARY = re.compile(r"\b(summari[sz]e|summary|overview|main points|key points|"
                      r"what is (this|the) (document|file|pdf|paper) about)\b", re.I)
_NUMBERS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6}


def parse_summary_request(text, q_en, has_docs):
    """Returns (is_summary_request, number_of_paragraphs_or_0, english_question)."""
    q = q_en or text or ""
    is_sum = bool(has_docs and _SUMMARY.search(q))
    n = 0
    m = re.search(r"\b(\d+|one|two|three|four|five|six)\s+paragraphs?\b", q, re.I)
    if m:
        v = m.group(1).lower()
        n = int(v) if v.isdigit() else _NUMBERS[v]
    return is_sum, max(0, min(6, n)), q_en
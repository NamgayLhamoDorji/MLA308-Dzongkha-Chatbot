"""Translation with a SQLite cache. Backends are swappable functions: (text) -> text."""
import os
import re
import sqlite3
import threading
import time

from text_utils import is_dzongkha, normalize, split_sentences

# Settings that change the translation output. They are part of the cache key, so changing
# a model, the beams or the word cutoff never shows old cached translations.
_SIG_VARS = ("DZO_NLLB_MODEL", "DZO_EN2DZ_MODEL", "DZO_BEAMS", "DZO_SHORT_WORDS")


def _key(s):
    """Spelling-insensitive lookup key: no punctuation or shad, one space, lower case."""
    s = re.sub("[།༎.!?,;:\"'\u201c\u201d\u2018\u2019]+", " ", normalize(s))
    return " ".join(s.lower().split()).strip("་ ")


class Translator:
    def __init__(self, dz_to_en, en_to_dz, cache_path="translations.db", phrasebook_path=None, en_to_dz_chat=None):
        self.fns = {("dz", "en"): dz_to_en, ("en", "dz"): en_to_dz}
        if en_to_dz_chat:
            self.fns[("en", "dz", "chat")] = en_to_dz_chat
        self.db = sqlite3.connect(cache_path, check_same_thread=False)
        self.db.execute("CREATE TABLE IF NOT EXISTS t (src TEXT, tgt TEXT, text TEXT, out TEXT, PRIMARY KEY (src, tgt, text))")
        self.pb_path, self._pb, self._pb_mtime = phrasebook_path, ({}, {}), None
        self.sig = "|".join(os.environ.get(k, "") for k in _SIG_VARS)

    def _phrase(self, text, src, tgt):
        """Hand-checked translations from phrasebook.txt win over every translator.
        The file is re-read automatically when you save it. One 'English | Dzongkha' pair per line."""
        p = self.pb_path
        if not p:
            return None
        try:
            m = os.path.getmtime(p)
        except OSError:
            self._pb, self._pb_mtime = ({}, {}), None
            return None
        if m != self._pb_mtime:
            en2dz, dz2en = {}, {}
            with open(p, encoding="utf-8-sig") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "|" not in line:
                        continue
                    en, dz = (x.strip() for x in line.split("|", 1))
                    if en and dz:
                        en2dz[_key(en)] = dz
                        dz2en[_key(dz)] = en
            self._pb, self._pb_mtime = (en2dz, dz2en), m
        return (self._pb[0] if src == "en" else self._pb[1]).get(_key(text))

    def _one(self, text, src, tgt, mode=None):
        hit = self._phrase(text, src, tgt)
        if hit is not None:
            return hit
        fn = self.fns.get((src, tgt, mode)) or self.fns[(src, tgt)]
        # chat and document results are cached separately, so they never reuse each other's output;
        # the settings signature keeps results from different models apart too
        ctag = (tgt + "-" + mode if (src, tgt, mode) in self.fns else tgt) + "|" + self.sig
        row = self.db.execute("SELECT out FROM t WHERE src=? AND tgt=? AND text=?", (src, ctag, text)).fetchone()
        if row:
            return row[0]
        out = fn(text)
        if tgt == "en":
            out = out.replace("\u00b7", "")          # stray middle dots from the translator
            if is_dzongkha(out):
                raise RuntimeError("The Dzongkha to English translation came back unchanged.")
        self.db.execute("INSERT OR REPLACE INTO t VALUES (?,?,?,?)", (src, ctag, text, out))
        self.db.commit()
        return out

    def translate(self, text, src, tgt, progress=None, mode=None):
        if src == tgt:
            return text
        parts = split_sentences(text, src)
        outs = []
        for i, p in enumerate(parts):
            outs.append(self._one(p, src, tgt, mode))
            if progress:
                progress(i + 1, len(parts))
        return ("\n" if src == "dz" else " ").join(outs)


# ------------------------------------------------------------------ Google (free web route)
_GLOCK = threading.Lock()
_GLAST = [0.0]


def google_backend(src, tgt, min_gap=0.5):
    """Calls Google Translate's web endpoint directly (deep-translator rejects 'dz').
    Calls are spaced out. On 429 (Google is limiting this network) it stops at once, so that
    with_fallback() can switch to the local model instead of hammering Google."""
    import requests

    def run(text):
        last = None
        for attempt in range(3):
            with _GLOCK:                      # one request at a time, spaced out
                wait = _GLAST[0] + min_gap - time.time()
                if wait > 0:
                    time.sleep(wait)
                _GLAST[0] = time.time()
            try:
                r = requests.get(
                    "https://translate.googleapis.com/translate_a/single",
                    params={"client": "gtx", "sl": src, "tl": tgt, "dt": "t", "q": text},
                    headers={"User-Agent": "Mozilla/5.0"},
                    timeout=30,
                )
                r.raise_for_status()
                return parse_google(r.json())
            except Exception as e:            # network error, rate limit, bad JSON
                last = e
                if "429" in str(e):
                    break
                time.sleep(1.5 * (attempt + 1))
        raise RuntimeError(f"Google translate failed ({src}->{tgt}): {last}")

    return run


def parse_google(data):
    """Join the translated pieces from Google's response."""
    return "".join(seg[0] for seg in data[0] if seg and seg[0])


# ------------------------------------------------------------------ local model (free, no limits)
_NLLB = {}
_NLLB_CODES = {"dz": "dzo_Tibt", "en": "eng_Latn"}


def tidy_dz(text):
    """Community NLLB models write Dzongkha with spaces between words and no closing shad.
    Join the words (a space after a bare word becomes a tsheg) and end the sentence with a shad."""
    L = "[\u0f40-\u0fbc]"
    text = re.sub("(?<=[\u0f40-\u0fbc\u0f71-\u0f84])[ \t]+(?=" + L + ")", "\u0f0b", text)   # ཚུགས ཡིག -> ཚུགས་ཡིག
    text = re.sub("\u0f0b[ \t]+(?=" + L + ")", "\u0f0b", text)                                # ཡིག་ཆ་ འདི -> ཡིག་ཆ་འདི
    text = normalize(text).strip()
    if text and re.search(L + "\u0f0b?$", text):
        text = text.rstrip("\u0f0b") + "\u0f0d"
    return text


def nllb_backend(src, tgt, model_name=None):
    """NLLB-200 runs on your own laptop, with no limits. Each model downloads once
    (about 2.5 GB for the 600M models, about 5.5 GB for facebook/nllb-200-distilled-1.3B).
    Another NLLB-based model can be used with model_name or the DZO_NLLB_MODEL setting."""
    name = model_name or os.environ.get("DZO_NLLB_MODEL") or "facebook/nllb-200-distilled-600M"
    beams = int(os.environ.get("DZO_BEAMS", "4"))

    def run(text):
        if name not in _NLLB:
            from transformers import AutoModelForSeq2SeqLM, AutoTokenizer
            print(f"Loading the local translation model {name} (the first time this downloads; 1.3B is about 5.5 GB)...")
            _NLLB[name] = (AutoTokenizer.from_pretrained(name),
                           AutoModelForSeq2SeqLM.from_pretrained(name, low_cpu_mem_usage=True))   # less RAM while loading
            _NLLB[name][1].eval()
        tok, model = _NLLB[name]
        tok.src_lang = _NLLB_CODES[src]
        inputs = tok(text, return_tensors="pt", truncation=True, max_length=200)
        # beam search plus no_repeat_ngram_size stops the repetition loops small NLLB models fall into
        out = model.generate(**inputs, forced_bos_token_id=tok.convert_tokens_to_ids(_NLLB_CODES[tgt]),
                             max_new_tokens=200, num_beams=beams, no_repeat_ngram_size=3)
        res = tok.batch_decode(out, skip_special_tokens=True)[0]
        return tidy_dz(res) if tgt == "dz" else res

    return run


def with_fallback(primary, secondary, cooldown=300):
    """Try primary. If it fails, use secondary, and skip primary for `cooldown` seconds."""
    state = {"until": 0.0}

    def run(text):
        if time.time() >= state["until"]:
            try:
                return primary(text)
            except Exception as e:
                state["until"] = time.time() + cooldown
                print(f"[translate] first choice failed, using the local model for {cooldown} s: {e}")
        return secondary(text)

    return run


def by_length(short_fn, long_fn, max_words):
    """Route each sentence by length: short ones to short_fn, longer ones to long_fn."""
    def run(text):
        return (short_fn if len(text.split()) <= max_words else long_fn)(text)

    return run
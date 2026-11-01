"""Dzongkha Assistant: web server with accounts, chat history and file upload.
Run:  python server.py   then open http://127.0.0.1:8000"""
import hashlib
import hmac
import io
import os
import re
import secrets
import sqlite3
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, File, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

import llm
from pipeline import Engine
from text_utils import chunk_text, docx_to_text, is_dzongkha, join_lines, parse_summary_request, split_english, syllables
from translate import Translator, by_length, google_backend, nllb_backend, with_fallback

BASE = Path(__file__).parent
DB_PATH = os.environ.get("DZO_DB", str(BASE / "dzo_chat.db"))
COOKIE = "dzo_session"
MAX_UPLOAD = 25 * 1024 * 1024
SUMMARY_RE = re.compile(r"\b(summari[sz]e|summary|overview|main points|key points|"
                        r"what is (this|the) (document|file|pdf|paper) about)\b", re.I)

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, salt BLOB NOT NULL, pw_hash TEXT NOT NULL, created REAL NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, created REAL NOT NULL);
CREATE TABLE IF NOT EXISTS chats (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL DEFAULT 'New chat', created REAL NOT NULL, updated REAL NOT NULL);
CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY, chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE, role TEXT NOT NULL, text TEXT NOT NULL DEFAULT '', en TEXT, status TEXT NOT NULL DEFAULT 'done', progress TEXT NOT NULL DEFAULT '', created REAL NOT NULL);
CREATE TABLE IF NOT EXISTS docs (id INTEGER PRIMARY KEY, chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE, name TEXT NOT NULL, pages INTEGER NOT NULL DEFAULT 0, empty_pages INTEGER NOT NULL DEFAULT 0, words INTEGER NOT NULL DEFAULT 0, raw_text TEXT NOT NULL DEFAULT '', en_text TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'queued', progress TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '', created REAL NOT NULL);
"""


# ------------------------------------------------------------------ database
@contextmanager
def conn():
    c = sqlite3.connect(DB_PATH, timeout=30)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys=ON")
    try:
        yield c
        c.commit()
    finally:
        c.close()


def init_db():
    with conn() as c:
        c.execute("PRAGMA journal_mode=WAL")
        c.executescript(SCHEMA)
        c.execute("UPDATE messages SET status='error', text='The server restarted before this finished. Please ask again.' WHERE status='pending'")
        c.execute("UPDATE docs SET status='error', error='Interrupted by a restart. Please attach the file again.' WHERE status IN ('queued','processing')")


# ------------------------------------------------------------------ engine
def build_engine():
    if os.environ.get("DZO_FAKE"):   # used by the automatic tests, no internet or Ollama needed
        tr = Translator(lambda t: "A translated sentence.", lambda t: "བཀྲ་ཤིས་བདེ་ལེགས།",
                        ":memory:")
        return Engine(tr, lambda p, **kw: "This is a test answer.", None)

    # English -> Dzongkha local model. Default: kinley (NLLB fine-tuned on Dzongkha-English pairs).
    # To try Meta's larger model: set DZO_EN2DZ_MODEL=facebook/nllb-200-distilled-1.3B
    kinley = os.environ.get("DZO_EN2DZ_MODEL", "kinleyrabgay/nllb-200-600M-dzo-eng-300k")
    # English -> Dzongkha, chosen per sentence by length (chat, documents and summaries alike).
    # Short (<= DZO_SHORT_WORDS words): kinley first, Google as fallback.
    # Longer: Google first, kinley as fallback.
    limit = int(os.environ.get("DZO_SHORT_WORDS", "12"))
    kinley_first = with_fallback(nllb_backend("en", "dz", kinley), google_backend("en", "dz"), cooldown=60)
    google_first = with_fallback(google_backend("en", "dz"), nllb_backend("en", "dz", kinley))
    en_to_dz = by_length(kinley_first, google_first, limit)
    en_to_dz_chat = en_to_dz
    # Dzongkha -> English: Google first, local NLLB as fallback.
    tr = Translator(with_fallback(google_backend("dz", "en"), nllb_backend("dz", "en")), en_to_dz,
                    str(BASE / "translations.db"), str(BASE / "phrasebook.txt"),   # swap dz->en for DzoNext here
                    en_to_dz_chat=en_to_dz_chat)
    model = {}

    def embed(xs):
        if "m" not in model:
            from sentence_transformers import SentenceTransformer
            model["m"] = SentenceTransformer("BAAI/bge-small-en-v1.5")
        return model["m"].encode(xs)

    return Engine(tr, llm.ask, embed)


ENGINE = build_engine()
POOL = ThreadPoolExecutor(max_workers=1)   # one job at a time: the LLM runs on the CPU
DOC_CACHE = {}


# ------------------------------------------------------------------ auth
def hash_pw(password, salt):
    return hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 200_000).hex()


def current_user(request: Request):
    token = request.cookies.get(COOKIE)
    if token:
        with conn() as c:
            r = c.execute("SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?", (token,)).fetchone()
        if r:
            return dict(r)
    raise HTTPException(401, "Please sign in.")


def start_session(response, user_id):
    token = secrets.token_urlsafe(32)
    with conn() as c:
        c.execute("INSERT INTO sessions VALUES (?,?,?)", (token, user_id, time.time()))
    response.set_cookie(COOKIE, token, httponly=True, samesite="lax", max_age=30 * 86400)


class Credentials(BaseModel):
    username: str
    password: str


class MessageIn(BaseModel):
    text: str = ""
    action: str = "chat"
    paragraphs: int = 0


app = FastAPI()


@app.get("/")
def index():
    return FileResponse(BASE / "static" / "index.html")


@app.post("/api/register")
def register(body: Credentials, response: Response):
    name = body.username.strip()
    if not re.fullmatch(r"[A-Za-z0-9_.@+-]{3,64}", name):
        raise HTTPException(400, "Username must be 3 to 64 letters, numbers, dots, dashes, underscores or @.")
    if len(body.password) < 6:
        raise HTTPException(400, "Password must be at least 6 characters.")
    salt = secrets.token_bytes(16)
    try:
        with conn() as c:
            uid = c.execute("INSERT INTO users(username, salt, pw_hash, created) VALUES (?,?,?,?)",
                            (name, salt, hash_pw(body.password, salt), time.time())).lastrowid
    except sqlite3.IntegrityError:
        raise HTTPException(409, "That username is taken.")
    start_session(response, uid)
    return {"username": name}


@app.post("/api/login")
def login(body: Credentials, response: Response):
    with conn() as c:
        r = c.execute("SELECT * FROM users WHERE username = ?", (body.username.strip(),)).fetchone()
    ok = r is not None and hmac.compare_digest(r["pw_hash"], hash_pw(body.password, r["salt"]))
    if not ok:
        raise HTTPException(400, "Wrong username or password.")
    start_session(response, r["id"])
    return {"username": r["username"]}


@app.post("/api/logout")
def logout(request: Request, response: Response):
    token = request.cookies.get(COOKIE)
    if token:
        with conn() as c:
            c.execute("DELETE FROM sessions WHERE token = ?", (token,))
    response.delete_cookie(COOKIE)
    return {"ok": True}


@app.get("/api/me")
def me(user=Depends(current_user)):
    return {"username": user["username"]}


# ------------------------------------------------------------------ chats
def own_chat(c, chat_id, user_id):
    r = c.execute("SELECT * FROM chats WHERE id = ? AND user_id = ?", (chat_id, user_id)).fetchone()
    if not r:
        raise HTTPException(404, "Chat not found.")
    return r


@app.get("/api/chats")
def list_chats(user=Depends(current_user)):
    with conn() as c:
        rows = c.execute("SELECT id, title, updated FROM chats WHERE user_id = ? ORDER BY updated DESC", (user["id"],)).fetchall()
    return [dict(r) for r in rows]


@app.post("/api/chats")
def new_chat(user=Depends(current_user)):
    now = time.time()
    with conn() as c:
        cid = c.execute("INSERT INTO chats(user_id, created, updated) VALUES (?,?,?)", (user["id"], now, now)).lastrowid
    return {"id": cid, "title": "New chat"}


@app.get("/api/chats/{chat_id}")
def get_chat(chat_id: int, user=Depends(current_user)):
    with conn() as c:
        chat = own_chat(c, chat_id, user["id"])
        msgs = c.execute("SELECT id, role, text, en, status, progress FROM messages WHERE chat_id = ? ORDER BY id", (chat_id,)).fetchall()
        docs = c.execute("SELECT id, name, pages, empty_pages, words, status, progress, error FROM docs WHERE chat_id = ? ORDER BY id", (chat_id,)).fetchall()
    return {"id": chat["id"], "title": chat["title"], "messages": [dict(m) for m in msgs], "docs": [dict(d) for d in docs]}


@app.delete("/api/chats/{chat_id}")
def delete_chat(chat_id: int, user=Depends(current_user)):
    with conn() as c:
        own_chat(c, chat_id, user["id"])
        ids = [r["id"] for r in c.execute("SELECT id FROM docs WHERE chat_id = ?", (chat_id,))]
        c.execute("DELETE FROM chats WHERE id = ?", (chat_id,))
    for i in ids:
        DOC_CACHE.pop(i, None)
    return {"ok": True}


# ------------------------------------------------------------------ documents
def extract_text(name, data):
    """Returns (text, pages, empty_pages)."""
    if name.lower().endswith(".docx"):
        try:
            return docx_to_text(data), 1, 0
        except ValueError as e:
            raise HTTPException(400, str(e))
    if name.lower().endswith(".pdf"):
        try:   # PyMuPDF keeps Tibetan stacked letters better than pypdf
            import fitz
            with fitz.open(stream=data, filetype="pdf") as pdf:
                pages = [pg.get_text() or "" for pg in pdf]
            empty = sum(1 for t in pages if len(t.strip()) < 20)
            return "\n".join(pages), len(pages), empty
        except ImportError:
            pass
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            try:
                reader.decrypt("")
            except Exception:
                raise HTTPException(400, "This PDF is password protected.")
        pages = []
        for p in reader.pages:
            try:
                pages.append(p.extract_text() or "")
            except Exception:
                pages.append("")
        empty = sum(1 for t in pages if len(t.strip()) < 20)
        return "\n".join(pages), len(pages), empty
    for enc in ("utf-8-sig", "utf-16", "latin-1"):
        try:
            return data.decode(enc), 1, 0
        except UnicodeError:
            continue
    raise HTTPException(400, "Could not read this text file.")


@app.post("/api/chats/{chat_id}/upload")
async def upload(chat_id: int, file: UploadFile = File(...), user=Depends(current_user)):
    name = os.path.basename(file.filename or "document")
    if not name.lower().endswith((".pdf", ".docx", ".txt", ".md")):
        raise HTTPException(400, "Only PDF, Word (.docx), TXT and MD files are supported.")
    data = await file.read()
    if len(data) > MAX_UPLOAD:
        raise HTTPException(400, "The file is larger than 25 MB.")
    with conn() as c:
        own_chat(c, chat_id, user["id"])
    text, pages, empty = extract_text(name, data)
    if name.lower().endswith(".docx"):   # Word paragraphs are already real paragraphs
        raw = "\n".join(l.strip() for l in text.split("\n") if l.strip())
    else:
        raw = join_lines(text)
    if len(raw.strip()) < 20:
        raise HTTPException(400, "No readable text found. If this is a scanned PDF, it needs OCR first.")
    words = syllables(raw) if is_dzongkha(raw) else len(raw.split())
    now = time.time()
    with conn() as c:
        did = c.execute("INSERT INTO docs(chat_id, name, pages, empty_pages, words, raw_text, created) VALUES (?,?,?,?,?,?,?)",
                        (chat_id, name, pages, empty, words, raw, now)).lastrowid
        c.execute("UPDATE chats SET updated = ? WHERE id = ?", (now, chat_id))
    POOL.submit(process_doc, did)
    return {"id": did}


@app.delete("/api/docs/{doc_id}")
def delete_doc(doc_id: int, user=Depends(current_user)):
    with conn() as c:
        r = c.execute("SELECT d.id FROM docs d JOIN chats c ON c.id = d.chat_id WHERE d.id = ? AND c.user_id = ?", (doc_id, user["id"])).fetchone()
        if not r:
            raise HTTPException(404, "Document not found.")
        c.execute("DELETE FROM docs WHERE id = ?", (doc_id,))
    DOC_CACHE.pop(doc_id, None)
    return {"ok": True}


def process_doc(doc_id):
    """Background job: translate the document to English when needed. Nothing is skipped."""
    def setp(text):
        with conn() as c:
            c.execute("UPDATE docs SET progress = ? WHERE id = ?", (text, doc_id))
    try:
        with conn() as c:
            row = c.execute("SELECT raw_text FROM docs WHERE id = ?", (doc_id,)).fetchone()
            if row is None:
                return
            c.execute("UPDATE docs SET status='processing', progress='Reading' WHERE id = ?", (doc_id,))
        en = ENGINE.document_to_english(row["raw_text"], lambda i, n: setp(f"Translating {i} of {n} sentences"))
        with conn() as c:
            c.execute("UPDATE docs SET en_text = ?, status='ready', progress='' WHERE id = ?", (en, doc_id))
    except Exception as e:
        with conn() as c:
            c.execute("UPDATE docs SET status='error', error=? WHERE id = ?", (f"Could not process this file: {e}", doc_id))


def doc_index(doc_id, en_text):
    if doc_id not in DOC_CACHE:
        chunks = chunk_text(split_english(en_text), 300)
        DOC_CACHE[doc_id] = (chunks, ENGINE.embed_chunks(chunks))
    return DOC_CACHE[doc_id]


# ------------------------------------------------------------------ messages
@app.post("/api/chats/{chat_id}/messages")
def post_message(chat_id: int, body: MessageIn, user=Depends(current_user)):
    text = body.text.strip()
    action = "summarize" if body.action == "summarize" else "chat"
    if not text and action == "chat":
        raise HTTPException(400, "Type a question first.")
    if len(text) > 4000:
        raise HTTPException(400, "That message is too long (4000 characters at most).")
    n = max(0, min(6, body.paragraphs))
    if action == "summarize" and n:      # the paragraph selector in the page: no translation involved
        text = "Summarize the document in %d paragraph%s." % (n, "" if n == 1 else "s")
    elif action == "summarize" and not text:
        text = "Summarize the document"
    now = time.time()
    with conn() as c:
        chat = own_chat(c, chat_id, user["id"])
        uid = c.execute("INSERT INTO messages(chat_id, role, text, status, created) VALUES (?,?,?,?,?)", (chat_id, "user", text, "done", now)).lastrowid
        aid = c.execute("INSERT INTO messages(chat_id, role, text, status, progress, created) VALUES (?,?,?,?,?,?)", (chat_id, "assistant", "", "pending", "Waiting", now)).lastrowid
        if chat["title"] == "New chat":
            c.execute("UPDATE chats SET title = ? WHERE id = ?", (text[:48], chat_id))
        c.execute("UPDATE chats SET updated = ? WHERE id = ?", (now, chat_id))
    POOL.submit(run_message, chat_id, uid, aid, text, action)
    return {"id": aid}


_WHAT = r"(?:this|it|that|the (?:text|following|above|passage|paragraph|notes|lecture|article)|these notes|my notes)"
_ASK = re.compile(r"\b(?:(?:can|could|would|will) you )?(?:please )?(?:summari[sz]e|(?:give me|write|make) a summary of|shorten) "
                  + _WHAT + r"(?: for me)?(?: please)?(?: in (?:\d+|one|two|three|four|five|six) paragraphs?)?[.?!]*", re.I)


def split_pasted_summary(q_en):
    """A long text pasted into the chat together with a request such as 'can you summarize this'.
    Returns (the text without the request, number of paragraphs asked for or 0),
    or ("", 0) when the message is not a pasted text with a summary request."""
    if not _ASK.search(q_en):
        return "", 0
    text = " ".join(_ASK.sub(" ", q_en).split())
    if len(text.split()) < 60:          # too short to be a pasted text
        return "", 0
    n = parse_summary_request(q_en[:200], q_en[:200], True)[1] or parse_summary_request(q_en[-200:], q_en[-200:], True)[1]
    return text, n


def run_message(chat_id, user_msg_id, asst_id, text, action):
    def setp(p):
        with conn() as c:
            c.execute("UPDATE messages SET progress = ? WHERE id = ?", (p, asst_id))
    try:
        setp("Understanding your question")
        with conn() as c:   # only the NEWEST ready file is used, so two documents never get mixed
            docs = c.execute("SELECT id, name, en_text, created FROM docs WHERE chat_id = ? AND status = 'ready' ORDER BY id DESC LIMIT 1", (chat_id,)).fetchall()
        q_en = ENGINE.to_en(text)
        is_sum, n_par, q_en = parse_summary_request(text, q_en, bool(docs))
        since = docs[0]["created"] if docs else 0
        with conn() as c:
            c.execute("UPDATE messages SET en = ? WHERE id = ?", (q_en, user_msg_id))
            past = c.execute("SELECT role, en FROM messages WHERE chat_id = ? AND id < ? AND status = 'done' AND en IS NOT NULL AND created >= ? ORDER BY id DESC LIMIT 6",
                             (chat_id, user_msg_id, since)).fetchall()   # nothing from before the file was attached
        history = [{"role": r["role"], "content": r["en"][:600]} for r in reversed(past)]

        pasted, n_pasted = ("", 0)
        if not docs and action == "chat":   # a long text pasted into the message with "summarize this"
            pasted, n_pasted = split_pasted_summary(q_en)
        if pasted:
            setp("Summarizing the text")
            en = ENGINE.summarize_chunks(chunk_text(split_english(pasted), 300), setp, request="Summarize the text.", paragraphs=n_pasted)
            setp("Translating the summary to Dzongkha")
            dz = ENGINE.to_dz(en)
        elif action == "summarize" or (docs and is_sum):
            if not docs:
                en = "There is no document in this chat yet. Please attach a PDF or text file first."
                dz = ENGINE.to_dz(en, chat=True)   # short fixed reply, so the chat route
            else:
                en_parts, dz_parts = [], []
                for d in docs:
                    chunks, _ = doc_index(d["id"], d["en_text"])
                    s = ENGINE.summarize_chunks(chunks, lambda m, n=d["name"]: setp(f"{n}: {m}"), request=q_en, paragraphs=n_par)
                    setp("Translating the summary to Dzongkha")
                    s_dz = ENGINE.to_dz(s)   # documents and summaries use the same length-based routing
                    if len(docs) > 1:
                        en_parts.append(f"{d['name']}:\n{s}")
                        dz_parts.append(f"{d['name']}:\n{s_dz}")
                    else:
                        en_parts.append(s)
                        dz_parts.append(s_dz)
                en, dz = "\n\n".join(en_parts), "\n\n".join(dz_parts)
        else:
            excerpts = []
            if docs:
                setp("Searching the document")
                items = []
                for d in docs:
                    chunks, vecs = doc_index(d["id"], d["en_text"])
                    for i, ch in enumerate(chunks):
                        items.append((d["name"], ch, None if vecs is None else vecs[i]))
                excerpts = ENGINE.retrieve(q_en, items, k=4)
            setp("Thinking")
            en = ENGINE.answer(q_en, excerpts, history)
            setp("Translating the answer to Dzongkha")
            dz = ENGINE.to_dz(en, chat=not excerpts)   # plain chat uses the chat route, document answers the default one
        with conn() as c:
            c.execute("UPDATE messages SET text = ?, en = ?, status = 'done', progress = '' WHERE id = ?", (dz, en, asst_id))
            c.execute("UPDATE chats SET updated = ? WHERE id = ?", (time.time(), chat_id))
    except Exception as e:
        with conn() as c:
            c.execute("UPDATE messages SET text = ?, status = 'error', progress = '' WHERE id = ?", (f"Something went wrong: {e}", asst_id))


init_db()

if __name__ == "__main__":
    import uvicorn
    print("Open http://127.0.0.1:8000 in your browser")
    uvicorn.run(app, host="127.0.0.1", port=8000)
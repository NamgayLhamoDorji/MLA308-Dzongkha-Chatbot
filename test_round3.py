import csv
import io
import os
import tempfile
import zipfile

os.environ["DZO_FAKE"] = "1"
os.environ["DZO_DB"] = os.path.join(tempfile.mkdtemp(), "r3.db")

import compare_translators  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from test_server import server, wait as _w  # noqa: E402

client = TestClient(server.app)


def wait(cid, cond, tries=100):
    import time
    for _ in range(tries):
        d = client.get(f"/api/chats/{cid}").json()
        if cond(d):
            return d
        time.sleep(0.05)
    raise AssertionError(str(d))
from text_utils import docx_to_text, parse_summary_request  # noqa: E402
from translate import Translator  # noqa: E402


def test_phrasebook_wins_and_reloads(tmp_path):
    pb = tmp_path / "pb.txt"
    pb.write_text("# c\nHello! How can I help you? | ཀུ་ཟུ།\n", encoding="utf-8")
    calls = []
    t = Translator(lambda s: calls.append(s) or "EN", lambda s: calls.append(s) or "ཨ་ཀ", str(tmp_path / "c.db"), str(pb))
    assert t._one("hello how can i help you", "en", "dz") == "ཀུ་ཟུ།"
    assert t._one("ཀུ་ཟུ།", "dz", "en") == "Hello! How can I help you?"
    assert not calls
    assert t._one("Other sentence.", "en", "dz") == "ཨ་ཀ" and calls
    os.utime(pb, (1, 1))
    pb.write_text("Other sentence. | གཞན།\n", encoding="utf-8")
    assert t._one("Other sentence.", "en", "dz") == "གཞན།"


def test_middle_dot_removed(tmp_path):
    t = Translator(lambda s: "Hel·lo there friend", lambda s: "x", str(tmp_path / "c.db"))
    assert t._one("ཀ་ཁ་ག་ང་ཅ་ཆ།", "dz", "en") == "Hello there friend"


def _docx(paras):
    body = "".join(f"<w:p><w:r><w:t>{p}</w:t></w:r></w:p>" for p in paras)
    xml = f'<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>{body}</w:body></w:document>'
    b = io.BytesIO()
    with zipfile.ZipFile(b, "w") as z:
        z.writestr("word/document.xml", xml)
    return b.getvalue()


def test_docx_reader_and_bad_file():
    assert "Second paragraph." in docx_to_text(_docx(["First one is here.", "Second paragraph."]))
    try:
        docx_to_text(b"nope")
        assert False
    except ValueError:
        pass


def test_dz_heuristic_needs_document():
    q = "Enter the document in columns 2."
    t = "ཡིག་ཆ་འདི་ཚན་པ་༢ ནང་བཀོད་གནང་།"   # no word for "summary", as machine translation produces it
    assert parse_summary_request(t, q, True)[:2] == (True, 2)
    assert not parse_summary_request(t, q, False)[0]


def _login():
    client.post("/api/register", json={"username": "r3user", "password": "secret1"})
    client.post("/api/login", json={"username": "r3user", "password": "secret1"})
    return client.post("/api/chats").json()["id"]


def test_word_upload_and_paragraph_selector():
    cid = _login()
    paras = [f"Section {i} explains an important idea number {i} in detail." for i in range(1, 7)]
    r = client.post(f"/api/chats/{cid}/upload", files={"file": ("a.docx", _docx(paras), "application/octet-stream")})
    assert r.status_code == 200
    wait(cid, lambda d: d["docs"] and d["docs"][0]["status"] == "ready")
    client.post(f"/api/chats/{cid}/messages", json={"text": "", "action": "summarize", "paragraphs": 3})
    d = wait(cid, lambda d: d["messages"][-1]["status"] != "pending")
    assert d["messages"][0]["en"] == "Summarize the document in 3 paragraphs."
    assert d["messages"][-1]["status"] == "done"


def test_only_newest_document_is_summarized(monkeypatch):
    cid = _login()
    seen = []
    orig = server.ENGINE.summarize_chunks

    def spy(chunks, *a, **k):
        seen.append(" ".join(chunks))
        return orig(chunks, *a, **k)

    monkeypatch.setattr(server.ENGINE, "summarize_chunks", spy)
    for name, word in (("one.txt", "ALPHA"), ("two.txt", "BRAVO")):
        client.post(f"/api/chats/{cid}/upload", files={"file": (name, f"The {word} document has a long enough sentence for reading.".encode(), "text/plain")})
        wait(cid, lambda d, n=name: any(x["name"] == n and x["status"] == "ready" for x in d["docs"]))
    client.post(f"/api/chats/{cid}/messages", json={"text": "", "action": "summarize"})
    wait(cid, lambda d: d["messages"][-1]["status"] != "pending")
    assert len(seen) == 1 and "BRAVO" in seen[0] and "ALPHA" not in seen[0]


def test_compare_script(tmp_path):
    out = tmp_path / "c.csv"
    compare_translators.run(["Hello."], "en", "dz", {"a": lambda s, t: (lambda x: f"{s}>{t}:{x}")}, str(out))
    rows = list(csv.DictReader(open(out, encoding="utf-8-sig")))
    assert rows[0]["a"] == "en>dz:Hello." and rows[0]["back_a"].startswith("dz>en:") and "dzonext" in rows[0]

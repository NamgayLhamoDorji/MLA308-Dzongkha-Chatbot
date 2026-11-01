import io
import os
import tempfile
import time

os.environ["DZO_FAKE"] = "1"
os.environ["DZO_DB"] = os.path.join(tempfile.mkdtemp(), "test.db")

from fastapi.testclient import TestClient  # noqa: E402
import server  # noqa: E402

client = TestClient(server.app)


def wait(cid, cond, tries=100):
    for _ in range(tries):
        d = client.get(f"/api/chats/{cid}").json()
        if cond(d):
            return d
        time.sleep(0.05)
    raise AssertionError("timed out: " + str(d))


def make_pdf(pages):
    from reportlab.pdfgen import canvas
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    for i in range(pages):
        c.drawString(72, 750, f"Page {i + 1} talks about topic number {i + 1} of the long report.")
        c.drawString(72, 730, "It continues on a second line without ending the sentence")
        c.drawString(72, 710, "until here.")
        c.showPage()
    c.save()
    return buf.getvalue()


def test_requires_login():
    assert client.get("/api/chats").status_code == 401


def test_accounts_and_history():
    assert client.post("/api/register", json={"username": "ab", "password": "secret1"}).status_code == 400
    assert client.post("/api/register", json={"username": "lhamo", "password": "secret1"}).status_code == 200
    assert client.post("/api/register", json={"username": "lhamo", "password": "other22"}).status_code == 409
    client.post("/api/logout")
    assert client.post("/api/login", json={"username": "lhamo", "password": "wrong!!"}).status_code == 400
    assert client.post("/api/login", json={"username": "lhamo", "password": "secret1"}).status_code == 200
    cid = client.post("/api/chats").json()["id"]
    assert client.post(f"/api/chats/{cid}/messages", json={"text": "Hello there"}).status_code == 200
    d = wait(cid, lambda d: d["messages"][-1]["status"] == "done")
    assert d["title"] == "Hello there" and len(d["messages"]) == 2
    assert d["messages"][1]["text"] and d["messages"][1]["en"] == "This is a test answer."
    # another user cannot see it
    other = TestClient(server.app)
    other.post("/api/register", json={"username": "karma", "password": "secret1"})
    assert other.get(f"/api/chats/{cid}").status_code == 404
    assert other.get("/api/chats").json() == []


def test_pdf_upload_reads_all_pages_and_summarizes():
    client.post("/api/login", json={"username": "lhamo", "password": "secret1"})
    cid = client.post("/api/chats").json()["id"]
    r = client.post(f"/api/chats/{cid}/upload", files={"file": ("report.pdf", make_pdf(12), "application/pdf")})
    assert r.status_code == 200
    d = wait(cid, lambda d: d["docs"] and d["docs"][0]["status"] == "ready")
    doc = d["docs"][0]
    assert doc["pages"] == 12 and doc["empty_pages"] == 0 and doc["words"] > 12 * 20
    # lines of one sentence were joined, so the text holds 12 whole sentences
    with server.conn() as c:
        text = c.execute("SELECT raw_text FROM docs WHERE id=?", (doc["id"],)).fetchone()["raw_text"]
    assert "second line without ending the sentence until here." in text and "topic number 12" in text
    client.post(f"/api/chats/{cid}/messages", json={"text": "", "action": "summarize"})
    d = wait(cid, lambda d: d["messages"][-1]["status"] != "pending")
    assert d["messages"][-1]["status"] == "done"
    client.post(f"/api/chats/{cid}/messages", json={"text": "What does page 3 say?"})
    d = wait(cid, lambda d: d["messages"][-1]["status"] != "pending")
    assert d["messages"][-1]["status"] == "done"


def test_bad_uploads():
    client.post("/api/login", json={"username": "lhamo", "password": "secret1"})
    cid = client.post("/api/chats").json()["id"]
    assert client.post(f"/api/chats/{cid}/upload", files={"file": ("x.exe", b"abc", "application/octet-stream")}).status_code == 400
    assert client.post(f"/api/chats/{cid}/upload", files={"file": ("e.txt", b"hi", "text/plain")}).status_code == 400


def test_delete_chat():
    client.post("/api/login", json={"username": "lhamo", "password": "secret1"})
    cid = client.post("/api/chats").json()["id"]
    assert client.delete(f"/api/chats/{cid}").status_code == 200
    assert client.get(f"/api/chats/{cid}").status_code == 404


def test_dzongkha_summary_instruction_is_understood():
    client.post("/api/login", json={"username": "lhamo", "password": "secret1"})
    cid = client.post("/api/chats").json()["id"]
    client.post(f"/api/chats/{cid}/upload", files={"file": ("e.txt", b"This is an English sentence that is long enough for the test.", "text/plain")})
    wait(cid, lambda d: d["docs"] and d["docs"][0]["status"] == "ready")
    # the fake translator turns every Dzongkha message into "A translated sentence." (a wrong guess)
    client.post(f"/api/chats/{cid}/messages", json={"text": "ཡིག་ཆ་འདི་ཚན་པ་༢ ནང་བསྡུས་གནང་།"})
    d = wait(cid, lambda d: d["messages"][-1]["status"] != "pending")
    assert d["messages"][0]["en"] == "Summarize the document in 2 paragraphs."
    assert d["messages"][-1]["status"] == "done"

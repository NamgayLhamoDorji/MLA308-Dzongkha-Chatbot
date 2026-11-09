"""Tests for the endpoints added for the Dzongkha AI interface (documents, saved summaries, formats, regenerate)."""
import os
import tempfile
import time

os.environ["DZO_FAKE"] = "1"
os.environ["DZO_DB"] = os.path.join(tempfile.mkdtemp(), "ui.db")

from fastapi.testclient import TestClient  # noqa: E402
import server  # noqa: E402
from pipeline import Engine  # noqa: E402

client = TestClient(server.app)
TEXT = ("Bhutan is a small country in the Himalayas. " * 12).encode()


def wait(cond, tries=100):
    for _ in range(tries):
        v = cond()
        if v:
            return v
        time.sleep(0.05)
    raise AssertionError("timed out")


def setup_doc():
    client.post("/api/register", json={"username": "uiuser", "password": "secret1"})
    cid = client.post("/api/chats").json()["id"]
    did = client.post(f"/api/chats/{cid}/upload", files={"file": ("notes.txt", TEXT)}).json()["id"]
    wait(lambda: client.get(f"/api/docs/{did}").json()["status"] == "ready")
    return cid, did


def test_static_and_docs_endpoints():
    assert client.get("/static/css/app.css").status_code == 200
    assert client.get("/static/js/core.js").status_code == 200
    cid, did = setup_doc()
    assert client.get(f"/api/chats/{cid}").json()["title"] == "notes.txt"   # chat is named after the first file
    docs = client.get("/api/docs").json()
    assert docs[0]["id"] == did and docs[0]["summaries"] == 0
    d = client.get(f"/api/docs/{did}").json()
    assert d["chat_id"] == cid and "Bhutan" in d["text"] and d["summaries"] == []
    assert client.get("/api/chats").json()[0]["docs"] == 1


def test_summary_formats_saving_regenerate_clear():
    cid, did = setup_doc()
    for fmt in ("brief", "detailed", "bullets", "points"):
        r = client.post(f"/api/chats/{cid}/messages", json={"action": "summarize", "format": fmt, "doc_id": did})
        assert r.status_code == 200
        wait(lambda: client.get(f"/api/docs/{did}").json()["summaries"][-1]["status"] == "done")
    sums = client.get(f"/api/docs/{did}").json()["summaries"]
    assert [s["fmt"] for s in sums][-4:] == ["brief", "detailed", "bullets", "points"]
    assert client.get("/api/docs").json()[0]["summaries"] >= 4
    # save, list, delete
    mid = sums[-1]["id"]
    sid = client.post("/api/summaries", json={"message_id": mid}).json()["id"]
    assert client.post("/api/summaries", json={"message_id": mid}).json()["id"] == sid   # no duplicates
    saved = client.get("/api/summaries").json()
    assert saved[0]["doc_name"] == "notes.txt" and saved[0]["chat_id"] == cid
    # regenerate in place
    assert client.post(f"/api/messages/{mid}/regenerate").status_code == 200
    wait(lambda: client.get(f"/api/docs/{did}").json()["summaries"][-1]["status"] == "done")
    # another user cannot touch any of it
    other = TestClient(server.app)
    other.post("/api/register", json={"username": "other1", "password": "secret1"})
    assert other.get(f"/api/docs/{did}").status_code == 404
    assert other.post("/api/summaries", json={"message_id": mid}).status_code == 404
    assert other.post(f"/api/messages/{mid}/regenerate").status_code == 404
    assert other.delete(f"/api/summaries/{sid}").status_code == 404
    assert other.get("/api/docs").json() == []
    # the saved copy survives deleting the document; the original is then unavailable
    client.delete(f"/api/docs/{did}")
    assert client.get("/api/summaries").json()[0]["chat_id"] is None
    assert client.delete(f"/api/summaries/{sid}").status_code == 200
    # clear conversation
    assert client.delete(f"/api/chats/{cid}/messages").status_code == 200
    assert client.get(f"/api/chats/{cid}").json()["messages"] == []


def test_bullet_and_point_styles_return_one_line_per_point():
    asked = []

    def ask(prompt, **kw):
        asked.append(prompt)
        return "Here are the points:\n- First fact about Bhutan.\n- Second fact.\n* Third fact.\n1. Fourth fact."
    eng = Engine(None, ask, None)
    out = eng.summarize_chunks(["Bhutan is in the Himalayas. It has mountains."], style="bullets")
    assert out.split("\n") == ["First fact about Bhutan.", "Second fact.", "Third fact.", "Fourth fact."]
    assert "bullet points" in asked[-1]
    eng.summarize_chunks(["Bhutan is in the Himalayas."], style="points")
    assert "4 to 6" in asked[-1]
    one = eng.summarize_chunks(["Bhutan is in the Himalayas. " * 10], style="brief")
    assert "\n\n" not in one

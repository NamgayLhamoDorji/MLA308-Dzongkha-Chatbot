from text_utils import *
from translate import Translator
from pipeline import Engine

S, T, DS = "།", "་", "༎"

def test_detect():
    assert is_dzongkha("བཀྲ་ཤིས་བདེ་ལེགས།") and not is_dzongkha("hello world")

def test_normalize_spaces_and_double_shad():
    assert normalize("ཀ་ཁ་ ། ། ག་ང་ །") == "ཀ་ཁ་།། ག་ང་།"
    assert TSHEG_NB not in normalize("ཀ༌ཁ")

def test_split_basic_and_merge_short():
    t = "ང་བཀྲ་ཤིས་བདེ་ལེགས་ཞུ་གི་ཨིན།" + " ཡིག་ཚང་།" + " ང་ཁྱོད་ལུ་བྱམས་བརྩེ་ཨིན།"
    parts = split_dzongkha(t)
    assert len(parts) == 2 and all(syllables(p) >= 6 for p in parts)

def test_ga_before_shad_without_tsheg():
    # ག directly followed by shad (no tsheg) still ends the clause
    parts = split_dzongkha("ང་དེབ་ཀློག་གི་ཡོད་པའི་ཐོག་ལས་འགྲོ་དགོ" + "ག" + S + "ཁོ་ར་ཡང་འོང་གི་ཨིན།")
    assert len(parts) == 2 and syllables(parts[0]) >= 6

def test_poem_double_shad_hard_break():
    verse = "ཀ་ཁ་ག་ང་" + DS + "ཅ་ཆ་ཇ་ཉ་" + DS
    assert len(split_dzongkha(verse)) == 2

def test_english_split():
    assert split_english("Hi there. How are you? Fine!") == ["Hi there.", "How are you?", "Fine!"]

def test_join_lines_repairs_pdf_breaks():
    assert join_lines("The model reads\nthe whole file.\nNext one.") == "The model reads the whole file.\nNext one."
    assert join_lines("ང་བཀྲ་ཤིས་\nབདེ་ལེགས།\nཁོ་ར།") == "ང་བཀྲ་ཤིས་ བདེ་ལེགས།\nཁོ་ར།"


def test_engine_with_fakes(tmp_path):
    calls = []
    tr = Translator(lambda x: calls.append(x) or "It rains today.", lambda x: "DZ:" + x, str(tmp_path / "c.db"))
    eng = Engine(tr, lambda p, **kw: "Answer.")
    en = eng.document_to_english("Plain English line.\nང་བཀྲ་ཤིས་བདེ་ལེགས་ཞུ་གི་ཨིན།")
    assert en == "Plain English line.\nIt rains today."
    assert eng.to_dz("- One.\n- Two.") == "DZ:One.\nDZ:Two."
    eng.document_to_english("ང་བཀྲ་ཤིས་བདེ་ལེགས་ཞུ་གི་ཨིན།")
    assert len(calls) == 1   # second time comes from the cache


def test_summary_reads_every_chunk():
    seen = []
    eng = Engine(None, lambda p, **kw: seen.append(p) or "note")
    chunks = [f"chunk{i} " * 5 for i in range(9)]
    eng.summarize_chunks(chunks)
    assert all(any(f"chunk{i} " in p for p in seen) for i in range(9))


def test_retrieve_keywords():
    eng = Engine(None, None)
    items = [("a", "cats and dogs", None), ("a", "the budget for next year is large", None), ("a", "weather today", None)]
    assert eng.retrieve("what is the budget", items, k=1) == ["the budget for next year is large"]


def test_parse_google():
    from translate import parse_google
    assert parse_google([[["Hello ", "x", None], ["world.", "y", None]], None, "dz"]) == "Hello world."


def test_parse_summary_request():
    assert parse_summary_request("summarize in 2 paragraph", "summarize in 2 paragraph") == (True, 2, "Summarize the document in 2 paragraphs.")
    assert parse_summary_request("Please summarize in three paragraphs", "Please summarize in three paragraphs")[1] == 3
    assert parse_summary_request("What is the capital?", "What is the capital?") == (False, None, "What is the capital?")
    # a Dzongkha instruction that Google mistranslated is still understood from the original text
    dz = "ཡིག་ཆ་འདི་ཚན་པ་༢ ནང་བསྡུས་གནང་།"
    assert parse_summary_request(dz, "Can this document be divided into two sets?") == (True, 2, "Summarize the document in 2 paragraphs.")
    assert parse_summary_request("ཡིག་ཆ་འདི་བསྡུས་གནང་།", "Please summarize.")[:2] == (True, None)


def test_shape_paragraphs():
    t = "One. Two. Three. Four. Five. Six."
    assert shape_paragraphs(t, 2) == "One. Two. Three.\n\nFour. Five. Six."
    assert shape_paragraphs(t, 4).count("\n\n") == 3
    assert shape_paragraphs("Only one.", 3) == "Only one."


def test_summary_has_requested_paragraphs():
    one_block = "A one. B two. C three. D four. E five. F six."
    eng = Engine(None, lambda p, **kw: one_block)
    out = eng.summarize_chunks(["some text " * 5], request="Summarize the document in 2 paragraphs.", paragraphs=2)
    assert out.count("\n\n") == 1
    assert "\n\n" not in eng.summarize_chunks(["some text " * 5])   # no count asked: left to the model


def test_google_stops_at_429_and_fallback_takes_over(monkeypatch):
    import requests
    import translate as T
    calls = []

    class R:
        status_code = 429
        def raise_for_status(self):
            raise requests.HTTPError("429 Client Error: Too Many Requests")

    monkeypatch.setattr(requests, "get", lambda *a, **k: calls.append(1) or R())
    g = T.google_backend("en", "dz", min_gap=0)
    try:
        g("Hi")
        assert False
    except RuntimeError as e:
        assert "429" in str(e)
    assert len(calls) == 1                      # no hammering after a 429
    used = []
    f = T.with_fallback(g, lambda t: used.append(t) or "local:" + t, cooldown=60)
    assert f("a") == "local:a" and f("b") == "local:b"
    assert len(calls) == 2                      # Google was tried once more for "a", then skipped for "b"

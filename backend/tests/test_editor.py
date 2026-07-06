"""Transcript-editor backend helpers: interval normalization, sentence
grouping, caption overrides."""
from main import _normalize_keep, _group_sentences, _apply_caption_overrides


# ── _normalize_keep ───────────────────────────────────────────────────────────

def test_normalize_sorts_and_merges_overlaps():
    keep = [[10.0, 15.0], [5.0, 10.02], [30.0, 31.0]]
    assert _normalize_keep(keep) == [(5.0, 15.0), (30.0, 31.0)]


def test_normalize_clamps_to_source_and_drops_slivers():
    keep = [[-5.0, 4.0], [100.0, 100.1], [90.0, 200.0]]
    assert _normalize_keep(keep, source_dur=120.0) == [(0.0, 4.0), (90.0, 120.0)]


def test_normalize_rejects_garbage():
    assert _normalize_keep([["a", 1], [None], [], [5]]) == []
    assert _normalize_keep(None) == []


# ── _group_sentences ──────────────────────────────────────────────────────────

def _seg(words):
    return {"start": words[0][1], "end": words[-1][2], "text": " ".join(w[0] for w in words),
            "words": [{"word": w, "start": s, "end": e} for w, s, e in words]}


def test_sentences_split_on_punctuation_and_gaps():
    segs = [_seg([("Hello", 0.0, 0.4), ("world.", 0.5, 0.9),
                  ("Next", 1.0, 1.3), ("thought", 1.4, 1.8),
                  # >0.8s gap forces a split even without punctuation:
                  ("after", 3.0, 3.4), ("pause", 3.5, 3.9)])]
    out = _group_sentences(segs)
    assert [s["text"] for s in out] == ["Hello world.", "Next thought", "after pause"]


def test_sentences_window_filter():
    segs = [_seg([("one.", 0.0, 1.0), ("two.", 10.0, 11.0), ("three.", 20.0, 21.0)])]
    out = _group_sentences(segs, t0=5.0, t1=15.0)
    assert [s["text"] for s in out] == ["two."]


# ── _apply_caption_overrides ──────────────────────────────────────────────────

def test_override_replaces_window_and_keeps_rest():
    segs = [_seg([("keep", 0.0, 0.5), ("wrong", 1.0, 1.5), ("words", 1.6, 2.0),
                  ("tail", 3.0, 3.5)])]
    out = _apply_caption_overrides(segs, [{"start": 0.9, "end": 2.1, "text": "right stuff"}])
    words = [w["word"] for s in out for w in s["words"]]
    assert words == ["keep", "right", "stuff", "tail"]
    # replaced words live inside the override window, in order
    rs = [w for s in out for w in s["words"] if w["word"] in ("right", "stuff")]
    assert rs[0]["start"] >= 0.9 and rs[-1]["end"] <= 2.1
    assert rs[0]["start"] < rs[1]["start"]


def test_override_noop_on_empty():
    segs = [_seg([("a", 0.0, 0.5)])]
    assert _apply_caption_overrides(segs, []) is segs
    assert _apply_caption_overrides(segs, [{"start": 5, "end": 4, "text": "x"}]) is segs

"""Transcript-editor backend helpers: interval normalization, sentence
grouping, caption overrides, filler-word cuts."""
from main import (_normalize_keep, _group_sentences, _apply_caption_overrides,
                  _filler_cut_intervals, _subtract_intervals)


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


# ── filler-word cleanup ───────────────────────────────────────────────────────

def test_filler_detection_padded_and_windowed():
    segs = [_seg([("So", 10.0, 10.3), ("um,", 10.4, 10.8), ("yeah", 10.9, 11.2),
                  ("Uh", 20.0, 20.3), ("next", 20.4, 20.8),
                  ("um", 99.0, 99.3)])]  # outside the clip window
    cuts = _filler_cut_intervals(segs, clip_start=10.0, clip_end=30.0)
    assert len(cuts) == 2
    # clip-relative, padded outward by 0.04
    assert abs(cuts[0][0] - 0.36) < 1e-6 and abs(cuts[0][1] - 0.84) < 1e-6
    assert abs(cuts[1][0] - 9.96) < 1e-6


def test_filler_ignores_real_words():
    segs = [_seg([("umbrella", 0.0, 0.5), ("terminal", 0.6, 1.1), ("like", 1.2, 1.5)])]
    assert _filler_cut_intervals(segs, 0.0, 10.0) == []


def test_subtract_intervals_splits_keep():
    keep = [(0.0, 10.0)]
    cuts = [(2.0, 3.0), (5.0, 5.5)]
    assert _subtract_intervals(keep, cuts) == [(0.0, 2.0), (3.0, 5.0), (5.5, 10.0)]


def test_subtract_composes_with_editor_cuts():
    # Editor kept two spans; a filler sits inside the second one.
    keep = [(0.0, 4.0), (6.0, 12.0)]
    cuts = [(7.0, 7.4)]
    assert _subtract_intervals(keep, cuts) == [(0.0, 4.0), (6.0, 7.0), (7.4, 12.0)]


def test_subtract_drops_slivers_and_handles_noop():
    keep = [(0.0, 1.0)]
    # cut leaves a 0.1s sliver at the front — dropped
    assert _subtract_intervals(keep, [(0.1, 1.0)]) == []
    assert _subtract_intervals(keep, []) == keep


# ── exports: SRT / Premiere XML / FCPXML ─────────────────────────────────────

from main import _format_srt, _format_xmeml, _format_fcpxml, _export_segments  # noqa: E402
import xml.etree.ElementTree as ET  # noqa: E402

WORDS = [{"word": "Hello", "start": 0.0, "end": 0.4},
         {"word": "world.", "start": 0.5, "end": 0.9},
         {"word": "After", "start": 2.0, "end": 2.4},   # >0.6s gap → new block
         {"word": "a", "start": 2.5, "end": 2.6},
         {"word": "pause.", "start": 2.7, "end": 3.1}]

META_CUT = {"fps": 29.97, "src_w": 1920, "src_h": 1080, "start": 100.0,
            "end": 130.0, "duration": 24.0,
            "keep": [[0.0, 10.0], [16.0, 30.0]], "words": WORDS}


def test_srt_blocks_and_timestamps():
    srt = _format_srt(WORDS)
    blocks = srt.strip().split("\n\n")
    assert len(blocks) == 2
    assert "00:00:00,000 --> 00:00:00,900" in blocks[0]
    assert blocks[0].endswith("Hello world.")
    assert "00:00:02,000 --> 00:00:03,100" in blocks[1]


def test_export_segments_source_time():
    assert _export_segments(META_CUT) == [(100.0, 110.0), (116.0, 130.0)]
    assert _export_segments({**META_CUT, "keep": None}) == [(100.0, 130.0)]


def test_xmeml_wellformed_with_cut_items():
    xml = _format_xmeml(META_CUT, 'Title & "quotes"', "abc123.mp4")
    root = ET.fromstring(xml)  # raises if malformed (escaping matters!)
    items = root.findall(".//clipitem")
    assert len(items) == 2
    # second clipitem starts on the timeline where the first ended
    assert items[1].find("start").text == items[0].find("end").text
    # source in/out at timebase 30: 116s → 3480
    assert items[1].find("in").text == "3480"


def test_fcpxml_wellformed_and_frame_aligned():
    xml = _format_fcpxml(META_CUT, "My Clip", "abc123.mp4")
    root = ET.fromstring(xml)
    clips = root.findall(".//asset-clip")
    assert len(clips) == 2
    # NTSC 29.97 → all times are multiples of 1001/30000s
    for c in clips:
        for attr in ("offset", "start", "duration"):
            num = int(c.get(attr).split("/")[0])
            assert num % 1001 == 0

"""Caption template regression tests.

The CaptionTemplate registry replaced the raw _CAPTION_STYLES strings; the three
legacy keys MUST keep emitting byte-identical ASS style lines so channels and
backfills with saved caption_style values render exactly as before.
"""
import main
from main import CAPTION_TEMPLATES, build_ass_subtitles


# The exact strings that shipped in _CAPTION_STYLES before the registry refactor.
LEGACY_LINES = {
    "bold_bottom": (
        "ClipForgeCaps,72,&H00FFFFFF,&H0000FF2B,&H00000000,&H80000000,-1,0,0,0,100,100,2,0,1,3,2,2,80,80,500,1",
        "ClipForgeCaps,72,&H0000FF2B,&H0000FF2B,&H00000000,&H80000000,-1,0,0,0,100,100,2,0,1,3,2,2,80,80,500,1",
    ),
    "center_pop": (
        "ClipForgeCaps,88,&H00FFFFFF,&H0000FFFF,&H00000000,&HFF000000,-1,0,0,0,100,100,2,0,1,5,0,5,80,80,0,1",
        "ClipForgeCaps,88,&H0000FFFF,&H0000FFFF,&H00000000,&HFF000000,-1,0,0,0,100,100,2,0,1,5,0,5,80,80,0,1",
    ),
    "minimal": (
        "Montserrat,56,&H00FFFFFF,&H00FFFFFF,&H00000000,&HFF000000,0,0,0,0,100,100,2,0,1,2,0,2,80,80,400,1",
        "Montserrat,56,&H00FFFFFF,&H00FFFFFF,&H00000000,&HFF000000,0,0,0,0,100,100,2,0,1,2,0,2,80,80,400,1",
    ),
}

SEGMENTS = [{
    "start": 0.0, "end": 2.4, "text": "STUCK SPINNING YOUR WHEELS",
    "words": [
        {"word": "STUCK", "start": 0.0, "end": 0.6},
        {"word": "SPINNING", "start": 0.6, "end": 1.2},
        {"word": "YOUR", "start": 1.2, "end": 1.7},
        {"word": "WHEELS", "start": 1.7, "end": 2.4},
    ],
}]


def _build(tmp_path, style, **kw):
    out = tmp_path / f"{style}.ass"
    build_ass_subtitles(SEGMENTS, 0.0, 2.4, out, 1080, 1920, caption_style=style, **kw)
    return out.read_text(encoding="utf-8")


def test_legacy_styles_byte_identical():
    for key, (default, highlight) in LEGACY_LINES.items():
        got_default, got_highlight = CAPTION_TEMPLATES[key].style_lines()
        assert got_default == default, f"{key} Default line drifted"
        assert got_highlight == highlight, f"{key} Highlight line drifted"


def test_every_template_builds_valid_ass(tmp_path):
    for key in CAPTION_TEMPLATES:
        content = _build(tmp_path, key)
        assert "[Script Info]" in content and "[V4+ Styles]" in content, key


def test_none_template_has_no_dialogue(tmp_path):
    content = _build(tmp_path, "none")
    assert "Dialogue:" not in content


def test_static_mode_single_event_per_line(tmp_path):
    content = _build(tmp_path, "bold_statement")
    dialogues = [l for l in content.splitlines() if l.startswith("Dialogue:")]
    # 4 words, words_per_line=6 → one line → one event (no per-word redraw)
    assert len(dialogues) == 1
    assert "STUCK SPINNING YOUR WHEELS" in dialogues[0]


def test_pop_mode_one_event_per_word(tmp_path):
    content = _build(tmp_path, "bold_bottom")
    dialogues = [l for l in content.splitlines() if l.startswith("Dialogue:")]
    assert len(dialogues) == 4  # tail word merged into the single 3-word line +1


def test_active_lead_shifts_highlight_early(tmp_path):
    # bold_bottom has active_lead_ms=80: the 2nd word's event starts ~80ms
    # before its audio (0.6s → 0.52s), i.e. ASS timestamp 0:00:00.52.
    content = _build(tmp_path, "bold_bottom")
    dialogues = [l for l in content.splitlines() if l.startswith("Dialogue:")]
    assert dialogues[1].split(",")[1] == "0:00:00.52"


def test_simple_template_keeps_sentence_case(tmp_path):
    out = tmp_path / "case.ass"
    segs = [{"start": 0.0, "end": 1.0, "text": "Hello there",
             "words": [{"word": "Hello", "start": 0.0, "end": 0.5},
                       {"word": "there", "start": 0.5, "end": 1.0}]}]
    build_ass_subtitles(segs, 0.0, 1.0, out, 1080, 1920, caption_style="simple")
    content = out.read_text(encoding="utf-8")
    assert "Hello" in content and "HELLO" not in content


def test_overrides_still_apply(tmp_path):
    content = _build(tmp_path, "bold_bottom", font_size=100,
                     highlight_color="#FF0000", margin_v_override=300,
                     alignment_override=8)
    style = next(l for l in content.splitlines() if l.startswith("Style: Default,"))
    parts = style[len("Style: Default,"):].split(",")
    assert parts[1] == "100"          # font size
    assert parts[3] == "&H000000FF"   # highlight → ASS BGR red
    assert parts[17] == "8"           # alignment
    assert parts[20] == "300"         # MarginV


def test_beasty_embeds_bangers_font(tmp_path):
    content = _build(tmp_path, "beasty")
    assert "fontname: Bangers-Regular_0.ttf" in content


def test_minimal_does_not_embed_font(tmp_path):
    # Montserrat isn't bundled — minimal must not emit a [Fonts] section,
    # matching pre-refactor behavior.
    content = _build(tmp_path, "minimal")
    assert "[Fonts]" not in content


def test_keyword_layer_colors_keyword_in_pop(tmp_path):
    # "WHEELS" is a keyword: in events where it is NOT the active word it must
    # carry the template's keyword colour (gold &H00D7FF) instead of base white.
    content = _build(tmp_path, "bold_bottom", keywords=["wheels"])
    dialogues = [l for l in content.splitlines() if l.startswith("Dialogue:")]
    first = dialogues[0]  # STUCK active; WHEELS inactive keyword
    assert "{\\1c&H00D7FF&}WHEELS" in first
    # In its own active window, WHEELS gets the ACTIVE colour, not keyword.
    last = dialogues[-1]
    assert "{\\1c&H00FF2B&}WHEELS" in last


def test_keyword_layer_in_karaoke_mode(tmp_path):
    content = _build(tmp_path, "minimal", keywords=["your"])
    line = next(l for l in content.splitlines() if l.startswith("Dialogue:"))
    assert "\\1c&H00D7FF&}YOUR" in line


def test_no_keywords_means_no_keyword_color(tmp_path):
    content = _build(tmp_path, "bold_bottom")
    assert "&H00D7FF&" not in content

# -*- coding: utf-8 -*-
"""Golden-render harness for the layout refactor (not collected by pytest).

Usage:
    python tests/golden_render.py capture   # render every style, store frame hashes
    python tests/golden_render.py verify    # re-render, compare against stored hashes

Renders each clip style (center-crop, reframe, blur_bg, facecam) through the
REAL create_clips on a synthetic source, extracts frames, and hashes them.
Run `capture` before the refactor and `verify` after — identical hashes prove
the refactor changed no rendered pixel.

Frames are compared via average-hash (16x16 grayscale) rather than exact bytes
so non-deterministic encoder noise doesn't false-positive; layout mistakes
(wrong crop/scale/stack) shift many hash bits.
"""
import asyncio
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path
from unittest.mock import MagicMock

HERE = Path(__file__).parent
BACKEND = HERE.parent
sys.path.insert(0, str(BACKEND))

for k, v in [("GROQ_API_KEY", "t"), ("SUPABASE_URL", "https://t.co"),
             ("SUPABASE_ANON_KEY", "a"), ("SUPABASE_SERVICE_KEY", "s")]:
    os.environ.setdefault(k, v)
sys.modules.setdefault("supabase", MagicMock())

import main  # noqa: E402

WORK = BACKEND / "tests" / "_golden"
GOLDEN_FILE = HERE / "golden_hashes.json"

SEGMENTS = [{
    "start": 0.0, "end": 6.0, "text": "THIS IS THE GOLDEN RENDER TEST CLIP OKAY",
    "words": [
        {"word": w, "start": round(i * 0.75, 2), "end": round((i + 1) * 0.75, 2)}
        for i, w in enumerate(["THIS", "IS", "THE", "GOLDEN", "RENDER", "TEST", "CLIP", "OKAY"])
    ],
}]

CLIP_DEFS = [{
    "start": 0.0, "end": 6.0, "title": "Golden Test", "hook": "hook",
    "virality_score": 9, "reason": "r", "tags": ["a"],
    "keywords": ["golden"], "emojis": [{"word": "GOLDEN", "emoji": "\U0001F525"}],
}]

STYLES = [
    # (name, kwargs for create_clips)
    ("center",  {"reframe": False, "clip_style": "reframe"}),
    ("reframe", {"reframe": True,  "clip_style": "reframe"}),
    ("blur_bg", {"reframe": False, "clip_style": "blur_bg"}),
    ("facecam", {"reframe": False, "clip_style": "facecam"}),
]


def build_source(path: Path) -> None:
    """1920x1080 synthetic source: moving test pattern + a 'facecam' face in the
    bottom-left corner (real face image so YuNet detects it)."""
    face = HERE / "_face.jpg"
    if not face.exists():
        import urllib.request
        urllib.request.urlretrieve(
            "https://raw.githubusercontent.com/opencv/opencv/master/samples/data/lena.jpg", face)
    subprocess.run([
        main.FFMPEG, "-y", "-loglevel", "error",
        "-f", "lavfi", "-i", "testsrc2=s=1920x1080:r=25:d=6",
        "-i", str(face),
        "-filter_complex",
        "[1:v]scale=380:380[fc];[0:v][fc]overlay=40:660[v]",
        "-map", "[v]", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
        str(path),
    ], check=True)


def frame_hash(video: Path, t: float) -> str:
    """Average-hash of the frame at t: 16x16 grayscale, bit = pixel > mean."""
    r = subprocess.run([
        main.FFMPEG, "-loglevel", "error", "-ss", str(t), "-i", str(video),
        "-frames:v", "1", "-vf", "scale=16:16,format=gray",
        "-f", "rawvideo", "pipe:1",
    ], capture_output=True, check=True)
    px = r.stdout[:256]
    mean = sum(px) / len(px)
    bits = "".join("1" if p > mean else "0" for p in px)
    return hashlib.sha1(bits.encode()).hexdigest()[:16]


async def render_all() -> dict:
    import shutil
    shutil.rmtree(WORK, ignore_errors=True)
    WORK.mkdir(parents=True)
    src = WORK / "source.mp4"
    build_source(src)

    # Route pipeline outputs into the work dir
    main.OUTPUT_DIR = WORK / "output"
    main.OUTPUT_DIR.mkdir(exist_ok=True)

    hashes = {}
    for name, kw in STYLES:
        job_id = f"golden_{name}"
        job_dir = WORK / job_id
        job_dir.mkdir(exist_ok=True)
        clip_defs = [dict(CLIP_DEFS[0])]
        results = await main.create_clips(
            src, clip_defs, SEGMENTS, job_dir, job_id,
            caption_style="bold_bottom",
            **kw,
        )
        out = main.OUTPUT_DIR / job_id
        clips = sorted(out.glob("clip_*.mp4"))
        assert clips, f"{name}: no clip produced (results={results})"
        hashes[name] = [frame_hash(clips[0], t) for t in (0.5, 2.0, 4.5)]
        print(f"  {name}: {hashes[name]}")
    return hashes


def main_entry():
    mode = sys.argv[1] if len(sys.argv) > 1 else "capture"
    hashes = asyncio.run(render_all())
    if mode == "capture":
        GOLDEN_FILE.write_text(json.dumps(hashes, indent=2))
        print(f"golden hashes written → {GOLDEN_FILE}")
    else:
        golden = json.loads(GOLDEN_FILE.read_text())
        bad = []
        for name, hs in golden.items():
            got = hashes.get(name)
            if got != hs:
                bad.append(f"{name}: golden={hs} got={got}")
        if bad:
            print("GOLDEN MISMATCH:\n  " + "\n  ".join(bad))
            sys.exit(1)
        print("ALL GOLDEN RENDERS MATCH")


if __name__ == "__main__":
    main_entry()

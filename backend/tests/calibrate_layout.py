# -*- coding: utf-8 -*-
"""Auto-layout threshold calibration harness (manual tool, not pytest).

Usage (run on the SERVER, where YouTube downloads work):
    cd backend && python tests/calibrate_layout.py            # full corpus
    python tests/calibrate_layout.py --only gameplay          # one category
    python tests/calibrate_layout.py --url URL --expect fill  # ad-hoc video

For every corpus entry it downloads a short ≤720p slice (cached in
tests/_corpus/), runs the SAME probes the auto-layout uses in production
(_detect_face_clusters / _pick_split_speakers / _facecam_region_from_clusters /
_probe_motion_edges), prints expected-vs-decided with the raw probe values,
then grid-searches (motion_low, edge_high, motion_high) for the thresholds
that maximise corpus accuracy.
"""
import argparse
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

CORPUS_FILE = HERE / "layout_corpus.json"
CACHE = HERE / "_corpus"
CACHE.mkdir(exist_ok=True)


def download(entry: dict) -> Path:
    vid = entry["url"].split("v=")[-1].split("/")[-1].split("?")[0]
    out = CACHE / f"{vid}.mp4"
    if out.exists() and out.stat().st_size > 0:
        return out
    section = entry.get("section", "*120-360")
    cmd = [main.YTDLP, "--download-sections", section,
           "-f", "bv*[height<=720][vcodec^=avc1]+ba[ext=m4a]/b[height<=720]",
           "--merge-output-format", "mp4", "--force-keyframes-at-cuts",
           "-o", str(out), "--no-playlist"]
    # Reuse the production auth setup (cookies / PO tokens) when present.
    if main.COOKIES_FROM_BROWSER:
        cmd += ["--cookies-from-browser", main.COOKIES_FROM_BROWSER]
    elif main.COOKIES_FILE.exists():
        cmd += ["--cookies", str(main.COOKIES_FILE)]
    cmd += ["--extractor-args", "youtube:player_client=tv,mweb,web"]
    if main.POTTOKEN_URL:
        cmd += ["--extractor-args", f"youtubepot-bgutilhttp:base_url={main.POTTOKEN_URL}"]
    cmd += ["--", entry["url"]]
    print(f"  downloading {entry['url']} ({section}) ...", flush=True)
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if not out.exists():
        raise RuntimeError(f"download failed: {(r.stderr or '')[-300:]}")
    return out


def probe(video: Path) -> dict:
    p = subprocess.run([main.FFPROBE, "-v", "quiet", "-print_format", "json",
                        "-show_streams", str(video)], capture_output=True, text=True)
    vs = next(s for s in json.loads(p.stdout)["streams"] if s["codec_type"] == "video")
    w, h = int(vs["width"]), int(vs["height"])
    dur = float(vs.get("duration") or 240)

    clusters, n_ok = main._detect_face_clusters(video, w, h, dur)
    split = main._pick_split_speakers(clusters, n_ok, w)
    region = main._facecam_region_from_clusters(clusters, n_ok, w, h)
    motion = edges = None
    motion_full = edges_full = None
    corner = False
    campos = None
    if region:
        motion, edges = main._probe_motion_edges(video, dur, region["box"])
        corner = (region["fcx"] < w * 0.33 or region["fcx"] > w * 0.67
                  or region["fcy"] > h * 0.75)
        campos = (round(region["fcx"] / w, 2), round(region["fcy"] / h, 2))
    else:
        motion_full, edges_full = main._probe_motion_edges(video, dur, None)
    face_evidence = sum(c["hits"] for c in clusters)
    return {"w": w, "h": h, "n_faces": len(clusters), "n_ok": n_ok,
            "split": bool(split), "cam": bool(region), "corner": corner,
            "campos": campos,
            "motion": motion, "edges": edges,
            "motion_full": motion_full, "edges_full": edges_full,
            "face_evidence": face_evidence}


def decide(m: dict, motion_low: float, edge_high: float, motion_high: float) -> str:
    """Mirror of the production auto-layout decision tree."""
    if m["split"]:
        return "split"
    if m["cam"]:
        if m["motion"] is not None and m["motion"] < motion_low and (m["edges"] or 0) > edge_high:
            return "screenshare"
        if m["motion"] is not None and m["motion"] >= motion_high and m["corner"]:
            return "gameplay"
        return "fill"
    # No cam: no-facecam screencast (face-free + static + edge-dense) → fit
    if (m.get("face_evidence", 0) <= 0.25 * max(1, m["n_ok"])
            and m.get("motion_full") is not None
            and m["motion_full"] < motion_low
            and (m.get("edges_full") or 0) > edge_high):
        return "fit"
    return "fill"


def main_entry():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="only entries whose expect matches")
    ap.add_argument("--url"), ap.add_argument("--expect")
    args = ap.parse_args()

    if args.url:
        corpus = [{"url": args.url, "expect": args.expect or "?"}]
    else:
        corpus = json.loads(CORPUS_FILE.read_text(encoding="utf-8"))
        if args.only:
            corpus = [e for e in corpus if e["expect"] == args.only]

    cur = (float(os.getenv("AUTO_MOTION_LOW", "4.0")),
           float(os.getenv("AUTO_EDGE_HIGH", "5.0")),
           float(os.getenv("AUTO_MOTION_HIGH", "9.0")))

    rows = []
    for e in corpus:
        try:
            video = download(e)
            m = probe(video)
            got = decide(m, *cur)
            rows.append((e, m, got))
            mark = "OK " if got == e["expect"] else "MISS"
            mv = "-" if m["motion"] is None else f"{m['motion']:.1f}"
            ev = "-" if m["edges"] is None else f"{m['edges']:.1f}"
            mfv = "-" if m["motion_full"] is None else f"{m['motion_full']:.1f}"
            efv = "-" if m["edges_full"] is None else f"{m['edges_full']:.1f}"
            print(f"[{mark}] expect={e['expect']:<11} got={got:<11} faces={m['n_faces']} "
                  f"fev={m['face_evidence']}/{m['n_ok']} "
                  f"split={m['split']} cam={m['cam']} corner={m['corner']} campos={m['campos']} "
                  f"motion={mv} edges={ev} full={mfv}/{efv}   {e['url']}", flush=True)
        except Exception as ex:
            print(f"[ERR ] {e['url']}: {ex}", flush=True)

    scored = [(e, m) for e, m, _ in rows if e["expect"] != "?"]
    if len(scored) >= 4:
        best, best_acc = cur, sum(1 for e, m in scored if decide(m, *cur) == e["expect"]) / len(scored)
        for ml in (2.0, 3.0, 4.0, 5.0, 6.0):
            for eh in (5.0, 6.5, 8.0, 10.0, 12.0):
                for mh in (7.0, 9.0, 11.0, 14.0, 18.0):
                    acc = sum(1 for e, m in scored if decide(m, ml, eh, mh) == e["expect"]) / len(scored)
                    if acc > best_acc:
                        best, best_acc = (ml, eh, mh), acc
        print(f"\ncurrent thresholds {cur} → accuracy "
              f"{sum(1 for e, m in scored if decide(m, *cur) == e['expect'])}/{len(scored)}")
        print(f"best thresholds    {best} → accuracy {int(best_acc * len(scored))}/{len(scored)}")
        print("→ set AUTO_MOTION_LOW / AUTO_EDGE_HIGH / AUTO_MOTION_HIGH accordingly")


if __name__ == "__main__":
    main_entry()

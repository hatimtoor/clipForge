import os
import json
import uuid
import asyncio
import subprocess
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import secrets

from dotenv import load_dotenv
# Load from clipforge root (local dev) or server path
_env = Path(__file__).parent.parent.parent / ".env"
load_dotenv(_env if _env.exists() else "/home/ubuntu/.env")
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
CLIP_USER    = os.getenv("CLIP_USER", "admin")
CLIP_PASS    = os.getenv("CLIP_PASS", "")

# yt-dlp binary: prefer PATH, then local venv, then server fallback
import shutil as _shutil
import sys as _sys
_local_venv_bin = "Scripts" if _sys.platform == "win32" else "bin"
_local_venv_exe = "yt-dlp.exe" if _sys.platform == "win32" else "yt-dlp"
_local_venv = Path(__file__).parent.parent.parent / "venv" / _local_venv_bin / _local_venv_exe
YTDLP = _shutil.which("yt-dlp") or (str(_local_venv) if _local_venv.exists() else "/home/ubuntu/clipforge/venv/bin/yt-dlp")

# Cookies file for yt-dlp (YouTube auth)
COOKIES_FILE = Path(__file__).parent.parent.parent / "cookies.txt"

# youtubepot bot-bypass: only enabled when its sidecar service is configured
POTTOKEN_URL = os.getenv("POTTOKEN_URL", "")

YOUTUBE_CLIENT_ID     = os.getenv("YOUTUBE_CLIENT_ID", "")
YOUTUBE_CLIENT_SECRET = os.getenv("YOUTUBE_CLIENT_SECRET", "")
YOUTUBE_REDIRECT_URI  = os.getenv("YOUTUBE_REDIRECT_URI", "http://localhost:8000/api/youtube/callback")

from groq import Groq

import base64
from fastapi import FastAPI, BackgroundTasks, HTTPException, Depends, Header
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, HTMLResponse
from pydantic import BaseModel

def require_auth(x_clip_auth: str = Header(default="")):
    try:
        user, pw = base64.b64decode(x_clip_auth).decode().split(":", 1)
    except Exception:
        raise HTTPException(status_code=401, detail="Not authenticated")
    ok = (
        secrets.compare_digest(user.encode(), CLIP_USER.encode()) and
        secrets.compare_digest(pw.encode(), CLIP_PASS.encode())
    )
    if not ok:
        raise HTTPException(status_code=401, detail="Invalid credentials")

app = FastAPI(title="ClipForge API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── paths ────────────────────────────────────────────────────────────────────
BASE_DIR   = Path(__file__).parent.parent
OUTPUT_DIR = BASE_DIR / "output"
TEMP_DIR   = BASE_DIR / "temp"
OUTPUT_DIR.mkdir(exist_ok=True)
TEMP_DIR.mkdir(exist_ok=True)
YOUTUBE_TOKEN_FILE = BASE_DIR / "youtube_token.json"
_oauth_states: dict = {}

# ── persistent job store ─────────────────────────────────────────────────────
from jobs_store import load_jobs, save_jobs
jobs: dict[str, dict] = load_jobs()

# ── request / response models ─────────────────────────────────────────────────
class ClipRequest(BaseModel):
    url: str
    max_clips: int = 5
    min_duration: int = 30
    max_duration: int = 90

class JobStatus(BaseModel):
    job_id: str
    status: str          # queued | downloading | transcribing | analyzing | clipping | done | error
    progress: int        # 0-100
    message: str
    clips: list = []
    error: Optional[str] = None

class YouTubeUploadRequest(BaseModel):
    title: str
    description: str
    tags: list = []
    privacy_status: str = "public"


# ══════════════════════════════════════════════════════════════════════════════
# HELPERS
# ══════════════════════════════════════════════════════════════════════════════

def update_job(job_id: str, **kwargs):
    jobs[job_id].update(kwargs)
    save_jobs(jobs)


def run_cmd(cmd: list[str], cwd=None) -> tuple[int, str, str]:
    result = subprocess.run(cmd, capture_output=True, text=True, cwd=cwd)
    return result.returncode, result.stdout, result.stderr


# ── download ──────────────────────────────────────────────────────────────────
async def download_video(url: str, job_dir: Path, job_id: str) -> Path:
    update_job(job_id, status="downloading", progress=5, message="Downloading video...")
    video_path = job_dir / "video.mp4"
    cmd = [
        YTDLP,
        "-f", "bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/best[ext=mp4]/best",
        "--merge-output-format", "mp4",
        "-o", str(video_path),
        "--no-playlist",
        "--newline",  # one progress line per update
    ]
    if COOKIES_FILE.exists():
        cmd += ["--cookies", str(COOKIES_FILE)]
    if POTTOKEN_URL:
        cmd += ["--extractor-args", f"youtubepot-bgutilhttp:base_url={POTTOKEN_URL}"]
    cmd.append(url)

    _pct_re = re.compile(r'\[download\]\s+(\d+\.?\d*)%')

    def _run_download():
        p = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, encoding="utf-8", errors="replace", bufsize=1,
        )
        tail = []
        for line in p.stdout:
            tail.append(line)
            if len(tail) > 40:
                tail.pop(0)
            m = _pct_re.search(line)
            if m:
                pct = float(m.group(1))
                update_job(job_id, progress=5 + int(pct * 0.13),
                           message=f"Downloading video... {pct:.0f}%")
            elif any(k in line for k in ("Merger", "Merging", "ffmpeg")):
                update_job(job_id, progress=19, message="Merging video and audio streams...")
            elif any(k in line for k in ("Deleting", "Destination", "Already downloaded")):
                update_job(job_id, progress=19, message="Finalizing download...")
        p.wait()
        return p.returncode, "".join(tail)

    loop = asyncio.get_event_loop()
    returncode, tail = await loop.run_in_executor(None, _run_download)
    if returncode != 0:
        raise RuntimeError(f"yt-dlp failed: {tail[-500:]}")
    update_job(job_id, progress=20, message="Download complete, preparing transcription...")
    return video_path


# ── transcribe with faster-whisper ───────────────────────────────────────────
async def transcribe(video_path: Path, job_id: str) -> dict:
    """Transcribe using Groq Whisper API with chunking for large files."""
    update_job(job_id, status="transcribing", progress=30, message="Extracting audio...")

    import math

    groq_client = Groq(api_key=GROQ_API_KEY)

    # Extract audio as mp3 (much smaller than video)
    audio_path = video_path.parent / "audio.mp3"
    cmd = ["ffmpeg", "-y", "-i", str(video_path), "-q:a", "0", "-map", "a",
           "-ac", "1", "-ar", "16000", str(audio_path)]
    code, _, err = run_cmd(cmd)
    if code != 0:
        raise RuntimeError(f"Audio extraction failed: {err}")

    update_job(job_id, progress=35, message="Audio extracted, sending to Groq Whisper...")

    # Check file size — chunk if over 20MB
    file_size = audio_path.stat().st_size
    CHUNK_LIMIT = 20 * 1024 * 1024  # 20MB

    all_segments = []

    if file_size <= CHUNK_LIMIT:
        update_job(job_id, progress=38, message="Transcribing audio via Groq Whisper...")
        with open(audio_path, "rb") as f:
            response = groq_client.audio.transcriptions.create(
                file=("audio.mp3", f.read()),
                model="whisper-large-v3",
                response_format="verbose_json",
                timestamp_granularities=["segment", "word"],
            )
        # Groq returns words at top level, segments as dicts
        top_words = []
        if hasattr(response, "words") and response.words:
            for w in response.words:
                if isinstance(w, dict):
                    top_words.append({"word": w.get("word",""), "start": round(w.get("start",0), 3), "end": round(w.get("end",0), 3)})
                else:
                    top_words.append({"word": w.word, "start": round(float(w.start), 3), "end": round(float(w.end), 3)})

        segs = response.segments if hasattr(response, "segments") else []
        for seg in segs:
            s_start = seg.get("start", 0) if isinstance(seg, dict) else seg.start
            s_end = seg.get("end", 0) if isinstance(seg, dict) else seg.end
            s_text = (seg.get("text", "") if isinstance(seg, dict) else seg.text).strip()

            # Match words by start time — tolerant at both boundaries to avoid
            # dropping words that straddle segment edges
            seg_words = [w for w in top_words if w["start"] >= s_start - 0.05 and w["start"] < s_end + 0.3]

            all_segments.append({
                "start": round(float(s_start), 3),
                "end": round(float(s_end), 3),
                "text": s_text,
                "words": seg_words
            })
    else:
        # Get audio duration
        probe_cmd = ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
                     "-of", "csv=p=0", str(audio_path)]
        _, duration_out, _ = run_cmd(probe_cmd)
        total_duration = float(duration_out.strip())

        # Split into 10-minute chunks
        chunk_duration = 600
        num_chunks = math.ceil(total_duration / chunk_duration)

        for i in range(num_chunks):
            chunk_start = i * chunk_duration
            chunk_path = video_path.parent / f"chunk_{i}.mp3"
            update_job(job_id, message=f"Transcribing part {i+1}/{num_chunks} via Groq Whisper...")

            cmd = ["ffmpeg", "-y", "-i", str(audio_path),
                   "-ss", str(chunk_start), "-t", str(chunk_duration),
                   "-ac", "1", "-ar", "16000", str(chunk_path)]
            run_cmd(cmd)

            with open(chunk_path, "rb") as f:
                response = groq_client.audio.transcriptions.create(
                    file=(f"chunk_{i}.mp3", f.read()),
                    model="whisper-large-v3",
                    response_format="verbose_json",
                    timestamp_granularities=["segment", "word"],
                )

            # Groq returns words at top level
            top_words = []
            if hasattr(response, "words") and response.words:
                for w in response.words:
                    if isinstance(w, dict):
                        top_words.append({"word": w.get("word",""), "start": round(w.get("start",0) + chunk_start, 3), "end": round(w.get("end",0) + chunk_start, 3)})
                    else:
                        top_words.append({"word": w.word, "start": round(float(w.start) + chunk_start, 3), "end": round(float(w.end) + chunk_start, 3)})

            segs = response.segments if hasattr(response, "segments") else []
            for seg in segs:
                s_start = seg.get("start", 0) if isinstance(seg, dict) else seg.start
                s_end = seg.get("end", 0) if isinstance(seg, dict) else seg.end
                s_text = (seg.get("text", "") if isinstance(seg, dict) else seg.text).strip()

                seg_words = [w for w in top_words if w["start"] >= s_start + chunk_start - 0.05 and w["start"] < s_end + chunk_start + 0.3]

                all_segments.append({
                    "start": round(float(s_start) + chunk_start, 3),
                    "end": round(float(s_end) + chunk_start, 3),
                    "text": s_text,
                    "words": seg_words
                })

            chunk_path.unlink(missing_ok=True)

    audio_path.unlink(missing_ok=True)
    update_job(job_id, progress=50, message="Transcription complete, analyzing virality...")
    return all_segments


# ── virality analysis via Ollama ──────────────────────────────────────────────
async def analyze_virality(segments: list, job_id: str, max_clips: int, min_dur: int, max_dur: int) -> list:
    update_job(job_id, status="analyzing", progress=55, message="AI is identifying viral moments...")

    # Build transcript lines
    transcript_lines = []
    for seg in segments:
        transcript_lines.append(f"[{seg['start']:.1f}s - {seg['end']:.1f}s] {seg['text']}")

    # Split into chunks of ~3000 chars to avoid Ollama timeout
    CHUNK_SIZE = 3000
    full_text = "\n".join(transcript_lines)
    chunks = []
    while len(full_text) > 0:
        chunk = full_text[:CHUNK_SIZE]
        last_newline = chunk.rfind("\n")
        if last_newline > 0 and len(full_text) > CHUNK_SIZE:
            chunk = full_text[:last_newline]
        chunks.append(chunk)
        full_text = full_text[len(chunk):].lstrip("\n")

    clips_per_chunk = max(2, max_clips // len(chunks) + 1)
    all_clips = []

    for chunk_idx, transcript_text in enumerate(chunks):
        analysis_progress = 55 + int((chunk_idx / len(chunks)) * 10)
        update_job(job_id, progress=analysis_progress, message=f"AI analyzing part {chunk_idx+1}/{len(chunks)}...")

        prompt = f"""You are a viral short-form content expert. Analyze this video transcript segment and identify the {clips_per_chunk} most viral-worthy moments.

A viral segment should have ONE OR MORE of:
- Strong hook / unexpected statement / surprising fact
- Emotional peak (anger, laughter, awe, inspiration)
- Clear story arc with tension + resolution
- Highly quotable / shareable moment
- Practical high-value tip or insight
- Controversial or bold opinion

TRANSCRIPT SEGMENT:
{transcript_text}

Return ONLY a JSON array. Each item must have:
- "start": start time in seconds (float)
- "end": end time in seconds (float) — clip must be {min_dur}s to {max_dur}s long
- "title": catchy short title for the clip (max 8 words)
- "hook": the opening line / hook text for this clip
- "virality_score": integer 1-10
- "reason": 1-sentence explanation of why this will perform well
- "tags": array of 3 relevant hashtag strings (without #)

Return valid JSON array only, no markdown, no explanation."""

        try:
            client = Groq(api_key=GROQ_API_KEY)
            response = client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.3,
                max_tokens=2000,
            )
            raw = response.choices[0].message.content.strip()
            if raw.startswith("```"):
                raw = raw.split("```")[1]
                if raw.startswith("json"):
                    raw = raw[4:]
                raw = raw.strip()
            chunk_clips = json.loads(raw)
            all_clips.extend(chunk_clips)
        except Exception as e:
            raise RuntimeError(f"Groq analysis failed: {e}")
            continue

    # Sort by virality score and take top max_clips
    all_clips.sort(key=lambda x: x.get("virality_score", 0), reverse=True)
    clips = all_clips[:max_clips]

    # Validate & clamp durations
    valid = []
    for c in clips:
        dur = c["end"] - c["start"]
        if dur < min_dur:
            c["end"] = c["start"] + min_dur
        if dur > max_dur:
            c["end"] = c["start"] + max_dur
        valid.append(c)

    return valid


def _fill_words(seg: dict) -> list:
    """
    Return a complete timed word list for a segment.

    Groq's word-level timestamps frequently omit words (filler words, fast
    speech, boundary words).  When coverage is below 85 % of the segment's
    plain text, fall back to distributing all text words evenly across the
    segment duration so nothing is silently dropped from the subtitles.
    """
    timed = seg.get("words", [])
    text_words = [w for w in re.split(r'\s+', seg.get("text", "").strip()) if w]

    if not text_words:
        return timed

    # Good coverage — keep Groq's precise timestamps for accurate karaoke
    if len(timed) >= len(text_words) * 0.85:
        return timed

    # Sparse coverage — distribute all text words evenly so none are missing
    seg_start = float(seg["start"])
    seg_end   = float(seg["end"])
    dur  = max(seg_end - seg_start, 0.1)
    step = dur / len(text_words)
    return [
        {
            "word":  w,
            "start": round(seg_start + i * step, 3),
            "end":   round(seg_start + (i + 1) * step, 3),
        }
        for i, w in enumerate(text_words)
    ]


# ── build ASS subtitle file (word-by-word TikTok style) ───────────────────────
def build_ass_subtitles(
    segments: list,
    clip_start: float,
    clip_end: float,
    output_path: Path,
    video_width: int = 1080,
    video_height: int = 1920,
):
    """Build an ASS subtitle file with word-by-word karaoke highlighting."""

    ass_header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {video_width}
PlayResY: {video_height}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Montserrat,72,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,2,0,1,3,2,5,80,80,120,1
Style: Highlight,Montserrat,72,&H0000D4FF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,2,0,1,3,2,5,80,80,120,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

    def ts(t: float) -> str:
        """Convert seconds (relative to clip) to ASS timestamp H:MM:SS.cc"""
        t = max(0, t - clip_start)
        h = int(t // 3600)
        m = int((t % 3600) // 60)
        s = int(t % 60)
        cs = int((t % 1) * 100)
        return f"{h}:{m:02d}:{s:02d}.{cs:02d}"

    events = []

    # Collect words in clip range, filling sparse segments from their text
    words_in_clip = []
    for seg in segments:
        if seg["end"] < clip_start or seg["start"] > clip_end:
            continue
        for w in _fill_words(seg):
            # Include word if it starts within the clip (small tolerance at edges)
            if w["start"] >= clip_start - 0.05 and w["start"] < clip_end + 0.05:
                words_in_clip.append(w)

    # Group into lines of ~5 words
    LINE_SIZE = 3
    for i in range(0, len(words_in_clip), LINE_SIZE):
        group = words_in_clip[i:i + LINE_SIZE]
        if not group:
            continue

        line_start = group[0]["start"]
        line_end   = group[-1]["end"]

        # Build karaoke line: each word highlighted when spoken
        karaoke_text = ""
        for w in group:
            dur_cs = max(1, int((w["end"] - w["start"]) * 100))
            karaoke_text += f"{{\\k{dur_cs}}}{w['word'].strip()} "

        karaoke_text = karaoke_text.strip()
        events.append(
            f"Dialogue: 0,{ts(line_start)},{ts(line_end)},Default,,0,0,0,,{karaoke_text}"
        )

    ass_content = ass_header + "\n".join(events) + "\n"
    output_path.write_text(ass_content, encoding="utf-8")


# ── smart speaker-tracking crop ───────────────────────────────────────────────

def sample_face_positions(
    video_path: Path,
    clip_start: float,
    clip_end: float,
    src_w: int,
    src_h: int,
    sample_interval: float = 1.0,
) -> list:
    """Sample frames and detect face positions. Returns [(rel_time, crop_x), ...]."""
    try:
        import cv2
    except ImportError:
        print("opencv-python-headless not installed — using center crop")
        return []

    crop_w = min(int(src_h * 9 / 16), src_w)
    cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    cap = cv2.VideoCapture(str(video_path))
    results = []
    t = clip_start
    while t < clip_end:
        cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
        ret, frame = cap.read()
        if not ret:
            break
        small = cv2.resize(frame, (0, 0), fx=0.5, fy=0.5)
        gray  = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
        faces = cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(30, 30))
        if len(faces) > 0:
            fx, fy, fw, fh = max(faces, key=lambda f: f[2] * f[3])
            face_cx = (fx + fw // 2) * 2  # scale back to full resolution
            crop_x  = max(0, min(face_cx - crop_w // 2, src_w - crop_w))
            results.append((round(t - clip_start, 3), crop_x))
        t += sample_interval
    cap.release()
    return results


def smooth_crop_trajectory(
    detections: list,
    clip_duration: float,
    fallback_crop_x: int,
    max_speed_px_per_s: float = 80.0,
) -> list:
    """
    Convert sparse detections to a smooth sendcmd-ready trajectory.
    Returns [(time_s, crop_x), ...] with 0.0 and clip_duration bookends.
    """
    if not detections:
        return [(0.0, fallback_crop_x), (round(clip_duration, 3), fallback_crop_x)]

    # Outlier rejection: drop samples >200px from 3-sample rolling median
    xs = [x for _, x in detections]
    filtered = []
    for i, (t, x) in enumerate(detections):
        window = xs[max(0, i-1):i+2]
        median = sorted(window)[len(window) // 2]
        if abs(x - median) <= 200:
            filtered.append((t, x))

    if not filtered:
        return [(0.0, fallback_crop_x), (round(clip_duration, 3), fallback_crop_x)]

    # Bookend at 0 and clip_duration
    if filtered[0][0] > 0:
        filtered.insert(0, (0.0, filtered[0][1]))
    if filtered[-1][0] < clip_duration:
        filtered.append((round(clip_duration, 3), filtered[-1][1]))

    # Rate-limit: max max_speed_px_per_s pixels/second
    smoothed = [filtered[0]]
    for i in range(1, len(filtered)):
        t_prev, x_prev = smoothed[-1]
        t_cur,  x_cur  = filtered[i]
        dt = max(t_cur - t_prev, 0.001)
        max_delta = int(max_speed_px_per_s * dt)
        x_cur = x_prev + max(-max_delta, min(max_delta, x_cur - x_prev))
        smoothed.append((t_cur, x_cur))

    return smoothed


def write_sendcmd_file(trajectory: list, output_path: Path) -> None:
    """Write FFmpeg sendcmd file that sets crop x at each keyframe."""
    lines = []
    for i, (t, x) in enumerate(trajectory):
        t_end = trajectory[i + 1][0] - 0.001 if i + 1 < len(trajectory) else t + 3600
        lines.append(f"{t:.3f}-{t_end:.3f} crop x {x};")
    output_path.write_text("\n".join(lines), encoding="utf-8")


# ── cut clips + burn subtitles ────────────────────────────────────────────────
async def create_clips(
    video_path: Path,
    clip_defs: list,
    segments: list,
    job_dir: Path,
    job_id: str,
) -> list:
    update_job(job_id, status="clipping", progress=70, message="Cutting clips and burning subtitles...")

    results = []
    for idx, clip in enumerate(clip_defs):
        start = clip["start"]
        end   = clip["end"]
        dur   = end - start

        progress = 70 + int((idx / len(clip_defs)) * 25)
        update_job(job_id, progress=progress, message=f"Rendering clip {idx+1}/{len(clip_defs)}: {clip['title']}")

        # Get video dimensions (assume 16:9 source → crop to 9:16 for shorts)
        probe_cmd = [
            "ffprobe", "-v", "quiet", "-print_format", "json",
            "-show_streams", str(video_path)
        ]
        _, probe_out, _ = run_cmd(probe_cmd)
        probe = json.loads(probe_out)
        vstream = next((s for s in probe["streams"] if s["codec_type"] == "video"), None)
        src_w = int(vstream["width"])  if vstream else 1920
        src_h = int(vstream["height"]) if vstream else 1080

        # Crop to 9:16 then scale to 1080x1920
        crop_h = src_h
        crop_w = min(int(src_h * 9 / 16), src_w)
        center_crop_x = max(0, (src_w - crop_w) // 2)

        # Final output resolution
        out_w = 1080
        out_h = 1920

        # Build ASS subtitle
        ass_path = job_dir / f"clip_{idx}.ass"
        build_ass_subtitles(
            segments,
            clip_start=start,
            clip_end=end,
            output_path=ass_path,
            video_width=out_w,
            video_height=out_h,
        )

        clip_filename = f"clip_{idx+1}_{clip['title'][:30].replace(' ','_')}.mp4"
        clip_path = OUTPUT_DIR / job_id / clip_filename
        clip_path.parent.mkdir(exist_ok=True)

        # basename-only for filter paths — avoids Windows drive-letter colon issue
        ass_filename = ass_path.name

        # Smart speaker-tracking crop
        detections  = sample_face_positions(video_path, start, end, src_w, src_h)
        trajectory  = smooth_crop_trajectory(detections, dur, fallback_crop_x=center_crop_x)
        is_dynamic  = len(set(x for _, x in trajectory)) > 1

        if is_dynamic:
            sendcmd_path = job_dir / f"clip_{idx}_crop.txt"
            write_sendcmd_file(trajectory, sendcmd_path)
            sendcmd_filename = sendcmd_path.name
            vf_string = (
                f"sendcmd=f={sendcmd_filename},"
                f"crop={crop_w}:{crop_h}:0:0,"
                f"scale={out_w}:{out_h},"
                f"ass={ass_filename}"
            )
        else:
            static_x = trajectory[0][1]
            vf_string = (
                f"crop={crop_w}:{crop_h}:{static_x}:0,"
                f"scale={out_w}:{out_h},"
                f"ass={ass_filename}"
            )

        ffmpeg_cmd = [
            "ffmpeg", "-y",
            "-ss", str(start),
            "-i", str(video_path),
            "-t", str(dur),
            "-vf", vf_string,
            "-c:v", "libx264",
            "-preset", "fast",
            "-crf", "23",
            "-c:a", "aac",
            "-b:a", "128k",
            "-movflags", "+faststart",
            str(clip_path),
        ]

        code, _, err = run_cmd(ffmpeg_cmd, cwd=str(job_dir))
        if code != 0:
            print(f"FFmpeg error for clip {idx}: {err}")
            update_job(job_id, message=f"Clip {idx+1} render failed: {err[-200:]}")
            continue

        results.append({
            **clip,
            "filename": clip_filename,
            "path": f"/clips/{job_id}/{clip_filename}",
            "duration": round(dur, 1),
        })

    return results


# ══════════════════════════════════════════════════════════════════════════════
# MAIN PIPELINE
# ══════════════════════════════════════════════════════════════════════════════

async def run_pipeline(job_id: str, req: ClipRequest):
    job_dir = TEMP_DIR / job_id
    job_dir.mkdir(exist_ok=True)

    try:
        # 1. Download
        video_path = await download_video(req.url, job_dir, job_id)

        # 2. Transcribe
        segments = await transcribe(video_path, job_id)

        # Save transcript alongside output clips so it survives temp cleanup
        out_dir = OUTPUT_DIR / job_id
        out_dir.mkdir(exist_ok=True)
        (out_dir / "transcript.json").write_text(json.dumps(segments, indent=2))

        # 3. Virality analysis
        clips = await analyze_virality(
            segments, job_id,
            req.max_clips, req.min_duration, req.max_duration,
        )

        # 4. Cut + subtitle
        final_clips = await create_clips(video_path, clips, segments, job_dir, job_id)

        update_job(
            job_id,
            status="done",
            progress=100,
            message=f"Done! {len(final_clips)} clips created.",
            clips=final_clips,
        )

    except Exception as e:
        update_job(job_id, status="error", progress=0, message="Pipeline failed", error=str(e))
        raise
    finally:
        if job_dir.exists():
            shutil.rmtree(job_dir, ignore_errors=True)



# ── Job timeout watchdog ───────────────────────────────────────────────────────
async def watchdog():
    """Auto-fail jobs stuck for more than 15 minutes."""
    while True:
        await asyncio.sleep(60)
        now = datetime.now(timezone.utc)
        for job_id, job in list(jobs.items()):
            if job["status"] in ("done", "error"):
                continue
            try:
                created = datetime.fromisoformat(job["created_at"].replace("Z", "+00:00"))
                if created.tzinfo is None:
                    created = created.replace(tzinfo=timezone.utc)
                age_minutes = (now - created).total_seconds() / 60
                if age_minutes > 15:
                    update_job(job_id, status="error", progress=0,
                               message="Pipeline failed", error="Job timed out after 15 minutes")
            except Exception:
                pass

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(watchdog())

# ══════════════════════════════════════════════════════════════════════════════
# API ROUTES
# ══════════════════════════════════════════════════════════════════════════════

@app.post("/api/clip")
async def start_clip(req: ClipRequest, background_tasks: BackgroundTasks,
                     _: None = Depends(require_auth)):
    job_id = str(uuid.uuid4())
    jobs[job_id] = {
        "job_id":    job_id,
        "status":    "queued",
        "progress":  0,
        "message":   "Queued...",
        "clips":     [],
        "error":     None,
        "url":       req.url,
        "created_at": datetime.utcnow().isoformat(),
    }
    save_jobs(jobs)
    background_tasks.add_task(run_pipeline, job_id, req)
    return {"job_id": job_id}


@app.get("/api/status/{job_id}")
async def get_status(job_id: str, _: None = Depends(require_auth)):
    if job_id not in jobs:
        raise HTTPException(404, "Job not found")
    return jobs[job_id]


@app.get("/api/jobs")
async def list_jobs(_: None = Depends(require_auth)):
    return list(jobs.values())


@app.get("/clips/{job_id}/{filename}")
async def serve_clip(job_id: str, filename: str):
    clip_path = OUTPUT_DIR / job_id / filename
    if not clip_path.exists():
        raise HTTPException(404, "Clip not found")
    return FileResponse(str(clip_path), media_type="video/mp4")


@app.get("/api/transcript/{job_id}")
async def get_transcript(job_id: str, _: None = Depends(require_auth)):
    transcript_path = OUTPUT_DIR / job_id / "transcript.json"
    if not transcript_path.exists():
        raise HTTPException(404, "Transcript not found")
    return json.loads(transcript_path.read_text())


# ══════════════════════════════════════════════════════════════════════════════
# YOUTUBE INTEGRATION
# ══════════════════════════════════════════════════════════════════════════════

def get_youtube_credentials():
    """Load stored YouTube OAuth credentials and refresh if expired."""
    if not YOUTUBE_TOKEN_FILE.exists():
        return None
    try:
        from google.oauth2.credentials import Credentials
        from google.auth.transport.requests import Request as GRequest
        token_data = json.loads(YOUTUBE_TOKEN_FILE.read_text())
        creds = Credentials(
            token=token_data.get("token"),
            refresh_token=token_data.get("refresh_token"),
            token_uri="https://oauth2.googleapis.com/token",
            client_id=YOUTUBE_CLIENT_ID,
            client_secret=YOUTUBE_CLIENT_SECRET,
            scopes=["https://www.googleapis.com/auth/youtube.upload"],
        )
        if creds.expired and creds.refresh_token:
            creds.refresh(GRequest())
            YOUTUBE_TOKEN_FILE.write_text(json.dumps({
                "token": creds.token,
                "refresh_token": creds.refresh_token,
            }))
        return creds
    except Exception:
        return None


def do_youtube_upload(job_id: str, clip_index: int, req_data: dict):
    """Upload a clip to YouTube (runs in background thread)."""
    try:
        from googleapiclient.discovery import build as yt_build
        from googleapiclient.http import MediaFileUpload

        creds = get_youtube_credentials()
        if not creds:
            jobs[job_id]["clips"][clip_index]["yt_upload"] = {"status": "error", "error": "Not authenticated with YouTube"}
            save_jobs(jobs)
            return

        clip = jobs[job_id]["clips"][clip_index]
        clip_file = OUTPUT_DIR / job_id / clip["filename"]
        if not clip_file.exists():
            jobs[job_id]["clips"][clip_index]["yt_upload"] = {"status": "error", "error": "Clip file not found"}
            save_jobs(jobs)
            return

        youtube = yt_build("youtube", "v3", credentials=creds)

        tags = req_data.get("tags") or clip.get("tags", [])
        auto_desc = (
            f"{clip.get('hook', '')}\n\n"
            f"{clip.get('reason', '')}\n\n"
            + " ".join(f"#{t}" for t in tags)
        ).strip()
        description = req_data.get("description") or auto_desc

        body = {
            "snippet": {
                "title": req_data.get("title") or clip.get("title", "ClipForge Video"),
                "description": description,
                "tags": tags,
                "categoryId": "22",
            },
            "status": {
                "privacyStatus": req_data.get("privacy_status", "public"),
            },
        }

        media = MediaFileUpload(str(clip_file), mimetype="video/mp4", chunksize=256 * 1024, resumable=True)
        jobs[job_id]["clips"][clip_index]["yt_upload"] = {"status": "uploading", "progress": 0}
        save_jobs(jobs)

        request = youtube.videos().insert(part="snippet,status", body=body, media_body=media)
        response = None
        while response is None:
            status, response = request.next_chunk()
            if status:
                total = getattr(status, "total_size", None) or getattr(status, "resumable_total", None)
                prog = int(status.resumable_progress / total * 100) if total else 0
                jobs[job_id]["clips"][clip_index]["yt_upload"] = {"status": "uploading", "progress": prog}
                save_jobs(jobs)

        video_id = response["id"]
        jobs[job_id]["clips"][clip_index]["yt_upload"] = {
            "status": "done",
            "progress": 100,
            "video_id": video_id,
            "url": f"https://youtube.com/watch?v={video_id}",
        }
        save_jobs(jobs)

    except Exception as e:
        jobs[job_id]["clips"][clip_index]["yt_upload"] = {"status": "error", "error": str(e)}
        save_jobs(jobs)


@app.get("/api/youtube/status")
async def youtube_status(_: None = Depends(require_auth)):
    creds = get_youtube_credentials()
    if not creds:
        return {"connected": False}
    try:
        from googleapiclient.discovery import build as yt_build
        youtube = yt_build("youtube", "v3", credentials=creds)
        ch = youtube.channels().list(part="snippet", mine=True).execute()
        items = ch.get("items", [])
        if items:
            return {"connected": True, "channel_name": items[0]["snippet"]["title"]}
    except Exception:
        pass
    return {"connected": True}


@app.get("/api/youtube/auth")
async def youtube_auth(_: None = Depends(require_auth)):
    if not YOUTUBE_CLIENT_ID or not YOUTUBE_CLIENT_SECRET:
        raise HTTPException(400, "YouTube OAuth not configured. Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in .env")
    try:
        from google_auth_oauthlib.flow import Flow
        flow = Flow.from_client_config(
            {
                "web": {
                    "client_id": YOUTUBE_CLIENT_ID,
                    "client_secret": YOUTUBE_CLIENT_SECRET,
                    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                    "token_uri": "https://oauth2.googleapis.com/token",
                    "redirect_uris": [YOUTUBE_REDIRECT_URI],
                }
            },
            scopes=["https://www.googleapis.com/auth/youtube.upload"],
        )
        flow.redirect_uri = YOUTUBE_REDIRECT_URI
        auth_url, state = flow.authorization_url(access_type="offline", include_granted_scopes="true", prompt="consent")
        _oauth_states[state] = getattr(flow, "code_verifier", None)
        return {"auth_url": auth_url}
    except Exception as e:
        raise HTTPException(500, f"OAuth setup failed: {e}")


@app.get("/api/youtube/callback")
async def youtube_callback(code: str = None, state: str = None, error: str = None):
    if error:
        return HTMLResponse(f"<script>window.opener?.postMessage({{type:'youtube_auth_error',error:'{error}'}},'*');window.close();</script>")
    if not code or state not in _oauth_states:
        return HTMLResponse("<script>window.opener?.postMessage({type:'youtube_auth_error',error:'Invalid state'},'*');window.close();</script>")
    try:
        from google_auth_oauthlib.flow import Flow
        flow = Flow.from_client_config(
            {
                "web": {
                    "client_id": YOUTUBE_CLIENT_ID,
                    "client_secret": YOUTUBE_CLIENT_SECRET,
                    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                    "token_uri": "https://oauth2.googleapis.com/token",
                    "redirect_uris": [YOUTUBE_REDIRECT_URI],
                }
            },
            scopes=["https://www.googleapis.com/auth/youtube.upload"],
            state=state,
        )
        flow.redirect_uri = YOUTUBE_REDIRECT_URI
        code_verifier = _oauth_states.get(state)
        flow.fetch_token(code=code, code_verifier=code_verifier)
        creds = flow.credentials
        YOUTUBE_TOKEN_FILE.write_text(json.dumps({
            "token": creds.token,
            "refresh_token": creds.refresh_token,
        }))
        _oauth_states.pop(state, None)
        return HTMLResponse("<script>window.opener?.postMessage({type:'youtube_auth_success'},'*');window.close();</script>")
    except Exception as e:
        return HTMLResponse(f"<script>window.opener?.postMessage({{type:'youtube_auth_error',error:'{str(e)}'}},'*');window.close();</script>")


@app.post("/api/youtube/upload/{job_id}/{clip_index}")
async def start_youtube_upload(
    job_id: str, clip_index: int, req: YouTubeUploadRequest,
    background_tasks: BackgroundTasks, _: None = Depends(require_auth),
):
    if job_id not in jobs:
        raise HTTPException(404, "Job not found")
    if clip_index >= len(jobs[job_id].get("clips", [])):
        raise HTTPException(404, "Clip not found")
    jobs[job_id]["clips"][clip_index]["yt_upload"] = {"status": "queued", "progress": 0}
    save_jobs(jobs)
    background_tasks.add_task(do_youtube_upload, job_id, clip_index, req.model_dump())
    return {"status": "queued"}


@app.get("/api/youtube/upload_status/{job_id}/{clip_index}")
async def get_youtube_upload_status(job_id: str, clip_index: int, _: None = Depends(require_auth)):
    if job_id not in jobs:
        raise HTTPException(404, "Job not found")
    clips = jobs[job_id].get("clips", [])
    if clip_index >= len(clips):
        raise HTTPException(404, "Clip not found")
    return clips[clip_index].get("yt_upload", {"status": "none"})


# Serve frontend (must be last)
FRONTEND_BUILD = BASE_DIR / "frontend" / "dist"
if FRONTEND_BUILD.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_BUILD), html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

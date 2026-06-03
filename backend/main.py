import os
import json
import asyncio
import threading
import subprocess
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
try:
    from reframe import _get_yolo, _speaking_person_cx
    _REFRAME_AVAILABLE = True
except Exception as _reframe_err:
    _REFRAME_AVAILABLE = False
    print(f"[reframe] YOLO unavailable: {_reframe_err}", flush=True)
from groq_limiter import whisper_limiter, llama_limiter, groq_with_retry, set_groq_keys, get_groq_key
# Load from clipforge root (local dev) or server path
_env = Path(__file__).parent.parent.parent / ".env"
load_dotenv(_env if _env.exists() else "/home/ubuntu/.env")
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
set_groq_keys([GROQ_API_KEY or ""] + [os.getenv(f"GROQ_API_KEY_{i}", "") for i in range(2, 6)])

# Google's OAuth server always returns extra scopes (openid, userinfo.*).
# This tells oauthlib to accept a superset of the requested scopes without raising.
os.environ.setdefault("OAUTHLIB_RELAX_TOKEN_SCOPE", "1")

# yt-dlp binary: probe all realistic locations in priority order
import shutil as _shutil
import sys as _sys
_local_venv_bin = "Scripts" if _sys.platform == "win32" else "bin"
_local_venv_exe = "yt-dlp.exe" if _sys.platform == "win32" else "yt-dlp"
def _find_ytdlp() -> str:
    # 1. Active PATH (works when venv is activated or yt-dlp is system-installed)
    found = _shutil.which("yt-dlp")
    if found:
        return found
    # 2. Probe candidate paths — server layout vs local-dev layout vs user install
    _candidates = [
        Path(__file__).parent.parent / "venv" / _local_venv_bin / _local_venv_exe,          # server: repo/venv
        Path(__file__).parent.parent.parent / "venv" / _local_venv_bin / _local_venv_exe,   # local dev: clipper/../venv
        Path.home() / ".local" / "bin" / "yt-dlp",                                           # pip install --user
        Path("/usr/local/bin/yt-dlp"),                                                        # sudo pip install
    ]
    for p in _candidates:
        if p.exists():
            return str(p)
    return "yt-dlp"  # last resort — will fail clearly at runtime if missing
YTDLP = _find_ytdlp()

# ffmpeg/ffprobe binaries: prefer PATH, then winget install location, then server fallback
_WINGET_FFMPEG = Path.home() / "AppData/Local/Microsoft/WinGet/Packages"
_ffmpeg_winget = next(_WINGET_FFMPEG.glob("Gyan.FFmpeg*/*/bin/ffmpeg.exe"), None) if _WINGET_FFMPEG.exists() else None
_ffprobe_winget = next(_WINGET_FFMPEG.glob("Gyan.FFmpeg*/*/bin/ffprobe.exe"), None) if _WINGET_FFMPEG.exists() else None
FFMPEG  = _shutil.which("ffmpeg")  or (str(_ffmpeg_winget)  if _ffmpeg_winget  else "ffmpeg")
FFPROBE = _shutil.which("ffprobe") or (str(_ffprobe_winget) if _ffprobe_winget else "ffprobe")

# Cookies for yt-dlp — browser takes priority (stays fresh), file is dev fallback
COOKIES_FROM_BROWSER = os.getenv("COOKIES_FROM_BROWSER", "")  # e.g. "chromium"
COOKIES_FILE = Path(__file__).parent.parent.parent / "cookies.txt"

# youtubepot bot-bypass: only enabled when its sidecar service is configured
POTTOKEN_URL = os.getenv("POTTOKEN_URL", "")

YOUTUBE_CLIENT_ID     = os.getenv("YOUTUBE_CLIENT_ID", "")
YOUTUBE_CLIENT_SECRET = os.getenv("YOUTUBE_CLIENT_SECRET", "")
YOUTUBE_REDIRECT_URI  = os.getenv("YOUTUBE_REDIRECT_URI", "http://localhost:8000/api/youtube/callback")
YOUTUBE_API_KEY       = os.getenv("YOUTUBE_API_KEY", "")

from groq import Groq
from supabase import create_client as _sb_create_client

from fastapi import FastAPI, BackgroundTasks, HTTPException, Depends, Header, Request
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, HTMLResponse
from pydantic import BaseModel

from r2 import upload_clip, presigned_url, stream_clip, download_clip_to_temp, R2_ENABLED
from db import (
    db_create_job, db_get_job, db_update_job, db_get_user_jobs,
    db_get_active_jobs, db_update_clip_yt_upload, db_update_clip_analytics,
    db_get_done_jobs_with_uploads,
    db_create_channel, db_get_channel, db_get_user_channels,
    db_get_all_channels, db_update_channel, db_delete_channel, db_channel_owned_by,
    db_get_youtube_token, db_get_user_youtube_tokens, db_upsert_youtube_token, db_delete_youtube_token,
    db_get_profile, db_check_and_reset_quota, db_increment_clips_used,
    db_get_user_email,
    FREE_MONTHLY_CLIP_LIMIT, FREE_MAX_CLIPS_PER_JOB, PRO_MAX_CLIPS_PER_JOB,
    db_create_backfill, db_get_user_backfills, db_get_active_backfills,
    db_get_backfill, db_update_backfill, db_delete_backfill,
)

SUPABASE_URL     = os.getenv("SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")

_sb_auth_client = None

def _get_sb_auth():
    global _sb_auth_client
    if _sb_auth_client is None:
        _sb_auth_client = _sb_create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
    return _sb_auth_client


async def require_auth(authorization: str = Header(default="")):
    """Validate Supabase JWT. Returns the Supabase user object."""
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization[7:]
    try:
        result = await asyncio.to_thread(_get_sb_auth().auth.get_user, token)
        if not result or not result.user:
            raise HTTPException(status_code=401, detail="Invalid or expired token")
        return result.user
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


async def require_pro(user=Depends(require_auth)):
    """Validate Supabase JWT and enforce Pro plan."""
    profile = db_check_and_reset_quota(user.id)
    if profile.get("plan", "free") != "pro":
        raise HTTPException(status_code=403, detail="This feature requires a Pro plan. Upgrade to unlock.")
    return user

from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

_limiter = Limiter(key_func=get_remote_address)
app = FastAPI(title="ClipForge API")
app.state.limiter = _limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

_APP_URL = os.getenv("APP_URL", "https://clipforge.ai").rstrip("/")
_ALLOWED_ORIGINS = [o.strip() for o in os.getenv(
    "ALLOWED_ORIGINS",
    f"{_APP_URL},http://localhost:5173,http://localhost:8000"
).split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
    allow_credentials=True,
)

from starlette.middleware.base import BaseHTTPMiddleware

class _SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        # Only apply strict CSP to API/JSON responses — HTML responses serve the
        # React app which needs scripts, fonts, and connections to work.
        if "text/html" not in response.headers.get("content-type", ""):
            response.headers.setdefault("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
        return response

app.add_middleware(_SecurityHeadersMiddleware)

# ── paths ────────────────────────────────────────────────────────────────────
BASE_DIR   = Path(__file__).parent.parent
OUTPUT_DIR = BASE_DIR / "output"
TEMP_DIR   = BASE_DIR / "temp"
OUTPUT_DIR.mkdir(exist_ok=True)
TEMP_DIR.mkdir(exist_ok=True)
_oauth_states: dict = {}  # state → {"user_id": ..., "code_verifier": ..., "_ts": monotonic()}
_OAUTH_STATE_TTL = 600   # 10 minutes

from time import monotonic as _monotonic

def _oauth_state_set(state: str, data: dict) -> None:
    now = _monotonic()
    expired = [k for k, v in _oauth_states.items() if now - v.get("_ts", 0) > _OAUTH_STATE_TTL]
    for k in expired:
        _oauth_states.pop(k, None)
    data["_ts"] = now
    _oauth_states[state] = data

def _oauth_state_get(state: str) -> dict | None:
    entry = _oauth_states.get(state)
    if entry and (_monotonic() - entry.get("_ts", 0)) <= _OAUTH_STATE_TTL:
        return entry
    _oauth_states.pop(state, None)
    return None

_clip_tokens: dict = {}   # token → {"job_id": ..., "filename": ..., "_ts": monotonic()}
_CLIP_TOKEN_TTL = 3600    # 1 hour

def _clip_token_set(token: str, job_id: str, filename: str) -> None:
    now = _monotonic()
    expired = [k for k, v in _clip_tokens.items() if now - v.get("_ts", 0) > _CLIP_TOKEN_TTL]
    for k in expired:
        _clip_tokens.pop(k, None)
    _clip_tokens[token] = {"job_id": job_id, "filename": filename, "_ts": now}

def _clip_token_verify(token: str, job_id: str, filename: str) -> bool:
    entry = _clip_tokens.get(token)
    if not entry:
        return False
    if (_monotonic() - entry.get("_ts", 0)) > _CLIP_TOKEN_TTL:
        _clip_tokens.pop(token, None)
        return False
    return entry.get("job_id") == job_id and entry.get("filename") == filename

# Running asyncio tasks — keyed by job_id so they can be cancelled
_running_tasks: dict[str, asyncio.Task] = {}

# ── request / response models ─────────────────────────────────────────────────
class ClipRequest(BaseModel):
    url: str
    max_clips: int = 5
    min_duration: int = 30
    max_duration: int = 90
    reframe: bool = False
    style_prompt: Optional[str] = None
    caption_style: str = "bold_bottom"
    caption_font_size: Optional[int] = None
    caption_highlight_color: Optional[str] = None
    caption_language: str = "source"

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
    yt_channel_id: Optional[str] = None  # which connected channel to upload to

class ChannelRequest(BaseModel):
    url: str
    auto_upload: bool = False
    max_clips: int = 3
    min_duration: int = 30
    max_duration: int = 90
    caption_style: str = "bold_bottom"
    caption_font_size: Optional[int] = None
    caption_highlight_color: Optional[str] = None
    caption_language: str = "source"
    yt_channel_id: Optional[str] = None

class ChannelPatchRequest(BaseModel):
    auto_upload: Optional[bool] = None
    max_clips: Optional[int] = None
    min_duration: Optional[int] = None
    max_duration: Optional[int] = None
    caption_style: Optional[str] = None
    caption_font_size: Optional[int] = None
    caption_highlight_color: Optional[str] = None
    caption_language: Optional[str] = None
    yt_channel_id: Optional[str] = None


class BackfillRequest(BaseModel):
    channel_url: str
    days_back: int = 30
    videos_per_day: int = 2
    yt_upload_channel_id: str = ""


# ══════════════════════════════════════════════════════════════════════════════
# HELPERS
# ══════════════════════════════════════════════════════════════════════════════

def log(job_id: str, msg: str):
    print(f"[{job_id[:8]}] {msg}", flush=True)


async def update_job(job_id: str, **kwargs):
    await asyncio.to_thread(db_update_job, job_id, kwargs)


def _j(job: dict) -> dict:
    """Add job_id alias so frontend code expecting job_id stays unchanged."""
    return {**job, "job_id": job["id"]} if job else job


def _enrich_clips(job: dict) -> dict:
    """Inject presigned R2 URLs into clip objects so the browser loads video directly from R2."""
    if not R2_ENABLED or job.get("status") != "done":
        return job
    clips = job.get("clips") or []
    if not clips:
        return job
    job_id = job.get("id", "")
    enriched = []
    for clip in clips:
        filename = clip.get("filename", "")
        if filename and job_id:
            url = presigned_url(job_id, filename)
            enriched.append({**clip, "presigned_url": url} if url else clip)
        else:
            enriched.append(clip)
    return {**job, "clips": enriched}

def _c(ch: dict) -> dict:
    """Add channel_id alias so frontend code expecting channel_id stays unchanged."""
    return {**ch, "channel_id": ch["id"]} if ch else ch


def run_cmd(cmd: list[str], cwd=None) -> tuple[int, str, str]:
    result = subprocess.run(cmd, capture_output=True, text=True, cwd=cwd)
    return result.returncode, result.stdout, result.stderr


async def run_cmd_async(cmd: list[str], cwd=None) -> tuple[int, str, str]:
    """Async subprocess wrapper — killed immediately when the asyncio task is cancelled."""
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        cwd=cwd,
    )
    try:
        stdout, stderr = await proc.communicate()
        return proc.returncode, stdout.decode(errors="replace"), stderr.decode(errors="replace")
    except asyncio.CancelledError:
        try:
            proc.kill()
            await proc.wait()
        except Exception:
            pass
        raise


# ── download ──────────────────────────────────────────────────────────────────
async def download_video(url: str, job_dir: Path, job_id: str) -> Path:
    log(job_id, f"Downloading: {url}")
    await update_job(job_id, status="downloading", progress=2, message="Downloading video...")
    video_path = job_dir / "video.mp4"
    cmd = [
        YTDLP,
        "-f", "bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/best[ext=mp4]/best",
        "--merge-output-format", "mp4",
        "-o", str(video_path),
        "--no-playlist",
        "--newline",  # one progress line per update
    ]
    if COOKIES_FROM_BROWSER:
        cmd += ["--cookies-from-browser", COOKIES_FROM_BROWSER]
    elif COOKIES_FILE.exists():
        cmd += ["--cookies", str(COOKIES_FILE)]
    if POTTOKEN_URL:
        cmd += ["--extractor-args", f"youtubepot-bgutilhttp:base_url={POTTOKEN_URL}"]
    # Tell yt-dlp exactly where ffmpeg is so it can merge streams reliably
    cmd += ["--ffmpeg-location", str(Path(FFMPEG).parent)]
    cmd.append(url)

    _pct_re = re.compile(r'\[download\]\s+(\d+\.?\d*)%')
    # Two-stream tracking: yt-dlp downloads video then audio separately
    # Stream 1 (video) maps to progress 2-25, stream 2 (audio) maps to 25-36
    _stream = [0]           # current stream index (0-based)
    _last_logged_pct = [-10]
    import queue as _queue
    _progress_q: _queue.Queue = _queue.Queue()

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
            stripped = line.strip()
            if stripped:
                print(f"[{job_id[:8]}] ytdlp> {stripped}", flush=True)
            if "[download] Destination:" in line:
                _stream[0] += 1
                _last_logged_pct[0] = -10
                label = "video" if _stream[0] == 1 else "audio"
                log(job_id, f"Downloading {label} stream (stream {_stream[0]})...")
            elif m := _pct_re.search(line):
                pct = float(m.group(1))
                if pct - _last_logged_pct[0] >= 10:
                    label = "video" if _stream[0] <= 1 else "audio"
                    log(job_id, f"{label} stream: {pct:.0f}%")
                    _last_logged_pct[0] = pct
                # Stream 1 → progress 2-25, stream 2 → progress 25-36
                if _stream[0] <= 1:
                    prog = 2 + int(pct * 0.23)
                    msg = f"Downloading video... {pct:.0f}%"
                else:
                    prog = 25 + int(pct * 0.11)
                    msg = f"Downloading audio... {pct:.0f}%"
                _progress_q.put({"progress": prog, "message": msg})
            elif "[Merger]" in line or "[VideoConvertor]" in line:
                log(job_id, f"Merge started: {line.strip()}")
                _progress_q.put({"status": "merging", "progress": 37, "message": "Merging video and audio streams..."})
            elif "Deleting original file" in line or "Already downloaded" in line:
                log(job_id, "Merge finalizing...")
                _progress_q.put({"status": "merging", "progress": 39, "message": "Finalizing download..."})
        p.wait()
        _progress_q.put(None)  # sentinel — signals drainer to stop
        return p.returncode, "".join(tail)

    loop = asyncio.get_event_loop()
    download_future = loop.run_in_executor(None, _run_download)

    # Drain progress updates from the event loop thread so the Supabase
    # httpx client is never called from the thread-pool executor.
    done = False
    while not done:
        await asyncio.sleep(0.2)
        while True:
            try:
                item = _progress_q.get_nowait()
                if item is None:
                    done = True
                    break
                await update_job(job_id, **item)
            except _queue.Empty:
                break
        # If the future raised an exception the sentinel may never arrive.
        if not done and download_future.done():
            done = True

    returncode, tail = await download_future
    if returncode != 0:
        log(job_id, f"yt-dlp failed (exit {returncode})")
        raise RuntimeError(f"yt-dlp failed: {tail[-500:]}")
    if not video_path.exists():
        log(job_id, "yt-dlp exited 0 but video.mp4 missing — merge likely failed")
        raise RuntimeError(f"yt-dlp exited 0 but output file missing. Last output: {tail[-500:]}")
    await update_job(job_id, progress=40, message="Download complete, preparing transcription...")
    return video_path


# ── transcribe with faster-whisper ───────────────────────────────────────────
async def transcribe(video_path: Path, job_id: str) -> dict:
    """Transcribe using Groq Whisper API with chunking for large files."""
    log(job_id, "Extracting audio from video...")
    await update_job(job_id, status="transcribing", progress=41, message="Extracting audio...")

    import math

    # Extract audio as mp3 (much smaller than video)
    audio_path = video_path.parent / "audio.mp3"
    cmd = [FFMPEG, "-y", "-i", str(video_path), "-q:a", "0", "-map", "a",
           "-ac", "1", "-ar", "16000", str(audio_path)]
    code, _, err = await run_cmd_async(cmd)
    if code != 0:
        log(job_id, f"Audio extraction FAILED: {err[-300:]}")
        raise RuntimeError(f"Audio extraction failed: {err}")

    audio_mb = audio_path.stat().st_size / 1_048_576
    log(job_id, f"Audio extracted → audio.mp3 ({audio_mb:.1f} MB)")
    await update_job(job_id, progress=44, message="Audio extracted, sending to Groq Whisper...")

    # Check file size — chunk if over 20MB
    file_size = audio_path.stat().st_size
    CHUNK_LIMIT = 20 * 1024 * 1024  # 20MB

    all_segments = []
    hallucinations_dropped = 0

    if file_size <= CHUNK_LIMIT:
        log(job_id, f"Audio is {file_size/1_048_576:.1f} MB — sending as single file to Whisper")
        await update_job(job_id, progress=47, message="Transcribing audio via Groq Whisper...")
        audio_data = audio_path.read_bytes()
        response = await groq_with_retry(
            lambda: asyncio.to_thread(
                lambda: Groq(api_key=get_groq_key()).audio.transcriptions.create(
                    file=("audio.mp3", audio_data),
                    model="whisper-large-v3",
                    response_format="verbose_json",
                    timestamp_granularities=["segment", "word"],
                )
            ),
            limiter=whisper_limiter,
            log_fn=lambda m: log(job_id, m),
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

            # Drop hallucinated segments: no real speech, or model was very uncertain
            no_speech  = seg.get("no_speech_prob", 0.0) if isinstance(seg, dict) else getattr(seg, "no_speech_prob", 0.0)
            avg_logprob = seg.get("avg_logprob", 0.0)  if isinstance(seg, dict) else getattr(seg, "avg_logprob", 0.0)
            if no_speech > 0.4 or avg_logprob < -1.0:
                log(job_id, f"  [hallucination] dropped seg '{s_text[:40]}' (no_speech={no_speech:.2f}, logprob={avg_logprob:.2f})")
                hallucinations_dropped += 1
                continue

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
        probe_cmd = [FFPROBE, "-v", "quiet", "-show_entries", "format=duration",
                     "-of", "csv=p=0", str(audio_path)]
        _, duration_out, _ = await asyncio.to_thread(run_cmd, probe_cmd)
        total_duration = float(duration_out.strip())

        # Split into 10-minute chunks
        chunk_duration = 600
        num_chunks = math.ceil(total_duration / chunk_duration)
        log(job_id, f"Audio is {file_size/1_048_576:.1f} MB — splitting into {num_chunks} chunks ({total_duration:.0f}s total)")

        for i in range(num_chunks):
            chunk_start = i * chunk_duration
            chunk_path = video_path.parent / f"chunk_{i}.mp3"
            # chunked: 47-63 spread across chunks
            chunk_prog = 47 + int((i / num_chunks) * 16)
            log(job_id, f"Transcribing chunk {i+1}/{num_chunks} ({chunk_start:.0f}s – {min(chunk_start+chunk_duration, total_duration):.0f}s)...")
            await update_job(job_id, progress=chunk_prog, message=f"Transcribing part {i+1}/{num_chunks} via Groq Whisper...")

            cmd = [FFMPEG, "-y", "-i", str(audio_path),
                   "-ss", str(chunk_start), "-t", str(chunk_duration),
                   "-ac", "1", "-ar", "16000", str(chunk_path)]
            await run_cmd_async(cmd)

            chunk_data = chunk_path.read_bytes()
            chunk_name = f"chunk_{i}.mp3"
            response = await groq_with_retry(
                lambda data=chunk_data, name=chunk_name: asyncio.to_thread(
                    lambda: Groq(api_key=get_groq_key()).audio.transcriptions.create(
                        file=(name, data),
                        model="whisper-large-v3",
                        response_format="verbose_json",
                        timestamp_granularities=["segment", "word"],
                    )
                ),
                limiter=whisper_limiter,
                log_fn=lambda m: log(job_id, m),
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

                # Drop hallucinated segments
                no_speech   = seg.get("no_speech_prob", 0.0) if isinstance(seg, dict) else getattr(seg, "no_speech_prob", 0.0)
                avg_logprob = seg.get("avg_logprob", 0.0)    if isinstance(seg, dict) else getattr(seg, "avg_logprob", 0.0)
                if no_speech > 0.4 or avg_logprob < -1.0:
                    log(job_id, f"  [hallucination] dropped seg '{s_text[:40]}' (no_speech={no_speech:.2f}, logprob={avg_logprob:.2f})")
                    hallucinations_dropped += 1
                    continue

                seg_words = [w for w in top_words if w["start"] >= s_start + chunk_start - 0.05 and w["start"] < s_end + chunk_start + 0.3]

                all_segments.append({
                    "start": round(float(s_start) + chunk_start, 3),
                    "end": round(float(s_end) + chunk_start, 3),
                    "text": s_text,
                    "words": seg_words
                })

            chunk_path.unlink(missing_ok=True)

    audio_path.unlink(missing_ok=True)
    log(job_id, f"Transcription complete: {len(all_segments)} segments kept, {hallucinations_dropped} hallucinations dropped")
    await update_job(job_id, progress=65, message="Transcription complete, analyzing virality...")
    return all_segments


# ── virality analysis via Ollama ──────────────────────────────────────────────
async def analyze_virality(segments: list, job_id: str, max_clips: int, min_dur: int, max_dur: int, style_prompt: str = "") -> list:
    log(job_id, f"Analyzing virality: {len(segments)} segments, max_clips={max_clips}, dur={min_dur}-{max_dur}s")
    await update_job(job_id, status="analyzing", progress=66, message="AI is identifying viral moments...")

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

    log(job_id, f"Transcript split into {len(chunks)} chunk(s) for Groq Llama analysis")
    for chunk_idx, transcript_text in enumerate(chunks):
        # analyzing: 66-77 spread across chunks
        analysis_progress = 66 + int((chunk_idx / len(chunks)) * 11)
        log(job_id, f"Sending chunk {chunk_idx+1}/{len(chunks)} to Groq Llama ({len(transcript_text)} chars)...")
        await update_job(job_id, progress=analysis_progress, message=f"AI analyzing part {chunk_idx+1}/{len(chunks)}...")

        focus_line = f"\nFOCUS ON: {style_prompt.strip()}\n" if style_prompt and style_prompt.strip() else ""
        prompt = f"""You are a viral short-form content expert. Analyze this video transcript segment and identify the {clips_per_chunk} most viral-worthy moments.

A viral segment should have ONE OR MORE of:
- Strong hook / unexpected statement / surprising fact
- Emotional peak (anger, laughter, awe, inspiration)
- Clear story arc with tension + resolution
- Highly quotable / shareable moment
- Practical high-value tip or insight
- Controversial or bold opinion
{focus_line}
TRANSCRIPT SEGMENT:
{transcript_text}

DURATION RULE (non-negotiable): Every clip MUST be {min_dur}s–{max_dur}s long (end - start). Target ~{(min_dur + max_dur) // 2}s. If the core moment is short, extend start earlier or end later to include setup/context. Never return a clip shorter than {min_dur}s.

Return ONLY a JSON array. Each item must have:
- "start": start time in seconds (float)
- "end": end time in seconds (float) — (end - start) must be between {min_dur} and {max_dur}
- "title": catchy short title for the clip (max 8 words)
- "hook": the opening line / hook text for this clip
- "virality_score": integer 1-10
- "reason": 1-sentence explanation of why this will perform well
- "tags": array of 3 relevant hashtag strings (without #)

Return valid JSON array only, no markdown, no explanation."""

        async def _call_groq(temp=0.3):
            def _sync(t=temp):
                client = Groq(api_key=get_groq_key())
                r = client.chat.completions.create(
                    model="llama-3.3-70b-versatile",
                    messages=[{"role": "user", "content": prompt}],
                    temperature=t,
                    max_tokens=2000,
                )
                return r.choices[0].message.content.strip()
            return await groq_with_retry(
                lambda t=temp: asyncio.to_thread(lambda: _sync(t)),
                limiter=llama_limiter,
                log_fn=lambda m: log(job_id, m),
            )

        def _parse_raw(raw: str):
            # Strip markdown fences
            if raw.startswith("```"):
                raw = raw.split("```")[1]
                if raw.startswith("json"):
                    raw = raw[4:]
                raw = raw.strip()
            # Try direct parse
            try:
                return json.loads(raw)
            except json.JSONDecodeError:
                pass
            # Fallback: extract first [...] block with regex
            m = re.search(r'\[.*\]', raw, re.DOTALL)
            if m:
                try:
                    return json.loads(m.group(0))
                except json.JSONDecodeError:
                    pass
            return None

        try:
            raw = await _call_groq(temp=0.3)
            chunk_clips = _parse_raw(raw)
            if chunk_clips is None:
                log(job_id, f"  chunk {chunk_idx+1} bad JSON on attempt 1, retrying with temp=0.1...")
                raw = await _call_groq(temp=0.1)
                chunk_clips = _parse_raw(raw)
            if chunk_clips is None:
                log(job_id, f"  chunk {chunk_idx+1} still bad JSON after retry — skipping. Raw: {raw[:300]}")
                continue
            log(job_id, f"  → chunk {chunk_idx+1} returned {len(chunk_clips)} clip candidates")
            all_clips.extend(chunk_clips)
        except Exception as e:
            log(job_id, f"  !!! Groq API error on chunk {chunk_idx+1}: {e} — skipping chunk")
            continue

    # Sort by virality score and take top max_clips
    all_clips.sort(key=lambda x: x.get("virality_score", 0), reverse=True)
    clips = all_clips[:max_clips]
    log(job_id, f"Top {len(clips)} clips selected (scores: {[c.get('virality_score') for c in clips]})")

    # Validate & clamp durations
    # When LLM returns a clip shorter than min_dur, extend to the midpoint of the
    # allowed range so the output isn't always exactly min_dur long.
    target_dur = (min_dur + max_dur) // 2
    valid = []
    for c in clips:
        dur = c["end"] - c["start"]
        if dur < min_dur:
            c["end"] = c["start"] + target_dur
        elif dur > max_dur:
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


# ── caption style presets ─────────────────────────────────────────────────────
# Each entry: (Default style line, Highlight style line) — ASS V4+ format
# Fields after Name: Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,
#   BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,
#   BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
_CAPTION_STYLES: dict[str, tuple[str, str]] = {
    # Format: Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,...
    # PrimaryColour  = colour of words AFTER being spoken (white)
    # SecondaryColour = karaoke sweep colour — words show in this colour BEFORE being spoken
    "bold_bottom": (
        "Montserrat,72,&H00FFFFFF,&H0000D4FF,&H00000000,&H80000000,-1,0,0,0,100,100,2,0,1,3,2,2,80,80,500,1",
        "Montserrat,72,&H0000D4FF,&H0000D4FF,&H00000000,&H80000000,-1,0,0,0,100,100,2,0,1,3,2,2,80,80,500,1",
    ),
    "center_pop": (
        "Montserrat,88,&H00FFFFFF,&H0000FFFF,&H00000000,&HFF000000,-1,0,0,0,100,100,2,0,1,5,0,5,80,80,0,1",
        "Montserrat,88,&H0000FFFF,&H0000FFFF,&H00000000,&HFF000000,-1,0,0,0,100,100,2,0,1,5,0,5,80,80,0,1",
    ),
    "minimal": (
        # Smaller, not bold, thin outline, no per-word colour change
        "Montserrat,56,&H00FFFFFF,&H00FFFFFF,&H00000000,&HFF000000,0,0,0,0,100,100,2,0,1,2,0,2,80,80,400,1",
        "Montserrat,56,&H00FFFFFF,&H00FFFFFF,&H00000000,&HFF000000,0,0,0,0,100,100,2,0,1,2,0,2,80,80,400,1",
    ),
}

_LANGUAGE_NAMES: dict[str, str] = {
    "en": "English", "es": "Spanish", "fr": "French", "de": "German",
    "pt": "Portuguese", "it": "Italian", "hi": "Hindi", "ar": "Arabic",
    "zh": "Chinese (Simplified)", "ja": "Japanese", "ko": "Korean",
    "ru": "Russian", "nl": "Dutch", "tr": "Turkish", "pl": "Polish",
}


async def translate_segments(segments: list, target_lang: str, job_id: str) -> list:
    """Translate transcript segments to target_lang using Llama, redistributing word timing."""
    lang_name = _LANGUAGE_NAMES.get(target_lang, target_lang)
    log(job_id, f"[translate] Translating {len(segments)} segments → {lang_name}")

    BATCH = 30
    translated_texts: list[str] = []

    for batch_start in range(0, len(segments), BATCH):
        batch = segments[batch_start: batch_start + BATCH]
        texts = [s["text"].strip() for s in batch]
        prompt = (
            f'Translate each string in this JSON array to {lang_name}. '
            f'Return ONLY a JSON array of translated strings in the same order. '
            f'No markdown, no explanation.\n\n{json.dumps(texts, ensure_ascii=False)}'
        )

        def _sync(p=prompt):
            client = Groq(api_key=get_groq_key())
            r = client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=[{"role": "user", "content": p}],
                temperature=0.1,
                max_tokens=4000,
            )
            return r.choices[0].message.content.strip()

        try:
            raw = await groq_with_retry(
                lambda: asyncio.to_thread(_sync),
                limiter=llama_limiter,
                log_fn=lambda m: log(job_id, m),
            )
            if raw.startswith("```"):
                raw = raw.split("```")[1]
                if raw.startswith("json"):
                    raw = raw[4:]
                raw = raw.strip()
            result = json.loads(raw)
            if isinstance(result, list) and len(result) == len(batch):
                translated_texts.extend(result)
                continue
        except Exception as e:
            log(job_id, f"[translate] batch error: {e}")
        # fallback: keep originals for this batch
        translated_texts.extend(texts)

    # Rebuild segments with translated text + proportionally redistributed word timing
    out = []
    for seg, trans_text in zip(segments, translated_texts):
        new_seg = dict(seg)
        new_seg["text"] = trans_text
        words = trans_text.split()
        duration = seg["end"] - seg["start"]
        if words and duration > 0:
            total_chars = sum(len(w) for w in words) or 1
            t = seg["start"]
            new_words = []
            for w in words:
                dur = duration * len(w) / total_chars
                new_words.append({"word": w, "start": t, "end": t + dur})
                t += dur
            new_seg["words"] = new_words
        out.append(new_seg)

    log(job_id, f"[translate] done")
    return out


def _hex_to_ass(hex_color: str) -> str:
    """Convert #RRGGBB to ASS &H00BBGGRR format (fully opaque)."""
    h = hex_color.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return f"&H00{b:02X}{g:02X}{r:02X}"


# ── build ASS subtitle file (word-by-word TikTok style) ───────────────────────
def build_ass_subtitles(
    segments: list,
    clip_start: float,
    clip_end: float,
    output_path: Path,
    video_width: int = 1080,
    video_height: int = 1920,
    caption_style: str = "bold_bottom",
    font_size: Optional[int] = None,
    highlight_color: Optional[str] = None,
):
    default_line, highlight_line = _CAPTION_STYLES.get(caption_style, _CAPTION_STYLES["bold_bottom"])

    # Apply per-job overrides on top of the chosen style preset
    if font_size is not None or highlight_color is not None:
        def _apply(line: str, is_default: bool) -> str:
            parts = line.split(",")
            if font_size is not None:
                parts[1] = str(font_size)
            if highlight_color is not None and is_default:
                # SecondaryColour (parts[3]) = the karaoke sweep colour shown before a
                # word is "spoken".  All dialogue events use the Default style, so this
                # is the only field that actually changes what the viewer sees.
                parts[3] = _hex_to_ass(highlight_color)
            return ",".join(parts)
        default_line = _apply(default_line, is_default=True)
        highlight_line = _apply(highlight_line, is_default=False)

    ass_header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {video_width}
PlayResY: {video_height}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{default_line}
Style: Highlight,{highlight_line}

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
            karaoke_text += f"{{\\k{dur_cs}}}{w['word'].strip().upper()} "

        karaoke_text = karaoke_text.strip()
        events.append(
            f"Dialogue: 0,{ts(line_start)},{ts(line_end)},Default,,0,0,0,,{karaoke_text}"
        )

    ass_content = ass_header + "\n".join(events) + "\n"
    output_path.write_text(ass_content, encoding="utf-8")


# ── smart speaker-tracking crop ───────────────────────────────────────────────

def _yolo_sample_positions_sequential(clip_path: Path, src_w: int, src_h: int) -> list:
    """
    Sample frames SEQUENTIALLY from a pre-extracted clip (no random seeking).
    Sequential reading is reliable across all codecs; time-based seeking in the
    source video can silently land on wrong/corrupt frames for yt-dlp merges.
    Returns [(rel_time, crop_x), ...] compatible with smooth_crop_trajectory.
    """
    if not _REFRAME_AVAILABLE:
        return []
    try:
        import cv2 as _cv2
    except ImportError:
        return []

    crop_w = min(int(src_h * 9 / 16), src_w)
    model  = _get_yolo()
    cap    = _cv2.VideoCapture(str(clip_path))
    fps    = cap.get(_cv2.CAP_PROP_FPS) or 30.0
    sample_every = max(1, int(fps))  # one sample per second

    results: list = []
    prev_frame = None
    frame_idx  = 0
    frames_tried = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break
        if frame_idx % sample_every == 0:
            frames_tried += 1
            cx = _speaking_person_cx(frame, prev_frame, model)
            if cx is not None:
                t = frame_idx / fps
                crop_x = max(0, min(int(cx - crop_w / 2), src_w - crop_w))
                results.append((round(t, 3), crop_x))
            prev_frame = frame
        frame_idx += 1

    cap.release()
    print(f"[reframe] {len(results)}/{frames_tried} frames detected a person", flush=True)
    return results


def smooth_crop_trajectory(
    detections: list,
    clip_duration: float,
    fallback_crop_x: int,
    crop_w: int,
    src_w: int,
    max_speed_px_per_s: float = 400.0,
    dead_zone_ratio: float = 0.60,
) -> list:
    """
    Dead-zone lazy-pan crop trajectory.

    The crop only moves when the face exits the central dead_zone_ratio of the
    frame (default 60 %).  Inside that zone the crop holds still, eliminating
    the constant micro-jitter of always chasing the face center.  When a pan IS
    needed it eases smoothly at max_speed_px_per_s.
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

    # Dead zone: only reposition when face exits the safe band
    # detections store crop_x-if-centered, so face_cx = crop_x + crop_w//2
    safe_margin = int((1.0 - dead_zone_ratio) / 2.0 * crop_w)  # px from each edge
    current_x = fallback_crop_x
    # Only add t=0 bookend if no detection starts at 0 (avoids duplicate timestamps)
    keyframes = [] if (filtered and filtered[0][0] < 0.001) else [(0.0, current_x)]

    for t, centered_x in filtered:
        face_cx = centered_x + crop_w // 2
        left_bound  = current_x + safe_margin
        right_bound = current_x + crop_w - safe_margin

        if left_bound <= face_cx <= right_bound:
            # Face is comfortably inside frame — hold position
            target_x = current_x
        elif face_cx < left_bound:
            # Drifting toward left edge — move just enough to hit safe zone edge
            target_x = max(0, face_cx - safe_margin)
        else:
            # Drifting toward right edge
            target_x = min(src_w - crop_w, face_cx - (crop_w - safe_margin))

        current_x = target_x
        keyframes.append((round(t, 3), target_x))

    if keyframes[-1][0] < clip_duration:
        keyframes.append((round(clip_duration, 3), current_x))

    # Rate-limit movement for smooth pans
    smoothed = [keyframes[0]]
    for i in range(1, len(keyframes)):
        t_prev, x_prev = smoothed[-1]
        t_cur,  x_cur  = keyframes[i]
        dt = max(t_cur - t_prev, 0.001)
        max_delta = int(max_speed_px_per_s * dt)
        x_cur = x_prev + max(-max_delta, min(max_delta, x_cur - x_prev))
        smoothed.append((t_cur, x_cur))

    return smoothed


def write_sendcmd_file(trajectory: list, output_path: Path, fps: float = 30.0) -> None:
    """
    Write FFmpeg sendcmd with per-frame crop x values, linearly interpolated
    between sparse keyframes. With a 50px/s speed limit this means each frame
    moves at most ~1.7px — smooth enough to be invisible.
    """
    if not trajectory:
        return
    if len(trajectory) == 1:
        output_path.write_text(f"0-3600 crop x {trajectory[0][1]};\n", encoding="utf-8")
        return

    frame_dur = 1.0 / fps
    lines = []

    for i in range(len(trajectory) - 1):
        t0, x0 = trajectory[i]
        t1, x1 = trajectory[i + 1]
        dt = t1 - t0
        if dt <= 0:
            continue
        n_frames = max(1, round(dt * fps))
        for j in range(n_frames):
            t_frame = t0 + j * frame_dur
            alpha = j / n_frames
            x_frame = int(round(x0 + alpha * (x1 - x0)))
            t_end = t_frame + frame_dur
            lines.append(f"{t_frame:.4f}-{t_end:.4f} crop x {x_frame};")

    # Hold last position to end of clip
    t_last, x_last = trajectory[-1]
    lines.append(f"{t_last:.4f}-{t_last + 3600:.4f} crop x {x_last};")

    output_path.write_text("\n".join(lines), encoding="utf-8")


# ── cut clips + burn subtitles ────────────────────────────────────────────────
async def create_clips(
    video_path: Path,
    clip_defs: list,
    segments: list,
    job_dir: Path,
    job_id: str,
    reframe: bool = False,
    caption_style: str = "bold_bottom",
    font_size: Optional[int] = None,
    highlight_color: Optional[str] = None,
    caption_segments: Optional[list] = None,
) -> list:
    log(job_id, f"Rendering {len(clip_defs)} clips...")
    await update_job(job_id, status="clipping", progress=78, message="Cutting clips and burning subtitles...")

    results = []
    for idx, clip in enumerate(clip_defs):
        start = clip["start"]
        end   = clip["end"]
        dur   = end - start

        log(job_id, f"Clip {idx+1}/{len(clip_defs)}: '{clip['title']}' [{start:.1f}s – {end:.1f}s] ({dur:.1f}s)")
        # clipping: 78-98 spread across clips
        progress = 78 + int((idx / len(clip_defs)) * 20)
        await update_job(job_id, progress=progress, message=f"Rendering clip {idx+1}/{len(clip_defs)}: {clip['title']}")

        # Get video dimensions (assume 16:9 source → crop to 9:16 for shorts)
        probe_cmd = [
            FFPROBE, "-v", "quiet", "-print_format", "json",
            "-show_streams", str(video_path)
        ]
        _, probe_out, _ = await asyncio.to_thread(run_cmd, probe_cmd)
        probe = json.loads(probe_out)
        vstream = next((s for s in probe["streams"] if s["codec_type"] == "video"), None)
        src_w = int(vstream["width"])  if vstream else 1920
        src_h = int(vstream["height"]) if vstream else 1080
        if vstream:
            num, den = vstream.get("r_frame_rate", "30/1").split("/")
            clip_fps = float(num) / max(1, float(den))
        else:
            clip_fps = 30.0

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
            caption_segments if caption_segments is not None else segments,
            clip_start=start,
            clip_end=end,
            output_path=ass_path,
            video_width=out_w,
            video_height=out_h,
            caption_style=caption_style,
            font_size=font_size,
            highlight_color=highlight_color,
        )

        safe_title = re.sub(r'[^\w]', '_', clip['title'][:30])
        clip_filename = f"clip_{idx+1}_{safe_title}.mp4"
        clip_path = OUTPUT_DIR / job_id / clip_filename
        clip_path.parent.mkdir(exist_ok=True)

        # basename-only for filter paths — avoids Windows drive-letter colon issue
        ass_filename = ass_path.name

        # Speaker-tracking crop: YOLO + dead-zone smooth when reframe=True,
        # static center crop otherwise (fast path, good for already-centered content)
        if reframe:
            if not _REFRAME_AVAILABLE:
                await update_job(job_id, message=f"Rendering clip {idx+1}/{len(clip_defs)}: {clip['title']} (YOLO unavailable — using center crop)")
                detections = []
            else:
                # Extract the clip segment first so YOLO can read frames sequentially
                # (avoids codec seeking bugs in the full downloaded source video)
                temp_yolo = job_dir / f"clip_{idx}_yolo.mp4"
                # Transcode to H.264 so OpenCV can decode it — AV1 source videos
                # fail silently in OpenCV even though ffmpeg handles them fine.
                await run_cmd_async([FFMPEG, "-y", "-ss", str(start), "-i", str(video_path),
                                     "-t", str(dur), "-c:v", "libx264", "-preset", "ultrafast",
                                     "-crf", "28", "-an", str(temp_yolo)])
                detections = await asyncio.to_thread(_yolo_sample_positions_sequential, temp_yolo, src_w, src_h)
                temp_yolo.unlink(missing_ok=True)
                log(job_id, f"  YOLO detections: {len(detections)} samples, source: {src_w}x{src_h}, crop: {crop_w}x{crop_h}")
                if len(detections) == 0:
                    await update_job(job_id, message=f"Rendering clip {idx+1}/{len(clip_defs)}: {clip['title']} (no person detected — using center crop)")
            trajectory = smooth_crop_trajectory(detections, dur, fallback_crop_x=center_crop_x, crop_w=crop_w, src_w=src_w)
        else:
            trajectory = [(0.0, center_crop_x), (round(dur, 3), center_crop_x)]
        is_dynamic = len(set(x for _, x in trajectory)) > 1
        log(job_id, f"  Crop mode: {'dynamic pan' if is_dynamic else 'static'} (x={trajectory[0][1]})")

        if is_dynamic:
            sendcmd_path = job_dir / f"clip_{idx}_crop.txt"
            write_sendcmd_file(trajectory, sendcmd_path, fps=clip_fps)
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
            FFMPEG, "-y",
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

        log(job_id, f"  Running FFmpeg for clip {idx+1}...")
        code, _, err = await run_cmd_async(ffmpeg_cmd, str(job_dir))
        if code != 0:
            log(job_id, f"  !!! FFmpeg FAILED for clip {idx+1}: {err[-300:]}")
            await update_job(job_id, message=f"Clip {idx+1} render failed: {err[-200:]}")
            continue

        log(job_id, f"  Clip {idx+1} done → {clip_path.name}")
        if R2_ENABLED:
            try:
                upload_clip(clip_path, job_id, clip_filename)
                clip_path.unlink(missing_ok=True)
                log(job_id, f"  Uploaded to R2, removed from disk")
            except Exception as e:
                log(job_id, f"  R2 upload failed (clip kept locally): {e}")
        results.append({
            **clip,
            "filename": clip_filename,
            "path": f"/clips/{job_id}/{clip_filename}",
            "duration": round(dur, 1),
        })

    return results


async def fetch_latest_video(channel_url: str) -> Optional[dict]:
    cmd = [YTDLP, "--flat-playlist", "--playlist-end", "1", "-j", "--no-warnings"]
    if COOKIES_FROM_BROWSER:
        cmd += ["--cookies-from-browser", COOKIES_FROM_BROWSER]
    elif COOKIES_FILE.exists():
        cmd += ["--cookies", str(COOKIES_FILE)]
    cmd.append(channel_url)
    def _run():
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
            return result.returncode, result.stdout.strip()
        except Exception as e:
            return -1, ""
    code, out = await asyncio.to_thread(_run)
    if code != 0 or not out:
        return None
    for line in out.splitlines():
        line = line.strip()
        if line.startswith("{"):
            try:
                return json.loads(line)
            except:
                pass
    return None


async def channel_poller():
    await asyncio.sleep(15)  # brief startup delay
    while True:
        for ch in db_get_all_channels():
            channel_id = ch["id"]
            try:
                print(f"[watchlist] Checking {ch.get('name', channel_id)}...", flush=True)
                video = await fetch_latest_video(ch["url"])
                db_update_channel(channel_id, {"last_checked": datetime.now(timezone.utc).isoformat()})
                if not video:
                    db_update_channel(channel_id, {"status": "error"})
                    continue
                video_id = video.get("id")
                db_update_channel(channel_id, {"status": "watching"})
                if video_id and video_id != ch.get("last_video_id"):
                    print(f"[watchlist] New video: {video.get('title')} ({video_id})", flush=True)
                    db_update_channel(channel_id, {
                        "last_video_id": video_id,
                        "last_video_title": video.get("title", ""),
                    })
                    video_url = f"https://www.youtube.com/watch?v={video_id}"
                    user_id = ch.get("user_id", "")
                    profile = db_check_and_reset_quota(user_id)
                    if profile.get("plan") != "pro":
                        print(f"[watchlist] Skipping channel {channel_id}: user {user_id} is not Pro", flush=True)
                        continue
                    job = db_create_job({
                        "user_id": user_id,
                        "status": "queued", "progress": 0,
                        "message": f"Queued by watchlist: {ch.get('name','')}",
                        "clips": [], "error": None, "url": video_url,
                        "source": "watchlist", "channel_id": channel_id,
                    })
                    job_id = job["id"]
                    req = ClipRequest(
                        url=video_url,
                        max_clips=ch.get("max_clips", 3),
                        min_duration=ch.get("min_duration", 30),
                        max_duration=ch.get("max_duration", 90),
                        reframe=True,
                        caption_style=ch.get("caption_style", "bold_bottom"),
                        caption_font_size=ch.get("caption_font_size"),
                        caption_highlight_color=ch.get("caption_highlight_color"),
                        caption_language=ch.get("caption_language", "source"),
                    )
                    asyncio.create_task(run_pipeline(job_id, req, user_id=user_id, auto_upload=ch.get("auto_upload", False), auto_upload_yt_channel=ch.get("yt_channel_id")))
            except Exception as e:
                print(f"[watchlist] Error checking {channel_id}: {e}", flush=True)
                db_update_channel(channel_id, {"last_checked": datetime.now(timezone.utc).isoformat()})
        await asyncio.sleep(30 * 60)


# ══════════════════════════════════════════════════════════════════════════════
# EMAIL NOTIFICATIONS
# ══════════════════════════════════════════════════════════════════════════════

async def send_job_notification(user_id: str, clip_count: int, video_url: str, error: str = "") -> None:
    """Send a Resend email when a job finishes. No-ops silently if RESEND_API_KEY is unset."""
    api_key = os.getenv("RESEND_API_KEY", "")
    if not api_key or not user_id:
        return
    try:
        import httpx
        email = await asyncio.to_thread(db_get_user_email, user_id)
        if not email:
            return
        app_url = os.getenv("APP_URL", "https://clipforge.ai")
        from html import escape as _he
        safe_url = _he(video_url)
        if error:
            subject = "ClipForge — your job hit an error"
            body = f"""<div style="font-family:monospace;max-width:540px;margin:0 auto;padding:32px 24px;background:#fef7e4;border:3px solid #1a0d2e">
  <div style="font-size:22px;font-weight:bold;color:#1a0d2e;margin-bottom:8px">&#x26A0;&#xFE0F; Job failed</div>
  <p style="color:#4a3d68;margin:0 0 12px">Your ClipForge job ran into a problem and couldn&#x27;t finish.</p>
  <p style="word-break:break-all;color:#1a0d2e;margin:0 0 6px"><strong>Video:</strong> {safe_url}</p>
  <p style="color:#d4669a;margin:0 0 20px"><strong>Error:</strong> An error occurred while processing your video.</p>
  <a href="{app_url}/archive" style="display:inline-block;padding:12px 20px;background:#f5a3c7;color:#1a0d2e;text-decoration:none;font-weight:bold;border:2px solid #1a0d2e">View in Archive &#x2192;</a>
</div>"""
        else:
            noun = "clip" if clip_count == 1 else "clips"
            subject = f"ClipForge — {clip_count} {noun} ready to ship!"
            body = f"""<div style="font-family:monospace;max-width:540px;margin:0 auto;padding:32px 24px;background:#fef7e4;border:3px solid #1a0d2e">
  <div style="font-size:22px;font-weight:bold;color:#1a0d2e;margin-bottom:8px">&#x2705; Your clips are ready</div>
  <p style="color:#4a3d68;margin:0 0 12px"><span style="font-size:32px;color:#1a0d2e;font-weight:bold">{clip_count}</span> {noun} forged and waiting for you.</p>
  <p style="word-break:break-all;color:#1a0d2e;margin:0 0 20px"><strong>Video:</strong> {safe_url}</p>
  <a href="{app_url}/archive" style="display:inline-block;padding:12px 20px;background:#7ddca0;color:#1a0d2e;text-decoration:none;font-weight:bold;border:2px solid #1a0d2e">Open in ClipForge &#x2192;</a>
</div>"""
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={
                    "from": "ClipForge <notifications@updates.automationsociety.dpdns.org>",
                    "to": [email],
                    "subject": subject,
                    "html": body,
                },
            )
        print(f"[email] Sent '{subject}' to {email}", flush=True)
    except Exception as e:
        print(f"[email] Notification failed (non-fatal): {e}", flush=True)


# ══════════════════════════════════════════════════════════════════════════════
# MAIN PIPELINE
# ══════════════════════════════════════════════════════════════════════════════

async def run_pipeline(job_id: str, req: ClipRequest, user_id: str = "", auto_upload: bool = False, auto_upload_yt_channel: Optional[str] = None):
    job_dir = TEMP_DIR / job_id
    job_dir.mkdir(exist_ok=True)
    log(job_id, f"=== PIPELINE START === url={req.url}")

    try:
        # 1. Download
        log(job_id, "--- PHASE 1: DOWNLOAD ---")
        video_path = await download_video(req.url, job_dir, job_id)
        log(job_id, f"Download done → {video_path} ({video_path.stat().st_size / 1_048_576:.1f} MB)")

        # 2. Transcribe
        log(job_id, "--- PHASE 2: TRANSCRIBE ---")
        segments = await transcribe(video_path, job_id)
        log(job_id, f"Transcription done → {len(segments)} segments")

        # Save transcript alongside output clips so it survives temp cleanup
        out_dir = OUTPUT_DIR / job_id
        out_dir.mkdir(exist_ok=True)
        (out_dir / "transcript.json").write_text(json.dumps(segments, indent=2))

        # 3. Virality analysis
        log(job_id, "--- PHASE 3: ANALYZE ---")
        clips = await analyze_virality(
            segments, job_id,
            req.max_clips, req.min_duration, req.max_duration,
            style_prompt=req.style_prompt or "",
        )
        log(job_id, f"Analysis done → {len(clips)} clips selected")

        # 4. Optionally translate captions (clip selection always uses source language)
        caption_segs = segments
        if req.caption_language and req.caption_language != "source":
            log(job_id, f"--- PHASE 3b: TRANSLATE CAPTIONS → {req.caption_language} ---")
            await update_job(job_id, status="analyzing", progress=77,
                       message=f"Translating captions to {_LANGUAGE_NAMES.get(req.caption_language, req.caption_language)}...")
            caption_segs = await translate_segments(segments, req.caption_language, job_id)

        # 5. Cut + subtitle
        log(job_id, "--- PHASE 4: CLIP ---")
        log(job_id, f"  caption_style={req.caption_style!r} lang={req.caption_language} font_size={req.caption_font_size} highlight={req.caption_highlight_color} reframe={req.reframe}")
        final_clips = await create_clips(
            video_path, clips, segments, job_dir, job_id,
            reframe=req.reframe,
            caption_style=req.caption_style or "bold_bottom",
            font_size=req.caption_font_size,
            highlight_color=req.caption_highlight_color,
            caption_segments=caption_segs,
        )

        await update_job(
            job_id,
            status="done",
            progress=100,
            message=f"Done! {len(final_clips)} clips created.",
            clips=final_clips,
        )
        if user_id and final_clips:
            db_increment_clips_used(user_id, len(final_clips))
        if auto_upload and final_clips:
            log(job_id, f"Auto-uploading {len(final_clips)} clips to YouTube...")
            for i in range(len(final_clips)):
                clip = final_clips[i]
                source_suffix = f"\n\nWatch the full video: {req.url}" if req.url else ""
                desc = "\n\n".join(filter(None, [clip.get("hook",""), clip.get("reason",""), " ".join(f"#{t}" for t in clip.get("tags",[]))])) + source_suffix
                upload_data = {
                    "title": clip.get("title", f"Clip {i+1}"),
                    "description": desc,
                    "tags": clip.get("tags", []),
                    "privacy_status": "public",
                }
                if auto_upload_yt_channel:
                    upload_data["yt_channel_id"] = auto_upload_yt_channel
                log(job_id, f"  Auto-uploading clip {i+1}/{len(final_clips)}...")
                await asyncio.to_thread(do_youtube_upload, job_id, i, upload_data, user_id)
        log(job_id, f"=== PIPELINE DONE === {len(final_clips)} clips delivered")
        if user_id:
            asyncio.create_task(send_job_notification(user_id, len(final_clips), req.url))

    except asyncio.CancelledError:
        log(job_id, "=== PIPELINE CANCELLED ===")
        await update_job(job_id, status="cancelled", progress=0, message="Job cancelled by user.")
        raise
    except Exception as e:
        import traceback as _tb
        log(job_id, f"!!! PIPELINE ERROR (full): {_tb.format_exc()}")
        await update_job(job_id, status="error", progress=0, message="Pipeline failed",
                   error="An error occurred while processing your video. Please try again.")
        if user_id:
            asyncio.create_task(send_job_notification(user_id, 0, req.url, error="Pipeline failed"))
        raise
    finally:
        _running_tasks.pop(job_id, None)
        if job_dir.exists():
            shutil.rmtree(job_dir, ignore_errors=True)



# ── Job timeout watchdog ───────────────────────────────────────────────────────
async def watchdog():
    """Auto-fail jobs with no DB activity for 20 minutes, or older than 90 minutes."""
    while True:
        await asyncio.sleep(60)
        now = datetime.now(timezone.utc)
        for job in db_get_active_jobs():
            job_id = job["id"]
            try:
                # Prefer updated_at (tracks last activity) over created_at (tracks age)
                ts_str = job.get("updated_at") or job.get("created_at", "")
                if not ts_str:
                    continue
                ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                if ts.tzinfo is None:
                    ts = ts.replace(tzinfo=timezone.utc)
                idle_minutes = (now - ts).total_seconds() / 60

                created_str = job.get("created_at", ts_str)
                created = datetime.fromisoformat(created_str.replace("Z", "+00:00"))
                if created.tzinfo is None:
                    created = created.replace(tzinfo=timezone.utc)
                age_minutes = (now - created).total_seconds() / 60

                # Kill if stuck (no update for 20 min) OR if total age exceeds 90 min
                if idle_minutes > 20 or age_minutes > 90:
                    reason = "no progress for 20 minutes" if idle_minutes > 20 else "exceeded 90-minute limit"
                    await asyncio.to_thread(db_update_job, job_id, {
                        "status": "error", "progress": 0,
                        "message": "Pipeline failed", "error": f"Job timed out ({reason})",
                    })
            except Exception:
                pass

async def _get_videos_since(channel_url: str, days_back: int) -> list:
    """Return list of {id, title, url} for videos published in the last days_back days."""
    from datetime import datetime, timezone, timedelta
    date_str = (datetime.now(timezone.utc) - timedelta(days=days_back)).strftime("%Y%m%d")
    cmd = [YTDLP, "--flat-playlist", "--dateafter", date_str,
           "--playlist-end", "200", "-j", "--no-warnings"]
    if COOKIES_FROM_BROWSER:
        cmd += ["--cookies-from-browser", COOKIES_FROM_BROWSER]
    elif COOKIES_FILE.exists():
        cmd += ["--cookies", str(COOKIES_FILE)]
    cmd.append(channel_url.rstrip("/") + "/videos")

    def _run():
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
            return r.stdout.strip()
        except Exception:
            return ""

    out = await asyncio.to_thread(_run)
    videos = []
    for line in out.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            d = json.loads(line)
            vid_id = d.get("id")
            if not vid_id:
                continue
            upload_date = d.get("upload_date", "")
            if upload_date and upload_date < date_str:
                continue  # client-side guard for entries yt-dlp may not have filtered
            videos.append({
                "id": vid_id,
                "title": d.get("title", vid_id),
                "url": f"https://www.youtube.com/watch?v={vid_id}",
            })
        except Exception:
            pass
    return videos


async def _process_backfill(bf: dict) -> None:
    from datetime import datetime, timezone
    bf_id = bf["id"]
    user_id = bf["user_id"]
    channel_url = bf.get("channel_url", "")
    days_back = bf.get("days_back", 30)
    vpd = bf.get("videos_per_day", 2)
    yt_ch_id = bf.get("yt_upload_channel_id") or None
    processed = set(bf.get("processed_video_ids") or [])

    profile = await asyncio.to_thread(db_check_and_reset_quota, user_id)
    if profile.get("plan") != "pro":
        return

    videos = await _get_videos_since(channel_url, days_back)
    total = len(videos)
    unprocessed = [v for v in videos if v["id"] not in processed]

    if not unprocessed:
        await asyncio.to_thread(db_update_backfill, bf_id, {
            "status": "completed",
            "total_videos": total,
            "last_run_at": datetime.now(timezone.utc).isoformat(),
        })
        print(f"[backfill] {channel_url} completed — all {total} videos processed", flush=True)
        return

    to_process = unprocessed[:vpd]
    new_processed = list(processed)

    for video in to_process:
        try:
            req = ClipRequest(url=video["url"], max_clips=3, min_duration=30, max_duration=90)
            job_data = {
                "user_id": user_id,
                "url": video["url"],
                "status": "queued",
                "max_clips": req.max_clips,
                "min_duration": req.min_duration,
                "max_duration": req.max_duration,
            }
            job = await asyncio.to_thread(db_create_job, job_data)
            asyncio.create_task(run_pipeline(
                job["id"], req,
                user_id=user_id,
                auto_upload=bool(yt_ch_id),
                auto_upload_yt_channel=yt_ch_id,
            ))
            new_processed.append(video["id"])
            print(f"[backfill] queued {video['url']}", flush=True)
        except Exception as ve:
            print(f"[backfill] error queuing {video['url']}: {ve}", flush=True)

    await asyncio.to_thread(db_update_backfill, bf_id, {
        "processed_video_ids": new_processed,
        "total_videos": total,
        "last_run_at": datetime.now(timezone.utc).isoformat(),
    })


async def backfill_scheduler():
    from datetime import datetime, timezone
    await asyncio.sleep(30)
    while True:
        try:
            backfills = await asyncio.to_thread(db_get_active_backfills)
            for bf in backfills:
                last_run = bf.get("last_run_at")
                if last_run:
                    last_run_dt = datetime.fromisoformat(last_run.replace("Z", "+00:00"))
                    if (datetime.now(timezone.utc) - last_run_dt).total_seconds() < 82800:
                        continue  # ran within the last 23h
                asyncio.create_task(_process_backfill(bf))
        except Exception as e:
            print(f"[backfill_scheduler] error: {e}", flush=True)
        await asyncio.sleep(3600)  # check every hour


@app.on_event("startup")
async def startup_event():
    asyncio.create_task(watchdog())
    asyncio.create_task(channel_poller())
    asyncio.create_task(analytics_refresher())
    asyncio.create_task(backfill_scheduler())

# ══════════════════════════════════════════════════════════════════════════════
# API ROUTES
# ══════════════════════════════════════════════════════════════════════════════

_YOUTUBE_URL_RE = re.compile(
    r'^https?://(www\.)?(youtube\.com|youtu\.be|m\.youtube\.com)/'
)

@app.post("/api/clip")
@_limiter.limit("10/minute")
async def start_clip(request: Request, req: ClipRequest, user=Depends(require_auth)):
    if not _YOUTUBE_URL_RE.match(req.url.strip()):
        raise HTTPException(400, "Only YouTube URLs are accepted.")
    req.url = req.url.strip()
    profile = db_check_and_reset_quota(user.id)
    plan = profile.get("plan", "free")
    max_clips_per_job = PRO_MAX_CLIPS_PER_JOB if plan == "pro" else FREE_MAX_CLIPS_PER_JOB
    if req.reframe and plan != "pro":
        raise HTTPException(403, "Auto-reframe (9:16) requires a Pro plan. Upgrade to unlock.")
    req.max_clips = min(req.max_clips, max_clips_per_job)
    if plan != "pro":
        claimed = db_claim_clips_atomic(user.id, req.max_clips, FREE_MONTHLY_CLIP_LIMIT)
        if not claimed:
            raise HTTPException(403, f"Monthly clip limit reached ({FREE_MONTHLY_CLIP_LIMIT} clips). Upgrade to Pro for unlimited clips.")
    job = db_create_job({
        "user_id": user.id,
        "status": "queued",
        "progress": 0,
        "message": "Queued...",
        "clips": [],
        "error": None,
        "url": req.url,
        "reframe": req.reframe,
        "max_clips": req.max_clips,
        "min_duration": req.min_duration,
        "max_duration": req.max_duration,
        "style_prompt": req.style_prompt or "",
        "caption_style": req.caption_style or "bold_bottom",
        "caption_font_size": req.caption_font_size,
        "caption_highlight_color": req.caption_highlight_color,
        "caption_language": req.caption_language or "source",
    })
    job_id = job["id"]
    task = asyncio.create_task(run_pipeline(job_id, req, user_id=user.id))
    _running_tasks[job_id] = task
    return {"job_id": job_id}


@app.post("/api/jobs/{job_id}/cancel")
async def cancel_job(job_id: str, user=Depends(require_auth)):
    job = db_get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    if job.get("user_id") != user.id:
        raise HTTPException(403, "Forbidden")
    status = job.get("status", "")
    if status in ("done", "error", "cancelled"):
        return {"ok": False, "reason": f"Job already {status}"}
    await asyncio.to_thread(db_update_job, job_id, {"status": "cancelled", "progress": 0, "message": "Job cancelled by user."})
    task = _running_tasks.get(job_id)
    if task and not task.done():
        task.cancel()
    return {"ok": True}


@app.get("/api/status/{job_id}")
async def get_status(job_id: str, user=Depends(require_auth)):
    job = db_get_job(job_id)
    if not job:
        print(f"[status] 404 job_id={job_id} user={user.id}", flush=True)
        raise HTTPException(404, "Job not found")
    if job.get("user_id") != user.id:
        print(f"[status] 403 job_id={job_id} owner={job.get('user_id')} requester={user.id}", flush=True)
        raise HTTPException(403, "Forbidden")
    return _j(_enrich_clips(job))


@app.get("/api/jobs")
async def list_jobs(user=Depends(require_auth), limit: int = 20, offset: int = 0):
    return [_j(j) for j in await asyncio.to_thread(db_get_user_jobs, user.id, limit=limit, offset=offset)]


@app.get("/api/profile")
async def get_profile(user=Depends(require_auth)):
    profile = db_check_and_reset_quota(user.id)
    return {
        "plan": profile.get("plan", "free"),
        "clips_used": profile.get("clips_used", 0),
        "clips_limit": FREE_MONTHLY_CLIP_LIMIT,
    }


@app.get("/api/system")
async def system_status(user=Depends(require_auth)):
    return {"reframe_available": _REFRAME_AVAILABLE}


_UUID_RE = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
_SAFE_FILENAME_RE = re.compile(r'^[a-zA-Z0-9_\-\.]+$')


@app.get("/api/clip-token/{job_id}/{filename}")
async def get_clip_token(job_id: str, filename: str, user=Depends(require_auth)):
    if not _UUID_RE.match(job_id) or not _SAFE_FILENAME_RE.match(filename):
        raise HTTPException(400, "Invalid request")
    job = db_get_job(job_id)
    if not job or job.get("user_id") != user.id:
        raise HTTPException(404, "Not found")
    if not any(c.get("filename") == filename for c in (job.get("clips") or [])):
        raise HTTPException(404, "Not found")
    import secrets as _secrets
    token = _secrets.token_urlsafe(32)
    _clip_token_set(token, job_id, filename)
    return {"token": token}


@app.get("/clips/{job_id}/{filename}")
async def serve_clip(job_id: str, filename: str, t: Optional[str] = None):
    from fastapi.responses import RedirectResponse
    if not _UUID_RE.match(job_id) or not _SAFE_FILENAME_RE.match(filename) or ".." in filename:
        raise HTTPException(400, "Invalid request")
    if not t or not _clip_token_verify(t, job_id, filename):
        raise HTTPException(401, "Unauthorized")
    job = db_get_job(job_id)
    if not job:
        raise HTTPException(404, "Clip not found")
    # Resolve both path components from DB data — no user input reaches the filesystem
    trusted_id   = job["id"]
    trusted_name = next(
        (c["filename"] for c in (job.get("clips") or []) if c.get("filename") == filename),
        None,
    )
    if not trusted_name:
        raise HTTPException(404, "Clip not found")
    clip_path = (OUTPUT_DIR / trusted_id / trusted_name).resolve()
    if not clip_path.is_relative_to(OUTPUT_DIR.resolve()):
        raise HTTPException(400, "Invalid path")
    if clip_path.exists():
        return FileResponse(str(clip_path), media_type="video/mp4")
    if R2_ENABLED:
        url = presigned_url(trusted_id, trusted_name)
        if url:
            return RedirectResponse(url, status_code=307)
    raise HTTPException(404, "Clip not found")


@app.get("/api/transcript/{job_id}")
async def get_transcript(job_id: str, user=Depends(require_auth)):
    if not _UUID_RE.match(job_id):
        raise HTTPException(400, "Invalid job ID")
    job = db_get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    if job.get("user_id") != user.id:
        raise HTTPException(403, "Forbidden")
    trusted_id = job["id"]          # comes from DB, not user input — breaks CodeQL taint
    transcript_path = (OUTPUT_DIR / trusted_id / "transcript.json").resolve()
    if not transcript_path.is_relative_to(OUTPUT_DIR.resolve()):
        raise HTTPException(400, "Invalid path")
    if not transcript_path.exists():
        raise HTTPException(404, "Transcript not found")
    return json.loads(transcript_path.read_text())


# ══════════════════════════════════════════════════════════════════════════════
# YOUTUBE ANALYTICS
# ══════════════════════════════════════════════════════════════════════════════

import urllib.request as _urllib_req
import urllib.parse   as _urllib_parse

def _fetch_yt_stats_sync(video_id: str) -> dict:
    if not YOUTUBE_API_KEY:
        return {}
    url = (
        "https://www.googleapis.com/youtube/v3/videos"
        f"?part=statistics&id={_urllib_parse.quote(video_id)}&key={YOUTUBE_API_KEY}"
    )
    try:
        with _urllib_req.urlopen(url, timeout=10) as resp:
            data = json.loads(resp.read())
        items = data.get("items", [])
        if not items:
            return {}
        stats = items[0].get("statistics", {})
        return {
            "views":    int(stats.get("viewCount",    0)),
            "likes":    int(stats.get("likeCount",    0)) if "likeCount"    in stats else None,
            "comments": int(stats.get("commentCount", 0)) if "commentCount" in stats else None,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as e:
        print(f"[analytics] fetch error for {video_id}: {e}", flush=True)
        return {}


async def fetch_youtube_stats(video_id: str) -> dict:
    return await asyncio.to_thread(_fetch_yt_stats_sync, video_id)


async def analytics_refresher():
    """Background task: refresh YT stats for clips uploaded 7+ days ago."""
    await asyncio.sleep(120)  # wait for server to settle on startup
    while True:
        if YOUTUBE_API_KEY:
            try:
                now = datetime.now(timezone.utc)
                for job in db_get_done_jobs_with_uploads():
                    created_raw = job.get("created_at", "")
                    try:
                        created = datetime.fromisoformat(created_raw.replace("Z", "+00:00"))
                    except Exception:
                        continue
                    if (now - created).days < 7:
                        continue  # video too new — stats still volatile
                    for i, clip in enumerate(job.get("clips") or []):
                        video_id = clip.get("yt_upload", {}).get("video_id")
                        if not video_id:
                            continue
                        existing = clip.get("yt_analytics") or {}
                        if existing.get("fetched_at"):
                            try:
                                last = datetime.fromisoformat(existing["fetched_at"].replace("Z", "+00:00"))
                                if (now - last).total_seconds() < 86400:
                                    continue  # refreshed within 24 h
                            except Exception:
                                pass
                        stats = await fetch_youtube_stats(video_id)
                        if stats:
                            db_update_clip_analytics(job["id"], i, stats)
                            print(f"[analytics] refreshed {video_id}: {stats['views']} views", flush=True)
            except Exception as e:
                print(f"[analytics] refresher error: {e}", flush=True)
        await asyncio.sleep(6 * 3600)  # run every 6 hours


# ══════════════════════════════════════════════════════════════════════════════
# YOUTUBE INTEGRATION
# ══════════════════════════════════════════════════════════════════════════════

def get_youtube_credentials(user_id: str, yt_channel_id: str = None):
    """Load stored YouTube OAuth credentials for a user and refresh if expired.
    If yt_channel_id is given, use that specific channel; otherwise use the first available."""
    token_data = db_get_youtube_token(user_id, yt_channel_id)
    if not token_data:
        return None
    try:
        from google.oauth2.credentials import Credentials
        from google.auth.transport.requests import Request as GRequest
        creds = Credentials(
            token=token_data.get("access_token"),
            refresh_token=token_data.get("refresh_token"),
            token_uri="https://oauth2.googleapis.com/token",
            client_id=YOUTUBE_CLIENT_ID,
            client_secret=YOUTUBE_CLIENT_SECRET,
            scopes=["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"],
        )
        if creds.expired and creds.refresh_token:
            creds.refresh(GRequest())
            db_upsert_youtube_token(user_id, creds.token, creds.refresh_token,
                                    token_data.get("yt_channel_id", ""),
                                    token_data.get("yt_channel_name", ""))
        return creds
    except Exception as e:
        print(f"[yt_credentials] failed for user={user_id}: {e}", flush=True)
        return None


_YT_REASON_MESSAGES = {
    "uploadLimitExceeded": "YouTube upload limit reached. Possible causes: Google Cloud project API quota exhausted (check console.cloud.google.com → YouTube Data API v3 → Quotas), channel has a content restriction (check YouTube Studio), or account is newly created.",
    "quotaExceeded": "YouTube API quota exceeded. Try again tomorrow.",
    "forbidden": "Your YouTube account doesn't have upload permission.",
    "invalidCredentials": "YouTube authentication expired. Please disconnect and reconnect your YouTube account.",
    "accountNotEnabled": "This YouTube account isn't enabled for video uploads. You may need to verify your account at youtube.com.",
    "videoTooLong": "Video exceeds YouTube's maximum length.",
    "invalidVideoMetadata": "The video title or description contains invalid characters.",
}

def _yt_upload_error_msg(exc: Exception) -> str:
    try:
        from googleapiclient.errors import HttpError as _HttpError
        if isinstance(exc, _HttpError):
            import json as _json
            details = _json.loads(exc.content.decode())
            errors = details.get("error", {}).get("errors", [])
            reason = errors[0].get("reason", "") if errors else ""
            if reason in _YT_REASON_MESSAGES:
                return _YT_REASON_MESSAGES[reason]
            msg = details.get("error", {}).get("message", "")
            return msg or f"YouTube API error {exc.status_code}"
    except Exception:
        pass
    return str(exc)


# Serializes concurrent YouTube uploads so they don't choke each other
_yt_upload_sem = threading.Semaphore(1)


def do_youtube_upload(job_id: str, clip_index: int, req_data: dict, user_id: str = ""):
    """Upload a clip to YouTube (runs in background thread, serialized via semaphore)."""
    with _yt_upload_sem:
        _do_youtube_upload(job_id, clip_index, req_data, user_id)


def _do_youtube_upload(job_id: str, clip_index: int, req_data: dict, user_id: str = ""):
    try:
        from googleapiclient.discovery import build as yt_build
        from googleapiclient.http import MediaFileUpload

        yt_channel_id = req_data.get("yt_channel_id") or None
        creds = get_youtube_credentials(user_id, yt_channel_id)
        if not creds:
            db_update_clip_yt_upload(job_id, clip_index, {"status": "error", "error": "Not authenticated with YouTube"})
            return

        job = db_get_job(job_id)
        if not job:
            return
        clips = job.get("clips", [])
        if clip_index >= len(clips):
            return
        clip = clips[clip_index]
        clip_file = OUTPUT_DIR / job_id / clip["filename"]
        temp_file = None
        if not clip_file.exists():
            if R2_ENABLED:
                temp_file = download_clip_to_temp(job_id, clip["filename"])
                if not temp_file:
                    db_update_clip_yt_upload(job_id, clip_index, {"status": "error", "error": "Clip not found in storage"})
                    return
                clip_file = temp_file
            else:
                db_update_clip_yt_upload(job_id, clip_index, {"status": "error", "error": "Clip file not found"})
                return

        youtube = yt_build("youtube", "v3", credentials=creds)

        # Pre-flight: log which channel we're uploading to and check its status
        try:
            ch_resp = youtube.channels().list(part="snippet,status,contentDetails", mine=True).execute()
            ch_items = ch_resp.get("items", [])
            if ch_items:
                ch = ch_items[0]
                ch_title = ch["snippet"]["title"]
                ch_id = ch["id"]
                status = ch.get("status", {})
                long_uploads = status.get("longUploadsStatus", "unknown")
                is_linked = status.get("isLinked", "unknown")
                made_for_kids = status.get("madeForKids", "unknown")
                print(f"[yt_upload] channel='{ch_title}' id={ch_id} longUploadsStatus={long_uploads} isLinked={is_linked} madeForKids={made_for_kids}", flush=True)
            else:
                print("[yt_upload] WARNING: no YouTube channel found for this account", flush=True)
        except Exception as ch_err:
            print(f"[yt_upload] channel check failed: {ch_err}", flush=True)

        tags = req_data.get("tags") or clip.get("tags", [])
        source_url = job.get("url", "")
        auto_desc = (
            f"{clip.get('hook', '')}\n\n"
            f"{clip.get('reason', '')}\n\n"
            + " ".join(f"#{t}" for t in tags)
        ).strip()
        description = req_data.get("description") or auto_desc
        if source_url and source_url not in description:
            description = description + f"\n\nWatch the full video: {source_url}"

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

        db_update_clip_yt_upload(job_id, clip_index, {"status": "uploading", "progress": 0})

        import time as _time
        from googleapiclient.errors import HttpError as _HttpError
        video_id = None
        for attempt in range(3):
            try:
                media = MediaFileUpload(str(clip_file), mimetype="video/mp4", chunksize=20 * 1024 * 1024, resumable=True)
                request = youtube.videos().insert(part="snippet,status", body=body, media_body=media)
                response = None
                while response is None:
                    status, response = request.next_chunk(num_retries=3)
                    if status:
                        total = getattr(status, "total_size", None) or getattr(status, "resumable_total", None)
                        prog = int(status.resumable_progress / total * 100) if total else 0
                        db_update_clip_yt_upload(job_id, clip_index, {"status": "uploading", "progress": prog})
                video_id = response["id"]
                break
            except _HttpError:
                raise  # never retry API-level rejections (e.g. uploadLimitExceeded)
            except Exception as conn_err:
                if attempt == 2:
                    raise
                wait = 2 ** attempt
                print(f"[yt_upload] attempt {attempt+1} failed ({conn_err}), retrying in {wait}s...", flush=True)
                _time.sleep(wait)

        db_update_clip_yt_upload(job_id, clip_index, {
            "status": "done",
            "progress": 100,
            "video_id": video_id,
            "url": f"https://youtube.com/watch?v={video_id}",
        })

    except Exception as e:
        error_msg = _yt_upload_error_msg(e)
        db_update_clip_yt_upload(job_id, clip_index, {"status": "error", "error": error_msg})
        print(f"[yt_upload] job={job_id} clip={clip_index} error: {e}", flush=True)
    finally:
        if temp_file and temp_file.exists():
            temp_file.unlink(missing_ok=True)


# ── Backfill endpoints ─────────────────────────────────────────────────────────

@app.get("/api/backfill")
async def list_backfills(user=Depends(require_pro)):
    return await asyncio.to_thread(db_get_user_backfills, user.id)


@app.post("/api/backfill")
async def create_backfill(req: BackfillRequest, user=Depends(require_pro)):
    if req.days_back not in [30, 60, 90]:
        raise HTTPException(400, "days_back must be 30, 60, or 90")
    # Resolve channel name using the same approach as add_channel
    cmd = [YTDLP, "--flat-playlist", "--playlist-end", "1", "-j", "--no-warnings"]
    if COOKIES_FROM_BROWSER:
        cmd += ["--cookies-from-browser", COOKIES_FROM_BROWSER]
    elif COOKIES_FILE.exists():
        cmd += ["--cookies", str(COOKIES_FILE)]
    cmd.append(req.channel_url)
    def _resolve():
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
            return r.stdout.strip()
        except Exception:
            return ""
    out = await asyncio.to_thread(_resolve)
    channel_name = req.channel_url
    for line in out.splitlines():
        line = line.strip()
        if line.startswith("{"):
            try:
                d = json.loads(line)
                channel_name = d.get("channel") or d.get("uploader") or req.channel_url
                break
            except Exception:
                pass
    bf = await asyncio.to_thread(db_create_backfill, {
        "user_id": user.id,
        "channel_url": req.channel_url,
        "channel_name": channel_name,
        "days_back": req.days_back,
        "videos_per_day": req.videos_per_day,
        "yt_upload_channel_id": req.yt_upload_channel_id,
        "processed_video_ids": [],
        "total_videos": 0,
        "status": "active",
    })
    return bf


@app.post("/api/backfill/{backfill_id}/run")
async def run_backfill_now(backfill_id: str, user=Depends(require_pro)):
    """Manually trigger processing for a backfill channel."""
    bf = await asyncio.to_thread(db_get_backfill, backfill_id)
    if not bf or bf.get("user_id") != user.id:
        raise HTTPException(404, "Not found")
    if bf.get("status") != "active":
        raise HTTPException(400, "Backfill is not active")
    asyncio.create_task(_process_backfill(bf))
    return {"ok": True}


@app.delete("/api/backfill/{backfill_id}")
async def delete_backfill(backfill_id: str, user=Depends(require_pro)):
    bf = await asyncio.to_thread(db_get_backfill, backfill_id)
    if not bf or bf.get("user_id") != user.id:
        raise HTTPException(404, "Not found")
    await asyncio.to_thread(db_delete_backfill, backfill_id)
    return {"ok": True}


@app.get("/api/youtube/status")
async def youtube_status(user=Depends(require_pro)):
    tokens = db_get_user_youtube_tokens(user.id)
    if not tokens:
        return {"connected": False, "channels": []}
    channels = [
        {"yt_channel_id": t.get("yt_channel_id", ""), "yt_channel_name": t.get("yt_channel_name") or "YouTube"}
        for t in tokens
    ]
    return {"connected": True, "channels": channels}


@app.delete("/api/youtube/disconnect")
async def youtube_disconnect(yt_channel_id: Optional[str] = None, user=Depends(require_pro)):
    db_delete_youtube_token(user.id, yt_channel_id or None)
    return {"ok": True}


@app.get("/api/youtube/auth")
async def youtube_auth(user=Depends(require_pro)):
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
            scopes=["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"],
        )
        flow.redirect_uri = YOUTUBE_REDIRECT_URI
        auth_url, state = flow.authorization_url(access_type="offline", include_granted_scopes="true", prompt="select_account consent")
        _oauth_state_set(state, {"user_id": user.id, "code_verifier": getattr(flow, "code_verifier", None)})
        return {"auth_url": auth_url}
    except Exception as e:
        print(f"[youtube_auth] OAuth setup failed: {e}", flush=True)
        raise HTTPException(500, "OAuth setup failed. Please try again.")


def _yt_postmsg(msg_type: str, error_text: str = "") -> HTMLResponse:
    """Return a safe postMessage response using json.dumps to escape all values."""
    safe_origin = json.dumps(_APP_URL)
    safe_type   = json.dumps(msg_type)
    safe_error  = json.dumps(error_text)
    return HTMLResponse(
        f"<script>window.opener?.postMessage({{type:{safe_type},error:{safe_error}}},{safe_origin});window.close();</script>"
    )

@app.get("/api/youtube/callback")
async def youtube_callback(code: str = None, state: str = None, error: str = None):
    if error:
        return _yt_postmsg("youtube_auth_error", "OAuth authorization was denied.")
    state_data = _oauth_state_get(state) if state else None
    if not code or not state_data:
        return _yt_postmsg("youtube_auth_error", "Invalid or expired OAuth state.")
    try:
        from google_auth_oauthlib.flow import Flow
        user_id = state_data.get("user_id", "")
        code_verifier = state_data.get("code_verifier")
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
            scopes=["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"],
            state=state,
        )
        flow.redirect_uri = YOUTUBE_REDIRECT_URI
        flow.fetch_token(code=code, code_verifier=code_verifier)
        creds = flow.credentials
        # Identify which YouTube channel was just authorized
        yt_channel_id = ""
        yt_channel_name = ""
        try:
            from googleapiclient.discovery import build as yt_build
            youtube = yt_build("youtube", "v3", credentials=creds)
            ch_resp = youtube.channels().list(part="snippet", mine=True).execute()
            items = ch_resp.get("items", [])
            if items:
                yt_channel_id = items[0]["id"]
                yt_channel_name = items[0]["snippet"]["title"]
        except Exception as ch_err:
            print(f"[youtube_callback] channel lookup failed: {ch_err}", flush=True)
        db_upsert_youtube_token(user_id, creds.token, creds.refresh_token, yt_channel_id, yt_channel_name)
        _oauth_states.pop(state, None)  # clean up used state
        return _yt_postmsg("youtube_auth_success")
    except Exception as e:
        print(f"[youtube_callback] error: {e}", flush=True)
        return _yt_postmsg("youtube_auth_error", "Failed to complete YouTube authorization.")


@app.post("/api/youtube/upload/{job_id}/{clip_index}")
async def start_youtube_upload(
    job_id: str, clip_index: int, req: YouTubeUploadRequest,
    background_tasks: BackgroundTasks, user=Depends(require_pro),
):
    job = db_get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    if job.get("user_id") != user.id:
        raise HTTPException(403, "Forbidden")
    if clip_index >= len(job.get("clips", [])):
        raise HTTPException(404, "Clip not found")
    db_update_clip_yt_upload(job_id, clip_index, {"status": "queued", "progress": 0})
    background_tasks.add_task(do_youtube_upload, job_id, clip_index, req.model_dump(), user.id)
    return {"status": "queued"}


@app.get("/api/youtube/upload_status/{job_id}/{clip_index}")
async def get_youtube_upload_status(job_id: str, clip_index: int, user=Depends(require_pro)):
    job = db_get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    if job.get("user_id") != user.id:
        raise HTTPException(403, "Forbidden")
    clips = job.get("clips", [])
    if clip_index >= len(clips):
        raise HTTPException(404, "Clip not found")
    return clips[clip_index].get("yt_upload", {"status": "none"})


@app.post("/api/jobs/{job_id}/clips/{clip_index}/refresh_analytics")
async def refresh_clip_analytics(job_id: str, clip_index: int, user=Depends(require_auth)):
    if not YOUTUBE_API_KEY:
        raise HTTPException(503, "YOUTUBE_API_KEY not configured on server")
    job = db_get_job(job_id)
    if not job or job.get("user_id") != user.id:
        raise HTTPException(404, "Job not found")
    clips = job.get("clips", [])
    if clip_index >= len(clips):
        raise HTTPException(404, "Clip not found")
    video_id = clips[clip_index].get("yt_upload", {}).get("video_id")
    if not video_id:
        raise HTTPException(400, "Clip has no YouTube video ID")
    stats = await fetch_youtube_stats(video_id)
    if not stats:
        raise HTTPException(502, "Failed to fetch stats from YouTube — is the video public?")
    db_update_clip_analytics(job_id, clip_index, stats)
    return stats


@app.get("/api/channels")
async def list_channels(user=Depends(require_pro)):
    return [_c(ch) for ch in await asyncio.to_thread(db_get_user_channels, user.id)]


@app.post("/api/channels")
async def add_channel(req: ChannelRequest, user=Depends(require_pro)):
    cmd = [YTDLP, "--flat-playlist", "--playlist-end", "1", "-j", "--no-warnings"]
    if COOKIES_FROM_BROWSER:
        cmd += ["--cookies-from-browser", COOKIES_FROM_BROWSER]
    elif COOKIES_FILE.exists():
        cmd += ["--cookies", str(COOKIES_FILE)]
    cmd.append(req.url)
    def _resolve():
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
            return r.returncode, r.stdout.strip()
        except:
            return -1, ""
    code, out = await asyncio.to_thread(_resolve)
    channel_name = req.url
    last_video_id = None
    if code == 0 and out:
        for line in out.splitlines():
            line = line.strip()
            if line.startswith("{"):
                try:
                    data = json.loads(line)
                    channel_name = data.get("channel") or data.get("uploader") or req.url
                    last_video_id = data.get("id")
                    break
                except:
                    pass
    existing = db_get_user_channels(user.id)
    if any(c.get("url") == req.url for c in existing):
        raise HTTPException(400, "Channel already in watchlist")
    ch_data = db_create_channel({
        "user_id": user.id,
        "url": req.url,
        "name": channel_name,
        "last_video_id": last_video_id,
        "last_video_title": None,
        "last_checked": datetime.now(timezone.utc).isoformat(),
        "auto_upload": req.auto_upload,
        "max_clips": req.max_clips,
        "min_duration": req.min_duration,
        "max_duration": req.max_duration,
        "status": "watching",
        "caption_style": req.caption_style,
        "caption_font_size": req.caption_font_size,
        "caption_highlight_color": req.caption_highlight_color,
        "caption_language": req.caption_language,
    })
    return _c(ch_data)


@app.delete("/api/channels/{channel_id}")
async def remove_channel(channel_id: str, user=Depends(require_pro)):
    if not db_channel_owned_by(channel_id, user.id):
        raise HTTPException(404, "Channel not found")
    db_delete_channel(channel_id)
    return {"ok": True}


@app.patch("/api/channels/{channel_id}")
async def update_channel(channel_id: str, req: ChannelPatchRequest, user=Depends(require_pro)):
    if not db_channel_owned_by(channel_id, user.id):
        raise HTTPException(404, "Channel not found")
    updates = req.model_dump(exclude_unset=True)
    if updates:
        db_update_channel(channel_id, updates)
    return _c(db_get_channel(channel_id))


@app.post("/api/channels/{channel_id}/check")
async def check_channel_now(channel_id: str, user=Depends(require_pro)):
    if not db_channel_owned_by(channel_id, user.id):
        raise HTTPException(404, "Channel not found")
    ch = db_get_channel(channel_id)
    video = await fetch_latest_video(ch["url"])
    db_update_channel(channel_id, {"last_checked": datetime.now(timezone.utc).isoformat()})
    if not video:
        db_update_channel(channel_id, {"status": "error"})
        return {"triggered": False, "reason": "Could not fetch channel"}
    video_id = video.get("id")
    db_update_channel(channel_id, {"status": "watching"})
    if video_id and video_id != ch.get("last_video_id"):
        db_update_channel(channel_id, {
            "last_video_id": video_id,
            "last_video_title": video.get("title", ""),
        })
        video_url = f"https://www.youtube.com/watch?v={video_id}"
        job = db_create_job({
            "user_id": user.id,
            "status": "queued", "progress": 0,
            "message": f"Manual check: {ch.get('name','')}",
            "clips": [], "error": None, "url": video_url,
            "source": "watchlist", "channel_id": channel_id,
        })
        job_id = job["id"]
        clip_req = ClipRequest(
            url=video_url,
            max_clips=ch.get("max_clips", 3),
            min_duration=ch.get("min_duration", 30),
            max_duration=ch.get("max_duration", 90),
            reframe=True,
            caption_style=ch.get("caption_style", "bold_bottom"),
            caption_font_size=ch.get("caption_font_size"),
            caption_highlight_color=ch.get("caption_highlight_color"),
            caption_language=ch.get("caption_language", "source"),
        )
        asyncio.create_task(run_pipeline(job_id, clip_req, user_id=user.id, auto_upload=ch.get("auto_upload", False)))
        return {"triggered": True, "job_id": job_id, "video_title": video.get("title")}
    return {"triggered": False, "reason": "No new video found"}


# Serve frontend (must be last)
FRONTEND_BUILD = BASE_DIR / "frontend" / "dist"
if FRONTEND_BUILD.exists():
    # Serve Vite's bundled JS/CSS/images under /assets
    _assets_dir = FRONTEND_BUILD / "assets"
    if _assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(_assets_dir)), name="assets")

@app.get("/{full_path:path}")
async def serve_spa(full_path: str):
    """Catch-all that serves index.html so React Router handles all client-side routes."""
    if FRONTEND_BUILD.exists():
        # Sanitise with basename on each path segment to prevent traversal
        safe_parts = [os.path.basename(p) for p in Path(full_path).parts if p not in ("", ".", "..")]
        candidate = (FRONTEND_BUILD / Path(*safe_parts) if safe_parts else FRONTEND_BUILD).resolve()
        if candidate.is_file() and candidate.is_relative_to(FRONTEND_BUILD.resolve()):
            return FileResponse(str(candidate))
        index = FRONTEND_BUILD / "index.html"
        if index.exists():
            return FileResponse(str(index))
    raise HTTPException(404, "Frontend not built")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

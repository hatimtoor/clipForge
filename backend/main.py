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
    from reframe import _get_yolo, _speaking_person_cx, _audio_rms_per_frame
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

# Optional OpenRouter primary model for virality analysis (falls back to Groq llama).
# Set OPENROUTER_API_KEY + OPENROUTER_MODEL in .env to enable; leave unset to stay on Groq.
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
OPENROUTER_MODEL   = os.getenv("OPENROUTER_MODEL", "openrouter/owl-alpha")
OPENROUTER_ENABLED = bool(OPENROUTER_API_KEY)

# Groq chat model for virality analysis + caption translation. llama-3.3-70b was
# deprecated (decommissioned 2026-08-16); default to its recommended replacement,
# GPT-OSS-120B. Override with GROQ_ANALYSIS_MODEL in .env (no code change needed).
GROQ_ANALYSIS_MODEL = os.getenv("GROQ_ANALYSIS_MODEL", "openai/gpt-oss-120b")

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

TIKTOK_CLIENT_KEY     = os.getenv("TIKTOK_CLIENT_KEY", "")
TIKTOK_CLIENT_SECRET  = os.getenv("TIKTOK_CLIENT_SECRET", "")
TIKTOK_REDIRECT_URI   = os.getenv("TIKTOK_REDIRECT_URI", "https://clipforging.com/api/tiktok/callback")
# SELF_ONLY (private) is forced for unaudited apps. After audit, set to
# PUBLIC_TO_EVERYONE in .env to publish publicly.
TIKTOK_PRIVACY_LEVEL  = os.getenv("TIKTOK_PRIVACY_LEVEL", "SELF_ONLY")
YOUTUBE_API_KEY       = os.getenv("YOUTUBE_API_KEY", "")

from groq import Groq
from supabase import create_client as _sb_create_client

from fastapi import FastAPI, BackgroundTasks, HTTPException, Depends, Header, Request
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, HTMLResponse
from pydantic import BaseModel

from r2 import upload_clip, upload_thumbnail, presigned_url, stream_clip, download_clip_to_temp, delete_job_clips, R2_ENABLED
import billing
from db import (
    db_create_job, db_get_job, db_update_job, db_delete_job, db_get_user_jobs,
    db_get_active_jobs, db_update_clip_yt_upload, db_update_clip_analytics,
    db_get_done_jobs_with_uploads, db_get_expirable_jobs,
    db_create_channel, db_get_channel, db_get_user_channels,
    db_get_all_channels, db_update_channel, db_delete_channel, db_channel_owned_by,
    db_get_youtube_token, db_get_user_youtube_tokens, db_upsert_youtube_token, db_delete_youtube_token,
    db_get_tiktok_token, db_get_user_tiktok_tokens, db_upsert_tiktok_token, db_delete_tiktok_token,
    db_update_clip_tt_upload,
    db_get_profile, db_check_and_reset_quota, db_increment_clips_used, db_claim_clips_atomic,
    db_get_user_email, db_update_profile, db_redeem_promo, parse_iso,
    FREE_MONTHLY_JOB_LIMIT, FREE_MAX_CLIPS_PER_JOB, PRO_MAX_CLIPS_PER_JOB,
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

_APP_URL = os.getenv("APP_URL", "https://clipforging.com").rstrip("/")
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
OUTPUT_DIR    = BASE_DIR / "output"
TEMP_DIR      = BASE_DIR / "temp"
MUSIC_CACHE_DIR = BASE_DIR / "music_cache"
OUTPUT_DIR.mkdir(exist_ok=True)
TEMP_DIR.mkdir(exist_ok=True)
MUSIC_CACHE_DIR.mkdir(exist_ok=True)
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

# Watchlist retry state: advance a channel's last_video_id only after its clip job
# SUCCEEDS, so a transient failure (e.g. a download outage) doesn't silently drop
# the upload. A new upload is retried up to WATCHLIST_MAX_ATTEMPTS across polls,
# then we give up (mark it seen) so a permanently-broken video can't loop forever.
WATCHLIST_MAX_ATTEMPTS = 3
_watchlist_inflight: set = set()   # (channel_id, video_id) currently processing — no duplicates
_watchlist_attempts: dict = {}     # (channel_id, video_id) -> failed-attempt count
# Limit concurrent YouTube downloads so the digest's parallel videos don't get
# throttled into failed-stream merge errors. Other pipeline phases stay parallel.
_download_sem = asyncio.Semaphore(2)

# Hard cap on a single download so a throttled/hung yt-dlp can't hold a download
# slot until the 20-minute watchdog kills the whole job — fail fast and free the
# slot for everyone else. Tune via DOWNLOAD_TIMEOUT (seconds).
_DOWNLOAD_TIMEOUT = int(os.getenv("DOWNLOAD_TIMEOUT", "900") or "900")

# Cap concurrent CPU-heavy renders (FFmpeg + YOLO) so a burst of jobs can't
# saturate the box and slow everything into the watchdog timeout. Extra jobs queue
# for a slot (with a heartbeat). Tune via MAX_CONCURRENT_RENDERS (default 2 on a
# 4-core box, leaving headroom for transcription threads and the web server).
_render_sem = asyncio.Semaphore(int(os.getenv("MAX_CONCURRENT_RENDERS", "2") or "2"))

# Validate every user-supplied URL before it reaches yt-dlp's argv. This blocks
# both SSRF (yt-dlp fetching arbitrary internal targets) and argument injection
# (a value like "--exec=..." being parsed by yt-dlp as an option instead of a URL).
_YOUTUBE_URL_RE = re.compile(
    r'^https?://(www\.)?(youtube\.com|youtu\.be|m\.youtube\.com)/'
)

# ── request / response models ─────────────────────────────────────────────────
class ClipRequest(BaseModel):
    url: str
    max_clips: int = 5
    min_duration: int = 30
    max_duration: int = 90
    reframe: bool = False
    clip_style: str = "reframe"  # "reframe" | "blur_bg"
    style_prompt: Optional[str] = None
    caption_style: str = "bold_bottom"
    caption_font_size: Optional[int] = None
    caption_highlight_color: Optional[str] = None
    caption_position: Optional[str] = None  # default | bottom | middle | top
    caption_keywords: bool = True           # AI keyword colour layer in captions
    caption_language: str = "source"
    bg_music_url: Optional[str] = None
    bg_music_volume: float = 0.15
    trim_silence: bool = False

class PromoRedeemRequest(BaseModel):
    code: str

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

class TikTokUploadRequest(BaseModel):
    tt_open_id: Optional[str] = None  # which connected TikTok account to upload to
    title: Optional[str] = None
    privacy_level: Optional[str] = None
    disable_comment: bool = False
    disable_duet: bool = False
    disable_stitch: bool = False

class ChannelRequest(BaseModel):
    url: str
    auto_upload: bool = False
    max_clips: int = 3
    min_duration: int = 30
    max_duration: int = 90
    clip_style: str = "reframe"  # "reframe" | "blur_bg"
    caption_style: str = "bold_bottom"
    caption_font_size: Optional[int] = None
    caption_highlight_color: Optional[str] = None
    caption_language: str = "source"
    yt_channel_id: Optional[str] = None
    tt_open_id: Optional[str] = None
    bg_music_url: Optional[str] = None
    bg_music_volume: float = 0.15
    trim_silence: bool = False

class ChannelPatchRequest(BaseModel):
    auto_upload: Optional[bool] = None
    max_clips: Optional[int] = None
    min_duration: Optional[int] = None
    max_duration: Optional[int] = None
    clip_style: Optional[str] = None
    caption_style: Optional[str] = None
    caption_font_size: Optional[int] = None
    caption_highlight_color: Optional[str] = None
    caption_language: Optional[str] = None
    yt_channel_id: Optional[str] = None
    tt_open_id: Optional[str] = None
    bg_music_url: Optional[str] = None
    bg_music_volume: Optional[float] = None
    trim_silence: Optional[bool] = None


class BackfillRequest(BaseModel):
    channel_url: str
    days_back: int = 30
    videos_per_day: int = 2
    yt_upload_channel_id: str = ""
    max_clips: int = 3
    min_duration: int = 30
    max_duration: int = 90
    clip_style: str = "reframe"  # "reframe" | "blur_bg"
    caption_style: str = "bold_bottom"
    caption_font_size: Optional[int] = None
    caption_highlight_color: Optional[str] = None
    caption_language: str = "source"
    bg_music_url: Optional[str] = None
    bg_music_volume: float = 0.15
    trim_silence: bool = False
    tt_open_id: Optional[str] = None


class BackfillPatchRequest(BaseModel):
    days_back: Optional[int] = None
    videos_per_day: Optional[int] = None
    yt_upload_channel_id: Optional[str] = None
    auto_upload: Optional[bool] = None
    max_clips: Optional[int] = None
    min_duration: Optional[int] = None
    max_duration: Optional[int] = None
    clip_style: Optional[str] = None
    caption_style: Optional[str] = None
    caption_font_size: Optional[int] = None
    caption_highlight_color: Optional[str] = None
    caption_language: Optional[str] = None
    bg_music_url: Optional[str] = None
    bg_music_volume: Optional[float] = None
    trim_silence: Optional[bool] = None
    tt_open_id: Optional[str] = None


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
        thumb = clip.get("thumbnail")
        extra = {}
        if filename and job_id:
            url = presigned_url(job_id, filename)
            if url:
                extra["presigned_url"] = url
        if thumb and job_id:
            turl = presigned_url(job_id, thumb)
            if turl:
                extra["thumbnail_url"] = turl
        enriched.append({**clip, **extra} if extra else clip)
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
        # Prefer direct-https (DASH) formats, never HLS: YouTube 403s HLS segments
        # from datacenter IPs even with a valid PO token. Try H.264+m4a first (clean
        # mp4, no AV1 decode quirks), then any https video+audio, then best https.
        "-f", "bv*[height<=1080][vcodec^=avc1][protocol^=http]+ba[ext=m4a][protocol^=http]/bv*[height<=1080][protocol^=http]+ba[ext=m4a][protocol^=http]/bv*[height<=1080][protocol^=http]+ba[protocol^=http]/b[protocol^=http]/b",
        "--merge-output-format", "mp4",
        "-o", str(video_path),
        "--no-playlist",
        "--newline",  # one progress line per update
        # Resilience against transient/throttled stream downloads (the cause of
        # "video.fNNN.mp4 not found" merge failures when YouTube throttles).
        "--retries", "10",
        "--fragment-retries", "10",
        "--file-access-retries", "5",
        "--retry-sleep", "3",
        # Speed + anti-throttle: pull DASH fragments in parallel, abandon a dead
        # socket in 30s instead of hanging, and re-extract fresh stream URLs if the
        # rate drops below 100K (YouTube throttles datacenter IPs, which otherwise
        # stalls the download with no progress until the 20-min watchdog kills it).
        "--concurrent-fragments", "4",
        "--socket-timeout", "30",
        "--throttled-rate", "100K",
    ]
    if COOKIES_FROM_BROWSER:
        cmd += ["--cookies-from-browser", COOKIES_FROM_BROWSER]
    elif COOKIES_FILE.exists():
        cmd += ["--cookies", str(COOKIES_FILE)]
    # Force tv/mweb player clients (which serve direct https/DASH URLs); the
    # default clients fall back to HLS, whose segments 403 from datacenter IPs.
    cmd += ["--extractor-args", "youtube:player_client=tv,mweb,web"]
    if POTTOKEN_URL:
        cmd += ["--extractor-args", f"youtubepot-bgutilhttp:base_url={POTTOKEN_URL}"]
    # Tell yt-dlp exactly where ffmpeg is so it can merge streams reliably
    cmd += ["--ffmpeg-location", str(Path(FFMPEG).parent)]
    cmd += ["--", url]  # "--" stops yt-dlp parsing the URL as an option flag

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
        # Backstop: kill a hung/throttled yt-dlp so it can't stall a slot until the
        # watchdog. A stalled download emits no stdout, so the read loop below would
        # block forever — an external timer is the only thing that can interrupt it.
        _killer = threading.Timer(_DOWNLOAD_TIMEOUT, p.kill)
        _killer.daemon = True
        _killer.start()
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
        _killer.cancel()
        _progress_q.put(None)  # sentinel — signals drainer to stop
        return p.returncode, "".join(tail)

    async with _download_sem:
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
                    # Progress writes are cosmetic — a transient DB hiccup here
                    # must never abort an in-flight download.
                    try:
                        await update_job(job_id, **item)
                    except Exception as e:
                        log(job_id, f"progress update skipped: {e}")
                except _queue.Empty:
                    break
            # If the future raised an exception the sentinel may never arrive.
            if not done and download_future.done():
                done = True

        returncode, tail = await download_future
    if returncode != 0:
        if returncode < 0:  # killed by the timeout backstop (negative = signal)
            log(job_id, f"yt-dlp killed — download exceeded {_DOWNLOAD_TIMEOUT}s")
            raise RuntimeError(
                f"Download timed out after {_DOWNLOAD_TIMEOUT // 60} min — YouTube is "
                f"likely throttling this server's IP. Last output: {tail[-300:]}")
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
            if no_speech > 0.65 or avg_logprob < -1.3:
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
                if no_speech > 0.65 or avg_logprob < -1.3:
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


async def _call_openrouter(prompt: str, temp: float = 0.3, max_tokens: int = 2000) -> Optional[str]:
    """Call the OpenRouter primary analysis model. Returns content, or None on any failure."""
    if not OPENROUTER_ENABLED:
        return None
    import httpx
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": _APP_URL,
        "X-Title": "ClipForge",
    }
    payload = {
        "model": OPENROUTER_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": temp,
        "max_tokens": max_tokens,
    }
    async with httpx.AsyncClient(timeout=90) as client:
        resp = await client.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers=headers, json=payload,
        )
        resp.raise_for_status()
        data = resp.json()
        return (data["choices"][0]["message"]["content"] or "").strip()


# ── virality analysis (OpenRouter primary, Groq Llama fallback) ───────────────
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

    _analysis_provider = f"OpenRouter ({OPENROUTER_MODEL})" if OPENROUTER_ENABLED else f"Groq ({GROQ_ANALYSIS_MODEL})"
    log(job_id, f"Transcript split into {len(chunks)} chunk(s) for {_analysis_provider} analysis")
    for chunk_idx, transcript_text in enumerate(chunks):
        # analyzing: 66-77 spread across chunks
        analysis_progress = 66 + int((chunk_idx / len(chunks)) * 11)
        log(job_id, f"Sending chunk {chunk_idx+1}/{len(chunks)} to {_analysis_provider} ({len(transcript_text)} chars)...")
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
- "keywords": array of 3-6 single words copied VERBATIM from the transcript inside
  this clip's time range — the most emphatic, emotional, or high-stakes words
  (these get color-highlighted in the burned-in captions)

Return valid JSON array only, no markdown, no explanation."""

        async def _call_groq(temp=0.3):
            def _sync(t=temp):
                client = Groq(api_key=get_groq_key())
                r = client.chat.completions.create(
                    model=GROQ_ANALYSIS_MODEL,
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

        async def _call_analysis(temp=0.3):
            # OpenRouter primary, automatic fallback to Groq llama on any failure
            if OPENROUTER_ENABLED:
                try:
                    out = await _call_openrouter(prompt, temp=temp, max_tokens=2000)
                    if out:
                        return out
                    log(job_id, "  OpenRouter returned empty — falling back to Groq llama")
                except Exception as e:
                    log(job_id, f"  OpenRouter error ({e}) — falling back to Groq llama")
            return await _call_groq(temp)

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
            raw = await _call_analysis(temp=0.3)
            chunk_clips = _parse_raw(raw)
            if chunk_clips is None:
                log(job_id, f"  chunk {chunk_idx+1} bad JSON on attempt 1, retrying with temp=0.1...")
                raw = await _call_analysis(temp=0.1)
                chunk_clips = _parse_raw(raw)
            if chunk_clips is None:
                log(job_id, f"  chunk {chunk_idx+1} still bad JSON after retry — skipping. Raw: {raw[:300]}")
                continue
            log(job_id, f"  → chunk {chunk_idx+1} returned {len(chunk_clips)} clip candidates")
            all_clips.extend(chunk_clips)
        except Exception as e:
            log(job_id, f"  !!! Analysis API error on chunk {chunk_idx+1}: {e} — skipping chunk")
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
        # Censor profanity in the title, hook, reason, and tags — these propagate to
        # the UI, thumbnails, and the burned-in YouTube/TikTok upload descriptions.
        if c.get("title"):
            c["title"] = _censor_text(c["title"])
        if c.get("hook"):
            c["hook"] = _censor_text(c["hook"])
        if c.get("reason"):
            c["reason"] = _censor_text(c["reason"])
        if isinstance(c.get("tags"), list):
            c["tags"] = [_censor_text(t) if isinstance(t, str) else t for t in c["tags"]]
        # Caption keyword highlights: keep raw (they're matched against raw
        # transcript words at render; the rendered word itself still gets
        # censored). Cap at 6 single words.
        kws = c.get("keywords")
        if isinstance(kws, list):
            c["keywords"] = [str(k).strip() for k in kws if str(k).strip() and " " not in str(k).strip()][:6]
        else:
            c["keywords"] = []
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


# ── caption template registry ─────────────────────────────────────────────────
# Each template fully describes a caption look; style_lines() emits the ASS V4+
# (Default, Highlight) style strings. The three legacy keys (bold_bottom,
# center_pop, minimal) emit byte-identical lines to the old _CAPTION_STYLES
# tuples (asserted in tests) so saved channels/backfills need no migration.
# Colours are ASS &HAABBGGRR.
from dataclasses import dataclass as _dataclass, replace as _dc_replace


@_dataclass(frozen=True)
class CaptionTemplate:
    font: str = "ClipForgeCaps"
    font_size: int = 72
    base_color: str = "&H00FFFFFF"      # PrimaryColour — normal/spoken text
    active_color: str = "&H0000FF2B"    # SecondaryColour — the active-word highlight
    keyword_color: str = "&H0000D7FF"   # static AI-keyword layer (gold), independent of active
    outline_color: str = "&H00000000"
    back_color: str = "&H80000000"
    bold: bool = True
    spacing: int = 2
    outline: int = 3
    shadow: int = 2
    alignment: int = 2
    margin_l: int = 80
    margin_r: int = 80
    margin_v: int = 500
    words_per_line: int = 3
    uppercase: bool = True
    mode: str = "pop"                   # pop | karaoke | static | none
    active_lead_ms: int = 80            # highlight fires this early (Opus-style anticipation)

    def style_lines(self) -> tuple[str, str]:
        def _line(primary: str) -> str:
            return (
                f"{self.font},{self.font_size},{primary},{self.active_color},"
                f"{self.outline_color},{self.back_color},{-1 if self.bold else 0},0,0,0,"
                f"100,100,{self.spacing},0,1,{self.outline},{self.shadow},"
                f"{self.alignment},{self.margin_l},{self.margin_r},{self.margin_v},1"
            )
        return _line(self.base_color), _line(self.active_color)


CAPTION_TEMPLATES: dict[str, CaptionTemplate] = {
    # ── legacy three (byte-identical to the old raw strings) ──
    "bold_bottom": CaptionTemplate(),
    "center_pop": CaptionTemplate(
        font_size=88, active_color="&H0000FFFF", back_color="&HFF000000",
        outline=5, shadow=0, alignment=5, margin_v=0),
    "minimal": CaptionTemplate(
        font="Montserrat", font_size=56, active_color="&H00FFFFFF",
        back_color="&HFF000000", bold=False, outline=2, shadow=0, margin_v=400,
        mode="karaoke", active_lead_ms=0),
    # ── Opus-style presets ──
    # Classic karaoke: white text, yellow active word.
    "karaoke": CaptionTemplate(font_size=76, active_color="&H0000FFFF"),
    # Hormozi/Mozi: huge, heavy outline, green active word, yellow keywords.
    "hormozi": CaptionTemplate(
        font_size=84, active_color="&H0000FF2B", keyword_color="&H0000FFFF",
        outline=4, shadow=3, margin_v=480),
    # Beasty: playful display font, yellow active, red keywords.
    "beasty": CaptionTemplate(
        font="Bangers", font_size=92, active_color="&H0000FFFF",
        keyword_color="&H003131FF", outline=4, margin_v=520),
    # Bold statement: full phrase shown at once, no per-word reveal, mid-screen.
    "bold_statement": CaptionTemplate(
        font_size=64, alignment=5, margin_v=0, back_color="&HFF000000",
        words_per_line=6, mode="static"),
    # Simple: minimal's sweep with a yellow active word, sentence case.
    "simple": CaptionTemplate(
        font="Montserrat", font_size=56, active_color="&H0000FFFF",
        back_color="&HFF000000", bold=False, outline=2, shadow=0, margin_v=400,
        mode="karaoke", uppercase=False),
    # Pod P: podcast look — mid-screen, smaller, cyan active word.
    "pod_p": CaptionTemplate(
        font_size=62, active_color="&H00FFFF00", alignment=5, margin_v=0,
        back_color="&HFF000000", words_per_line=4),
    # No captions at all (header-only ASS keeps every render graph unchanged).
    "none": CaptionTemplate(mode="none"),
}

# Position presets → (alignment, MarginV). MarginV measures from the bottom for
# alignment 1-3 and from the top for 7-9; ignored for middle row (4-6).
_CAPTION_POSITIONS = {
    "bottom": (2, 500),
    "middle": (5, 0),
    "top": (8, 140),
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
                model=GROQ_ANALYSIS_MODEL,
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


def _ass_escape(text: str) -> str:
    """Strip characters that would break out of an ASS dialogue field — override
    braces and the backslash escape lead-in — so transcript text can't inject ASS
    tags or corrupt the subtitle file."""
    return (
        text.replace("\\", "")
            .replace("{", "")
            .replace("}", "")
            .replace("\r", " ")
            .replace("\n", " ")
    )


_HEX_COLOR_RE = re.compile(r'^#?[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$')


def _hex_to_ass(hex_color: str) -> Optional[str]:
    """Convert #RGB or #RRGGBB to ASS &H00BBGGRR format (fully opaque).

    Returns None for anything that isn't a valid hex colour so a malformed
    user-supplied value is ignored rather than crashing the render.
    """
    if not hex_color or not _HEX_COLOR_RE.match(hex_color.strip()):
        return None
    h = hex_color.strip().lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return f"&H00{b:02X}{g:02X}{r:02X}"


# ── word-by-word "pop" captions ──────────────────────────────────────────────
# Active word grows + recolours while spoken; neighbours stay fixed (each word is
# positioned individually with \pos, so scaling one doesn't reflow the others).
from functools import lru_cache as _lru_cache

FONTS_DIR     = Path(__file__).parent / "assets" / "fonts"
_CAPTION_FONT = FONTS_DIR / "ClipForgeCaps-Bold.ttf"
# ASS family name -> bundled file. Families listed here get embedded into the
# ASS [Fonts] section; anything else (e.g. Montserrat) relies on server fonts,
# matching the legacy minimal-style behavior.
_FONT_FILES = {
    "ClipForgeCaps": "ClipForgeCaps-Bold.ttf",
    "Bangers": "Bangers-Regular.ttf",
}
# fontsdir for the libass filter — escape ':' (Windows drive) for the filtergraph.
_FONTSDIR_ESC = str(FONTS_DIR).replace("\\", "/").replace(":", "\\:")


def _ssa_uuencode(data: bytes) -> str:
    """Encode bytes in the SSA/ASS embedded-font format (UU-style, 6-bit + 33,
    wrapped at 80 chars). libass reads this from the [Fonts] section."""
    out = []
    for i in range(0, len(data), 3):
        chunk = data[i:i + 3]
        n = len(chunk)
        val = (chunk[0] << 16) | ((chunk[1] << 8) if n > 1 else 0) | (chunk[2] if n > 2 else 0)
        nchars = n + 1  # 3 bytes -> 4 chars, 2 -> 3, 1 -> 2
        for j in range(nchars):
            out.append(chr(((val >> (6 * (3 - j))) & 0x3F) + 33))
    s = "".join(out)
    return "\n".join(s[i:i + 80] for i in range(0, len(s), 80))


@_lru_cache(maxsize=8)
def _embedded_caption_font(font: str = "ClipForgeCaps") -> str:
    """The [Fonts] section embedding a bundled caption font, so libass renders
    with the exact font we measure/design against (no dependency on server
    fontconfig, which the systemd service doesn't share — the real cause of the
    old caption-spacing bug). Returns "" for non-bundled families (Montserrat)."""
    filename = _FONT_FILES.get(font)
    if not filename:
        return ""
    try:
        data = (FONTS_DIR / filename).read_bytes()
    except Exception:
        return ""
    stem = filename.rsplit(".", 1)[0]
    return f"\n[Fonts]\nfontname: {stem}_0.ttf\n" + _ssa_uuencode(data) + "\n"


@_lru_cache(maxsize=32)
def _caption_pil_font(size: int, font: str = "ClipForgeCaps"):
    from PIL import ImageFont
    filename = _FONT_FILES.get(font, "ClipForgeCaps-Bold.ttf")
    return ImageFont.truetype(str(FONTS_DIR / filename), size)


def _measure_caption(text: str, size: int, font: str = "ClipForgeCaps") -> float:
    """Pixel width of text at the caption font size (for overlay placement)."""
    try:
        return float(_caption_pil_font(size, font).getlength(text))
    except Exception:
        return len(text) * size * 0.6  # rough fallback if the font can't be loaded


def _inline_color(style_color: str) -> str:
    """Convert a V4+ style colour (&HAABBGGRR) to an inline \\c override (&HBBGGRR&)."""
    h = style_color.replace("&H", "").replace("&", "")
    if len(h) >= 6:
        h = h[-6:]  # drop the alpha byte → BBGGRR
    return f"&H{h}&"


# ── profanity censoring (captions + titles) ───────────────────────────────────
# Whole-word match only (avoids the "Scunthorpe problem" — 'class', 'pass' etc.
# are never touched). Add variants explicitly rather than matching substrings.
_PROFANITY = {
    "fuck", "fucks", "fucked", "fucking", "fuckin", "fucker", "fuckers", "fuckface",
    "motherfucker", "motherfuckers", "motherfucking", "clusterfuck", "fuckboy",
    "shit", "shits", "shitty", "shitting", "shithead", "bullshit", "dipshit",
    "bitch", "bitches", "bitching", "bitchy",
    "ass", "asses", "asshole", "assholes", "asshat", "dumbass", "jackass",
    "dick", "dicks", "dickhead", "cock", "cocks", "cocksucker",
    "pussy", "pussies", "cunt", "cunts", "twat",
    "semen", "cum", "cums", "cumming", "jizz", "boner", "horny", "orgasm",
    "penis", "vagina", "dildo", "tits", "titties", "tittie",
    "whore", "whores", "slut", "sluts", "skank",
    "bastard", "bastards", "prick", "wanker", "bollocks",
    "nigger", "niggers", "nigga", "niggas", "faggot", "faggots", "fag", "fags",
    "retard", "retarded",
}


def _censor_word(w: str) -> str:
    """Mask the inner letters of a word: keep first + last, star the middle."""
    if len(w) <= 1:
        return w
    if len(w) == 2:
        return w[0] + "*"
    return w[0] + "*" * (len(w) - 2) + w[-1]


# Roots safe to prefix-match (any word starting with these is profane), so
# compounds like 'shitshow', 'fuckwit', 'bitchin' are caught without listing each.
# Only roots that virtually never start innocent words (NOT 'ass', 'cock', 'dick',
# 'cum' — those hit 'assassin', 'cockpit', 'dickens', 'cucumber').
_PROFANITY_PREFIXES = ("fuck", "motherfuck", "shit", "bitch", "cunt", "nigg", "faggot")


def _is_profane(token: str) -> bool:
    t = token.lower().strip("'")
    return t in _PROFANITY or any(t.startswith(p) for p in _PROFANITY_PREFIXES)


def _censor_text(text: str) -> str:
    """Censor profane whole words in text, preserving punctuation/case/length."""
    if not text:
        return text
    return re.sub(
        r"[A-Za-z']+",
        lambda m: _censor_word(m.group(0)) if _is_profane(m.group(0)) else m.group(0),
        text,
    )


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
    margin_v_override: Optional[int] = None,
    alignment_override: Optional[int] = None,
    keywords: Optional[list] = None,
):
    tpl = CAPTION_TEMPLATES.get(caption_style) or CAPTION_TEMPLATES["bold_bottom"]

    # Apply per-job overrides on top of the chosen template
    if font_size is not None:
        tpl = _dc_replace(tpl, font_size=font_size)
    if highlight_color is not None:
        ass_color = _hex_to_ass(highlight_color)
        if ass_color is not None:  # ignore malformed colours, keep the preset
            tpl = _dc_replace(tpl, active_color=ass_color)
    if alignment_override is not None:
        # Must be forced to a bottom value for the MarginV override to take
        # effect — ASS ignores MarginV for middle-row alignments (4/5/6).
        tpl = _dc_replace(tpl, alignment=alignment_override)
    if margin_v_override is not None:
        tpl = _dc_replace(tpl, margin_v=margin_v_override)

    default_line, highlight_line = tpl.style_lines()

    # Embed the bundled font so libass renders with the exact face we designed
    # against (server fontconfig is unreliable under systemd).
    _fonts_section = _embedded_caption_font(tpl.font) if tpl.mode != "none" else ""

    ass_header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {video_width}
PlayResY: {video_height}
ScaledBorderAndShadow: yes
{_fonts_section}
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

    # "none" template: header-only ASS — every render graph keeps its ass=
    # filter unchanged, libass just has nothing to draw.
    if tpl.mode == "none":
        output_path.write_text(ass_header, encoding="utf-8")
        return

    _case = (lambda s: s.upper()) if tpl.uppercase else (lambda s: s)

    def _token(w: dict) -> str:
        return _ass_escape(_case(_censor_text(w["word"]).strip()))

    # AI keyword layer: static accent colour on emphasis words, independent of
    # the transient active-word highlight (Opus's two-layer system). Matching is
    # against the raw transcript word, pre-censor/case.
    kw_set = {k.lower().strip(".,!?\"'") for k in (keywords or []) if k}

    def _is_kw(w: dict) -> bool:
        return bool(kw_set) and w["word"].strip().strip(".,!?\"'").lower() in kw_set

    # Group into lines of ~words_per_line; merge a lonely 1-word tail into the
    # line before it (so "... YOUR" + "WHEELS" reads as one "... YOUR WHEELS").
    groups = [words_in_clip[i:i + tpl.words_per_line]
              for i in range(0, len(words_in_clip), tpl.words_per_line)]
    if len(groups) >= 2 and len(groups[-1]) == 1:
        tail = groups.pop()
        groups[-1] += tail
    for group in groups:
        if not group:
            continue
        line_start = group[0]["start"]
        line_end   = group[-1]["end"]

        if tpl.mode == "pop":
            # Full-line redraw with a moving single-word highlight. libass lays
            # out and centres the WHOLE line itself — using the style's
            # alignment/MarginV — so word spacing is always natural and we never
            # position words by hand (this is what killed the old spacing bug).
            # One event per word window; only the active word is recoloured, and
            # the full line stays on screen throughout. The highlight fires
            # active_lead_ms early (Opus-style reading anticipation).
            base_i, hl_i = _inline_color(tpl.base_color), _inline_color(tpl.active_color)
            kw_i = _inline_color(tpl.keyword_color)
            tokens = [_token(w) for w in group]
            kw_flags = [_is_kw(w) for w in group]
            lead = tpl.active_lead_ms / 1000.0
            bounds = [line_start]
            for k in range(1, len(group)):
                bounds.append(max(bounds[-1], group[k]["start"] - lead))
            bounds.append(max(bounds[-1], line_end))
            for k in range(len(group)):
                k_start, k_end = bounds[k], bounds[k + 1]
                if k_end <= k_start:
                    continue
                # Every token carries its own colour: active wins, then the
                # static keyword layer, then base.
                parts = [
                    f"{{\\1c{hl_i if j == k else (kw_i if kw_flags[j] else base_i)}}}{tok}"
                    for j, tok in enumerate(tokens)
                ]
                events.append(
                    f"Dialogue: 0,{ts(k_start)},{ts(k_end)},Default,,0,0,0,,{' '.join(parts)}"
                )
        elif tpl.mode == "static":
            # Bold-statement look: the whole phrase appears at once, no reveal.
            base_i, kw_i = _inline_color(tpl.base_color), _inline_color(tpl.keyword_color)
            text = " ".join(
                f"{{\\1c{kw_i}}}{_token(w)}{{\\1c{base_i}}}" if _is_kw(w) else _token(w)
                for w in group
            )
            events.append(
                f"Dialogue: 0,{ts(line_start)},{ts(line_end)},Default,,0,0,0,,{text}"
            )
        else:
            # Classic karaoke colour sweep (minimal/simple styles). Keyword words
            # land on the keyword colour after the sweep passes them.
            base_i, kw_i = _inline_color(tpl.base_color), _inline_color(tpl.keyword_color)
            karaoke_text = ""
            for w in group:
                dur_cs = max(1, int((w["end"] - w["start"]) * 100))
                colour = kw_i if _is_kw(w) else base_i
                karaoke_text += f"{{\\k{dur_cs}\\1c{colour}}}{_token(w)} "
            events.append(
                f"Dialogue: 0,{ts(line_start)},{ts(line_end)},Default,,0,0,0,,{karaoke_text.strip()}"
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
    sample_every = max(1, int(fps / 2))  # two samples per second — catch speaker switches faster

    # Audio gating: only track the speaker during actual speech. During silent
    # pauses the camera holds where it is instead of chasing a fidgeting listener.
    import numpy as _np
    try:
        rms = _audio_rms_per_frame(clip_path, fps, FFMPEG)
    except Exception:
        rms = _np.array([])
    # Quietest ~35% of frames treated as pauses; rest = speech. No audio → track all.
    speech_threshold = float(_np.percentile(rms, 35)) if len(rms) else 0.0

    results: list = []
    prev_frame = None
    frame_idx  = 0
    frames_tried = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break
        if frame_idx % sample_every == 0:
            is_speech = (speech_threshold == 0.0) or (frame_idx < len(rms) and rms[frame_idx] >= speech_threshold)
            if is_speech:
                frames_tried += 1
                cx = _speaking_person_cx(frame, prev_frame, model)
                if cx is not None:
                    t = frame_idx / fps
                    crop_x = max(0, min(int(cx - crop_w / 2), src_w - crop_w))
                    results.append((round(t, 3), crop_x))
            prev_frame = frame  # update regardless so motion diff stays consistent
        frame_idx += 1

    cap.release()
    print(f"[reframe] {len(results)}/{frames_tried} speech-frame samples detected a person (audio-gated)", flush=True)
    return results


def smooth_crop_trajectory(
    detections: list,
    clip_duration: float,
    fallback_crop_x: int,
    crop_w: int,
    src_w: int,
    track_speed_px_per_s: float = 300.0,
    switch_speed_px_per_s: float = 1500.0,
    min_hold_s: float = 1.0,
) -> list:
    """
    Active-speaker crop trajectory.

    Centers the crop on whoever is currently speaking. Small movements (the same
    speaker shifting) are tracked gently and a micro dead-zone kills jitter. A
    large jump (a different speaker taking over) is treated as a SWITCH: it only
    fires if the current speaker has been held for at least min_hold_s, and then
    snaps quickly (switch_speed) so the camera doesn't linger on the empty space
    between people. This gives clean multi-cam-style cuts instead of either
    ping-ponging or freezing in the middle.
    """
    def _clamp(x):
        return max(0, min(int(x), src_w - crop_w))

    if not detections:
        return [(0.0, fallback_crop_x), (round(clip_duration, 3), fallback_crop_x)]

    # Outlier rejection: drop samples >200px from 3-sample rolling median
    xs = [x for _, x in detections]
    filtered = []
    for i, (t, x) in enumerate(detections):
        window = xs[max(0, i - 1):i + 2]
        median = sorted(window)[len(window) // 2]
        if abs(x - median) <= 200:
            filtered.append((t, x))

    if not filtered:
        return [(0.0, fallback_crop_x), (round(clip_duration, 3), fallback_crop_x)]

    micro_dead       = crop_w * 0.08   # ignore tiny wiggle (same speaker)
    switch_threshold = crop_w * 0.22   # bigger than this = a different speaker

    # Center the crop on the first detected speaker
    first_target = _clamp(filtered[0][1])  # detections already store crop_x-if-centered
    current_x = first_target
    last_switch_t = filtered[0][0]
    keyframes = [(0.0, current_x)] if filtered[0][0] >= 0.001 else []
    # tag each keyframe: (t, x, is_switch)
    kf = [(round(filtered[0][0], 3), current_x, True)]

    for t, centered_x in filtered[1:]:
        desired = _clamp(centered_x)
        delta = abs(desired - current_x)
        if delta <= micro_dead:
            kf.append((round(t, 3), current_x, False))          # hold — kills jitter
        elif delta <= switch_threshold:
            current_x = desired                                  # same speaker drifting — track
            kf.append((round(t, 3), current_x, False))
        else:
            # Different speaker — only switch if we've held the current one long enough
            if (t - last_switch_t) >= min_hold_s:
                current_x = desired
                last_switch_t = t
                kf.append((round(t, 3), current_x, True))        # mark as a fast switch
            else:
                kf.append((round(t, 3), current_x, False))       # too soon — stay

    # Prepend the t=0 bookend if needed
    if keyframes:
        kf = [(0.0, keyframes[0][1], False)] + kf
    if kf[-1][0] < clip_duration:
        kf.append((round(clip_duration, 3), current_x, False))

    # Rate-limit: gentle for tracking, fast snap for speaker switches
    smoothed = [(kf[0][0], kf[0][1])]
    for i in range(1, len(kf)):
        t_prev, x_prev = smoothed[-1]
        t_cur, x_cur, is_switch = kf[i]
        dt = max(t_cur - t_prev, 0.001)
        speed = switch_speed_px_per_s if is_switch else track_speed_px_per_s
        max_delta = int(speed * dt)
        x_cur = x_prev + max(-max_delta, min(max_delta, x_cur - x_prev))
        smoothed.append((t_cur, x_cur))

    return smoothed


_YUNET_PATH = Path(__file__).parent / "assets" / "models" / "face_detection_yunet.onnx"


def _detect_facecam_region(video_path: Path, src_w: int, src_h: int,
                           duration: float, n_samples: int = 48) -> Optional[dict]:
    """Find the streamer's webcam ONCE for the whole video by sampling frames
    spread across it, so every clip uses the same cam and splits consistently
    (per-clip detection was firing on some clips and not others).

    Returns {"box": (x,y,w,h), "fw": int, "fh": int, "fcx": float, "fcy": float}
    or None. Face-primary: the persistent small face across the video = the cam.
    """
    if not _REFRAME_AVAILABLE:
        return None
    try:
        import cv2 as _cv2
    except ImportError:
        return None
    import numpy as _np
    import statistics as _st
    from collections import defaultdict

    if not _YUNET_PATH.exists():
        return None
    try:
        face_det = _cv2.FaceDetectorYN_create(
            str(_YUNET_PATH), "", (320, 320),
            score_threshold=0.6, nms_threshold=0.3, top_k=50)
    except Exception as e:
        print(f"[facecam] YuNet unavailable: {e}", flush=True)
        return None

    cap = _cv2.VideoCapture(str(video_path))
    fps = cap.get(_cv2.CAP_PROP_FPS) or 30.0
    if duration <= 0:
        cnt = cap.get(_cv2.CAP_PROP_FRAME_COUNT) or 0
        duration = cnt / fps if fps else 0.0
    frame_area = src_w * src_h
    n = max(8, n_samples)
    face_hits, n_ok = [], 0
    for i in range(n):
        t = duration * (i + 0.5) / n if duration > 0 else 0.0
        cap.set(_cv2.CAP_PROP_POS_MSEC, t * 1000.0)
        ret, frame = cap.read()
        if not ret:
            continue
        n_ok += 1
        try:
            face_det.setInputSize((frame.shape[1], frame.shape[0]))
            _c, faces = face_det.detect(frame)
        except Exception:
            faces = None
        if faces is None:
            continue
        for f in faces:
            fw, fh = int(f[2]), int(f[3])
            if fw <= 0 or fh <= 0 or fw * fh >= frame_area * 0.08:
                continue  # small face only = a cam, not the main subject
            face_hits.append((int(f[0]) + fw / 2.0, int(f[1]) + fh / 2.0, fw, fh))
    cap.release()

    if n_ok == 0 or not face_hits:
        return None
    gx, gy = src_w * 0.08, src_h * 0.08
    clusters = defaultdict(list)
    for h in face_hits:
        clusters[(int(h[0] / gx), int(h[1] / gy))].append(h)
    best = max(clusters.values(), key=len)
    if len(best) < max(3, int(0.20 * n_ok)):
        return None
    fcx, fcy = _st.median([h[0] for h in best]), _st.median([h[1] for h in best])
    mfw, mfh = int(_st.median([h[2] for h in best])), int(_st.median([h[3] for h in best]))
    bw, bh = int(mfw * 2.4), int(mfh * 3.0)
    bx = int(max(0, min(fcx - bw / 2, src_w - bw)))
    by = int(max(0, min(fcy - bh * 0.40, src_h - bh)))
    return {"box": (bx, by, min(bw, src_w), min(bh, src_h)),
            "fw": mfw, "fh": mfh, "fcx": float(fcx), "fcy": float(fcy)}


def _detect_facecam_and_track(clip_path: Path, src_w: int, src_h: int,
                              known_box: Optional[tuple] = None) -> tuple:
    """For the 'facecam' gaming layout: find the streamer's corner webcam and
    track both the streamer's FACE (to frame the top) and the gameplay (bottom).

    known_box, when given, is the video-level cam region (shared across every clip
    of the video) and overrides the per-clip guess so all clips split consistently.

    Returns (facecam_box | None, face_info | None, gameplay_samples) where
      facecam_box      = (x, y, w, h)  region to EXCLUDE from the gameplay crop
      face_info        = {"traj": [(t, cx, cy)], "fw": int, "fh": int} | None
                         the streamer's face centres over time, used to frame the
                         top on the face and gently follow it. None -> plain crop.
      gameplay_samples = [(rel_time, cx), ...] for smooth_crop_trajectory

    Detection: a YuNet face detector (robust to a hand on the face) finds the
    persistent small corner face = the webcam; a YOLO 'person' pass finds the
    cam box for exclusion and the gameplay subject. The face drives the top
    framing; if no face is found we fall back to fitting the whole cam box.
    """
    if not _REFRAME_AVAILABLE:
        return None, None, []
    try:
        import cv2 as _cv2
    except ImportError:
        return None, None, []
    import numpy as _np
    from collections import defaultdict

    model = _get_yolo()
    face_det = None
    try:
        if _YUNET_PATH.exists():
            face_det = _cv2.FaceDetectorYN_create(
                str(_YUNET_PATH), "", (320, 320),
                score_threshold=0.6, nms_threshold=0.3, top_k=50)
    except Exception as e:
        print(f"[facecam] YuNet unavailable: {e}", flush=True)
        face_det = None

    cap   = _cv2.VideoCapture(str(clip_path))
    fps   = cap.get(_cv2.CAP_PROP_FPS) or 30.0
    sample_every = max(1, int(fps / 2))
    frame_area   = src_w * src_h

    per_frame    = []   # (frame_idx, xyxy array of person boxes)
    corner_boxes = []   # candidate facecam person boxes (small + corner-hugging)
    face_hits    = []   # (t, cx, cy, fw, fh) small corner face detections
    fidx = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        if fidx % sample_every == 0:
            res   = model(frame, classes=[0], verbose=False, conf=0.25)
            boxes = res[0].boxes
            xyxy  = (boxes.xyxy.cpu().numpy().astype(int)
                     if boxes is not None and len(boxes) else _np.empty((0, 4), int))
            per_frame.append((fidx, xyxy))
            for x1, y1, x2, y2 in xyxy:
                if x2 <= x1 or y2 <= y1:
                    continue
                small     = (x2 - x1) * (y2 - y1) < frame_area * 0.18
                near_edge = ((x1 < src_w * 0.06 or x2 > src_w * 0.94) and
                             (y1 < src_h * 0.06 or y2 > src_h * 0.94))
                if small and near_edge:
                    corner_boxes.append((x1, y1, x2, y2))
            if face_det is not None:
                try:
                    face_det.setInputSize((frame.shape[1], frame.shape[0]))
                    _n, faces = face_det.detect(frame)
                except Exception:
                    faces = None
                if faces is not None:
                    for f in faces:
                        fx, fy, fw, fh = (int(f[0]), int(f[1]), int(f[2]), int(f[3]))
                        if fw <= 0 or fh <= 0:
                            continue
                        cx, cy = fx + fw / 2.0, fy + fh / 2.0
                        # Small persistent face = the webcam (no corner requirement —
                        # cams sit top-centre too; persistence clustering filters out
                        # transient gameplay faces).
                        if fw * fh < frame_area * 0.10:
                            face_hits.append((round(fidx / fps, 3), cx, cy, fw, fh))
        fidx += 1
    cap.release()

    # ── Facecam person box (exclusion region): persistent corner cluster ──
    facecam = None
    if corner_boxes and per_frame:
        gx, gy = src_w * 0.05, src_h * 0.05
        clusters = defaultdict(list)
        for b in corner_boxes:
            cx, cy = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
            clusters[(int(cx / gx), int(cy / gy))].append(b)
        best = max(clusters.values(), key=len)
        if len(best) >= max(2, int(0.25 * len(per_frame))):
            arr = _np.array(best)
            fx1, fy1 = int(_np.median(arr[:, 0])), int(_np.median(arr[:, 1]))
            fx2, fy2 = int(_np.median(arr[:, 2])), int(_np.median(arr[:, 3]))
            pad = int(max(fx2 - fx1, fy2 - fy1) * 0.10)
            fx1, fy1 = max(0, fx1 - pad), max(0, fy1 - pad)
            fx2, fy2 = min(src_w, fx2 + pad), min(src_h, fy2 + pad)
            facecam = (fx1, fy1, fx2 - fx1, fy2 - fy1)

    # ── Facecam FACE (top framing + follow): persistent corner face cluster ──
    face_info = None
    if face_hits and per_frame:
        gx, gy = src_w * 0.08, src_h * 0.08
        fclusters = defaultdict(list)
        for hit in face_hits:
            fclusters[(int(hit[1] / gx), int(hit[2] / gy))].append(hit)
        fbest = max(fclusters.values(), key=len)
        if len(fbest) >= max(2, int(0.20 * len(per_frame))):
            mfw = int(_np.median([h[3] for h in fbest]))
            mfh = int(_np.median([h[4] for h in fbest]))
            traj = sorted((h[0], h[1], h[2]) for h in fbest)
            face_info = {"traj": traj, "fw": mfw, "fh": mfh}
            # If the person pass missed the cam, derive the exclusion box from the
            # face (expanded to head + shoulders) so the bottom still drops it.
            if facecam is None:
                mcx = float(_np.median([h[1] for h in fbest]))
                mcy = float(_np.median([h[2] for h in fbest]))
                bw, bh = int(mfw * 2.2), int(mfh * 2.8)
                bx = int(max(0, min(mcx - bw / 2, src_w - bw)))
                by = int(max(0, min(mcy - bh * 0.40, src_h - bh)))
                facecam = (bx, by, min(bw, src_w), min(bh, src_h))

    # A shared video-level box wins, so every clip of the video splits the same way.
    if known_box is not None:
        facecam = known_box

    def _in_facecam(b) -> bool:
        if not facecam:
            return False
        fx, fy, fw, fh = facecam
        ix1, iy1 = max(b[0], fx), max(b[1], fy)
        ix2, iy2 = min(b[2], fx + fw), min(b[3], fy + fh)
        inter = max(0, ix2 - ix1) * max(0, iy2 - iy1)
        ba    = (b[2] - b[0]) * (b[3] - b[1])
        return ba > 0 and inter / ba > 0.5

    # Gameplay subject = largest person that isn't the facecam.
    game = []
    for fr, xyxy in per_frame:
        cands = [b for b in xyxy if not _in_facecam(b)]
        if not cands:
            continue
        b = cands[int(_np.argmax([(c[2] - c[0]) * (c[3] - c[1]) for c in cands]))]
        game.append((round(fr / fps, 3), float((b[0] + b[2]) / 2)))

    return facecam, face_info, game


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


# ── background music cache ────────────────────────────────────────────────────
async def get_bg_music_path(url: str) -> Optional[Path]:
    """Download audio from a YouTube URL and cache it. Returns the local path, or None on failure."""
    import hashlib as _hashlib

    # Reject anything that isn't a genuine YouTube URL before it reaches yt-dlp's
    # argv — this is the single chokepoint for background-music URLs coming from
    # manual jobs, watchlist channels, and digest backfills alike.
    if not url or not _YOUTUBE_URL_RE.match(url.strip()):
        print(f"[bg_music] rejected non-YouTube URL: {url!r}", flush=True)
        return None
    url = url.strip()

    # Derive the cache filename purely from a SHA-256 hash of the URL — the result is
    # a fixed-length hex string with no path separators or traversal sequences, so the
    # user-controlled URL never reaches the filesystem path in a usable form.
    cache_key = _hashlib.sha256(url.encode("utf-8")).hexdigest()

    base = os.path.realpath(MUSIC_CACHE_DIR)

    def _safe_path(ext: str) -> Optional[Path]:
        # Resolve the candidate and confirm it stays inside the cache directory.
        candidate = os.path.realpath(os.path.join(base, f"{cache_key}{ext}"))
        if os.path.commonpath([base, candidate]) != base:
            return None
        return Path(candidate)

    exts = [".m4a", ".mp3", ".webm", ".opus"]

    # Check cache
    for ext in exts:
        p = _safe_path(ext)
        if p and p.exists():
            return p

    # Download audio-only
    out_target = _safe_path("")
    if out_target is None:
        return None
    cmd = [YTDLP, "-x", "--audio-format", "m4a", "--audio-quality", "128K",
           "-o", str(out_target) + ".%(ext)s", "--no-playlist", "--quiet"]
    if COOKIES_FROM_BROWSER:
        cmd += ["--cookies-from-browser", COOKIES_FROM_BROWSER]
    elif COOKIES_FILE.exists():
        cmd += ["--cookies", str(COOKIES_FILE)]
    cmd += ["--", url]  # "--" stops yt-dlp parsing the URL as an option flag
    try:
        r = await asyncio.to_thread(subprocess.run, cmd, capture_output=True, text=True, timeout=180)
        for ext in exts:
            p = _safe_path(ext)
            if p and p.exists():
                return p
        print(f"[bg_music] download failed for {url}: {r.stderr[-200:]}", flush=True)
        return None
    except Exception as e:
        print(f"[bg_music] exception for {url}: {e}", flush=True)
        return None


# ── hardcoded caption bar detection ──────────────────────────────────────────
async def _detect_caption_bar(video_path: Path, duration: float, src_h: int, src_w: int) -> int:
    """
    Sample 5 frames and measure row-by-row variance in the bottom 18% of the frame.
    Returns the number of pixels to crop from the bottom if a consistent subtitle bar
    is detected, otherwise 0. Caps at 12% of frame height to avoid over-cropping.
    """
    strip_h = min(int(src_h * 0.18), 220)
    timestamps = [duration * f for f in [0.15, 0.30, 0.50, 0.70, 0.85]]
    row_hit = [0] * strip_h
    frames_ok = 0

    for ts in timestamps:
        cmd = [
            FFMPEG, "-ss", f"{ts:.2f}", "-i", str(video_path),
            "-vframes", "1", "-f", "rawvideo", "-pix_fmt", "gray",
            "-vf", f"crop={src_w}:{strip_h}:0:{src_h - strip_h}",
            "-an", "pipe:1",
        ]
        try:
            r = await asyncio.to_thread(subprocess.run, cmd, capture_output=True, timeout=15)
            data = r.stdout
            if len(data) != src_w * strip_h:
                continue
            frames_ok += 1
            for row in range(strip_h):
                row_bytes = data[row * src_w:(row + 1) * src_w]
                mean = sum(row_bytes) / src_w
                variance = sum((b - mean) ** 2 for b in row_bytes) / src_w
                bright = sum(1 for b in row_bytes if b > 190)
                # Text row: high variance AND enough bright pixels (white/yellow text)
                if variance > 700 and bright > src_w * 0.01:
                    row_hit[row] += 1
        except Exception:
            continue

    if frames_ok < 3:
        return 0

    min_agree = max(2, int(frames_ok * 0.6))
    subtitle_top = None
    gap = 0

    # Scan bottom-to-top to find the topmost row of the subtitle band
    for row in range(strip_h - 1, -1, -1):
        if row_hit[row] >= min_agree:
            subtitle_top = row
            gap = 0
        else:
            gap += 1
            if gap >= 10 and subtitle_top is not None:
                break  # Left the subtitle band

    if subtitle_top is None:
        return 0

    crop_px = strip_h - subtitle_top
    if crop_px < 20:  # Too thin to be a real subtitle bar
        return 0
    return min(crop_px, int(src_h * 0.12))


# ── auto thumbnail generation ─────────────────────────────────────────────────
def _wrap_title(title: str, max_chars: int = 16, max_lines: int = 3) -> str:
    """Word-wrap a title into at most max_lines lines for thumbnail overlay."""
    words = (title or "").strip().upper().split()
    lines, cur = [], ""
    for w in words:
        if len(cur) + len(w) + 1 <= max_chars or not cur:
            cur = f"{cur} {w}".strip()
        else:
            lines.append(cur)
            cur = w
        if len(lines) == max_lines:
            break
    if cur and len(lines) < max_lines:
        lines.append(cur)
    return "\n".join(lines[:max_lines])


async def _generate_thumbnail(clip_path: Path, title: str, out_path: Path, job_dir: Path) -> bool:
    """Grab a frame from the rendered 9:16 clip and overlay a dark band + title at top."""
    txt_file = job_dir / f"{out_path.stem}_title.txt"
    try:
        txt_file.write_text(_wrap_title(title), encoding="utf-8")
        # textfile path is relative to job_dir (cwd) to avoid colon-escaping issues
        vf = (
            "drawbox=x=0:y=0:w=iw:h=420:color=black@0.5:t=fill,"
            f"drawtext=font=Montserrat:textfile={txt_file.name}:fontcolor=white:"
            "fontsize=72:borderw=4:bordercolor=black@0.9:"
            "x=(w-text_w)/2:y=70:line_spacing=14"
        )
        cmd = [
            FFMPEG, "-y", "-ss", "1.2", "-i", str(clip_path),
            "-vframes", "1", "-vf", vf, "-q:v", "3", str(out_path),
        ]
        code, _, err = await run_cmd_async(cmd, str(job_dir))
        if code != 0 or not out_path.exists():
            # Retry without the title overlay (font issues) — still produce a frame
            cmd2 = [FFMPEG, "-y", "-ss", "1.2", "-i", str(clip_path), "-vframes", "1", "-q:v", "3", str(out_path)]
            code2, _, _ = await run_cmd_async(cmd2, str(job_dir))
            return code2 == 0 and out_path.exists()
        return True
    except Exception:
        return False
    finally:
        txt_file.unlink(missing_ok=True)


# ── scene-aware clip boundaries ───────────────────────────────────────────────
async def _scene_cuts_near(video_path: Path, t: float, window: float = 0.6, threshold: float = 0.35) -> list:
    """Return absolute timestamps of scene cuts within ±window seconds of t."""
    seg_start = max(0.0, t - window)
    seg_dur = window * 2
    cmd = [
        FFMPEG, "-ss", f"{seg_start:.3f}", "-i", str(video_path), "-t", f"{seg_dur:.3f}",
        "-filter:v", f"select='gt(scene,{threshold})',showinfo", "-an", "-f", "null", "-",
    ]
    try:
        _, _, err = await run_cmd_async(cmd)
    except Exception:
        return []
    cuts = []
    for m in re.finditer(r"pts_time:([0-9.]+)", err or ""):
        try:
            cuts.append(seg_start + float(m.group(1)))
        except ValueError:
            pass
    return cuts


async def _snap_to_scene_boundaries(video_path: Path, clip_defs: list, job_id: str) -> None:
    """Nudge each clip's start/end to the nearest scene cut within a small window (in place)."""
    for clip in clip_defs:
        start, end = clip.get("start"), clip.get("end")
        if start is None or end is None:
            continue
        # Snap start — only if it keeps the clip at least 5s long
        if start > 0.7:
            cuts = await _scene_cuts_near(video_path, start)
            if cuts:
                best = min(cuts, key=lambda c: abs(c - start))
                if abs(best - start) <= 0.6 and (end - best) >= 5:
                    clip["start"] = round(best, 3)
        # Snap end
        end_cuts = await _scene_cuts_near(video_path, end)
        if end_cuts:
            best = min(end_cuts, key=lambda c: abs(c - end))
            if abs(best - end) <= 0.6 and (best - clip["start"]) >= 5:
                clip["end"] = round(best, 3)
    log(job_id, "  Snapped clip boundaries to nearby scene cuts")


# ── silence trimming ──────────────────────────────────────────────────────────
async def _detect_silence(video_path: Path, start: float, dur: float,
                          min_silence: float = 0.5, noise: str = "-30dB") -> list:
    """Detect silent ranges (clip-relative, 0-based) within a clip via silencedetect."""
    cmd = [
        FFMPEG, "-ss", f"{start:.3f}", "-i", str(video_path), "-t", f"{dur:.3f}",
        "-af", f"silencedetect=n={noise}:d={min_silence}", "-f", "null", "-",
    ]
    try:
        _, _, err = await run_cmd_async(cmd)
    except Exception:
        return []
    silences, cur = [], None
    for line in (err or "").splitlines():
        ms = re.search(r"silence_start:\s*([0-9.]+)", line)
        me = re.search(r"silence_end:\s*([0-9.]+)", line)
        if ms:
            cur = float(ms.group(1))
        elif me and cur is not None:
            silences.append((cur, float(me.group(1))))
            cur = None
    return silences


def _keep_intervals(silences: list, total: float, pad: float = 0.08) -> list:
    """Complement of silent ranges → list of (start,end) speech intervals to keep."""
    keep, cursor = [], 0.0
    for s_start, s_end in silences:
        # Pad inward so we don't clip the start/end of adjacent speech
        s_start = min(total, s_start + pad)
        s_end = max(0.0, s_end - pad)
        if s_end <= s_start:
            continue
        if s_start > cursor:
            keep.append((cursor, s_start))
        cursor = max(cursor, s_end)
    if cursor < total:
        keep.append((cursor, total))
    return [(a, b) for a, b in keep if b - a > 0.05]


def _remap_segments_for_trim(segments: list, clip_start: float, clip_end: float, keep: list) -> tuple:
    """Map word timings onto the trimmed timeline. Returns (new_segments, trimmed_dur)."""
    # cumulative kept-duration offset at the start of each keep interval
    offsets, acc = [], 0.0
    for a, b in keep:
        offsets.append(acc)
        acc += (b - a)
    trimmed_dur = acc

    def remap(local: float):
        for (a, b), off in zip(keep, offsets):
            if a <= local <= b:
                return off + (local - a)
        return None

    new_segments = []
    src = segments or []
    for seg in src:
        for w in _fill_words(seg):
            ws = w["start"] - clip_start
            we = w["end"] - clip_start
            if we < 0 or ws > (clip_end - clip_start):
                continue
            ns = remap(max(0.0, ws))
            ne = remap(min(clip_end - clip_start, we))
            if ns is None and ne is None:
                continue
            ns = ns if ns is not None else (ne - 0.2 if ne else 0.0)
            ne = ne if ne is not None else ns + 0.2
            if ne <= ns:
                ne = ns + 0.1
            word = w["word"]
            new_segments.append({
                "start": round(ns, 3), "end": round(ne, 3),
                "text": word, "words": [{"word": word, "start": round(ns, 3), "end": round(ne, 3)}],
            })
    return new_segments, trimmed_dur


async def _build_trimmed_clip(video_path: Path, start: float, dur: float, keep: list, out_path: Path) -> bool:
    """Render an intermediate clip with silent gaps cut out, preserving source resolution."""
    parts_v, parts_a, labels = [], [], []
    for i, (a, b) in enumerate(keep):
        parts_v.append(f"[0:v]trim=start={a:.3f}:end={b:.3f},setpts=PTS-STARTPTS[v{i}]")
        parts_a.append(f"[0:a]atrim=start={a:.3f}:end={b:.3f},asetpts=PTS-STARTPTS[a{i}]")
        labels.append(f"[v{i}][a{i}]")
    n = len(keep)
    fc = ";".join(parts_v + parts_a) + ";" + "".join(labels) + f"concat=n={n}:v=1:a=1[v][a]"
    cmd = [
        FFMPEG, "-y", "-ss", f"{start:.3f}", "-i", str(video_path), "-t", f"{dur:.3f}",
        "-filter_complex", fc, "-map", "[v]", "-map", "[a]",
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "20", "-c:a", "aac", str(out_path),
    ]
    try:
        code, _, _ = await run_cmd_async(cmd)
        return code == 0 and out_path.exists()
    except Exception:
        return False


# ── cut clips + burn subtitles ────────────────────────────────────────────────
async def create_clips(
    video_path: Path,
    clip_defs: list,
    segments: list,
    job_dir: Path,
    job_id: str,
    reframe: bool = False,
    clip_style: str = "reframe",
    caption_style: str = "bold_bottom",
    font_size: Optional[int] = None,
    highlight_color: Optional[str] = None,
    caption_position: Optional[str] = None,
    caption_keywords: bool = True,
    caption_segments: Optional[list] = None,
    bg_music_url: Optional[str] = None,
    bg_music_volume: float = 0.15,
    trim_silence: bool = False,
) -> list:
    log(job_id, f"Rendering {len(clip_defs)} clips...")
    await update_job(job_id, status="clipping", progress=78, message="Cutting clips and burning subtitles...")

    # Smart-framing steps (scene-snapping + caption-bar crop) only run with the
    # 9:16 reframe option on. Free / non-reframe clips get a plain center crop
    # with no boundary shifting or zoom.
    caption_crop_px = 0
    if reframe:
        # Snap clip boundaries to nearby scene cuts so clips don't start/end mid-shot
        try:
            await _snap_to_scene_boundaries(video_path, clip_defs, job_id)
        except Exception as _se:
            log(job_id, f"  Scene-boundary snap skipped: {_se}")

        # Probe once to detect a hardcoded subtitle bar before the clip loop
        try:
            _pre_probe_cmd = [FFPROBE, "-v", "quiet", "-print_format", "json", "-show_streams", str(video_path)]
            _, _pre_out, _ = await asyncio.to_thread(run_cmd, _pre_probe_cmd)
            _pre = json.loads(_pre_out)
            _pvs = next((s for s in _pre["streams"] if s["codec_type"] == "video"), None)
            if _pvs:
                _ph, _pw = int(_pvs["height"]), int(_pvs["width"])
                _dur = float(_pvs.get("duration") or 60)
                caption_crop_px = await _detect_caption_bar(video_path, _dur, _ph, _pw)
                if caption_crop_px > 0:
                    log(job_id, f"  Caption bar detected: cropping {caption_crop_px}px from bottom")
        except Exception as _ce:
            log(job_id, f"  Caption detection skipped: {_ce}")

    # Download background music once before the clip loop
    music_path: Optional[Path] = None
    if bg_music_url:
        log(job_id, f"  Fetching background music: {bg_music_url}")
        music_path = await get_bg_music_path(bg_music_url)
        if music_path:
            log(job_id, f"  Background music ready: {music_path.name} (vol={bg_music_volume})")
        else:
            log(job_id, "  Background music download failed — rendering without music")

    # Detect the streamer's webcam ONCE for the whole video so every facecam clip
    # splits the same way (per-clip detection was inconsistent across clips).
    facecam_region = None
    if clip_style == "facecam" and _REFRAME_AVAILABLE:
        try:
            _fc_probe = [FFPROBE, "-v", "quiet", "-print_format", "json", "-show_streams", str(video_path)]
            _, _fo, _ = await asyncio.to_thread(run_cmd, _fc_probe)
            _fvs = next((s for s in json.loads(_fo)["streams"] if s["codec_type"] == "video"), None)
            if _fvs:
                _fw, _fh = int(_fvs["width"]), int(_fvs["height"])
                _fd = float(_fvs.get("duration") or 0)
                facecam_region = await asyncio.to_thread(_detect_facecam_region, video_path, _fw, _fh, _fd)
            log(job_id, f"  Facecam region (video-level): {facecam_region['box'] if facecam_region else 'none'}")
        except Exception as _fe:
            log(job_id, f"  Facecam region detection skipped: {_fe}")

    results = []
    for idx, clip in enumerate(clip_defs):
        start = clip["start"]
        end   = clip["end"]
        dur   = end - start

        log(job_id, f"Clip {idx+1}/{len(clip_defs)}: '{clip['title']}' [{start:.1f}s – {end:.1f}s] ({dur:.1f}s)")
        # clipping: 78-98 spread across clips
        progress = 78 + int((idx / len(clip_defs)) * 20)
        await update_job(job_id, progress=progress, message=f"Rendering clip {idx+1}/{len(clip_defs)}: {clip['title']}")

        # Render source defaults to the original video; silence trimming may swap
        # it for a pre-trimmed intermediate with gaps cut out.
        render_src   = video_path
        render_ss    = start
        render_dur   = dur
        ass_segs     = caption_segments if caption_segments is not None else segments
        ass_clip_start = start
        ass_clip_end   = end
        trimmed_file: Optional[Path] = None

        if trim_silence:
            silences = await _detect_silence(video_path, start, dur)
            keep = _keep_intervals(silences, dur)
            removed = dur - sum(b - a for a, b in keep)
            if keep and len(keep) >= 2 and removed >= 0.8:
                trimmed_file = job_dir / f"clip_{idx}_trimmed.mp4"
                if await _build_trimmed_clip(video_path, start, dur, keep, trimmed_file):
                    remapped, trimmed_dur = _remap_segments_for_trim(
                        caption_segments if caption_segments is not None else segments,
                        start, end, keep,
                    )
                    render_src, render_ss, render_dur = trimmed_file, 0.0, trimmed_dur
                    ass_segs, ass_clip_start, ass_clip_end = remapped, 0.0, trimmed_dur
                    log(job_id, f"  Silence trimmed: removed {removed:.1f}s ({dur:.1f}s → {trimmed_dur:.1f}s)")
                else:
                    trimmed_file = None
                    log(job_id, "  Silence trim failed — rendering full clip")

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
        # Subtract any detected hardcoded caption bar from the bottom
        effective_h = src_h - caption_crop_px
        crop_h = effective_h
        crop_w = min(int(effective_h * 9 / 16), src_w)
        center_crop_x = max(0, (src_w - crop_w) // 2)

        # Final output resolution
        out_w = 1080
        out_h = 1920

        # For blur_bg, compute where the foreground video ends so captions land
        # in the bottom blurred zone rather than on top of the main video.
        blur_bg_margin_v = None
        if clip_style == "blur_bg":
            fg_h = int(src_h * out_w / src_w)
            fg_h = max(2, fg_h - (fg_h % 2))  # ensure even
            fg_h = min(fg_h, out_h)
            fg_bottom = (out_h + fg_h) // 2
            bottom_zone = out_h - fg_bottom
            eff_font = font_size or 72
            # Centre the caption text in the bottom blur zone
            blur_bg_margin_v = max(30, (bottom_zone - eff_font) // 2)

        # Caption position preset → alignment/MarginV pair. blur_bg wins (its
        # captions must land in the bottom blur zone regardless of preset).
        pos_align, pos_mv = None, None
        if caption_position and caption_position != "default" and clip_style != "blur_bg":
            pos_align, pos_mv = _CAPTION_POSITIONS.get(caption_position, (None, None))

        # Build ASS subtitle
        ass_path = job_dir / f"clip_{idx}.ass"
        build_ass_subtitles(
            ass_segs,
            clip_start=ass_clip_start,
            clip_end=ass_clip_end,
            output_path=ass_path,
            video_width=out_w,
            video_height=out_h,
            caption_style=caption_style,
            font_size=font_size,
            highlight_color=highlight_color,
            margin_v_override=blur_bg_margin_v if clip_style == "blur_bg" else pos_mv,
            # Force bottom-center alignment in blur_bg so captions land in the
            # bottom blur zone even for center-aligned styles like POP.
            alignment_override=2 if clip_style == "blur_bg" else pos_align,
            keywords=clip.get("keywords") if caption_keywords else None,
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
                # Keep audio so the sampler can gate tracking to actual speech
                await run_cmd_async([FFMPEG, "-y", "-ss", str(render_ss), "-i", str(render_src),
                                     "-t", str(render_dur), "-c:v", "libx264", "-preset", "ultrafast",
                                     "-crf", "28", "-c:a", "aac", "-b:a", "64k", str(temp_yolo)])
                detections = await asyncio.to_thread(_yolo_sample_positions_sequential, temp_yolo, src_w, src_h)
                temp_yolo.unlink(missing_ok=True)
                log(job_id, f"  YOLO detections: {len(detections)} samples, source: {src_w}x{src_h}, crop: {crop_w}x{crop_h}")
                if len(detections) == 0:
                    await update_job(job_id, message=f"Rendering clip {idx+1}/{len(clip_defs)}: {clip['title']} (no person detected — using center crop)")
            trajectory = smooth_crop_trajectory(detections, render_dur, fallback_crop_x=center_crop_x, crop_w=crop_w, src_w=src_w)
        else:
            trajectory = [(0.0, center_crop_x), (round(render_dur, 3), center_crop_x)]
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
                f"ass={ass_filename}:fontsdir={_FONTSDIR_ESC}"
            )
        else:
            static_x = trajectory[0][1]
            vf_string = (
                f"crop={crop_w}:{crop_h}:{static_x}:0,"
                f"scale={out_w}:{out_h},"
                f"ass={ass_filename}:fontsdir={_FONTSDIR_ESC}"
            )

        # Facecam (gaming) layout: streamer's corner cam on top 40%, reframe-tracked
        # gameplay on the bottom 60% (with the facecam excluded from the gameplay crop).
        facecam_fc = None
        facecam_extra_inputs = []
        if clip_style == "facecam" and _REFRAME_AVAILABLE:
            _fc_tmp = job_dir / f"clip_{idx}_fc.mp4"
            await run_cmd_async([FFMPEG, "-y", "-ss", str(render_ss), "-i", str(render_src),
                                 "-t", str(render_dur), "-c:v", "libx264", "-preset", "ultrafast",
                                 "-crf", "28", "-an", str(_fc_tmp)])
            _known_box = facecam_region["box"] if facecam_region else None
            facecam_box, face_info, game = await asyncio.to_thread(
                _detect_facecam_and_track, _fc_tmp, src_w, src_h, _known_box)
            _fc_tmp.unlink(missing_ok=True)
            if facecam_box:
                fx, fy, fw, fh = facecam_box
                top_h = (out_h * 2 // 5);  top_h -= top_h % 2     # 40% (768)
                bot_h = out_h - top_h                              # 60% (1152)
                gp_h  = crop_h
                gp_w  = min(int(gp_h * out_w / bot_h), src_w); gp_w -= gp_w % 2
                gp_min_x, gp_max_x = 0, src_w - gp_w
                if fx + fw <= src_w / 2:                            # facecam on the left
                    gp_min_x = min(fx + fw, gp_max_x)
                elif fx >= src_w / 2:                              # facecam on the right
                    gp_max_x = max(fx - gp_w, gp_min_x)
                gp_dets  = [(t, max(gp_min_x, min(int(cx - gp_w / 2), gp_max_x))) for t, cx in game]
                gp_fb    = max(gp_min_x, min((src_w - gp_w) // 2, gp_max_x))
                gp_traj  = smooth_crop_trajectory(gp_dets, render_dur, fallback_crop_x=gp_fb, crop_w=gp_w, src_w=src_w)
                gp_traj  = [(t, max(gp_min_x, min(x, gp_max_x))) for t, x in gp_traj]
                if len(set(x for _, x in gp_traj)) > 1:
                    _gp_cmd = job_dir / f"clip_{idx}_gp.txt"
                    write_sendcmd_file(gp_traj, _gp_cmd, fps=clip_fps)
                    gp_crop = f"sendcmd=f={_gp_cmd.name},crop={gp_w}:{gp_h}:0:0"
                else:
                    gp_crop = f"crop={gp_w}:{gp_h}:{gp_traj[0][1]}:0"

                # Face geometry for the TOP: per-clip face (follow) if this segment
                # showed it, else the shared video-level face (static) — so every
                # clip frames the face the SAME clean way (Opus-style fill) instead
                # of some clips falling back to a blurred card.
                if face_info:
                    fh_med, face_pts = face_info["fh"], face_info["traj"]
                elif facecam_region:
                    fh_med = facecam_region["fh"]
                    face_pts = [(0.0, facecam_region["fcx"], facecam_region["fcy"])]
                else:
                    fh_med, face_pts = None, None

                if face_pts:
                    # Frame the face (head + shoulders) at the top-strip aspect and
                    # FILL it (no blur). The follow needs its own sendcmd-driven crop,
                    # so render the top strip in a separate pass (one crop per graph)
                    # and vstack it in the main pass — no sendcmd cross-talk.
                    import statistics as _stats
                    win_w = int(min(fh_med * 2.6 * out_w / top_h, src_w)); win_w -= win_w % 2
                    win_h = int(win_w * top_h / out_w); win_h -= win_h % 2
                    win_h = min(win_h, src_h - (src_h % 2))
                    win_w = int(win_h * out_w / top_h); win_w -= win_w % 2
                    cxs = [c for _, c, _ in face_pts]
                    cys = [c for _, _, c in face_pts]
                    win_y = int(max(0, min(_stats.median(cys) - win_h * 0.42, src_h - win_h)))
                    f_dets = [(t, int(max(0, min(cx - win_w / 2, src_w - win_w)))) for t, cx, _ in face_pts]
                    f_fb   = int(max(0, min(_stats.median(cxs) - win_w / 2, src_w - win_w)))
                    f_traj = smooth_crop_trajectory(f_dets, render_dur, fallback_crop_x=f_fb, crop_w=win_w, src_w=src_w)
                    if len(set(x for _, x in f_traj)) > 1:
                        _f_cmd = job_dir / f"clip_{idx}_face.txt"
                        write_sendcmd_file(f_traj, _f_cmd, fps=clip_fps)
                        top_crop = f"sendcmd=f={_f_cmd.name},crop={win_w}:{win_h}:0:{win_y}"
                        _top_mode = "tracked"
                    else:
                        top_crop = f"crop={win_w}:{win_h}:{f_traj[0][1]}:{win_y}"
                        _top_mode = "framed"
                    _top_tmp = job_dir / f"clip_{idx}_top.mp4"
                    await run_cmd_async([
                        FFMPEG, "-y", "-ss", str(render_ss), "-i", str(render_src), "-t", str(render_dur),
                        "-filter_complex", f"[0:v]{top_crop},scale={out_w}:{top_h}[v]",
                        "-map", "[v]", "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "20",
                        str(_top_tmp),
                    ], str(job_dir))
                    facecam_extra_inputs.append(["-i", str(_top_tmp)])
                    top_chain = f"[{len(facecam_extra_inputs)}:v]null[top];"
                else:
                    # Last resort (no face anywhere) — fit the whole cam with blur.
                    _top_mode = "blur-fit"
                    top_chain = (
                        f"[0:v]crop={fw}:{fh}:{fx}:{fy},split[fcm][fcb];"
                        f"[fcb]scale={out_w}:{top_h}:force_original_aspect_ratio=increase,crop={out_w}:{top_h},boxblur=20:2[fcbg];"
                        f"[fcm]scale={out_w}:{top_h}:force_original_aspect_ratio=decrease[fcfg];"
                        f"[fcbg][fcfg]overlay=(W-w)/2:(H-h)/2[top];"
                    )

                facecam_fc = (
                    top_chain +
                    f"[0:v]{gp_crop},scale={out_w}:{bot_h}[bot];"
                    f"[top][bot]vstack[stacked];"
                    f"[stacked]ass={ass_filename}:fontsdir={_FONTSDIR_ESC}[vout]"
                )
                log(job_id, f"  Facecam {facecam_box}, top={_top_mode}, "
                            f"gameplay {gp_w}x{gp_h} x∈[{gp_min_x},{gp_max_x}]")
            else:
                log(job_id, "  No facecam detected — using center crop instead")

        if clip_style == "facecam" and facecam_fc:
            ffmpeg_cmd = [FFMPEG, "-y", "-ss", str(render_ss), "-i", str(render_src)]
            for _inp in facecam_extra_inputs:
                ffmpeg_cmd += _inp
            if music_path:
                music_idx = 1 + len(facecam_extra_inputs)
                facecam_fc += (
                    f";[0:a]volume=1.0[speech];[{music_idx}:a]volume={bg_music_volume}[bgm];"
                    f"[speech][bgm]amix=inputs=2:duration=first:dropout_transition=0.5[aout]"
                )
                ffmpeg_cmd += [
                    "-stream_loop", "-1", "-i", str(music_path), "-t", str(render_dur),
                    "-filter_complex", facecam_fc, "-map", "[vout]", "-map", "[aout]",
                    "-c:v", "libx264", "-preset", "fast", "-crf", "23",
                    "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(clip_path),
                ]
            else:
                ffmpeg_cmd += [
                    "-t", str(render_dur),
                    "-filter_complex", facecam_fc, "-map", "[vout]", "-map", "0:a?",
                    "-c:v", "libx264", "-preset", "fast", "-crf", "23",
                    "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(clip_path),
                ]
        elif clip_style == "blur_bg":
            # Blur-background style: landscape clip centred in 9:16 with a
            # blurred+scaled copy filling the bars.
            # Perf trick: blur at half-res (540x960) then upscale — blurring a
            # small image is ~4x faster and the upscale smears the blur further,
            # which actually improves the look. CRF 26 is fine here because the
            # background is heavily blurred; nobody sees compression artefacts.
            half_w = out_w // 2   # 540
            half_h = out_h // 2   # 960
            blur_bg_fc = (
                f"[0:v]scale={half_w}:{half_h}:force_original_aspect_ratio=increase,"
                f"crop={half_w}:{half_h},boxblur=10:2,scale={out_w}:{out_h}[bg];"
                f"[0:v]scale={out_w}:-2:force_original_aspect_ratio=decrease[fg];"
                f"[bg][fg]overlay=(W-w)/2:(H-h)/2[overlaid];"
                f"[overlaid]ass={ass_filename}:fontsdir={_FONTSDIR_ESC}[vout]"
            )
            if music_path:
                blur_bg_fc += (
                    f";[0:a]volume=1.0[speech];"
                    f"[1:a]volume={bg_music_volume}[bgm];"
                    f"[speech][bgm]amix=inputs=2:duration=first:dropout_transition=0.5[aout]"
                )
                ffmpeg_cmd = [
                    FFMPEG, "-y",
                    "-ss", str(render_ss),
                    "-i", str(render_src),
                    "-stream_loop", "-1",
                    "-i", str(music_path),
                    "-t", str(render_dur),
                    "-filter_complex", blur_bg_fc,
                    "-map", "[vout]",
                    "-map", "[aout]",
                    "-c:v", "libx264", "-preset", "fast", "-crf", "26",
                    "-c:a", "aac", "-b:a", "128k",
                    "-movflags", "+faststart",
                    str(clip_path),
                ]
            else:
                ffmpeg_cmd = [
                    FFMPEG, "-y",
                    "-ss", str(render_ss),
                    "-i", str(render_src),
                    "-t", str(render_dur),
                    "-filter_complex", blur_bg_fc,
                    "-map", "[vout]",
                    "-map", "0:a?",
                    "-c:v", "libx264", "-preset", "fast", "-crf", "26",
                    "-c:a", "aac", "-b:a", "128k",
                    "-movflags", "+faststart",
                    str(clip_path),
                ]
        elif music_path:
            fc = (
                f"[0:v]{vf_string}[vout];"
                f"[0:a]volume=1.0[speech];"
                f"[1:a]volume={bg_music_volume}[bgm];"
                f"[speech][bgm]amix=inputs=2:duration=first:dropout_transition=0.5[aout]"
            )
            ffmpeg_cmd = [
                FFMPEG, "-y",
                "-ss", str(render_ss),
                "-i", str(render_src),
                "-stream_loop", "-1",
                "-i", str(music_path),
                "-t", str(render_dur),
                "-filter_complex", fc,
                "-map", "[vout]",
                "-map", "[aout]",
                "-c:v", "libx264",
                "-preset", "fast",
                "-crf", "23",
                "-c:a", "aac",
                "-b:a", "128k",
                "-movflags", "+faststart",
                str(clip_path),
            ]
        else:
            ffmpeg_cmd = [
                FFMPEG, "-y",
                "-ss", str(render_ss),
                "-i", str(render_src),
                "-t", str(render_dur),
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

        # Generate a thumbnail from the rendered clip
        thumb_filename = f"clip_{idx+1}_thumb.jpg"
        thumb_path = OUTPUT_DIR / job_id / thumb_filename
        thumb_ok = await _generate_thumbnail(clip_path, clip.get("title", f"Clip {idx+1}"), thumb_path, job_dir)

        if R2_ENABLED:
            try:
                upload_clip(clip_path, job_id, clip_filename)
                clip_path.unlink(missing_ok=True)
                log(job_id, f"  Uploaded to R2, removed from disk")
            except Exception as e:
                log(job_id, f"  R2 upload failed (clip kept locally): {e}")
            if thumb_ok:
                try:
                    upload_thumbnail(thumb_path, job_id, thumb_filename)
                    thumb_path.unlink(missing_ok=True)
                except Exception as e:
                    log(job_id, f"  Thumbnail upload failed: {e}")
        if trimmed_file:
            trimmed_file.unlink(missing_ok=True)
        results.append({
            **clip,
            "filename": clip_filename,
            "path": f"/clips/{job_id}/{clip_filename}",
            "thumbnail": thumb_filename if thumb_ok else None,
            "duration": round(render_dur, 1),
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
                    key = (channel_id, video_id)
                    if key in _watchlist_inflight:
                        continue  # this upload is already being processed — don't queue a duplicate
                    if _watchlist_attempts.get(key, 0) >= WATCHLIST_MAX_ATTEMPTS:
                        # Give up after repeated failures: mark it seen so we stop
                        # retrying and can still detect newer uploads.
                        print(f"[watchlist] giving up on {video_id} after {WATCHLIST_MAX_ATTEMPTS} attempts", flush=True)
                        db_update_channel(channel_id, {"last_video_id": video_id, "last_video_title": video.get("title", "")})
                        _watchlist_attempts.pop(key, None)
                        continue
                    print(f"[watchlist] New video: {video.get('title')} ({video_id})", flush=True)
                    video_url = f"https://www.youtube.com/watch?v={video_id}"
                    user_id = ch.get("user_id", "")
                    profile = db_check_and_reset_quota(user_id)
                    if profile.get("plan") != "pro":
                        # Non-Pro: mark seen so we don't re-detect it every poll.
                        db_update_channel(channel_id, {"last_video_id": video_id, "last_video_title": video.get("title", "")})
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
                    _ch_clip_style = ch.get("clip_style", "reframe")
                    req = ClipRequest(
                        url=video_url,
                        max_clips=ch.get("max_clips", 3),
                        min_duration=ch.get("min_duration", 30),
                        max_duration=ch.get("max_duration", 90),
                        reframe=_ch_clip_style != "blur_bg",
                        clip_style=_ch_clip_style,
                        caption_style=ch.get("caption_style", "bold_bottom"),
                        caption_font_size=ch.get("caption_font_size"),
                        caption_highlight_color=ch.get("caption_highlight_color"),
                        caption_language=ch.get("caption_language", "source"),
                        bg_music_url=ch.get("bg_music_url") or None,
                        bg_music_volume=ch.get("bg_music_volume") or 0.15,
                        trim_silence=ch.get("trim_silence", False),
                    )
                    _watchlist_inflight.add(key)
                    _running_tasks[job_id] = asyncio.create_task(run_pipeline(job_id, req, user_id=user_id, auto_upload=ch.get("auto_upload", False), auto_upload_yt_channel=ch.get("yt_channel_id"), auto_upload_tt_account=ch.get("tt_open_id"), watchlist_channel_id=channel_id, watchlist_video_id=video_id, watchlist_video_title=video.get("title", "")))
            except Exception as e:
                print(f"[watchlist] Error checking {channel_id}: {e}", flush=True)
                db_update_channel(channel_id, {"last_checked": datetime.now(timezone.utc).isoformat()})
        await asyncio.sleep(30 * 60)


# ══════════════════════════════════════════════════════════════════════════════
# EMAIL NOTIFICATIONS
# ══════════════════════════════════════════════════════════════════════════════

async def send_job_notification(user_id: str, clip_count: int, video_url: str, error: str = "", job_id: str = "") -> None:
    """Send a Resend email when a job finishes. No-ops silently if RESEND_API_KEY is unset."""
    api_key = os.getenv("RESEND_API_KEY", "")
    if not api_key or not user_id:
        return
    try:
        import httpx
        email = await asyncio.to_thread(db_get_user_email, user_id)
        if not email:
            return
        app_url = os.getenv("APP_URL", "https://clipforging.com")
        from html import escape as _he
        safe_url = _he(video_url)
        # Deep-link straight to this job's clips on the Work page (falls back to
        # the Archive if we somehow don't have a job id).
        work_link = f"{app_url}/work?job={_he(job_id)}" if job_id else f"{app_url}/archive"
        if error:
            subject = "ClipForge — your job hit an error"
            body = f"""<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#ebe1c4;font-family:monospace">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#ebe1c4;padding:32px 16px">
  <tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;border:3px solid #1a0d2e;box-shadow:6px 6px 0 #1a0d2e">

      <!-- header -->
      <tr>
        <td style="background:#1a0d2e;padding:14px 24px">
          <span style="font-family:monospace;font-size:13px;font-weight:bold;letter-spacing:2px;color:#f4ecd6;text-transform:uppercase">&#x2702; CLIPFORGE</span>
        </td>
      </tr>

      <!-- accent bar -->
      <tr><td style="background:#f5a3c7;height:6px;border-bottom:3px solid #1a0d2e"></td></tr>

      <!-- body -->
      <tr>
        <td style="background:#fef7e4;padding:32px 28px">

          <p style="font-family:monospace;font-size:10px;letter-spacing:2px;color:#6b5b8a;margin:0 0 10px;text-transform:uppercase">! PIPELINE ERROR</p>
          <p style="font-family:monospace;font-size:24px;font-weight:bold;color:#1a0d2e;margin:0 0 20px;line-height:1.2">Your job hit<br>a problem.</p>

          <table width="100%" cellpadding="0" cellspacing="0" style="border:2px solid #1a0d2e;margin-bottom:24px">
            <tr>
              <td style="background:#ebe1c4;padding:10px 14px;border-bottom:2px solid #1a0d2e">
                <span style="font-family:monospace;font-size:9px;letter-spacing:1px;color:#6b5b8a;text-transform:uppercase">SOURCE VIDEO</span>
              </td>
            </tr>
            <tr>
              <td style="background:#fef7e4;padding:10px 14px">
                <span style="font-family:monospace;font-size:11px;color:#1a0d2e;word-break:break-all">{safe_url}</span>
              </td>
            </tr>
          </table>

          <p style="font-family:monospace;font-size:13px;color:#4a3d68;margin:0 0 28px;line-height:1.6">
            ClipForge ran into an error and couldn&#x27;t finish this job.<br>
            Head to the Archive to retry with the same settings &#x2192;
          </p>

          <a href="{app_url}/archive" style="display:inline-block;font-family:monospace;font-size:11px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;text-decoration:none;color:#1a0d2e;background:#f5a3c7;border:3px solid #1a0d2e;box-shadow:4px 4px 0 #1a0d2e;padding:13px 22px">VIEW IN ARCHIVE &gt;</a>

        </td>
      </tr>

      <!-- footer -->
      <tr>
        <td style="background:#ebe1c4;border-top:3px solid #1a0d2e;padding:14px 28px">
          <span style="font-family:monospace;font-size:9px;letter-spacing:1px;color:#6b5b8a;text-transform:uppercase">clipforging.com &mdash; your AI clip forge</span>
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body></html>"""
        else:
            noun = "clip" if clip_count == 1 else "clips"
            subject = f"ClipForge — {clip_count} {noun} ready to ship!"
            body = f"""<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#ebe1c4;font-family:monospace">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#ebe1c4;padding:32px 16px">
  <tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;border:3px solid #1a0d2e;box-shadow:6px 6px 0 #1a0d2e">

      <!-- header -->
      <tr>
        <td style="background:#1a0d2e;padding:14px 24px">
          <span style="font-family:monospace;font-size:13px;font-weight:bold;letter-spacing:2px;color:#f4ecd6;text-transform:uppercase">&#x2702; CLIPFORGE</span>
        </td>
      </tr>

      <!-- accent bar -->
      <tr><td style="background:#7ddca0;height:6px;border-bottom:3px solid #1a0d2e"></td></tr>

      <!-- body -->
      <tr>
        <td style="background:#fef7e4;padding:32px 28px">

          <p style="font-family:monospace;font-size:10px;letter-spacing:2px;color:#3aa86a;margin:0 0 10px;text-transform:uppercase">&#x2713; JOB COMPLETE</p>
          <table cellpadding="0" cellspacing="0" style="margin-bottom:20px">
            <tr>
              <td style="font-family:monospace;font-size:64px;font-weight:bold;color:#1a0d2e;line-height:1;padding-right:16px;vertical-align:middle">{clip_count}</td>
              <td style="font-family:monospace;font-size:20px;font-weight:bold;color:#1a0d2e;vertical-align:middle;line-height:1.2">{noun.upper()}<br><span style="font-size:13px;color:#6b5b8a;font-weight:normal">forged &amp; ready</span></td>
            </tr>
          </table>

          <table width="100%" cellpadding="0" cellspacing="0" style="border:2px solid #1a0d2e;margin-bottom:28px">
            <tr>
              <td style="background:#ebe1c4;padding:10px 14px;border-bottom:2px solid #1a0d2e">
                <span style="font-family:monospace;font-size:9px;letter-spacing:1px;color:#6b5b8a;text-transform:uppercase">SOURCE VIDEO</span>
              </td>
            </tr>
            <tr>
              <td style="background:#fef7e4;padding:10px 14px">
                <span style="font-family:monospace;font-size:11px;color:#1a0d2e;word-break:break-all">{safe_url}</span>
              </td>
            </tr>
          </table>

          <a href="{work_link}" style="display:inline-block;font-family:monospace;font-size:11px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;text-decoration:none;color:#1a0d2e;background:#7ddca0;border:3px solid #1a0d2e;box-shadow:4px 4px 0 #1a0d2e;padding:13px 22px">OPEN YOUR CLIPS &gt;</a>

        </td>
      </tr>

      <!-- footer -->
      <tr>
        <td style="background:#ebe1c4;border-top:3px solid #1a0d2e;padding:14px 28px">
          <span style="font-family:monospace;font-size:9px;letter-spacing:1px;color:#6b5b8a;text-transform:uppercase">clipforging.com &mdash; your AI clip forge</span>
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body></html>"""
        from_addr = os.getenv("RESEND_FROM", "ClipForge <notifications@updates.clipforging.com>")
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={
                    "from": from_addr,
                    "to": [email],
                    "subject": subject,
                    "html": body,
                },
            )
            if resp.status_code >= 400:
                print(f"[email] Resend rejected ({resp.status_code}): {resp.text[:300]}", flush=True)
                return
        print(f"[email] Sent '{subject}' to {email}", flush=True)
    except Exception as e:
        print(f"[email] Notification failed (non-fatal): {e}", flush=True)


# ══════════════════════════════════════════════════════════════════════════════
# MAIN PIPELINE
# ══════════════════════════════════════════════════════════════════════════════

async def _acquire_render_slot(job_id: str) -> None:
    """Acquire a global render slot. While queued, emit a heartbeat every 30s
    (explicitly bumping updated_at) so the watchdog's 20-minute no-progress kill
    doesn't reap a job that is merely waiting its turn. Cancellation-safe: never
    leaks a permit if the pipeline task is cancelled while waiting."""
    acq = asyncio.ensure_future(_render_sem.acquire())
    try:
        while True:
            done, _ = await asyncio.wait({acq}, timeout=30)
            if acq in done:
                return  # slot acquired (caller must release)
            await update_job(
                job_id, status="clipping", progress=77,
                message="Waiting for a free render slot...",
                updated_at=datetime.now(timezone.utc).isoformat(),
            )
    except asyncio.CancelledError:
        if acq.done() and not acq.cancelled():
            _render_sem.release()   # we had acquired — give it back
        else:
            acq.cancel()            # still pending — drop the request
        raise


async def run_pipeline(job_id: str, req: ClipRequest, user_id: str = "", auto_upload: bool = False, auto_upload_yt_channel: Optional[str] = None, auto_upload_tt_account: Optional[str] = None, backfill_id: Optional[str] = None, backfill_video_id: Optional[str] = None, watchlist_channel_id: Optional[str] = None, watchlist_video_id: Optional[str] = None, watchlist_video_title: str = ""):
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

        # 5. Cut + subtitle — gated by the render semaphore so only N jobs render
        #    concurrently; the rest queue here (heart-beating) instead of dogpiling.
        log(job_id, "--- PHASE 4: CLIP ---")
        log(job_id, f"  caption_style={req.caption_style!r} lang={req.caption_language} font_size={req.caption_font_size} highlight={req.caption_highlight_color} reframe={req.reframe}")
        await _acquire_render_slot(job_id)
        try:
            final_clips = await create_clips(
                video_path, clips, segments, job_dir, job_id,
                reframe=req.reframe,
                clip_style=req.clip_style,
                caption_style=req.caption_style or "bold_bottom",
                font_size=req.caption_font_size,
                highlight_color=req.caption_highlight_color,
                caption_position=req.caption_position,
                caption_keywords=req.caption_keywords,
                caption_segments=caption_segs,
                bg_music_url=req.bg_music_url,
                bg_music_volume=req.bg_music_volume,
                trim_silence=req.trim_silence,
            )
        finally:
            _render_sem.release()

        await update_job(
            job_id,
            status="done",
            progress=100,
            message=f"Done! {len(final_clips)} clips created.",
            clips=final_clips,
        )
        # Free quota is counted as one job at submit time (db_claim_clips_atomic),
        # so nothing to increment here on completion.
        if auto_upload and final_clips:
            # YouTube runs when a YT channel is chosen, or as the default when no
            # TikTok account is the sole chosen target (backward compatible).
            do_yt = bool(auto_upload_yt_channel) or not auto_upload_tt_account
            if do_yt:
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
                    log(job_id, f"  Auto-uploading clip {i+1}/{len(final_clips)} to YouTube...")
                    await asyncio.to_thread(do_youtube_upload, job_id, i, upload_data, user_id)
            if auto_upload_tt_account:
                log(job_id, f"Auto-uploading {len(final_clips)} clips to TikTok...")
                for i in range(len(final_clips)):
                    await asyncio.to_thread(do_tiktok_upload, job_id, i, {"tt_open_id": auto_upload_tt_account}, user_id)
        log(job_id, f"=== PIPELINE DONE === {len(final_clips)} clips delivered")
        if backfill_id and backfill_video_id:
            bf = await asyncio.to_thread(db_get_backfill, backfill_id)
            if bf:
                current = set(bf.get("processed_video_ids") or [])
                current.add(backfill_video_id)
                await asyncio.to_thread(db_update_backfill, backfill_id, {"processed_video_ids": list(current)})
        if watchlist_channel_id and watchlist_video_id:
            # Mark the upload seen only now that it succeeded; clear its retry state.
            await asyncio.to_thread(db_update_channel, watchlist_channel_id, {
                "last_video_id": watchlist_video_id,
                "last_video_title": watchlist_video_title,
            })
            _watchlist_attempts.pop((watchlist_channel_id, watchlist_video_id), None)
        if user_id:
            asyncio.create_task(send_job_notification(user_id, len(final_clips), req.url, job_id=job_id))

    except asyncio.CancelledError:
        log(job_id, "=== PIPELINE CANCELLED ===")
        await update_job(job_id, status="cancelled", progress=0, message="Job cancelled by user.")
        raise
    except Exception as e:
        import traceback as _tb
        log(job_id, f"!!! PIPELINE ERROR (full): {_tb.format_exc()}")
        await update_job(job_id, status="error", progress=0, message="Pipeline failed",
                   error="An error occurred while processing your video. Please try again.")
        if watchlist_channel_id and watchlist_video_id:
            # Count the failure so the poller retries (up to WATCHLIST_MAX_ATTEMPTS)
            # rather than dropping the upload. last_video_id is NOT advanced here.
            _k = (watchlist_channel_id, watchlist_video_id)
            _watchlist_attempts[_k] = _watchlist_attempts.get(_k, 0) + 1
        if user_id:
            asyncio.create_task(send_job_notification(user_id, 0, req.url, error="Pipeline failed", job_id=job_id))
        raise
    finally:
        _running_tasks.pop(job_id, None)
        if watchlist_channel_id and watchlist_video_id:
            _watchlist_inflight.discard((watchlist_channel_id, watchlist_video_id))
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
                ts = parse_iso(ts_str)
                if ts.tzinfo is None:
                    ts = ts.replace(tzinfo=timezone.utc)
                idle_minutes = (now - ts).total_seconds() / 60

                created_str = job.get("created_at", ts_str)
                created = parse_iso(created_str)
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


_backfill_running: set = set()  # backfill ids currently processing (prevents stacking)


async def _process_backfill(bf: dict) -> None:
    """Guard wrapper — ensures only one run per backfill channel at a time."""
    bf_id = bf.get("id")
    if bf_id in _backfill_running:
        print(f"[backfill] {bf_id} already running — skipping duplicate trigger", flush=True)
        return
    _backfill_running.add(bf_id)
    try:
        await _process_backfill_inner(bf)
    finally:
        _backfill_running.discard(bf_id)


async def _process_backfill_inner(bf: dict) -> None:
    from datetime import datetime, timezone
    bf_id = bf["id"]
    user_id = bf["user_id"]
    channel_url = bf.get("channel_url", "")
    days_back = bf.get("days_back", 30)
    vpd = bf.get("videos_per_day", 2)
    yt_ch_id = bf.get("yt_upload_channel_id") or None
    tt_account = bf.get("tt_open_id") or None
    auto_upload = bf.get("auto_upload", False)
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

    for video in to_process:
        try:
            _bf_clip_style = bf.get("clip_style", "reframe")
            req = ClipRequest(
                url=video["url"],
                max_clips=bf.get("max_clips", 3),
                min_duration=bf.get("min_duration", 30),
                max_duration=bf.get("max_duration", 90),
                reframe=_bf_clip_style != "blur_bg",
                clip_style=_bf_clip_style,
                caption_style=bf.get("caption_style", "bold_bottom"),
                caption_font_size=bf.get("caption_font_size"),
                caption_highlight_color=bf.get("caption_highlight_color"),
                caption_language=bf.get("caption_language", "source"),
                bg_music_url=bf.get("bg_music_url") or None,
                bg_music_volume=bf.get("bg_music_volume") or 0.15,
                trim_silence=bf.get("trim_silence", False),
            )
            job_data = {
                "user_id": user_id,
                "url": video["url"],
                "status": "queued",
                "max_clips": req.max_clips,
                "min_duration": req.min_duration,
                "max_duration": req.max_duration,
            }
            job = await asyncio.to_thread(db_create_job, job_data)
            _running_tasks[job["id"]] = asyncio.create_task(run_pipeline(
                job["id"], req,
                user_id=user_id,
                auto_upload=auto_upload and (bool(yt_ch_id) or bool(tt_account)),
                auto_upload_yt_channel=yt_ch_id if auto_upload else None,
                auto_upload_tt_account=tt_account if auto_upload else None,
                backfill_id=bf_id,
                backfill_video_id=video["id"],
            ))
            print(f"[backfill] queued {video['url']}", flush=True)
        except Exception as ve:
            print(f"[backfill] error queuing {video['url']}: {ve}", flush=True)

    # Only update total_videos and last_run_at — processed_video_ids is updated
    # by run_pipeline on success so failed videos are retried next run.
    await asyncio.to_thread(db_update_backfill, bf_id, {
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
                    last_run_dt = parse_iso(last_run)
                    if (datetime.now(timezone.utc) - last_run_dt).total_seconds() < 82800:
                        continue  # ran within the last 23h
                asyncio.create_task(_process_backfill(bf))
        except Exception as e:
            print(f"[backfill_scheduler] error: {e}", flush=True)
        await asyncio.sleep(3600)  # check every hour


CLIP_RETENTION_DAYS = 7

async def clip_cleanup_scheduler():
    """Delete R2 clips for done jobs older than CLIP_RETENTION_DAYS, once per day."""
    await asyncio.sleep(120)  # let startup settle
    while True:
        try:
            if R2_ENABLED:
                jobs = await asyncio.to_thread(db_get_expirable_jobs, CLIP_RETENTION_DAYS)
                for job in jobs:
                    job_id = job["id"]
                    try:
                        n = await asyncio.to_thread(delete_job_clips, job_id)
                        await asyncio.to_thread(db_update_job, job_id, {"clips_expired": True})
                        print(f"[clip_cleanup] expired {n} clips for job {job_id}", flush=True)
                    except Exception as je:
                        print(f"[clip_cleanup] failed for job {job_id}: {je}", flush=True)
        except Exception as e:
            print(f"[clip_cleanup] error: {e}", flush=True)
        await asyncio.sleep(86400)  # once per day


@app.on_event("startup")
async def startup_event():
    asyncio.create_task(watchdog())
    asyncio.create_task(channel_poller())
    asyncio.create_task(analytics_refresher())
    asyncio.create_task(backfill_scheduler())
    asyncio.create_task(clip_cleanup_scheduler())
    asyncio.create_task(public_stats_aggregator())

# ══════════════════════════════════════════════════════════════════════════════
# API ROUTES
# ══════════════════════════════════════════════════════════════════════════════

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
    if plan != "pro":
        if req.clip_style == "blur_bg":
            raise HTTPException(403, "Blur background style requires a Pro plan. Upgrade to unlock.")
        if req.clip_style == "facecam":
            raise HTTPException(403, "Facecam (gaming split) style requires a Pro plan. Upgrade to unlock.")
        if req.trim_silence:
            raise HTTPException(403, "Trim silence requires a Pro plan. Upgrade to unlock.")
    req.max_clips = min(req.max_clips, max_clips_per_job)
    if plan != "pro":
        # Count one JOB against the monthly free quota (each job yields up to 3 clips).
        claimed = db_claim_clips_atomic(user.id, 1, FREE_MONTHLY_JOB_LIMIT)
        if not claimed:
            raise HTTPException(403, f"Monthly free limit reached ({FREE_MONTHLY_JOB_LIMIT} jobs). Upgrade to Pro for unlimited.")
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
        "bg_music_url": req.bg_music_url or None,
        "bg_music_volume": req.bg_music_volume,
        # New-style knobs live in one JSONB bag (see sql/options_column.sql).
        # PostgREST silently drops the key if the column doesn't exist yet.
        "options": {
            "caption_position": req.caption_position,
            "caption_keywords": req.caption_keywords,
        },
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


@app.delete("/api/jobs/{job_id}")
async def delete_job(job_id: str, user=Depends(require_auth)):
    job = db_get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    if job.get("user_id") != user.id:
        raise HTTPException(403, "Forbidden")
    # Stop it if it's still running
    task = _running_tasks.get(job_id)
    if task and not task.done():
        task.cancel()
    # Remove its clips from R2 storage
    if R2_ENABLED:
        try:
            await asyncio.to_thread(delete_job_clips, job_id)
        except Exception as e:
            print(f"[delete_job] R2 cleanup failed for {job_id}: {e}", flush=True)
    await asyncio.to_thread(db_delete_job, job_id)
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
        "clips_limit": FREE_MONTHLY_JOB_LIMIT,
        "subscription_status": profile.get("subscription_status"),
        "plan_renews_at": profile.get("plan_renews_at"),
        "has_subscription": bool(profile.get("ls_subscription_id")),
        "pro_expires_at": profile.get("pro_expires_at"),
        "billing_enabled": billing.LS_ENABLED,
    }


@app.get("/api/system")
async def system_status(user=Depends(require_auth)):
    return {"reframe_available": _REFRAME_AVAILABLE}


@app.get("/api/stats/public")
async def get_public_stats():
    """Public aggregate stats for the landing-page counter (cached, no auth)."""
    return _PUBLIC_STATS


@app.post("/api/promo/redeem")
@_limiter.limit("10/minute")
async def redeem_promo(request: Request, req: PromoRedeemRequest, user=Depends(require_auth)):
    """Redeem an invite/promo code for time-limited Pro access."""
    code = (req.code or "").strip()
    if not code:
        raise HTTPException(400, "Missing code.")
    # Ensure the user's profile row exists (first-time sign-ups) before the RPC.
    await asyncio.to_thread(db_check_and_reset_quota, user.id)
    result = await asyncio.to_thread(db_redeem_promo, code, user.id)
    if not result.get("ok"):
        reason = result.get("reason")
        if reason == "full":
            raise HTTPException(409, "This invite has been fully claimed.")
        if reason == "already_redeemed":
            raise HTTPException(409, "You've already used this invite.")
        raise HTTPException(400, "Invalid or expired invite code.")
    return {"ok": True, "pro_days": result.get("pro_days"), "expires_at": result.get("expires_at")}


# ══════════════════════════════════════════════════════════════════════════════
# BILLING (Lemon Squeezy)
# ══════════════════════════════════════════════════════════════════════════════

@app.post("/api/billing/checkout")
@_limiter.limit("10/minute")
async def billing_checkout(request: Request, plan: str = "monthly", user=Depends(require_auth)):
    """Create a Lemon Squeezy hosted checkout for the current user and return its URL."""
    if not billing.LS_ENABLED:
        raise HTTPException(503, "Billing is not configured.")
    if plan not in ("monthly", "annual"):
        raise HTTPException(400, "Invalid plan.")
    if not billing.variant_for_plan(plan):
        raise HTTPException(503, "This plan is not available.")
    redirect_url = f"{_APP_URL}/hello?upgraded=1"
    try:
        url = await billing.create_checkout(user.id, getattr(user, "email", "") or "", plan, redirect_url)
    except Exception as e:
        print(f"[billing] checkout creation failed for {user.id}: {e}", flush=True)
        raise HTTPException(502, "Could not start checkout. Please try again.")
    if not url:
        raise HTTPException(502, "Could not start checkout. Please try again.")
    return {"url": url}


@app.get("/api/billing/portal")
async def billing_portal(user=Depends(require_auth)):
    """Return the Lemon Squeezy customer-portal URL so a subscriber can manage/cancel."""
    profile = db_get_profile(user.id) or {}
    sub_id = profile.get("ls_subscription_id")
    if not sub_id:
        raise HTTPException(404, "No active subscription.")
    url = await billing.get_portal_url(sub_id)
    if not url:
        raise HTTPException(502, "Could not open the billing portal. Please try again.")
    return {"url": url}


@app.post("/api/billing/webhook")
async def billing_webhook(request: Request):
    """Lemon Squeezy webhook — the single source of truth for a user's plan."""
    raw = await request.body()
    signature = request.headers.get("X-Signature", "")
    if not billing.verify_webhook(raw, signature):
        raise HTTPException(401, "Invalid signature")

    try:
        body = json.loads(raw)
    except Exception:
        raise HTTPException(400, "Invalid payload")

    meta = body.get("meta", {})
    event = meta.get("event_name", "")
    custom = meta.get("custom_data", {}) or {}
    user_id = custom.get("user_id")
    data = body.get("data", {}) or {}
    attrs = data.get("attributes", {}) or {}

    # Only subscription_* events carry the data we map to a plan.
    if not event.startswith("subscription_"):
        return {"ok": True, "ignored": event}
    if not user_id:
        print(f"[billing] webhook {event} missing custom user_id — skipping", flush=True)
        return {"ok": True, "skipped": "no user_id"}

    status = attrs.get("status", "")
    is_pro = status in billing.PRO_STATUSES
    updates = {
        "plan": "pro" if is_pro else "free",
        "ls_subscription_id": str(data.get("id")) if data.get("id") else None,
        "ls_customer_id": str(attrs.get("customer_id")) if attrs.get("customer_id") else None,
        "subscription_status": status,
        "plan_renews_at": attrs.get("renews_at"),
    }
    try:
        await asyncio.to_thread(db_update_profile, user_id, updates)
        print(f"[billing] {event} → user={user_id} status={status} plan={updates['plan']}", flush=True)
    except Exception as e:
        print(f"[billing] webhook db update failed for {user_id}: {e}", flush=True)
        raise HTTPException(500, "Update failed")
    return {"ok": True}


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
                        created = parse_iso(created_raw)
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
                                last = parse_iso(existing["fetched_at"])
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
# PUBLIC LANDING-PAGE STATS  (aggregate across all ClipForge-uploaded videos)
# ══════════════════════════════════════════════════════════════════════════════
# Only videos uploaded to YouTube via ClipForge are counted (we have their video
# ids), and only those with >0 captured views. A background task recomputes the
# totals into this cache so the public endpoint never makes per-request API calls.
_PUBLIC_STATS = {"videos": 0, "views": 0, "likes": 0, "subscribers": 0, "updated_at": None}


def _yt_api_json(path_qs: str) -> dict:
    url = f"https://www.googleapis.com/youtube/v3/{path_qs}&key={YOUTUBE_API_KEY}"
    with _urllib_req.urlopen(url, timeout=15) as resp:
        return json.loads(resp.read())


def _sum_channel_subscribers(channel_ids: list) -> int:
    """Sum current subscriber counts of distinct channels (skips hidden counts)."""
    total = 0
    for i in range(0, len(channel_ids), 50):
        ids = ",".join(_urllib_parse.quote(c) for c in channel_ids[i:i + 50])
        try:
            data = _yt_api_json(f"channels?part=statistics&id={ids}")
            for item in data.get("items", []):
                st = item.get("statistics", {})
                if st.get("hiddenSubscriberCount"):
                    continue
                total += int(st.get("subscriberCount", 0) or 0)
        except Exception as e:
            print(f"[public_stats] subscriber lookup failed: {e}", flush=True)
    return total


def _compute_public_stats_sync() -> dict:
    # Every video uploaded to YouTube via ClipForge (deduped).
    video_ids: list = []
    for job in db_get_done_jobs_with_uploads():
        for clip in job.get("clips") or []:
            vid = (clip.get("yt_upload") or {}).get("video_id")
            if vid:
                video_ids.append(vid)
    video_ids = list(dict.fromkeys(video_ids))  # dedupe, preserve order

    videos = views = likes = 0
    channel_ids: set = set()
    if YOUTUBE_API_KEY and video_ids:
        # One batched call returns live stats AND the owning channel per video.
        # Deleted/private videos simply aren't returned, so they drop out naturally.
        for i in range(0, len(video_ids), 50):
            ids = ",".join(_urllib_parse.quote(v) for v in video_ids[i:i + 50])
            try:
                data = _yt_api_json(f"videos?part=snippet,statistics&id={ids}")
            except Exception as e:
                print(f"[public_stats] video stats batch failed: {e}", flush=True)
                continue
            for item in data.get("items", []):
                v = int(item.get("statistics", {}).get("viewCount", 0) or 0)
                if v <= 0:                      # skip videos with no views entirely
                    continue
                if v > 100:                     # only >100-view videos count toward the video tally
                    videos += 1
                views += v                      # but their views/likes still count
                likes += int(item.get("statistics", {}).get("likeCount", 0) or 0)
                cid = item.get("snippet", {}).get("channelId")
                if cid:
                    channel_ids.add(cid)

    subscribers = _sum_channel_subscribers(list(channel_ids)) if channel_ids else 0

    return {
        "videos": videos, "views": views, "likes": likes, "subscribers": subscribers,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


async def public_stats_aggregator():
    """Recompute the public landing-page totals periodically into _PUBLIC_STATS."""
    global _PUBLIC_STATS
    await asyncio.sleep(20)  # let the server settle
    while True:
        try:
            _PUBLIC_STATS = await asyncio.to_thread(_compute_public_stats_sync)
            print(f"[public_stats] {_PUBLIC_STATS}", flush=True)
        except Exception as e:
            print(f"[public_stats] compute failed: {e}", flush=True)
        await asyncio.sleep(1800)  # every 30 minutes


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

        # Set the custom thumbnail we generated. Best-effort: custom thumbnails
        # require a phone-verified YouTube channel, so an unverified account gets
        # a 403 here — that must NOT fail the upload, since the video is already
        # published. The local thumbnail is deleted after R2 upload, so re-fetch
        # it from R2 when it isn't on disk.
        thumb_name = clip.get("thumbnail")
        if video_id and thumb_name:
            thumb_local = OUTPUT_DIR / job_id / thumb_name
            thumb_temp = None
            try:
                if not thumb_local.exists() and R2_ENABLED:
                    thumb_temp = download_clip_to_temp(job_id, thumb_name)
                    thumb_local = thumb_temp
                if thumb_local and Path(thumb_local).exists():
                    youtube.thumbnails().set(
                        videoId=video_id,
                        media_body=MediaFileUpload(str(thumb_local), mimetype="image/jpeg"),
                    ).execute()
                    print(f"[yt_upload] thumbnail set for {video_id}", flush=True)
                else:
                    print(f"[yt_upload] thumbnail '{thumb_name}' unavailable, skipping", flush=True)
            except Exception as thumb_err:
                print(f"[yt_upload] thumbnail set failed for {video_id} (non-fatal — channel may be unverified): {thumb_err}", flush=True)
            finally:
                if thumb_temp and Path(thumb_temp).exists():
                    Path(thumb_temp).unlink(missing_ok=True)

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
    if req.days_back < 1 or req.days_back > 365:
        raise HTTPException(400, "days_back must be between 1 and 365")
    if not _YOUTUBE_URL_RE.match(req.channel_url.strip()):
        raise HTTPException(400, "Only YouTube channel URLs are accepted.")
    req.channel_url = req.channel_url.strip()
    # Resolve channel name using the same approach as add_channel
    cmd = [YTDLP, "--flat-playlist", "--playlist-end", "1", "-j", "--no-warnings"]
    if COOKIES_FROM_BROWSER:
        cmd += ["--cookies-from-browser", COOKIES_FROM_BROWSER]
    elif COOKIES_FILE.exists():
        cmd += ["--cookies", str(COOKIES_FILE)]
    cmd += ["--", req.channel_url]  # "--" stops yt-dlp parsing the URL as an option flag
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
        "max_clips": req.max_clips,
        "min_duration": req.min_duration,
        "max_duration": req.max_duration,
        "caption_style": req.caption_style,
        "caption_font_size": req.caption_font_size,
        "caption_highlight_color": req.caption_highlight_color,
        "caption_language": req.caption_language,
        "clip_style": req.clip_style,
        "bg_music_url": req.bg_music_url or None,
        "bg_music_volume": req.bg_music_volume,
        "trim_silence": req.trim_silence,
        "tt_open_id": req.tt_open_id or None,
        "processed_video_ids": [],
        "total_videos": 0,
        "status": "active",
    })
    return bf


@app.patch("/api/backfill/{backfill_id}")
async def patch_backfill(backfill_id: str, req: BackfillPatchRequest, user=Depends(require_pro)):
    bf = await asyncio.to_thread(db_get_backfill, backfill_id)
    if not bf or bf.get("user_id") != user.id:
        raise HTTPException(404, "Not found")
    updates = req.model_dump(exclude_unset=True)
    if "days_back" in updates and (updates["days_back"] < 1 or updates["days_back"] > 365):
        raise HTTPException(400, "days_back must be between 1 and 365")
    if updates:
        await asyncio.to_thread(db_update_backfill, backfill_id, updates)
    return await asyncio.to_thread(db_get_backfill, backfill_id)


@app.post("/api/backfill/{backfill_id}/run")
@_limiter.limit("4/minute")
async def run_backfill_now(request: Request, backfill_id: str, user=Depends(require_pro)):
    """Manually trigger processing for a backfill channel."""
    bf = await asyncio.to_thread(db_get_backfill, backfill_id)
    if not bf or bf.get("user_id") != user.id:
        raise HTTPException(404, "Not found")
    if bf.get("status") != "active":
        raise HTTPException(400, "Backfill is not active")
    if backfill_id in _backfill_running:
        return {"ok": True, "already_running": True}
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


# ══════════════════════════════════════════════════════════════════════════════
# TIKTOK CROSS-POSTING (Content Posting API — inbox/draft upload)
# ══════════════════════════════════════════════════════════════════════════════

TIKTOK_SCOPES = "user.info.basic,video.publish"


def _tt_postmsg(msg_type: str, error_text: str = "") -> HTMLResponse:
    safe_origin = json.dumps(_APP_URL)
    safe_type   = json.dumps(msg_type)
    safe_error  = json.dumps(error_text)
    return HTMLResponse(
        f"<script>window.opener?.postMessage({{type:{safe_type},error:{safe_error}}},{safe_origin});window.close();</script>"
    )


def _tt_pkce():
    """Return (code_verifier, code_challenge) for TikTok OAuth PKCE (S256)."""
    import base64, hashlib, secrets
    verifier = secrets.token_urlsafe(64)[:128]
    challenge = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode()).digest()
    ).decode().rstrip("=")
    return verifier, challenge


async def get_tiktok_access_token(user_id: str, tt_open_id: Optional[str] = None) -> Optional[dict]:
    """Return a token row with a valid access_token, refreshing if expired."""
    from datetime import datetime, timezone
    tok = await asyncio.to_thread(db_get_tiktok_token, user_id, tt_open_id)
    if not tok:
        return None
    exp = tok.get("expires_at")
    needs_refresh = False
    if exp:
        try:
            exp_dt = parse_iso(exp)
            # refresh a couple minutes early
            needs_refresh = (exp_dt - datetime.now(timezone.utc)).total_seconds() < 120
        except Exception:
            needs_refresh = True
    if needs_refresh and tok.get("refresh_token"):
        import httpx
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                r = await client.post(
                    "https://open.tiktokapis.com/v2/oauth/token/",
                    headers={"Content-Type": "application/x-www-form-urlencoded"},
                    data={
                        "client_key": TIKTOK_CLIENT_KEY,
                        "client_secret": TIKTOK_CLIENT_SECRET,
                        "grant_type": "refresh_token",
                        "refresh_token": tok["refresh_token"],
                    },
                )
                d = r.json()
                if d.get("access_token"):
                    from datetime import timedelta
                    new_exp = (datetime.now(timezone.utc) + timedelta(seconds=int(d.get("expires_in", 86400)))).isoformat()
                    await asyncio.to_thread(
                        db_upsert_tiktok_token, user_id, d["access_token"],
                        d.get("refresh_token", tok["refresh_token"]),
                        tok.get("tt_open_id", ""), tok.get("tt_display_name", "TikTok"), new_exp,
                    )
                    tok["access_token"] = d["access_token"]
        except Exception as e:
            print(f"[tiktok] token refresh failed: {e}", flush=True)
    return tok


@app.get("/api/tiktok/auth")
async def tiktok_auth(user=Depends(require_pro)):
    if not TIKTOK_CLIENT_KEY or not TIKTOK_CLIENT_SECRET:
        raise HTTPException(400, "TikTok not configured. Set TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET in .env")
    import urllib.parse, secrets
    verifier, challenge = _tt_pkce()
    state = secrets.token_urlsafe(24)
    _oauth_state_set(state, {"user_id": user.id, "code_verifier": verifier})
    params = {
        "client_key": TIKTOK_CLIENT_KEY,
        "scope": TIKTOK_SCOPES,
        "response_type": "code",
        "redirect_uri": TIKTOK_REDIRECT_URI,
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    auth_url = "https://www.tiktok.com/v2/auth/authorize/?" + urllib.parse.urlencode(params)
    return {"auth_url": auth_url}


@app.get("/api/tiktok/callback")
async def tiktok_callback(code: str = None, state: str = None, error: str = None):
    if error:
        return _tt_postmsg("tiktok_auth_error", "Authorization was denied.")
    state_data = _oauth_state_get(state) if state else None
    if not code or not state_data:
        return _tt_postmsg("tiktok_auth_error", "Invalid or expired authorization state.")
    try:
        import httpx
        from datetime import datetime, timezone, timedelta
        user_id = state_data.get("user_id", "")
        verifier = state_data.get("code_verifier", "")
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(
                "https://open.tiktokapis.com/v2/oauth/token/",
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                data={
                    "client_key": TIKTOK_CLIENT_KEY,
                    "client_secret": TIKTOK_CLIENT_SECRET,
                    "code": code,
                    "grant_type": "authorization_code",
                    "redirect_uri": TIKTOK_REDIRECT_URI,
                    "code_verifier": verifier,
                },
            )
            tok = r.json()
        if not tok.get("access_token"):
            print(f"[tiktok_callback] token exchange failed: {tok}", flush=True)
            return _tt_postmsg("tiktok_auth_error", "Failed to complete TikTok authorization.")
        access_token = tok["access_token"]
        open_id = tok.get("open_id", "")
        expires_at = (datetime.now(timezone.utc) + timedelta(seconds=int(tok.get("expires_in", 86400)))).isoformat()
        # Look up display name
        display_name = "TikTok"
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                ui = await client.get(
                    "https://open.tiktokapis.com/v2/user/info/",
                    headers={"Authorization": f"Bearer {access_token}"},
                    params={"fields": "open_id,display_name"},
                )
                uj = ui.json()
                display_name = uj.get("data", {}).get("user", {}).get("display_name") or "TikTok"
                open_id = uj.get("data", {}).get("user", {}).get("open_id") or open_id
        except Exception as ue:
            print(f"[tiktok_callback] user info lookup failed: {ue}", flush=True)
        await asyncio.to_thread(
            db_upsert_tiktok_token, user_id, access_token,
            tok.get("refresh_token"), open_id, display_name, expires_at,
        )
        _oauth_states.pop(state, None)
        return _tt_postmsg("tiktok_auth_success")
    except Exception as e:
        print(f"[tiktok_callback] error: {e}", flush=True)
        return _tt_postmsg("tiktok_auth_error", "Failed to complete TikTok authorization.")


@app.get("/api/tiktok/status")
async def tiktok_status(user=Depends(require_pro)):
    tokens = await asyncio.to_thread(db_get_user_tiktok_tokens, user.id)
    if not tokens:
        return {"connected": False, "accounts": []}
    accounts = [
        {"tt_open_id": t.get("tt_open_id", ""), "tt_display_name": t.get("tt_display_name") or "TikTok"}
        for t in tokens
    ]
    return {"connected": True, "accounts": accounts}


@app.delete("/api/tiktok/disconnect")
async def tiktok_disconnect(tt_open_id: Optional[str] = None, user=Depends(require_pro)):
    await asyncio.to_thread(db_delete_tiktok_token, user.id, tt_open_id or None)
    return {"ok": True}


@app.get("/api/tiktok/creator_info")
async def tiktok_creator_info(tt_open_id: Optional[str] = None, user=Depends(require_pro)):
    """Creator's allowed privacy levels + interaction settings — required by the
    posting UI so the user picks from what TikTok actually permits for them."""
    tok = await get_tiktok_access_token(user.id, tt_open_id or None)
    if not tok:
        raise HTTPException(400, "Not connected to TikTok")
    import httpx
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.post(
                "https://open.tiktokapis.com/v2/post/publish/creator_info/query/",
                headers={"Authorization": f"Bearer {tok['access_token']}", "Content-Type": "application/json"},
            )
            d = r.json()
    except Exception as e:
        print(f"[tiktok] creator_info endpoint error: {e}", flush=True)
        raise HTTPException(502, "Could not reach TikTok")
    if d.get("error", {}).get("code") not in (None, "ok"):
        raise HTTPException(502, d.get("error", {}).get("message", "TikTok creator info failed"))
    data = d.get("data", {})
    return {
        "nickname": data.get("creator_nickname"),
        "avatar": data.get("creator_avatar_url"),
        "privacy_level_options": data.get("privacy_level_options", []),
        "comment_disabled": data.get("comment_disabled", False),
        "duet_disabled": data.get("duet_disabled", False),
        "stitch_disabled": data.get("stitch_disabled", False),
        "max_duration_sec": data.get("max_video_post_duration_sec"),
    }


def do_tiktok_upload(job_id: str, clip_index: int, req_data: dict, user_id: str):
    """Push a rendered clip to the user's TikTok inbox (draft) via the Content Posting API."""
    import httpx, asyncio as _aio
    tmp_path = None
    try:
        tok = _aio.run(get_tiktok_access_token(user_id, req_data.get("tt_open_id") or None))
        if not tok:
            db_update_clip_tt_upload(job_id, clip_index, {"status": "error", "error": "Not connected to TikTok"})
            return
        access_token = tok["access_token"]

        job = db_get_job(job_id)
        if not job:
            return
        clips = job.get("clips", [])
        if clip_index >= len(clips):
            return
        clip = clips[clip_index]
        filename = clip.get("filename", "")

        # Get the clip file (download from R2 if needed)
        local = OUTPUT_DIR / job_id / filename
        if local.exists():
            video_path = local
        elif R2_ENABLED:
            tmp_path = download_clip_to_temp(job_id, filename)
            video_path = tmp_path
        else:
            video_path = None
        if not video_path or not Path(video_path).exists():
            db_update_clip_tt_upload(job_id, clip_index, {"status": "error", "error": "Clip file not found"})
            return

        size = Path(video_path).stat().st_size
        db_update_clip_tt_upload(job_id, clip_index, {"status": "uploading", "progress": 10})

        # Caption: prefer the one the user typed in the modal, else build from the clip
        tags = clip.get("tags", []) or []
        default_caption = " ".join(filter(None, [
            clip.get("title", "") or clip.get("hook", ""),
            " ".join(f"#{t}" for t in tags),
        ])).strip() or "New clip"
        caption = (req_data.get("title") or default_caption)[:2200]
        disable_comment = bool(req_data.get("disable_comment", False))
        disable_duet    = bool(req_data.get("disable_duet", False))
        disable_stitch  = bool(req_data.get("disable_stitch", False))

        with httpx.Client(timeout=120) as client:
            auth_h = {"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"}

            # 1. Resolve privacy — use the user's choice if allowed, else a valid fallback
            privacy = req_data.get("privacy_level") or TIKTOK_PRIVACY_LEVEL
            try:
                ci = client.post("https://open.tiktokapis.com/v2/post/publish/creator_info/query/", headers=auth_h)
                cj = ci.json()
                print(f"[tiktok] creator_info ({ci.status_code}): {json.dumps(cj)[:300]}", flush=True)
                opts = cj.get("data", {}).get("privacy_level_options", [])
                if opts and privacy not in opts:
                    privacy = opts[0]
            except Exception as ce:
                print(f"[tiktok] creator_info query failed: {ce}", flush=True)

            source_info = {
                "source": "FILE_UPLOAD",
                "video_size": size,
                "chunk_size": size,
                "total_chunk_count": 1,
            }

            # 2. Direct Post (publishes to the profile via video.publish).
            mode = "direct"
            init = client.post(
                "https://open.tiktokapis.com/v2/post/publish/video/init/",
                headers=auth_h,
                json={
                    "post_info": {
                        "title": caption,
                        "privacy_level": privacy,
                        "disable_comment": disable_comment,
                        "disable_duet": disable_duet,
                        "disable_stitch": disable_stitch,
                    },
                    "source_info": source_info,
                },
            )
            ij = init.json()
            print(f"[tiktok] direct init ({init.status_code}) privacy={privacy} size={size}: {json.dumps(ij)[:400]}", flush=True)
            code = ij.get("error", {}).get("code")
            if code == "unaudited_client_can_only_post_to_private_accounts":
                # App not yet audited: TikTok only allows direct post to a private account.
                db_update_clip_tt_upload(job_id, clip_index, {"status": "error",
                    "error": "TikTok posting is pending app approval. Set your TikTok account to private to post in the meantime."})
                return
            if code not in (None, "ok"):
                err = ij.get("error", {})
                db_update_clip_tt_upload(job_id, clip_index, {"status": "error", "error": f"{err.get('code','')}: {err.get('message','init failed')}"})
                return
            upload_url = ij.get("data", {}).get("upload_url")
            publish_id = ij.get("data", {}).get("publish_id")
            if not upload_url:
                db_update_clip_tt_upload(job_id, clip_index, {"status": "error", "error": "No upload URL from TikTok"})
                return

            # 3. PUT the whole file as one chunk
            with open(video_path, "rb") as f:
                data = f.read()
            put = client.put(
                upload_url,
                headers={
                    "Content-Type": "video/mp4",
                    "Content-Length": str(size),
                    "Content-Range": f"bytes 0-{size-1}/{size}",
                },
                content=data,
            )
            if put.status_code not in (200, 201, 206):
                print(f"[tiktok] PUT upload failed ({put.status_code}): {put.text[:300]}", flush=True)
                db_update_clip_tt_upload(job_id, clip_index, {"status": "error", "error": f"Upload failed ({put.status_code})"})
                return

        note = ("Posted privately to your TikTok profile." if privacy == "SELF_ONLY"
                else "Posted to your TikTok profile.")
        db_update_clip_tt_upload(job_id, clip_index, {
            "status": "done", "progress": 100, "publish_id": publish_id,
            "privacy": privacy, "note": note,
        })
        print(f"[tiktok] job={job_id} clip={clip_index} direct ok (publish_id={publish_id})", flush=True)
    except Exception as e:
        print(f"[tiktok] job={job_id} clip={clip_index} error: {e}", flush=True)
        db_update_clip_tt_upload(job_id, clip_index, {"status": "error", "error": "Upload to TikTok failed"})
    finally:
        if tmp_path:
            try:
                Path(tmp_path).unlink(missing_ok=True)
            except Exception:
                pass


@app.post("/api/tiktok/upload/{job_id}/{clip_index}")
async def start_tiktok_upload(
    job_id: str, clip_index: int, req: TikTokUploadRequest,
    background_tasks: BackgroundTasks, user=Depends(require_pro),
):
    job = db_get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    if job.get("user_id") != user.id:
        raise HTTPException(403, "Forbidden")
    if clip_index >= len(job.get("clips", [])):
        raise HTTPException(404, "Clip not found")
    db_update_clip_tt_upload(job_id, clip_index, {"status": "queued", "progress": 0})
    background_tasks.add_task(do_tiktok_upload, job_id, clip_index, req.model_dump(), user.id)
    return {"status": "queued"}


@app.get("/api/tiktok/upload_status/{job_id}/{clip_index}")
async def get_tiktok_upload_status(job_id: str, clip_index: int, user=Depends(require_pro)):
    job = db_get_job(job_id)
    if not job or job.get("user_id") != user.id:
        raise HTTPException(404, "Job not found")
    clips = job.get("clips", [])
    if clip_index >= len(clips):
        raise HTTPException(404, "Clip not found")
    return clips[clip_index].get("tt_upload", {"status": "none"})


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
    if not _YOUTUBE_URL_RE.match(req.url.strip()):
        raise HTTPException(400, "Only YouTube channel URLs are accepted.")
    req.url = req.url.strip()
    cmd = [YTDLP, "--flat-playlist", "--playlist-end", "1", "-j", "--no-warnings"]
    if COOKIES_FROM_BROWSER:
        cmd += ["--cookies-from-browser", COOKIES_FROM_BROWSER]
    elif COOKIES_FILE.exists():
        cmd += ["--cookies", str(COOKIES_FILE)]
    cmd += ["--", req.url]  # "--" stops yt-dlp parsing the URL as an option flag
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
        "clip_style": req.clip_style,
        "bg_music_url": req.bg_music_url or None,
        "bg_music_volume": req.bg_music_volume,
        "trim_silence": req.trim_silence,
        "tt_open_id": req.tt_open_id or None,
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
@_limiter.limit("6/minute")
async def check_channel_now(request: Request, channel_id: str, user=Depends(require_pro)):
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
        # Don't fall through to index.html for obvious file/probe requests
        # (e.g. /.git-credentials, /config/secrets.yml, /vite.config.js). Real
        # client-side routes have no file extension and no dot-prefixed segment,
        # so anything that looks like a file gets a clean 404 instead of a 200.
        last = safe_parts[-1] if safe_parts else ""
        if "." in last or any(p.startswith(".") for p in safe_parts):
            raise HTTPException(404, "Not found")
        index = FRONTEND_BUILD / "index.html"
        if index.exists():
            return FileResponse(str(index))
    raise HTTPException(404, "Frontend not built")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

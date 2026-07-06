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
    from reframe import _get_yolo, _speaking_person_cx, _person_candidates, _audio_rms_per_frame
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

# Remote JS challenge solver for yt-dlp. Modern YouTube requires solving a JS
# signature/nsig challenge; "ejs:github" fetches the solver and runs it via a
# JS runtime (deno). Without it, extraction degrades into the "sign in to
# confirm you're not a bot" wall even with valid cookies + PO token. Empty on
# local dev (no deno); set YTDLP_REMOTE_COMPONENTS=ejs:github on the server.
YTDLP_REMOTE_COMPONENTS = os.getenv("YTDLP_REMOTE_COMPONENTS", "")
# The ejs solver needs deno on PATH — prepend the standard install dir if present
# (mirrors ytdlp_helper.py, the known-working downloader on the server).
_DENO_BIN = Path.home() / ".deno" / "bin"
if _DENO_BIN.is_dir() and str(_DENO_BIN) not in os.environ.get("PATH", ""):
    os.environ["PATH"] = f"{_DENO_BIN}{os.pathsep}" + os.environ.get("PATH", "")

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

from fastapi import FastAPI, BackgroundTasks, HTTPException, Depends, Header, Request, File, UploadFile
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, HTMLResponse, Response
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
    db_create_scheduled_post, db_get_user_scheduled_posts, db_get_scheduled_post,
    db_update_scheduled_post, db_due_scheduled_posts,
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
BRAND_DIR     = BASE_DIR / "brand"   # per-user watermark logos (brand kit)
TEMP_DIR      = BASE_DIR / "temp"
MUSIC_CACHE_DIR = BASE_DIR / "music_cache"
# Finished sources are kept here briefly so "reprompt" (find more clips in the
# same video) can skip the re-download. Bounded by the sweeper (hours + GB).
SOURCE_CACHE_DIR = BASE_DIR / "source_cache"
SOURCE_RETENTION_HOURS = int(os.getenv("SOURCE_RETENTION_HOURS", "48") or "48")
SOURCE_CACHE_MAX_GB = float(os.getenv("SOURCE_CACHE_MAX_GB", "100") or "100")
OUTPUT_DIR.mkdir(exist_ok=True)
TEMP_DIR.mkdir(exist_ok=True)
BRAND_DIR.mkdir(exist_ok=True)
MUSIC_CACHE_DIR.mkdir(exist_ok=True)
SOURCE_CACHE_DIR.mkdir(exist_ok=True)
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
    clip_style: str = "reframe"  # legacy name; aliased into layout (reframe→fill, facecam→gameplay)
    layout: Optional[str] = None  # auto | fill | fit | blur_bg | gameplay | split | screenshare (wins over clip_style)
    aspect_ratio: str = "9:16"    # 9:16 | 1:1 | 16:9 (multi-region layouts are 9:16-only)
    facecam_box: Optional[list] = None  # manual cam region [x, y, w, h], normalized 0-1
    style_prompt: Optional[str] = None       # "find" prompt (kept name for compat)
    exclude_prompt: Optional[str] = None     # topics the AI must never clip
    timeframe_start_min: Optional[float] = None  # only clip this window (minutes)
    timeframe_end_min: Optional[float] = None
    caption_style: str = "bold_bottom"
    caption_font_size: Optional[int] = None
    caption_highlight_color: Optional[str] = None
    caption_position: Optional[str] = None  # default | bottom | middle | top
    caption_keywords: bool = True           # AI keyword colour layer in captions
    caption_emoji: bool = True              # AI emoji overlays near captions
    caption_language: str = "source"
    bg_music_url: Optional[str] = None
    bg_music_volume: float = 0.15
    trim_silence: bool = False
    remove_fillers: bool = False   # cut um/uh/erm... vocal fillers out of clips
    # Exact-clip mode: render exactly this source range as one clip — the AI
    # selection phase is skipped entirely. Both must be set (seconds).
    exact_start_s: Optional[float] = None
    exact_end_s: Optional[float] = None
    # Editor internals (set by the /edit endpoint, not the Hello page):
    # keep-intervals in absolute source seconds and caption text overrides.
    edit_keep: Optional[list] = None            # [[start, end], ...]
    edit_title: Optional[str] = None
    caption_overrides: Optional[list] = None    # [{start, end, text}, ...]

class PromoRedeemRequest(BaseModel):
    code: str

class EditClipRequest(BaseModel):
    clip_index: Optional[int] = None    # which clip's window/settings to base on (None = from-scratch)
    keep: list                          # [[start, end], ...] absolute source seconds
    title: Optional[str] = None
    caption_overrides: Optional[list] = None  # [{start, end, text}, ...]
    remove_fillers: bool = False        # also strip um/uh... from the kept audio

class BrandSettings(BaseModel):
    enabled: bool = False
    position: str = "br"                # tl | tr | bl | br
    opacity: float = 0.5                # 0.1 - 1.0
    size: float = 0.15                  # logo width as a fraction of clip width
    color: Optional[str] = None         # brand hex — default caption highlight

class ScheduleRequest(BaseModel):
    job_id: str
    clip_index: int
    platform: str                       # youtube | tiktok
    target_id: Optional[str] = None     # yt_channel_id / tt_open_id
    title: Optional[str] = None
    description: Optional[str] = None
    privacy: Optional[str] = None       # youtube privacy_status / tiktok privacy_level
    publish_at: str                     # ISO timestamp (UTC)

class RepromptRequest(BaseModel):
    find: Optional[str] = None          # new find prompt (defaults to parent's)
    exclude: Optional[str] = None
    max_clips: Optional[int] = None
    min_duration: Optional[int] = None
    max_duration: Optional[int] = None
    timeframe_start_min: Optional[float] = None
    timeframe_end_min: Optional[float] = None
    facecam_box: Optional[list] = None  # manual cam region [x, y, w, h], normalized 0-1
    layout: Optional[str] = None        # override the parent's layout

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
    clip_style: str = "reframe"  # any layout: reframe|fit|blur_bg|split|screenshare|facecam|auto
    caption_style: str = "bold_bottom"
    caption_font_size: Optional[int] = None
    caption_highlight_color: Optional[str] = None
    caption_language: str = "source"
    yt_channel_id: Optional[str] = None
    tt_open_id: Optional[str] = None
    bg_music_url: Optional[str] = None
    bg_music_volume: float = 0.15
    trim_silence: bool = False
    # New-style knobs — stored in the channels.options JSONB bag
    aspect_ratio: Optional[str] = None
    caption_position: Optional[str] = None
    caption_keywords: Optional[bool] = None
    caption_emoji: Optional[bool] = None
    style_prompt: Optional[str] = None
    exclude_prompt: Optional[str] = None
    facecam_box: Optional[list] = None
    remove_fillers: Optional[bool] = None

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
    aspect_ratio: Optional[str] = None
    caption_position: Optional[str] = None
    caption_keywords: Optional[bool] = None
    caption_emoji: Optional[bool] = None
    style_prompt: Optional[str] = None
    exclude_prompt: Optional[str] = None
    facecam_box: Optional[list] = None
    remove_fillers: Optional[bool] = None


# Fields that live in the options JSONB bag on channels/backfill_channels
# (instead of a column per knob). Split out of create/patch payloads.
_OPTIONS_FIELDS = ("aspect_ratio", "caption_position", "caption_keywords",
                   "caption_emoji", "style_prompt", "exclude_prompt", "facecam_box",
                   "remove_fillers")


def _channel_clip_request(row: dict, video_url: str) -> ClipRequest:
    """Build a ClipRequest from a watchlist channel / backfill row, including
    the new-style knobs stored in its options JSONB bag — so auto-created jobs
    honour everything the manual submit form can express."""
    style = row.get("clip_style") or "reframe"
    opt = row.get("options") or {}
    return ClipRequest(
        url=video_url,
        max_clips=row.get("max_clips", 3),
        min_duration=row.get("min_duration", 30),
        max_duration=row.get("max_duration", 90),
        # Tracked crop except for whole-frame layouts; multi-region layouts use
        # `reframe` only for their Fill fallback, where tracking is wanted.
        reframe=style not in ("blur_bg", "fit"),
        clip_style=style,
        aspect_ratio=opt.get("aspect_ratio") or "9:16",
        facecam_box=opt.get("facecam_box"),
        style_prompt=opt.get("style_prompt") or None,
        exclude_prompt=opt.get("exclude_prompt") or None,
        caption_style=row.get("caption_style") or "bold_bottom",
        caption_font_size=row.get("caption_font_size"),
        caption_highlight_color=row.get("caption_highlight_color"),
        caption_position=opt.get("caption_position"),
        caption_keywords=opt.get("caption_keywords") is not False,
        caption_emoji=opt.get("caption_emoji") is not False,
        caption_language=row.get("caption_language") or "source",
        bg_music_url=row.get("bg_music_url") or None,
        bg_music_volume=row.get("bg_music_volume") or 0.15,
        trim_silence=row.get("trim_silence", False),
        remove_fillers=bool(opt.get("remove_fillers")),
    )


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
    aspect_ratio: Optional[str] = None
    caption_position: Optional[str] = None
    caption_keywords: Optional[bool] = None
    caption_emoji: Optional[bool] = None
    style_prompt: Optional[str] = None
    exclude_prompt: Optional[str] = None
    facecam_box: Optional[list] = None
    remove_fillers: Optional[bool] = None


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
    aspect_ratio: Optional[str] = None
    caption_position: Optional[str] = None
    caption_keywords: Optional[bool] = None
    caption_emoji: Optional[bool] = None
    style_prompt: Optional[str] = None
    exclude_prompt: Optional[str] = None
    facecam_box: Optional[list] = None
    remove_fillers: Optional[bool] = None


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
    if YTDLP_REMOTE_COMPONENTS:
        cmd += ["--remote-components", YTDLP_REMOTE_COMPONENTS]
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
        # Translate the common YouTube refusals into a clear user-facing reason
        # instead of dumping raw yt-dlp output as a mysterious "clip errored".
        low = tail.lower()
        if "confirm your age" in low or "age-restricted" in low or "inappropriate for some" in low:
            raise RuntimeError("This video is age-restricted, so YouTube won't let it be downloaded. Try a different video.")
        if "not a bot" in low or "login_required" in low or "sign in to confirm" in low:
            raise RuntimeError("YouTube blocked this video as restricted/sign-in-only (it can't be processed from a server). Try a different video.")
        if "private video" in low or "video is private" in low:
            raise RuntimeError("This video is private and can't be accessed. Try a different video.")
        if "members-only" in low or "members only" in low or "join this channel" in low:
            raise RuntimeError("This is a members-only video and can't be accessed. Try a different video.")
        if "video unavailable" in low or "removed" in low or "no longer available" in low or "has been terminated" in low:
            raise RuntimeError("This video is unavailable (removed, deleted, or region-blocked). Try a different video.")
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


# ── virality analysis (Groq) ─────────────────────────────────────────────────
async def _describe_energy_clips(clips: list, job_id: str) -> None:
    """One LLM call to give synthesized energy clips real titles, hooks,
    descriptions, and tags — grounded ONLY in what was actually spoken inside
    each window (the model can't see the video, so it must never invent
    specifics). Non-fatal: on any failure the template titles stay."""
    targets = [(i, c) for i, c in enumerate(clips) if c.get("_energy")]
    if not targets:
        return
    items = [{"n": i, "seconds": f"{c['start']:.0f}-{c['end']:.0f}",
              "spoken": (c.get("_spoken") or "")[:400]} for i, c in targets]
    prompt = f"""These video clips were auto-selected from a low-dialogue video (gaming/sports/vlog)
by audio-energy spikes. For each, write social-media metadata. "spoken" is ALL you
know about the clip — when it's empty or thin, write engaging but GENERIC hype copy
(e.g. about an intense moment) and NEVER invent specific events, names, or outcomes.

CLIPS:
{json.dumps(items, ensure_ascii=False)}

Return ONLY a JSON array, one item per clip, each with:
- "n": the same n as the input
- "title": catchy short title (max 8 words)
- "hook": a one-line opening hook
- "reason": 1-sentence description of the clip for a video description
- "tags": array of 3 hashtag strings (without #)"""

    def _sync():
        client = Groq(api_key=get_groq_key())
        r = client.chat.completions.create(
            model=GROQ_ANALYSIS_MODEL,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.5,
            max_tokens=1500,
        )
        return r.choices[0].message.content.strip()

    try:
        raw = await groq_with_retry(lambda: asyncio.to_thread(_sync),
                                    limiter=llama_limiter,
                                    log_fn=lambda m: log(job_id, m))
        if raw.startswith("```"):
            raw = raw.split("```")[1].lstrip("json").strip()
        m = re.search(r"\[.*\]", raw, re.DOTALL)
        data = json.loads(m.group(0) if m else raw)
        by_n = {int(d["n"]): d for d in data if isinstance(d, dict) and "n" in d}
        applied = 0
        for i, c in targets:
            d = by_n.get(i)
            if not d:
                continue
            if d.get("title"):
                c["title"] = _censor_text(str(d["title"]).strip())
            if d.get("hook"):
                c["hook"] = _censor_text(str(d["hook"]).strip())
            if d.get("reason"):
                c["reason"] = _censor_text(str(d["reason"]).strip())
            if isinstance(d.get("tags"), list) and d["tags"]:
                c["tags"] = [_censor_text(str(t)) for t in d["tags"][:3]]
            applied += 1
        log(job_id, f"  Energy clips described: {applied}/{len(targets)}")
    except Exception as e:
        log(job_id, f"  Energy clip descriptions skipped: {e}")


async def analyze_virality(segments: list, job_id: str, max_clips: int, min_dur: int, max_dur: int,
                           style_prompt: str = "", exclude_prompt: str = "",
                           timeframe_start: Optional[float] = None,
                           timeframe_end: Optional[float] = None,
                           excitement: Optional[dict] = None) -> list:
    log(job_id, f"Analyzing virality: {len(segments)} segments, max_clips={max_clips}, dur={min_dur}-{max_dur}s")
    await update_job(job_id, status="analyzing", progress=66, message="AI is identifying viral moments...")

    # Processing timeframe: only analyze the requested window of the source
    # (seconds). Captions still use the full segment list at render time.
    if timeframe_start is not None or timeframe_end is not None:
        t0 = timeframe_start or 0.0
        t1 = timeframe_end if timeframe_end is not None else float("inf")
        before = len(segments)
        segments = [s for s in segments if s["end"] > t0 and s["start"] < t1]
        log(job_id, f"  Timeframe {t0:.0f}s-{t1 if t1 != float('inf') else 'end'}s: {before} → {len(segments)} segments")
        if not segments:
            log(job_id, "  Timeframe excluded every segment — falling back to full transcript")
            return []

    # Build transcript lines, marking segments inside high-energy windows so
    # the LLM weighs audible/visual excitement it can't hear from text alone.
    _hot = (excitement or {}).get("hot") or []

    def _is_hot(mid: float) -> bool:
        return any(a <= mid < b for a, b in _hot)

    transcript_lines = []
    for seg in segments:
        _tag = "[HIGH ENERGY] " if _hot and _is_hot((seg["start"] + seg["end"]) / 2) else ""
        transcript_lines.append(f"[{seg['start']:.1f}s - {seg['end']:.1f}s] {_tag}{seg['text']}")

    # Chunk size is sized for the CURRENT model, not the original Ollama-era
    # 3,000 chars (that relic made a 3h video 75+ sequential LLM calls — fine
    # when a rate-limit-free primary answered in ~5s each, a 48-minute crawl
    # on Groq free-tier pacing). gpt-oss-120b has 128k context; ~24k chars
    # (~6k tokens) per chunk turns 75 calls into ~10 with the same total
    # tokens and far fewer rate-limit round-trips.
    CHUNK_SIZE = int(os.getenv("ANALYSIS_CHUNK_CHARS", "24000") or "24000")
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

    _analysis_provider = f"Groq ({GROQ_ANALYSIS_MODEL})"
    log(job_id, f"Transcript split into {len(chunks)} chunk(s) for {_analysis_provider} analysis")
    for chunk_idx, transcript_text in enumerate(chunks):
        # analyzing: 66-77 spread across chunks
        analysis_progress = 66 + int((chunk_idx / len(chunks)) * 11)
        log(job_id, f"Sending chunk {chunk_idx+1}/{len(chunks)} to {_analysis_provider} ({len(transcript_text)} chars)...")
        await update_job(job_id, progress=analysis_progress, message=f"AI analyzing part {chunk_idx+1}/{len(chunks)}...")

        _find = (style_prompt or "").strip()
        _excl = (exclude_prompt or "").strip()
        focus_line = ""
        if _find:
            focus_line += (f"\nUSER REQUEST — find ALL moments about: {_find}. "
                           f"Rank matching moments by virality; prefer relevance to this request over generic virality.\n")
        if _excl:
            focus_line += (f"\nHARD EXCLUDE — never return moments about: {_excl}. "
                           f"If a candidate touches an excluded topic, drop it entirely.\n")
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
- "scores": object {{"hook": 0-99, "flow": 0-99, "value": 0-99, "trend": 0-99}} where
  hook = how hard the first 3 seconds grab attention; flow = does it hold attention
  start to finish with a resolution; value = payoff/insight/emotion delivered;
  trend = shareability and topicality
- "reason": 1-sentence explanation of why this will perform well
- "tags": array of 3 relevant hashtag strings (without #)
- "keywords": array of 3-6 single words copied VERBATIM from the transcript inside
  this clip's time range — the most emphatic, emotional, or high-stakes words
  (these get color-highlighted in the burned-in captions)
- "emojis": array of up to 4 objects {{"word": <a verbatim transcript word>, "emoji": <ONE common emoji>}}
  pairing an emotional moment's word with a fitting emoji (shown near the captions)

Return valid JSON array only, no markdown, no explanation."""

        async def _call_groq(temp=0.3):
            def _sync(t=temp):
                client = Groq(api_key=get_groq_key())
                r = client.chat.completions.create(
                    model=GROQ_ANALYSIS_MODEL,
                    messages=[{"role": "user", "content": prompt}],
                    temperature=t,
                    # Sized with ANALYSIS_CHUNK_CHARS: each ~24k-char chunk can
                    # legitimately yield several full clip objects of JSON.
                    max_tokens=4000,
                )
                return r.choices[0].message.content.strip()
            return await groq_with_retry(
                lambda t=temp: asyncio.to_thread(lambda: _sync(t)),
                limiter=llama_limiter,
                log_fn=lambda m: log(job_id, m),
            )

        async def _call_analysis(temp=0.3):
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

    # Normalize scoring: the LLM returns 4 subscores 0-99 (hook/flow/value/trend);
    # the weighted total is computed HERE, never trusted from the model. The
    # legacy 1-10 virality_score is shadow-written so every old consumer (UI
    # badges, upload descriptions, saved jobs) keeps working; if a fallback
    # model ignored the new schema, subscores are synthesized from the legacy
    # field so the UI always has something coherent to show.
    for c in all_clips:
        s = c.get("scores")
        if isinstance(s, dict):
            def _g(k):
                try:
                    return max(0, min(99, int(float(s.get(k, 0)))))
                except Exception:
                    return 0
            hook, flow, value, trend = _g("hook"), _g("flow"), _g("value"), _g("trend")
        else:
            try:
                legacy = max(1, min(10, int(float(c.get("virality_score", 5)))))
            except Exception:
                legacy = 5
            hook = flow = value = trend = legacy * 10 - 5
        c["scores"] = {"hook": hook, "flow": flow, "value": value, "trend": trend}
        c["score"] = round(0.40 * hook + 0.20 * flow + 0.25 * value + 0.15 * trend)
        c["virality_score"] = max(1, min(10, round(c["score"] / 10)))

    # Sort by the 0-99 score and take top max_clips
    all_clips.sort(key=lambda x: x.get("score", 0), reverse=True)
    clips = all_clips[:max_clips]
    log(job_id, f"Top {len(clips)} clips selected (scores: {[c.get('score') for c in clips]})")

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
        # Caption emoji: keep only pairs whose emoji exists in the bundled
        # Twemoji whitelist (the LLM free-associates; we only render curated).
        emo = c.get("emojis")
        cleaned = []
        if isinstance(emo, list):
            for item in emo:
                if isinstance(item, dict) and item.get("word") and _emoji_file(str(item.get("emoji", ""))):
                    cleaned.append({"word": str(item["word"]).strip(), "emoji": str(item["emoji"]).strip()})
        c["emojis"] = cleaned[:4]
        valid.append(c)

    # Low-dialogue fallback: when there's barely any speech (gameplay, sports,
    # vlogs) the transcript can't fill the quota — synthesize candidates from
    # the top non-overlapping excitement peaks instead of returning nothing.
    if excitement and len(valid) < max_clips:
        dur_total = excitement.get("duration") or 0
        # Coverage and peaks are evaluated WITHIN the analyzed window: with a
        # user timeframe, `segments` is already filtered, so dividing by the
        # whole video length would make any talky video look low-dialogue and
        # spuriously trigger this fallback (with peaks outside the timeframe).
        win_start = timeframe_start or 0.0
        win_end = min(timeframe_end, dur_total) if timeframe_end is not None else dur_total
        win_dur = max(0.0, win_end - win_start)
        speech = sum(s["end"] - s["start"] for s in segments)
        coverage = speech / win_dur if win_dur > 0 else 1.0
        if win_dur > 120 and coverage < 0.4:
            added = 0
            for peak_start, peak_score in excitement.get("peaks") or []:
                if len(valid) >= max_clips:
                    break
                if not (win_start <= peak_start < win_end):
                    continue
                start = max(win_start, peak_start - (target_dur - 5) / 2)
                end = min(win_end, start + target_dur)
                if end - start < min_dur:
                    continue
                if any(c["start"] < end and start < c["end"] for c in valid):
                    continue
                # Title from whatever was said inside the window, if anything —
                # a generic label only as the last resort. The _spoken text is
                # kept temporarily so the describe pass below can ground its
                # titles/hooks in real dialogue.
                spoken = " ".join(s["text"].strip() for s in segments
                                  if s["start"] < end and s["end"] > start).strip()
                if spoken:
                    title_words = spoken.split()[:7]
                    title = " ".join(title_words) + ("…" if len(spoken.split()) > 7 else "")
                else:
                    title = f"High-Energy Moment #{added + 1}"
                base = max(40, min(75, int(55 + peak_score * 10)))
                valid.append({
                    "start": round(start, 1), "end": round(end, 1),
                    "title": title,
                    "hook": "",
                    "scores": {"hook": base, "flow": base - 5, "value": base - 5, "trend": base},
                    "score": base - 3,
                    "virality_score": max(1, min(10, round(base / 10))),
                    "reason": "Low-dialogue section — selected by audio/visual energy.",
                    "tags": ["shorts", "clips", "viral"],
                    "keywords": [], "emojis": [],
                    "_spoken": spoken,
                    "_energy": True,
                })
                added += 1
            if added:
                log(job_id, f"  Low-dialogue fallback: added {added} energy-based clips (speech coverage {coverage:.0%})")
                await _describe_energy_clips(valid, job_id)
    for c in valid:
        c.pop("_spoken", None)
        c.pop("_energy", None)

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

# ── caption emoji (Twemoji PNG overlays) ──────────────────────────────────────
# libass can't render colour emoji, so emoji are composited as timed PNG
# overlays in a post-pass after the clip renders. Only the curated set bundled
# in assets/emoji ships — anything else the LLM suggests is silently dropped.
_EMOJI_DIR = Path(__file__).parent / "assets" / "emoji"


def _emoji_file(emoji: str) -> Optional[Path]:
    """Path to the bundled Twemoji PNG for an emoji string, or None if it isn't
    in the curated set. Tries the fe0f-stripped codepoint name first (Twemoji's
    usual convention), then the full sequence."""
    if not emoji:
        return None
    emoji = emoji.strip()
    cps = [ord(c) for c in emoji]
    stripped = "-".join(f"{c:x}" for c in cps if c != 0xFE0F)
    full = "-".join(f"{c:x}" for c in cps)
    for name in (stripped, full):
        if name:
            p = _EMOJI_DIR / f"{name}.png"
            if p.exists():
                return p
    return None


def _emoji_placements(emojis: list, cap_info: dict, render_dur: float) -> list:
    """Map the LLM's {word, emoji} pairs onto caption-line display windows.
    Returns [(png_path, x, y, size, t0, t1)], max one emoji per caption line,
    max 8 per clip. Lines whose window falls outside the clip are skipped."""
    placements, used_lines = [], set()
    esz = cap_info["emoji_size"]
    x = (cap_info["video_width"] - esz) // 2
    y = cap_info["emoji_y"]
    for item in emojis or []:
        png = _emoji_file(item.get("emoji", ""))
        if not png:
            continue
        target = item.get("word", "").strip().strip(".,!?\"'").lower()
        if not target:
            continue
        for li, line in enumerate(cap_info.get("lines", [])):
            if li in used_lines or target not in line["words"]:
                continue
            t0, t1 = line["start"], min(line["end"], render_dur)
            if t1 - t0 >= 0.2 and t0 < render_dur:
                placements.append((png, x, y, esz, round(t0, 3), round(t1, 3)))
                used_lines.add(li)
            break
        if len(placements) >= 8:
            break
    return placements


async def _apply_emoji_overlays(clip_path: Path, placements: list, job_id: str) -> None:
    """Post-pass: composite timed emoji PNGs onto the rendered clip. A separate
    pass (not part of the main filtergraph) so it works identically for every
    layout; only runs when a clip actually has emoji, and failure is non-fatal."""
    if not placements:
        return
    tmp = clip_path.with_name(clip_path.stem + "_emoji.mp4")
    cmd = [FFMPEG, "-y", "-i", str(clip_path)]
    for png, *_ in placements:
        cmd += ["-i", str(png)]
    fc, prev = [], "0:v"
    for i, (_png, x, y, esz, t0, t1) in enumerate(placements):
        fc.append(f"[{i + 1}:v]scale={esz}:{esz}[e{i}]")
        out = f"v{i}"
        fc.append(f"[{prev}][e{i}]overlay={x}:{y}:enable='between(t,{t0},{t1})'[{out}]")
        prev = out
    cmd += ["-filter_complex", ";".join(fc), "-map", f"[{prev}]", "-map", "0:a?",
            "-c:v", "libx264", "-preset", "fast", "-crf", "20",
            "-c:a", "copy", "-movflags", "+faststart", str(tmp)]
    code, _, err = await run_cmd_async(cmd)
    if code == 0 and tmp.exists() and tmp.stat().st_size > 0:
        tmp.replace(clip_path)
        log(job_id, f"  Emoji overlay: {len(placements)} placed")
    else:
        tmp.unlink(missing_ok=True)
        log(job_id, f"  Emoji overlay skipped (ffmpeg exit {code}): {err[-200:] if err else ''}")

async def _apply_watermark(clip_path: Path, brand: dict, out_w: int, out_h: int,
                           job_id: str) -> None:
    """Post-pass: composite the user's brand logo onto the rendered clip —
    same pattern as the emoji pass so it works identically for every layout.
    brand = {"logo": Path, "position": tl|tr|bl|br, "opacity": float, "size": float}.
    Failure is non-fatal (the clip ships without the watermark)."""
    logo = brand.get("logo")
    if not logo or not Path(logo).exists():
        return
    w = max(24, int(out_w * float(brand.get("size") or 0.15)))
    op = min(1.0, max(0.05, float(brand.get("opacity") or 0.5)))
    m = max(12, int(out_w * 0.03))
    pos = {"tl": f"{m}:{m}", "tr": f"W-w-{m}:{m}",
           "bl": f"{m}:H-h-{m}", "br": f"W-w-{m}:H-h-{m}"}.get(brand.get("position") or "br", f"W-w-{m}:H-h-{m}")
    tmp = clip_path.with_name(clip_path.stem + "_wm.mp4")
    fc = (f"[1:v]scale={w}:-1,format=rgba,colorchannelmixer=aa={op}[wm];"
          f"[0:v][wm]overlay={pos}[v]")
    cmd = [FFMPEG, "-y", "-i", str(clip_path), "-i", str(logo),
           "-filter_complex", fc, "-map", "[v]", "-map", "0:a?",
           "-c:v", "libx264", "-preset", "fast", "-crf", "20",
           "-c:a", "copy", "-movflags", "+faststart", str(tmp)]
    code, _, err = await run_cmd_async(cmd)
    if code == 0 and tmp.exists() and tmp.stat().st_size > 0:
        tmp.replace(clip_path)
        log(job_id, "  Watermark applied")
    else:
        tmp.unlink(missing_ok=True)
        log(job_id, f"  Watermark skipped (ffmpeg exit {code}): {err[-200:] if err else ''}")


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
# fontsdir for the libass filter — single-quoted for spaces AND colon-escaped
# for the Windows drive letter; both are needed for the filtergraph parser.
_FONTSDIR_ESC = "'" + str(FONTS_DIR).replace("\\", "/").replace(":", "\\:") + "'"


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

    # Caption geometry for the emoji overlay post-pass: where an emoji should
    # sit relative to the caption block, plus each caption line's display
    # window (clip-relative) and raw words.
    _esz = int(tpl.font_size * 1.2)
    if tpl.alignment in (7, 8, 9):        # top block → emoji below it
        _emoji_y = tpl.margin_v + int(tpl.font_size * 1.5) + 12
    elif tpl.alignment in (4, 5, 6):      # middle block → emoji above centre
        _emoji_y = video_height // 2 - int(tpl.font_size * 0.75) - _esz - 12
    else:                                  # bottom block → emoji above it
        _emoji_y = video_height - tpl.margin_v - int(tpl.font_size * 1.25) - _esz - 12
    cap_info = {"lines": [], "emoji_size": _esz,
                "emoji_y": max(0, _emoji_y), "video_width": video_width}

    # "none" template: header-only ASS — every render graph keeps its ass=
    # filter unchanged, libass just has nothing to draw.
    if tpl.mode == "none":
        output_path.write_text(ass_header, encoding="utf-8")
        return cap_info

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
        cap_info["lines"].append({
            "start": max(0.0, line_start - clip_start),
            "end": max(0.0, line_end - clip_start),
            "words": [w["word"].strip().strip(".,!?\"'").lower() for w in group],
        })

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
    return cap_info


# ── smart speaker-tracking crop ───────────────────────────────────────────────

def _select_crop_center(cands: list, crop_w: int, state: dict) -> Optional[float]:
    """Pick this sample's crop-centre x from person candidates
    [(cx, area, head_motion), ...]. Pure function; `state` carries the sticky
    target across samples ({target, chall, chall_n}).

    Three stages, designed against the ping-pong/edge-hijack failure mode:
    1. OUTLIER TRIM — drop candidates far from the area-weighted median cx, so
       a lone straggler at the frame edge can't hijack the crop away from the
       main cluster of people.
    2. GROUP mode — if the surviving cluster fits inside the crop, return its
       area-weighted centroid. Nobody is "chosen", so there is nothing to
       ping-pong between: the camera holds the action's centre of mass.
    3. SPEAKER mode — subjects too far apart to frame together: sticky lock.
       Candidates score on motion+area+continuity, and a challenger must win
       3 CONSECUTIVE samples (~1.5s) before the camera moves; meanwhile the
       incumbent's own drift is still tracked.
    """
    if not cands:
        return None

    # 1. Outlier trim around the area-weighted median cx. Only applied when a
    #    real MAJORITY cluster remains (≥55% of person area, ≥2 candidates in
    #    a 3+ crowd) — trimming a 2-person wide shot would just delete whoever
    #    loses the median tiebreak, hiding the other speaker forever.
    cands = sorted(cands, key=lambda c: c[0])
    total_area = sum(c[1] for c in cands) or 1.0
    kept = cands
    if len(cands) >= 3:
        acc, wmedian = 0.0, cands[-1][0]
        for cx, area, _ in cands:
            acc += area
            if acc >= total_area / 2:
                wmedian = cx
                break
        trimmed = [c for c in cands if abs(c[0] - wmedian) <= 0.45 * crop_w]
        if trimmed and sum(c[1] for c in trimmed) >= 0.55 * total_area:
            kept = trimmed

    # 2. GROUP mode: cluster fits in the crop → weighted centroid
    spread = kept[-1][0] - kept[0][0]
    # Record the cluster spread regardless of branch — the fill layout uses the
    # distribution to decide auto zoom-out (wide crop + blur bars) for group
    # scenes that never quite fit a tight 9:16 window.
    state.setdefault("spreads", []).append(spread)
    if len(kept) == 1 or spread <= 0.75 * crop_w:
        tw = sum(c[1] for c in kept) or 1.0
        center = sum(c[0] * c[1] for c in kept) / tw
        state["target"] = center
        state["chall"], state["chall_n"] = None, 0
        return center

    # 3. SPEAKER mode: sticky lock with challenger persistence
    target = state.get("target")
    max_m = max((c[2] for c in kept), default=0.0) or 1.0
    max_a = max((c[1] for c in kept), default=0.0) or 1.0

    def _score(c):
        s = 0.40 * (c[2] / max_m) + 0.35 * (c[1] / max_a)
        if target is not None:
            s += 0.25 * (1.0 - min(1.0, abs(c[0] - target) / max(1.0, float(crop_w))))
        return s

    best = max(kept, key=_score)
    if target is None:
        state["target"] = best[0]
        return best[0]
    if abs(best[0] - target) <= 0.30 * crop_w:
        state["target"] = best[0]                      # incumbent drifting — follow
        state["chall"], state["chall_n"] = None, 0
        return best[0]
    # A far-away challenger: count consecutive wins before conceding the lock.
    if state.get("chall") is not None and abs(best[0] - state["chall"]) <= 0.30 * crop_w:
        state["chall_n"] = state.get("chall_n", 0) + 1
        state["chall"] = best[0]
    else:
        state["chall"], state["chall_n"] = best[0], 1
    if state["chall_n"] >= 3:
        state["target"] = best[0]
        state["chall"], state["chall_n"] = None, 0
        return best[0]
    # Not yet — keep following the incumbent (their nearest candidate).
    near = min(kept, key=lambda c: abs(c[0] - target))
    if abs(near[0] - target) <= 0.30 * crop_w:
        state["target"] = near[0]
        return near[0]
    return target


def _yolo_sample_positions_sequential(clip_path: Path, src_w: int, src_h: int,
                                      stats: Optional[dict] = None) -> list:
    """
    Sample frames SEQUENTIALLY from a pre-extracted clip (no random seeking).
    Sequential reading is reliable across all codecs; time-based seeking in the
    source video can silently land on wrong/corrupt frames for yt-dlp merges.
    Returns [(rel_time, crop_x), ...] compatible with smooth_crop_trajectory.
    If `stats` is passed, it is filled with "spreads" (per-sample person-cluster
    widths) and "centers" ([(t, cx), ...] raw centres) so the caller can re-derive
    crop positions for a different (wider) crop window.
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
    sel_state: dict = {}   # sticky-target state for _select_crop_center

    while True:
        ret, frame = cap.read()
        if not ret:
            break
        if frame_idx % sample_every == 0:
            is_speech = (speech_threshold == 0.0) or (frame_idx < len(rms) and rms[frame_idx] >= speech_threshold)
            if is_speech:
                frames_tried += 1
                cands = _person_candidates(frame, prev_frame, model)
                cx = _select_crop_center(cands, crop_w, sel_state)
                if cx is not None:
                    t = frame_idx / fps
                    crop_x = max(0, min(int(cx - crop_w / 2), src_w - crop_w))
                    results.append((round(t, 3), crop_x))
                    if stats is not None:
                        stats.setdefault("centers", []).append((round(t, 3), float(cx)))
            prev_frame = frame  # update regardless so motion diff stays consistent
        frame_idx += 1

    cap.release()
    if stats is not None:
        stats["spreads"] = sel_state.get("spreads", [])
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
    # Adaptive hysteresis: each switch inside a rolling window raises the hold
    # required for the next one — a hard physical bound on ping-ponging even
    # when the detections themselves flip-flop.
    recent_switches: list = []   # timestamps of switches in the last window
    SWITCH_WINDOW_S = 12.0
    HOLD_GROWTH = 1.8
    HOLD_CAP_S = 4.0

    for t, centered_x in filtered[1:]:
        desired = _clamp(centered_x)
        delta = abs(desired - current_x)
        if delta <= micro_dead:
            kf.append((round(t, 3), current_x, False))          # hold — kills jitter
        elif delta <= switch_threshold:
            current_x = desired                                  # same speaker drifting — track
            kf.append((round(t, 3), current_x, False))
        else:
            # Different speaker — the hold requirement grows with every recent
            # switch, so back-and-forth cutting gets progressively harder.
            recent_switches = [s for s in recent_switches if t - s <= SWITCH_WINDOW_S]
            hold_needed = min(HOLD_CAP_S, min_hold_s * (HOLD_GROWTH ** len(recent_switches)))
            if (t - last_switch_t) >= hold_needed:
                current_x = desired
                last_switch_t = t
                recent_switches.append(t)
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


def _yunet_detector():
    """A YuNet face detector instance, or None if unavailable."""
    if not _REFRAME_AVAILABLE or not _YUNET_PATH.exists():
        return None
    try:
        import cv2 as _cv2
        return _cv2.FaceDetectorYN_create(
            str(_YUNET_PATH), "", (320, 320),
            score_threshold=0.6, nms_threshold=0.3, top_k=50)
    except Exception as e:
        print(f"[facecam] YuNet unavailable: {e}", flush=True)
        return None


def _detect_face_clusters(video_path: Path, src_w: int, src_h: int,
                          duration: float, n_samples: int = 48,
                          t0: Optional[float] = None,
                          t1: Optional[float] = None) -> tuple:
    """Sample frames across the video — or just the [t0, t1] window when given
    (per-clip auto layout) — and cluster EVERY detected face by position.
    Returns (clusters, n_ok) where each cluster is
    {"fcx","fcy","fw","fh","hits","frames"} (frames = set of sample indices the
    cluster appeared in, for co-presence checks), sorted most-persistent first.
    Shared by the facecam-region detector (small persistent face = webcam) and
    the split layout (two co-present faces = two speakers)."""
    face_det = _yunet_detector()
    if face_det is None:
        return [], 0
    import cv2 as _cv2
    import statistics as _st

    cap = _cv2.VideoCapture(str(video_path))
    fps = cap.get(_cv2.CAP_PROP_FPS) or 30.0
    if duration <= 0:
        cnt = cap.get(_cv2.CAP_PROP_FRAME_COUNT) or 0
        duration = cnt / fps if fps else 0.0
    win_a = max(0.0, t0) if t0 is not None else 0.0
    win_b = min(duration, t1) if t1 is not None else duration
    span = max(0.0, win_b - win_a)
    n = max(8, n_samples)
    hits, n_ok = [], 0
    for i in range(n):
        t = win_a + span * (i + 0.5) / n if span > 0 else 0.0
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
        found = [] if faces is None else [
            [float(f[0]), float(f[1]), float(f[2]), float(f[3])]
            for f in faces if f[2] > 0 and f[3] > 0]
        # Recall boost: wide two-shots and tiny corner cams often yield 0-1
        # detections at native res (YuNet misses small faces) — measured on JRE
        # 720p wide shots: ~1 of 2 hosts found per frame, killing co-presence.
        # Retry on a 2x upscale and merge (dedup against the first pass).
        if len(found) < 2 and max(frame.shape[:2]) <= 1440:
            try:
                up = _cv2.resize(frame, None, fx=2.0, fy=2.0,
                                 interpolation=_cv2.INTER_CUBIC)
                face_det.setInputSize((up.shape[1], up.shape[0]))
                _c2, faces2 = face_det.detect(up)
                for f2 in (faces2 if faces2 is not None else []):
                    g = [float(f2[0]) / 2, float(f2[1]) / 2, float(f2[2]) / 2, float(f2[3]) / 2]
                    if g[2] <= 0 or g[3] <= 0:
                        continue
                    dup = any(abs((g[0] + g[2] / 2) - (f[0] + f[2] / 2)) < max(g[2], f[2])
                              and abs((g[1] + g[3] / 2) - (f[1] + f[3] / 2)) < max(g[3], f[3])
                              for f in found)
                    if not dup:
                        found.append(g)
            except Exception:
                pass
        for f in found:
            fw, fh = int(f[2]), int(f[3])
            if fw <= 0 or fh <= 0:
                continue
            hits.append((i, f[0] + fw / 2.0, f[1] + fh / 2.0, fw, fh))
    cap.release()

    if not hits:
        return [], n_ok
    # Greedy centroid clustering (replaces the old fixed 8% grid, which
    # fragmented one moving person into many single-cell "clusters" — a 4-person
    # gym video measured 44 clusters). Radius scales with the face itself, so a
    # tiny webcam face clusters tightly while a large moving subject can drift.
    clusters = []

    def _radius(fw):
        return max(fw * 1.2, src_w * 0.05)

    for h in hits:
        _, cx, cy, fw, fh = h
        best, best_d = None, None
        for c in clusters:
            d = ((cx - c["_sx"] / c["hits"]) ** 2 + (cy - c["_sy"] / c["hits"]) ** 2) ** 0.5
            if d <= _radius(max(fw, c["_sw"] / c["hits"])) and (best_d is None or d < best_d):
                best, best_d = c, d
        if best is None:
            clusters.append({"_m": [h], "_sx": cx, "_sy": cy, "_sw": fw, "hits": 1})
        else:
            best["_m"].append(h)
            best["_sx"] += cx; best["_sy"] += cy; best["_sw"] += fw
            best["hits"] += 1

    # Agglomerative merge pass: greedy assignment can still leave two halves of
    # one wandering subject; fold clusters whose centroids overlap.
    merged = True
    while merged and len(clusters) > 1:
        merged = False
        for i in range(len(clusters)):
            for j in range(i + 1, len(clusters)):
                a, b = clusters[i], clusters[j]
                ax, ay = a["_sx"] / a["hits"], a["_sy"] / a["hits"]
                bx, by = b["_sx"] / b["hits"], b["_sy"] / b["hits"]
                r = _radius(max(a["_sw"] / a["hits"], b["_sw"] / b["hits"]))
                if ((ax - bx) ** 2 + (ay - by) ** 2) ** 0.5 <= r:
                    a["_m"] += b["_m"]
                    a["_sx"] += b["_sx"]; a["_sy"] += b["_sy"]; a["_sw"] += b["_sw"]
                    a["hits"] += b["hits"]
                    del clusters[j]
                    merged = True
                    break
            if merged:
                break

    out = []
    for c in clusters:
        m = c["_m"]
        xs = [v[1] for v in m]; ys = [v[2] for v in m]
        mx, my = float(_st.median(xs)), float(_st.median(ys))
        fw_med = int(_st.median(v[3] for v in m))
        # Stability stats: a webcam overlay is pinned (near-zero drift, constant
        # size); a person in the scene drifts and scales. Median-based so a few
        # stray detections merged into the cluster can't inflate the spread
        # (reaction videos: content faces near the cam corner did exactly that).
        pos_std = float(_st.median(((x - mx) ** 2 + (y - my) ** 2) ** 0.5
                                   for x, y in zip(xs, ys)))
        sizes = [v[3] for v in m]
        size_std = float(_st.median(abs(s - fw_med) for s in sizes)) if len(sizes) > 1 else 0.0
        out.append({
            "fcx": mx, "fcy": my,
            "fw": fw_med,
            "fh": int(_st.median(v[4] for v in m)),
            "hits": len(m),
            "frames": {v[0] for v in m},
            "pos_std": pos_std,
            "size_std": size_std,
        })
    out.sort(key=lambda c: c["hits"], reverse=True)
    return out, n_ok


def _pick_split_speakers(clusters: list, n_ok: int, src_w: int) -> Optional[list]:
    """Two co-present speaker faces for the Split layout, left-first, or None.
    Requirements (Opus has the same co-presence constraint): both faces
    persistent, both in the SAME frames often enough (two clusters that never
    co-occur are one person who moved seats), horizontally separated, and of
    comparable size."""
    if n_ok == 0:
        return None
    # Seated podcast hosts are persistent AND positionally stable; people moving
    # through a scene (gym/action crowds) are excluded by the drift guard so the
    # merged clusters of two movers can never masquerade as a two-shot.
    cands = [c for c in clusters
             if c["hits"] >= max(3, int(0.35 * n_ok))
             and c.get("pos_std", 0.0) < src_w * 0.05]
    from itertools import combinations
    total_ev = sum(c["hits"] for c in clusters) or 1
    for a, b in combinations(cands[:6], 2):
        co_present = len(a["frames"] & b["frames"])
        if co_present < 0.3 * n_ok:
            continue
        if abs(a["fcx"] - b["fcx"]) < 0.22 * src_w:
            continue
        area_a, area_b = a["fw"] * a["fh"], b["fw"] * b["fh"]
        if max(area_a, area_b) > 2.5 * max(1, min(area_a, area_b)):
            continue
        # Pair dominance: in a real two-shot the two hosts ARE the video's face
        # evidence. A crowd (gym: 4 movers → 24 fragment clusters) can produce
        # two stable-looking fragments, but they own a sliver of the total.
        if a["hits"] + b["hits"] < 0.55 * total_ev:
            continue
        return sorted([a, b], key=lambda c: c["fcx"])
    return None


def _facecam_region_from_clusters(clusters: list, n_ok: int,
                                  src_w: int, src_h: int) -> Optional[dict]:
    """Pick the webcam from pre-computed face clusters: the persistent SMALL
    face (a large face is the main subject, not a cam) that is also ANCHORED —
    a real cam overlay is pinned in place with a constant size, while a person
    who happens to linger near a corner (gym crowds!) drifts and scales."""
    if n_ok == 0:
        return None
    frame_area = src_w * src_h
    small = [c for c in clusters
             if c["fw"] * c["fh"] < frame_area * 0.08
             and c["hits"] >= max(3, int(0.20 * n_ok))
             and c.get("pos_std", 0.0) < src_w * 0.03
             and c.get("size_std", 0.0) < max(4.0, c["fw"] * 0.35)]
    if not small:
        return None
    best = small[0]
    fcx, fcy, mfw, mfh = best["fcx"], best["fcy"], best["fw"], best["fh"]
    bw, bh = int(mfw * 2.4), int(mfh * 3.0)
    bx = int(max(0, min(fcx - bw / 2, src_w - bw)))
    by = int(max(0, min(fcy - bh * 0.40, src_h - bh)))
    return {"box": (bx, by, min(bw, src_w), min(bh, src_h)),
            "fw": mfw, "fh": mfh, "fcx": float(fcx), "fcy": float(fcy)}


def _detect_facecam_region(video_path: Path, src_w: int, src_h: int,
                           duration: float, n_samples: int = 48) -> Optional[dict]:
    """Find the streamer's webcam ONCE for the whole video by sampling frames
    spread across it, so every clip uses the same cam and splits consistently.

    Returns {"box": (x,y,w,h), "fw": int, "fh": int, "fcx": float, "fcy": float}
    or None. Face-primary: the persistent small face across the video = the cam.
    """
    clusters, n_ok = _detect_face_clusters(video_path, src_w, src_h, duration, n_samples)
    return _facecam_region_from_clusters(clusters, n_ok, src_w, src_h)


def _probe_motion_edges(video_path: Path, duration: float,
                        exclude_box: Optional[tuple] = None,
                        n_samples: int = 24,
                        t0: Optional[float] = None,
                        t1: Optional[float] = None) -> tuple:
    """Motion + edge statistics of the non-cam region, for the auto-layout
    discriminator — over the whole video or just the [t0, t1] window when
    given (per-clip auto). Samples are ~seconds apart, computed on ~320px
    grayscale: slides/code barely change between samples and are edge-dense;
    gameplay and camera footage change a lot. Returns (motion, edge_density)
    on a 0-255-ish scale, or (None, None) if unreadable."""
    try:
        import cv2 as _cv2
        import numpy as _np
    except ImportError:
        return None, None
    cap = _cv2.VideoCapture(str(video_path))
    fps = cap.get(_cv2.CAP_PROP_FPS) or 30.0
    if duration <= 0:
        cnt = cap.get(_cv2.CAP_PROP_FRAME_COUNT) or 0
        duration = cnt / fps if fps else 0.0
    win_a = max(0.0, t0) if t0 is not None else 0.0
    win_b = min(duration, t1) if t1 is not None else duration
    span = max(0.0, win_b - win_a)
    frames = []
    for i in range(max(8, n_samples)):
        t = win_a + span * (i + 0.5) / max(8, n_samples) if span > 0 else 0.0
        cap.set(_cv2.CAP_PROP_POS_MSEC, t * 1000.0)
        ret, frame = cap.read()
        if not ret:
            continue
        h, w = frame.shape[:2]
        if exclude_box:
            bx, by, bw, bh = exclude_box
            frame = frame.copy()
            frame[max(0, by):by + bh, max(0, bx):bx + bw] = 0
        small = _cv2.resize(frame, (320, max(2, int(320 * h / w))))
        frames.append(_cv2.cvtColor(small, _cv2.COLOR_BGR2GRAY).astype(_np.float32))
    cap.release()
    if len(frames) < 2:
        return None, None
    diffs = [float(_np.mean(_np.abs(frames[i + 1] - frames[i]))) for i in range(len(frames) - 1)]
    motion = float(_np.median(diffs))
    edges = float(_np.median([_np.mean(_np.abs(_cv2.Laplacian(f, _cv2.CV_32F))) for f in frames]))
    return motion, edges


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


# Vocal fillers that are safe to cut unconditionally. Deliberately conservative:
# no "like"/"you know"/"I mean" — those carry meaning often enough that cutting
# them by string match butchers real sentences.
_FILLER_WORDS = {"um", "uh", "umm", "uhh", "uhm", "erm", "er", "ehm", "hmm", "hm", "mmm"}


def _filler_cut_intervals(segments: list, clip_start: float, clip_end: float,
                          pad: float = 0.04) -> list:
    """Clip-relative (start, end) spans of filler words inside the clip window,
    slightly padded so the cut doesn't clip neighbouring phonemes."""
    dur = clip_end - clip_start
    cuts = []
    for seg in segments or []:
        for w in _fill_words(seg):
            word = str(w["word"]).strip().lower().strip(".,!?;:…\"'")
            if word not in _FILLER_WORDS:
                continue
            ws, we = float(w["start"]), float(w["end"])
            if we <= clip_start or ws >= clip_end:
                continue
            a = max(0.0, ws - clip_start - pad)
            b = min(dur, we - clip_start + pad)
            if b - a >= 0.08:
                cuts.append((a, b))
    return cuts


def _subtract_intervals(keep: list, cuts: list) -> list:
    """Remove `cuts` from `keep` (both [(a, b)] lists); drops slivers <0.15s.
    Used to strip filler words out of whatever keep-set is already in play
    (full clip, silence-trimmed, or user-authored editor cuts)."""
    if not cuts:
        return keep
    merged_cuts = _normalize_keep([[a, b] for a, b in cuts])
    out = []
    for ka, kb in keep:
        cursor = ka
        for ca, cb in merged_cuts:
            if cb <= cursor or ca >= kb:
                continue
            if ca > cursor:
                out.append((cursor, min(ca, kb)))
            cursor = max(cursor, cb)
            if cursor >= kb:
                break
        if cursor < kb:
            out.append((cursor, kb))
    return [(a, b) for a, b in out if b - a >= 0.15]


def _normalize_keep(keep: list, source_dur: Optional[float] = None) -> list:
    """Sanitize user keep-intervals: coerce to floats, clamp, sort, merge
    overlaps/adjacent (<0.05s gap), drop slivers. Returns [(a, b), ...]."""
    ivals = []
    for pair in (keep or []):
        try:
            a, b = float(pair[0]), float(pair[1])
        except (TypeError, ValueError, IndexError):
            continue
        if source_dur is not None:
            a, b = max(0.0, min(a, source_dur)), max(0.0, min(b, source_dur))
        if b - a >= 0.25:
            ivals.append((a, b))
    ivals.sort()
    merged: list = []
    for a, b in ivals:
        if merged and a - merged[-1][1] < 0.05:
            merged[-1] = (merged[-1][0], max(merged[-1][1], b))
        else:
            merged.append((a, b))
    return merged


def _group_sentences(segments: list, t0: Optional[float] = None,
                     t1: Optional[float] = None) -> list:
    """Group transcript words into sentence-ish units for the clip editor:
    split on terminal punctuation or a speech gap >0.8s, cap 15s per sentence.
    Returns [{start, end, text, words: [{word, start, end}]}] within [t0, t1)."""
    out, cur = [], []

    def _flush():
        if cur:
            out.append({
                "start": round(cur[0]["start"], 3),
                "end": round(cur[-1]["end"], 3),
                "text": " ".join(w["word"].strip() for w in cur),
                "words": [dict(w) for w in cur],
            })
            cur.clear()

    for seg in segments or []:
        for w in _fill_words(seg):
            ws, we = float(w["start"]), float(w["end"])
            if (t1 is not None and ws >= t1) or (t0 is not None and we <= t0):
                continue
            if cur and (ws - cur[-1]["end"] > 0.8 or ws - cur[0]["start"] > 15.0):
                _flush()
            cur.append({"word": str(w["word"]), "start": ws, "end": we})
            if str(w["word"]).strip().endswith((".", "!", "?")):
                _flush()
    _flush()
    return out


def _apply_caption_overrides(segments: list, overrides: list) -> list:
    """Replace the transcript text inside each override's [start, end] window
    with the user's edited text, redistributing word timings across the window
    weighted by word length. Returns NEW segments; the input is not mutated."""
    if not overrides:
        return segments
    windows = []
    for o in overrides:
        try:
            a, b, txt = float(o["start"]), float(o["end"]), str(o.get("text", "")).strip()
        except (TypeError, ValueError, KeyError):
            continue
        if b > a:
            windows.append((a, b, txt))
    if not windows:
        return segments

    # Flatten to words, drop originals inside any window, then inject the
    # edited words as one synthetic segment per window.
    kept_words = []
    for seg in segments or []:
        for w in _fill_words(seg):
            mid = (float(w["start"]) + float(w["end"])) / 2
            if not any(a <= mid <= b for a, b, _ in windows):
                kept_words.append({"word": str(w["word"]), "start": float(w["start"]), "end": float(w["end"])})
    for a, b, txt in windows:
        words = txt.split()
        if not words:
            continue
        weights = [max(1, len(x)) for x in words]
        total_w = sum(weights)
        t = a
        for x, wt in zip(words, weights):
            d = max(0.12, (b - a) * wt / total_w)
            kept_words.append({"word": x, "start": round(t, 3), "end": round(min(b, t + d), 3)})
            t = min(b, t + d)
    kept_words.sort(key=lambda w: w["start"])
    return [{"start": w["start"], "end": w["end"], "text": w["word"], "words": [w]}
            for w in kept_words]


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


# ── excitement signals (for low-dialogue clip selection) ─────────────────────

def _compute_excitement_signals(video_path: Path) -> dict:
    """Per-second audio RMS envelope for the whole video — an audio-only
    decode, takes seconds even for hour-long sources."""
    import numpy as _np
    sr = 8000
    r = subprocess.run([FFMPEG, "-i", str(video_path), "-f", "s16le", "-ac", "1",
                        "-ar", str(sr), "pipe:1"],
                       capture_output=True)
    rms = []
    if r.stdout:
        audio = _np.frombuffer(r.stdout, dtype=_np.int16).astype(_np.float32) / 32768.0
        n = len(audio) // sr
        for i in range(n):
            chunk = audio[i * sr:(i + 1) * sr]
            rms.append(round(float(_np.sqrt(_np.mean(chunk ** 2))), 5))
    return {"rms": rms, "cuts": []}


def _compute_scene_cuts(video_path: Path) -> list:
    """Scene-cut timestamps across the whole video (decoded at 320px for
    speed). Only run for low-dialogue videos, where visual energy has to
    stand in for speech."""
    r = subprocess.run([FFMPEG, "-i", str(video_path),
                        "-vf", "scale=320:-2,select='gt(scene,0.35)',showinfo",
                        "-f", "null", "-"], capture_output=True, text=True)
    return [round(float(m), 3) for m in re.findall(r"pts_time:([0-9.]+)", r.stderr or "")]


def _excitement_windows(signals: dict, win: int = 5) -> Optional[dict]:
    """Score 5s windows by audio-energy spikes + scene-cut density. Returns
    {"hot": [(start, end)...], "peaks": [(start, score) best-first],
    "duration": float} or None if the video is too short/quiet to score."""
    import numpy as _np
    rms = signals.get("rms") or []
    if len(rms) < win * 4:
        return None
    duration = float(len(rms))
    arr = _np.array(rms, dtype=_np.float32)
    n_win = len(arr) // win
    w_rms = arr[:n_win * win].reshape(n_win, win).mean(axis=1)
    cuts = signals.get("cuts") or []
    w_cuts = _np.zeros(n_win, dtype=_np.float32)
    for c in cuts:
        wi = int(c // win)
        if 0 <= wi < n_win:
            w_cuts[wi] += 1.0

    def _z(v):
        s = float(v.std())
        return (v - float(v.mean())) / s if s > 1e-6 else _np.zeros_like(v)

    score = _z(w_rms) + (_z(w_cuts) if w_cuts.any() else 0)
    thresh = max(0.5, float(_np.percentile(score, 90)))
    hot = [(float(i * win), float((i + 1) * win)) for i in range(n_win) if score[i] >= thresh]
    order = _np.argsort(score)[::-1]
    peaks = [(float(int(i) * win), round(float(score[int(i)]), 3)) for i in order[:20] if score[int(i)] >= 0.5]
    return {"hot": hot, "peaks": peaks, "duration": duration}


# ── layout engine ─────────────────────────────────────────────────────────────
# Each layout builder returns a LayoutPlan: a filter_complex ending in [vmain]
# (captions/music/encode are appended generically), plus any extra -i inputs it
# pre-rendered. HARD RULE: at most ONE sendcmd-driven crop per ffmpeg graph —
# sendcmd targets every crop instance in a graph, so dynamic crops that must
# move independently are rendered in separate pre-passes (asserted at dispatch).

@_dataclass
class ClipRenderCtx:
    render_src: Path
    render_ss: float
    render_dur: float
    src_w: int
    src_h: int
    out_w: int
    out_h: int
    crop_w: int
    crop_h: int
    center_crop_x: int
    clip_fps: float
    job_dir: Path
    idx: int
    job_id: str
    reframe: bool
    n_clips: int = 1
    clip_title: str = ""
    facecam_region: Optional[dict] = None
    split_speakers: Optional[list] = None


@_dataclass
class LayoutPlan:
    filter_complex: str                 # ends in [vmain]; no ass/audio yet
    extra_inputs: Optional[list] = None  # file paths appended as -i inputs
    encode_crf: int = 23

    def __post_init__(self):
        if self.extra_inputs is None:
            self.extra_inputs = []


async def _plan_fill(ctx: ClipRenderCtx) -> LayoutPlan:
    """Fill layout: 9:16 crop of the source — YOLO speaker-tracked when
    reframe is on, static center crop otherwise."""
    if ctx.reframe:
        if not _REFRAME_AVAILABLE:
            await update_job(ctx.job_id, message=f"Rendering clip {ctx.idx+1}/{ctx.n_clips}: {ctx.clip_title} (YOLO unavailable — using center crop)")
            detections = []
        else:
            # Extract the clip segment first so YOLO can read frames sequentially
            # (avoids codec seeking bugs in the full downloaded source video).
            # Transcode to H.264 so OpenCV can decode it — AV1 source videos
            # fail silently in OpenCV even though ffmpeg handles them fine.
            # Keep audio so the sampler can gate tracking to actual speech.
            temp_yolo = ctx.job_dir / f"clip_{ctx.idx}_yolo.mp4"
            await run_cmd_async([FFMPEG, "-y", "-ss", str(ctx.render_ss), "-i", str(ctx.render_src),
                                 "-t", str(ctx.render_dur), "-c:v", "libx264", "-preset", "ultrafast",
                                 "-crf", "28", "-c:a", "aac", "-b:a", "64k", str(temp_yolo)])
            track_stats: dict = {}
            detections = await asyncio.to_thread(_yolo_sample_positions_sequential, temp_yolo, ctx.src_w, ctx.src_h, track_stats)
            temp_yolo.unlink(missing_ok=True)
            log(ctx.job_id, f"  YOLO detections: {len(detections)} samples, source: {ctx.src_w}x{ctx.src_h}, crop: {ctx.crop_w}x{ctx.crop_h}")
            if len(detections) == 0:
                await update_job(ctx.job_id, message=f"Rendering clip {ctx.idx+1}/{ctx.n_clips}: {ctx.clip_title} (no person detected — using center crop)")
    else:
        detections = None

    # Auto zoom-out for group scenes: when the people-cluster is persistently
    # wider than the tight 9:16 window, widen the visible crop (up to 1.6x,
    # bounded by the source) and letterbox it over a blurred fill. Solo
    # speakers keep the classic tight crop. FILL_GROUP_ZOOM=0 disables.
    fg_w, fg_scaled_h = ctx.crop_w, ctx.out_h
    if (ctx.reframe and detections and float(os.getenv("FILL_GROUP_ZOOM", "1") or "1")
            and ctx.crop_w < ctx.src_w):
        spreads = sorted(track_stats.get("spreads", []))
        if spreads:
            p70 = spreads[min(len(spreads) - 1, int(0.7 * len(spreads)))]
            if p70 > 0.75 * ctx.crop_w:
                want = int(p70 + 0.35 * ctx.crop_w)
                fg_w = max(ctx.crop_w, min(want, int(1.6 * ctx.crop_w), ctx.src_w))
                fg_w -= fg_w % 2
    if fg_w > ctx.crop_w:
        # Re-derive crop x from the raw centres for the wider window.
        detections = [(t, max(0, min(int(cx - fg_w / 2), ctx.src_w - fg_w)))
                      for t, cx in track_stats.get("centers", [])]
        fg_scaled_h = int(ctx.out_w * ctx.src_h / fg_w); fg_scaled_h -= fg_scaled_h % 2
        log(ctx.job_id, f"  Group zoom-out: crop {ctx.crop_w} → {fg_w}px wide "
                        f"(cluster p70 spread {int(p70)}px), fg height {fg_scaled_h}/{ctx.out_h}")

    if ctx.reframe:
        fallback_x = ctx.center_crop_x if fg_w == ctx.crop_w else (ctx.src_w - fg_w) // 2
        trajectory = smooth_crop_trajectory(detections or [], ctx.render_dur, fallback_crop_x=fallback_x, crop_w=fg_w, src_w=ctx.src_w)
    else:
        trajectory = [(0.0, ctx.center_crop_x), (round(ctx.render_dur, 3), ctx.center_crop_x)]
    is_dynamic = len(set(x for _, x in trajectory)) > 1
    log(ctx.job_id, f"  Crop mode: {'dynamic pan' if is_dynamic else 'static'} (x={trajectory[0][1]})")

    if fg_w > ctx.crop_w:
        # Wide (zoomed-out) group render: tracked wide crop centred over a
        # blurred squash-to-fill background. The bg chain deliberately has NO
        # crop filter — sendcmd targets every `crop` instance in the graph
        # (see the facecam cross-talk lesson), so the single crop lives in
        # the fg chain only. The bg's aspect distortion vanishes under blur.
        half_w, half_h = ctx.out_w // 2, ctx.out_h // 2
        bg = (f"[0:v]scale={half_w}:{half_h},boxblur=10:2,"
              f"scale={ctx.out_w}:{ctx.out_h}[bg];")
        if is_dynamic:
            sendcmd_path = ctx.job_dir / f"clip_{ctx.idx}_crop.txt"
            write_sendcmd_file(trajectory, sendcmd_path, fps=ctx.clip_fps)
            fg = (f"[0:v]sendcmd=f={sendcmd_path.name},"
                  f"crop={fg_w}:{ctx.src_h}:0:0,scale={ctx.out_w}:{fg_scaled_h}[fg];")
        else:
            fg = (f"[0:v]crop={fg_w}:{ctx.src_h}:{trajectory[0][1]}:0,"
                  f"scale={ctx.out_w}:{fg_scaled_h}[fg];")
        fc = bg + fg + "[bg][fg]overlay=(W-w)/2:(H-h)/2[vmain]"
    elif is_dynamic:
        sendcmd_path = ctx.job_dir / f"clip_{ctx.idx}_crop.txt"
        write_sendcmd_file(trajectory, sendcmd_path, fps=ctx.clip_fps)
        fc = (
            f"[0:v]sendcmd=f={sendcmd_path.name},"
            f"crop={ctx.crop_w}:{ctx.crop_h}:0:0,"
            f"scale={ctx.out_w}:{ctx.out_h}[vmain]"
        )
    else:
        fc = (
            f"[0:v]crop={ctx.crop_w}:{ctx.crop_h}:{trajectory[0][1]}:0,"
            f"scale={ctx.out_w}:{ctx.out_h}[vmain]"
        )
    return LayoutPlan(filter_complex=fc)


def _plan_blur_bg(ctx: ClipRenderCtx) -> LayoutPlan:
    """Blur-background layout: landscape clip centred over a blurred fill.
    Perf trick: blur at half-res then upscale — blurring a small image is ~4x
    faster and the upscale smears the blur further, which improves the look.
    CRF 26 because the background is heavily blurred; artefacts are invisible."""
    half_w = ctx.out_w // 2
    half_h = ctx.out_h // 2
    fc = (
        f"[0:v]scale={half_w}:{half_h}:force_original_aspect_ratio=increase,"
        f"crop={half_w}:{half_h},boxblur=10:2,scale={ctx.out_w}:{ctx.out_h}[bg];"
        f"[0:v]scale={ctx.out_w}:-2:force_original_aspect_ratio=decrease[fg];"
        f"[bg][fg]overlay=(W-w)/2:(H-h)/2[vmain]"
    )
    return LayoutPlan(filter_complex=fc, encode_crf=26)


async def _render_face_strip(ctx: ClipRenderCtx, fh_med: int, face_pts: list,
                             strip_h: int) -> tuple:
    """Pre-render a face-framed strip (head + shoulders, gently following the
    face) as its own pass — the follow needs its own sendcmd-driven crop, and
    only one sendcmd fits per graph. Returns (path, mode) where mode is
    'tracked' or 'framed'. Shared by the gameplay and screenshare layouts."""
    import statistics as _stats
    src_w, src_h, out_w = ctx.src_w, ctx.src_h, ctx.out_w
    win_w = int(min(fh_med * 2.6 * out_w / strip_h, src_w)); win_w -= win_w % 2
    win_h = int(win_w * strip_h / out_w); win_h -= win_h % 2
    win_h = min(win_h, src_h - (src_h % 2))
    win_w = int(win_h * out_w / strip_h); win_w -= win_w % 2
    cxs = [c for _, c, _ in face_pts]
    cys = [c for _, _, c in face_pts]
    win_y = int(max(0, min(_stats.median(cys) - win_h * 0.42, src_h - win_h)))
    f_dets = [(t, int(max(0, min(cx - win_w / 2, src_w - win_w)))) for t, cx, _ in face_pts]
    f_fb   = int(max(0, min(_stats.median(cxs) - win_w / 2, src_w - win_w)))
    f_traj = smooth_crop_trajectory(f_dets, ctx.render_dur, fallback_crop_x=f_fb, crop_w=win_w, src_w=src_w)
    if len(set(x for _, x in f_traj)) > 1:
        _f_cmd = ctx.job_dir / f"clip_{ctx.idx}_face.txt"
        write_sendcmd_file(f_traj, _f_cmd, fps=ctx.clip_fps)
        strip_crop = f"sendcmd=f={_f_cmd.name},crop={win_w}:{win_h}:0:{win_y}"
        mode = "tracked"
    else:
        strip_crop = f"crop={win_w}:{win_h}:{f_traj[0][1]}:{win_y}"
        mode = "framed"
    strip_tmp = ctx.job_dir / f"clip_{ctx.idx}_top.mp4"
    await run_cmd_async([
        FFMPEG, "-y", "-ss", str(ctx.render_ss), "-i", str(ctx.render_src), "-t", str(ctx.render_dur),
        "-filter_complex", f"[0:v]{strip_crop},scale={out_w}:{strip_h}[v]",
        "-map", "[v]", "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "20",
        str(strip_tmp),
    ], str(ctx.job_dir))
    return strip_tmp, mode


async def _plan_gameplay(ctx: ClipRenderCtx) -> Optional[LayoutPlan]:
    """Gameplay layout: streamer's cam (face-framed/tracked) on top, tracked
    gameplay on the bottom with the cam region excluded. Returns None when no
    facecam is found (caller falls back to Fill)."""
    _fc_tmp = ctx.job_dir / f"clip_{ctx.idx}_fc.mp4"
    await run_cmd_async([FFMPEG, "-y", "-ss", str(ctx.render_ss), "-i", str(ctx.render_src),
                         "-t", str(ctx.render_dur), "-c:v", "libx264", "-preset", "ultrafast",
                         "-crf", "28", "-an", str(_fc_tmp)])
    _known_box = ctx.facecam_region["box"] if ctx.facecam_region else None
    facecam_box, face_info, game = await asyncio.to_thread(
        _detect_facecam_and_track, _fc_tmp, ctx.src_w, ctx.src_h, _known_box)
    _fc_tmp.unlink(missing_ok=True)
    if not facecam_box:
        return None

    src_w, src_h, out_w, out_h = ctx.src_w, ctx.src_h, ctx.out_w, ctx.out_h
    fx, fy, fw, fh = facecam_box
    top_h = (out_h * 3 // 10); top_h -= top_h % 2     # 30% cam (Opus's Gameplay ratio)
    bot_h = out_h - top_h                              # 70% gameplay
    gp_h  = ctx.crop_h
    gp_w  = min(int(gp_h * out_w / bot_h), src_w); gp_w -= gp_w % 2
    gp_min_x, gp_max_x = 0, src_w - gp_w
    if fx + fw <= src_w / 2:                            # facecam on the left
        gp_min_x = min(fx + fw, gp_max_x)
    elif fx >= src_w / 2:                              # facecam on the right
        gp_max_x = max(fx - gp_w, gp_min_x)
    gp_dets  = [(t, max(gp_min_x, min(int(cx - gp_w / 2), gp_max_x))) for t, cx in game]
    gp_fb    = max(gp_min_x, min((src_w - gp_w) // 2, gp_max_x))
    gp_traj  = smooth_crop_trajectory(gp_dets, ctx.render_dur, fallback_crop_x=gp_fb, crop_w=gp_w, src_w=src_w)
    gp_traj  = [(t, max(gp_min_x, min(x, gp_max_x))) for t, x in gp_traj]
    if len(set(x for _, x in gp_traj)) > 1:
        _gp_cmd = ctx.job_dir / f"clip_{ctx.idx}_gp.txt"
        write_sendcmd_file(gp_traj, _gp_cmd, fps=ctx.clip_fps)
        gp_crop = f"sendcmd=f={_gp_cmd.name},crop={gp_w}:{gp_h}:0:0"
    else:
        gp_crop = f"crop={gp_w}:{gp_h}:{gp_traj[0][1]}:0"

    # Face geometry for the TOP: per-clip face (follow) if this segment showed
    # it, else the shared video-level face (static) — so every clip frames the
    # face the SAME clean way instead of some falling back to a blurred card.
    if face_info:
        fh_med, face_pts = face_info["fh"], face_info["traj"]
    elif ctx.facecam_region:
        fh_med = ctx.facecam_region["fh"]
        face_pts = [(0.0, ctx.facecam_region["fcx"], ctx.facecam_region["fcy"])]
    else:
        fh_med, face_pts = None, None

    extra_inputs = []
    if face_pts:
        strip_path, _top_mode = await _render_face_strip(ctx, fh_med, face_pts, top_h)
        extra_inputs.append(strip_path)
        top_chain = f"[{len(extra_inputs)}:v]null[top];"
    else:
        # Last resort (no face anywhere) — fit the whole cam with blur.
        _top_mode = "blur-fit"
        top_chain = (
            f"[0:v]crop={fw}:{fh}:{fx}:{fy},split[fcm][fcb];"
            f"[fcb]scale={out_w}:{top_h}:force_original_aspect_ratio=increase,crop={out_w}:{top_h},boxblur=20:2[fcbg];"
            f"[fcm]scale={out_w}:{top_h}:force_original_aspect_ratio=decrease[fcfg];"
            f"[fcbg][fcfg]overlay=(W-w)/2:(H-h)/2[top];"
        )

    fc = (
        top_chain +
        f"[0:v]{gp_crop},scale={out_w}:{bot_h}[bot];"
        f"[top][bot]vstack[vmain]"
    )
    log(ctx.job_id, f"  Facecam {facecam_box}, top={_top_mode}, "
                    f"gameplay {gp_w}x{gp_h} x∈[{gp_min_x},{gp_max_x}]")
    return LayoutPlan(filter_complex=fc, extra_inputs=extra_inputs)


def _faces_present_in_windows(clip_path: Path, windows: list, n_samples: int = 16) -> list:
    """For each (x, y, w, h) window, the fraction of sampled frames whose face
    centre lands inside it. Used to re-validate video-level split speakers on a
    specific clip segment (the guest may not be on screen in this window)."""
    face_det = _yunet_detector()
    if face_det is None:
        return [0.0] * len(windows)
    import cv2 as _cv2
    cap = _cv2.VideoCapture(str(clip_path))
    fps = cap.get(_cv2.CAP_PROP_FPS) or 30.0
    total = cap.get(_cv2.CAP_PROP_FRAME_COUNT) or 0
    dur = total / fps if fps else 0.0
    counts = [0] * len(windows)
    n_ok = 0
    for i in range(n_samples):
        t = dur * (i + 0.5) / n_samples if dur > 0 else 0.0
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
            cx, cy = int(f[0]) + int(f[2]) / 2, int(f[1]) + int(f[3]) / 2
            for wi, (wx, wy, ww, wh) in enumerate(windows):
                if wx <= cx <= wx + ww and wy <= cy <= wy + wh:
                    counts[wi] += 1
                    break
    cap.release()
    return [c / max(1, n_ok) for c in counts]


def _speaker_window(sp: dict, tile_w: int, tile_h: int, src_w: int, src_h: int) -> tuple:
    """Head-and-shoulders crop window for one speaker at the tile's aspect,
    sized off the face height (same framing as the gameplay top strip)."""
    win_w = int(min(sp["fh"] * 2.6 * tile_w / tile_h, src_w)); win_w -= win_w % 2
    win_h = int(win_w * tile_h / tile_w); win_h -= win_h % 2
    win_h = min(win_h, src_h - (src_h % 2))
    win_w = int(win_h * tile_w / tile_h); win_w -= win_w % 2
    wx = int(max(0, min(sp["fcx"] - win_w / 2, src_w - win_w)))
    wy = int(max(0, min(sp["fcy"] - win_h * 0.42, src_h - win_h)))
    return wx, wy, win_w, win_h


async def _plan_split(ctx: ClipRenderCtx) -> Optional[LayoutPlan]:
    """Split layout: two co-present speakers stacked 50/50 (Opus's Split).
    Requires the video-level speaker pair AND per-clip re-validation — if
    either speaker isn't actually on screen during this clip's window, returns
    None and the caller falls back to Fill (whose speaker tracking handles
    two-person scenes gracefully)."""
    if not ctx.split_speakers or len(ctx.split_speakers) < 2:
        return None
    tile_h = ctx.out_h // 2; tile_h -= tile_h % 2
    windows = [_speaker_window(sp, ctx.out_w, tile_h, ctx.src_w, ctx.src_h)
               for sp in ctx.split_speakers[:2]]

    # Re-validate on THIS clip segment (cheap H.264 intermediate, 16 frames).
    _sv_tmp = ctx.job_dir / f"clip_{ctx.idx}_split.mp4"
    await run_cmd_async([FFMPEG, "-y", "-ss", str(ctx.render_ss), "-i", str(ctx.render_src),
                         "-t", str(ctx.render_dur), "-c:v", "libx264", "-preset", "ultrafast",
                         "-crf", "28", "-an", str(_sv_tmp)])
    fractions = await asyncio.to_thread(_faces_present_in_windows, _sv_tmp, windows)
    _sv_tmp.unlink(missing_ok=True)
    if min(fractions) < 0.3:
        log(ctx.job_id, f"  Split re-validation failed ({[round(f, 2) for f in fractions]}) — falling back to Fill")
        return None

    parts = []
    for i, (wx, wy, ww, wh) in enumerate(windows):
        parts.append(f"[0:v]crop={ww}:{wh}:{wx}:{wy},scale={ctx.out_w}:{tile_h}[t{i}]")
    fc = ";".join(parts) + f";[t0][t1]vstack[vmain]"
    log(ctx.job_id, f"  Split: speakers at x={int(ctx.split_speakers[0]['fcx'])},{int(ctx.split_speakers[1]['fcx'])} "
                    f"presence={[round(f, 2) for f in fractions]}")
    return LayoutPlan(filter_complex=fc)


async def _plan_screenshare(ctx: ClipRenderCtx) -> Optional[LayoutPlan]:
    """Screenshare layout (Opus's 50/50): screen content on top — letterboxed,
    NEVER cropped (readability beats fill for slides/code) — and the speaker's
    face strip on the bottom. The cam region is excluded from the screen crop.
    Returns None when no cam/face is found (caller falls back)."""
    _fc_tmp = ctx.job_dir / f"clip_{ctx.idx}_fc.mp4"
    await run_cmd_async([FFMPEG, "-y", "-ss", str(ctx.render_ss), "-i", str(ctx.render_src),
                         "-t", str(ctx.render_dur), "-c:v", "libx264", "-preset", "ultrafast",
                         "-crf", "28", "-an", str(_fc_tmp)])
    _known_box = ctx.facecam_region["box"] if ctx.facecam_region else None
    facecam_box, face_info, _game = await asyncio.to_thread(
        _detect_facecam_and_track, _fc_tmp, ctx.src_w, ctx.src_h, _known_box)
    _fc_tmp.unlink(missing_ok=True)
    if not facecam_box:
        return None

    src_w, src_h, out_w, out_h = ctx.src_w, ctx.src_h, ctx.out_w, ctx.out_h
    fx, fy, fw, fh = facecam_box
    tile_h = out_h // 2; tile_h -= tile_h % 2

    # Screen region = the larger side of the frame next to the cam; if the cam
    # sits near the middle, keep the full frame (excluding would cut content).
    left_w, right_w = fx, src_w - (fx + fw)
    if max(left_w, right_w) >= src_w * 0.5:
        if right_w >= left_w:
            sx, sw = fx + fw, right_w
        else:
            sx, sw = 0, left_w
    else:
        sx, sw = 0, src_w
    sw -= sw % 2
    top_chain = (
        f"[0:v]crop={sw}:{src_h - (src_h % 2)}:{sx}:0,"
        f"scale={out_w}:{tile_h}:force_original_aspect_ratio=decrease,"
        f"pad={out_w}:{tile_h}:(ow-iw)/2:(oh-ih)/2:black[top];"
    )

    # Bottom: the speaker's face strip (shared with the gameplay layout).
    if face_info:
        fh_med, face_pts = face_info["fh"], face_info["traj"]
    elif ctx.facecam_region:
        fh_med = ctx.facecam_region["fh"]
        face_pts = [(0.0, ctx.facecam_region["fcx"], ctx.facecam_region["fcy"])]
    else:
        return None
    strip_path, _mode = await _render_face_strip(ctx, fh_med, face_pts, tile_h)
    fc = (
        top_chain +
        f"[1:v]null[bot];"
        f"[top][bot]vstack[vmain]"
    )
    log(ctx.job_id, f"  Screenshare: cam {facecam_box}, screen x={sx} w={sw}, face={_mode}")
    return LayoutPlan(filter_complex=fc, extra_inputs=[strip_path])


def _plan_fit(ctx: ClipRenderCtx) -> LayoutPlan:
    """Fit layout (Opus-style): source cropped to 4:3 centred, fitted to the
    output width, letterboxed with opaque bars. Nothing is ever cut off the
    sides beyond the gentle 16:9→4:3 trim; captions land on the bottom bar."""
    fit_h = ctx.src_h - (ctx.src_h % 2)
    fit_w = min(int(ctx.src_h * 4 / 3), ctx.src_w); fit_w -= fit_w % 2
    fit_x = max(0, (ctx.src_w - fit_w) // 2)
    fc = (
        f"[0:v]crop={fit_w}:{fit_h}:{fit_x}:0,"
        f"scale={ctx.out_w}:-2,"
        f"pad={ctx.out_w}:{ctx.out_h}:0:(oh-ih)/2:black[vmain]"
    )
    return LayoutPlan(filter_complex=fc)


# clip_style names kept as accepted aliases for saved channels/backfills.
_LAYOUT_ALIASES = {"reframe": "fill", "facecam": "gameplay"}
# Layouts that stack multiple source regions — locked to 9:16 output in V1.
_PORTRAIT_ONLY_LAYOUTS = {"gameplay", "split", "screenshare"}
_ASPECT_RATIOS = {"9:16": (1080, 1920), "1:1": (1080, 1080), "16:9": (1920, 1080)}


async def _build_layout_plan(ctx: ClipRenderCtx, clip_style: str) -> LayoutPlan:
    """Dispatch to the right layout builder, with graceful fallbacks."""
    layout = _LAYOUT_ALIASES.get(clip_style, clip_style)
    if layout == "gameplay" and _REFRAME_AVAILABLE:
        plan = await _plan_gameplay(ctx)
        if plan is not None:
            return plan
        log(ctx.job_id, "  No facecam detected — using center crop instead")
    if layout == "split" and _REFRAME_AVAILABLE:
        plan = await _plan_split(ctx)
        if plan is not None:
            return plan
        # Fill's active-speaker tracking handles two-person scenes gracefully.
        ctx = _dc_replace(ctx, reframe=True) if not ctx.reframe else ctx
    if layout == "screenshare" and _REFRAME_AVAILABLE:
        plan = await _plan_screenshare(ctx)
        if plan is not None:
            return plan
        log(ctx.job_id, "  No speaker cam found for screenshare — using center crop instead")
    if layout == "blur_bg":
        return _plan_blur_bg(ctx)
    if layout == "fit":
        return _plan_fit(ctx)
    return await _plan_fill(ctx)


# ── cut clips + burn subtitles ────────────────────────────────────────────────
async def _resolve_auto_layout(video_path: Path, src_w: int, src_h: int,
                               duration: float, job_id: str,
                               t0: Optional[float] = None,
                               t1: Optional[float] = None,
                               n_samples: int = 48,
                               label: str = "") -> tuple:
    """The AUTO layout decision tree over the whole video (default) or a
    [t0, t1] clip window (per-clip auto). One cluster pass feeds every
    decision; a motion/edge probe of the non-cam region separates screenshare
    (static, edge-dense) from gameplay (high motion). Ambiguity always
    resolves to fill — a wrong fill is watchable, a wrong split is not.
    Returns (layout, facecam_region, split_speakers). Thresholds measured on
    the 12-video calibration corpus (tests/layout_corpus.json, 2026-07-06)."""
    _clusters, _n_ok = await asyncio.to_thread(
        _detect_face_clusters, video_path, src_w, src_h, duration, n_samples, t0, t1)
    split_speakers = _pick_split_speakers(_clusters, _n_ok, src_w)
    if split_speakers:
        log(job_id, f"  Auto layout{label} → split")
        return "split", None, split_speakers

    _m_low = float(os.getenv("AUTO_MOTION_LOW", "4.0"))
    _e_high = float(os.getenv("AUTO_EDGE_HIGH", "5.0"))
    _m_high = float(os.getenv("AUTO_MOTION_HIGH", "9.0"))
    facecam_region = _facecam_region_from_clusters(_clusters, _n_ok, src_w, src_h)
    if facecam_region:
        _motion, _edges = await asyncio.to_thread(
            _probe_motion_edges, video_path, duration, facecam_region["box"], 24, t0, t1)
        # Streamer cams sit in the left/right corners or the bottom band
        # (bottom-center webcam bars are common); top/center faces are subjects
        # or logos, never cams — confirmed across the calibration corpus.
        _corner = (facecam_region["fcx"] < src_w * 0.33
                   or facecam_region["fcx"] > src_w * 0.67
                   or facecam_region["fcy"] > src_h * 0.75)
        log(job_id, f"  Auto probe{label}: motion={_motion if _motion is None else round(_motion, 1)} "
                    f"edges={_edges if _edges is None else round(_edges, 1)} corner_cam={_corner}")
        if _motion is not None and _motion < _m_low and _edges > _e_high:
            layout = "screenshare"
        elif _motion is not None and _motion >= _m_high and _corner:
            layout = "gameplay"
        else:
            layout = "fill"
        log(job_id, f"  Auto layout{label} → {layout}")
        return layout, facecam_region, None

    # No cam found. A no-facecam screencast (pure code/slides — near-zero face
    # evidence, static frame, edge-dense) must NOT be center-cropped by fill;
    # letterbox it with Fit so the content stays legible.
    layout = "fill"
    _face_evidence = sum(c["hits"] for c in _clusters)
    if _face_evidence <= 0.25 * max(1, _n_ok):
        _motion, _edges = await asyncio.to_thread(
            _probe_motion_edges, video_path, duration, None, 24, t0, t1)
        log(job_id, f"  Auto probe{label} (no cam): motion={_motion if _motion is None else round(_motion, 1)} "
                    f"edges={_edges if _edges is None else round(_edges, 1)}")
        if _motion is not None and _motion < _m_low and (_edges or 0) > _e_high:
            layout = "fit"
    log(job_id, f"  Auto layout{label} → {layout}")
    return layout, None, None


async def create_clips(
    video_path: Path,
    clip_defs: list,
    segments: list,
    job_dir: Path,
    job_id: str,
    reframe: bool = False,
    clip_style: str = "reframe",
    aspect_ratio: str = "9:16",
    manual_facecam_box: Optional[list] = None,
    caption_style: str = "bold_bottom",
    font_size: Optional[int] = None,
    highlight_color: Optional[str] = None,
    caption_position: Optional[str] = None,
    caption_keywords: bool = True,
    caption_emoji: bool = True,
    caption_segments: Optional[list] = None,
    bg_music_url: Optional[str] = None,
    bg_music_volume: float = 0.15,
    trim_silence: bool = False,
    remove_fillers: bool = False,
    brand_overlay: Optional[dict] = None,
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
    split_speakers = None
    layout_resolved = None
    _manual_cam = False        # user-drawn box beats ALL detection, incl. per-clip auto
    _auto_src_dims = None      # (w, h, dur) — set when the auto video-level probe ran
    _probe_layout = _LAYOUT_ALIASES.get(clip_style, clip_style)

    # A user-drawn cam box (normalized 0-1) beats detection entirely — this is
    # the escape hatch Opus doesn't have for misdetected facecams.
    if manual_facecam_box and len(manual_facecam_box) == 4 and _probe_layout in ("gameplay", "screenshare"):
        try:
            _mb_probe = [FFPROBE, "-v", "quiet", "-print_format", "json", "-show_streams", str(video_path)]
            _, _mo, _ = await asyncio.to_thread(run_cmd, _mb_probe)
            _mvs = next((s for s in json.loads(_mo)["streams"] if s["codec_type"] == "video"), None)
            if _mvs:
                _mw, _mh = int(_mvs["width"]), int(_mvs["height"])
                nx, ny, nw, nh = [max(0.0, min(1.0, float(v))) for v in manual_facecam_box]
                bx, by = int(nx * _mw), int(ny * _mh)
                bw = max(2, min(int(nw * _mw), _mw - bx)); bw -= bw % 2
                bh = max(2, min(int(nh * _mh), _mh - by)); bh -= bh % 2
                if bw >= 40 and bh >= 40:
                    facecam_region = {
                        "box": (bx, by, bw, bh),
                        # Approximate face geometry from the box (inverse of the
                        # detector's box construction: bw≈fw*2.4, bh≈fh*3.0).
                        "fw": max(20, int(bw / 2.4)),
                        "fh": max(20, int(bh / 3.0)),
                        "fcx": bx + bw / 2.0,
                        "fcy": by + bh * 0.40,
                    }
                    _manual_cam = True
                    log(job_id, f"  Manual facecam box: {facecam_region['box']}")
        except Exception as _me:
            log(job_id, f"  Manual facecam box ignored: {_me}")

    if facecam_region is None and _probe_layout in ("gameplay", "split", "screenshare", "auto") and _REFRAME_AVAILABLE:
        try:
            _fc_probe = [FFPROBE, "-v", "quiet", "-print_format", "json", "-show_streams", str(video_path)]
            _, _fo, _ = await asyncio.to_thread(run_cmd, _fc_probe)
            _fvs = next((s for s in json.loads(_fo)["streams"] if s["codec_type"] == "video"), None)
            if _fvs:
                _fw, _fh = int(_fvs["width"]), int(_fvs["height"])
                _fd = float(_fvs.get("duration") or 0)
                if _probe_layout in ("gameplay", "screenshare"):
                    facecam_region = await asyncio.to_thread(_detect_facecam_region, video_path, _fw, _fh, _fd)
                    log(job_id, f"  Facecam region (video-level): {facecam_region['box'] if facecam_region else 'none'}")
                elif _probe_layout == "split":
                    _clusters, _n_ok = await asyncio.to_thread(_detect_face_clusters, video_path, _fw, _fh, _fd)
                    split_speakers = _pick_split_speakers(_clusters, _n_ok, _fw)
                    log(job_id, f"  Split speakers (video-level): "
                                f"{[int(s['fcx']) for s in split_speakers] if split_speakers else 'none — will fall back to Fill'}")
                else:
                    # AUTO, video-level pass: the fallback answer when a
                    # per-clip probe fails, and the source of the video dims
                    # for the per-clip passes below.
                    layout_resolved, facecam_region, split_speakers = await _resolve_auto_layout(
                        video_path, _fw, _fh, _fd, job_id, label=" (video)")
                    _auto_src_dims = (_fw, _fh, _fd)
        except Exception as _fe:
            log(job_id, f"  Layout probe skipped: {_fe}")
    if _probe_layout == "auto":
        clip_style = layout_resolved or "fill"
        if clip_style == "fill":
            # A tracked fill is the better default for auto (auto is Pro-only).
            reframe = True if _REFRAME_AVAILABLE else reframe

    results = []
    for idx, clip in enumerate(clip_defs):
        start = clip["start"]
        end   = clip["end"]
        dur   = end - start

        log(job_id, f"Clip {idx+1}/{len(clip_defs)}: '{clip['title']}' [{start:.1f}s – {end:.1f}s] ({dur:.1f}s)")
        # clipping: 78-98 spread across clips
        progress = 78 + int((idx / len(clip_defs)) * 20)
        await update_job(job_id, progress=progress, message=f"Rendering clip {idx+1}/{len(clip_defs)}: {clip['title']}")

        # Per-clip AUTO: each clip's window gets its own layout decision — a
        # 2h stream can yield podcast (fill) + gameplay + slides (fit) clips,
        # and a montage's cams move between segments. The video-level result
        # is the fallback; a user-drawn cam box wins upstream (it forces a
        # cam layout before auto is ever probed). Explicit layouts are
        # untouched: one layout for all clips, exactly as the user asked.
        clip_layout, clip_reframe = clip_style, reframe
        clip_cam, clip_split = facecam_region, split_speakers
        if _probe_layout == "auto" and _auto_src_dims and not _manual_cam:
            try:
                _aw, _ah, _ad = _auto_src_dims
                _l, _cam, _spl = await _resolve_auto_layout(
                    video_path, _aw, _ah, _ad, job_id,
                    t0=start, t1=end, n_samples=24, label=f" (clip {idx+1})")
                clip_layout, clip_cam, clip_split = _l, _cam, _spl
                clip_reframe = (True if _REFRAME_AVAILABLE else reframe) if _l == "fill" else reframe
            except Exception as _pe:
                log(job_id, f"  Per-clip auto probe failed (clip {idx+1}) — using video-level '{clip_style}': {_pe}")

        # Render source defaults to the original video; silence trimming may swap
        # it for a pre-trimmed intermediate with gaps cut out.
        render_src   = video_path
        render_ss    = start
        render_dur   = dur
        ass_segs     = caption_segments if caption_segments is not None else segments
        ass_clip_start = start
        ass_clip_end   = end
        trimmed_file: Optional[Path] = None

        # Unified cut engine: three composable cut sources produce ONE keep-set,
        # rendered through the same trimmed-intermediate machinery.
        #   base:     user-authored editor cuts (cut_keep) OR silence trim OR full clip
        #   subtract: filler words (um/uh/...) when remove_fillers is on
        user_keep = clip.get("cut_keep")
        if user_keep:
            base_keep = _normalize_keep(user_keep, dur) or [(0.0, dur)]
            base_label = "editor cuts"
        elif trim_silence:
            silences = await _detect_silence(video_path, start, dur)
            base_keep = _keep_intervals(silences, dur)
            base_label = "silence trim"
        else:
            base_keep, base_label = [(0.0, dur)], ""
        if remove_fillers:
            fillers = _filler_cut_intervals(segments, start, end)
            keep = _subtract_intervals(base_keep, fillers)
            if fillers:
                base_label = f"{base_label} + " if base_label else ""
                base_label += f"{len(fillers)} fillers"
        else:
            keep = base_keep

        removed = dur - sum(b - a for a, b in keep)
        # Only worth a re-encode pass when the cuts are real: any mid-clip cut,
        # or ≥0.8s shaved off in total.
        needs_trim = keep and keep != [(0.0, dur)] and (len(keep) >= 2 or removed >= 0.8)
        if needs_trim:
            trimmed_file = job_dir / f"clip_{idx}_trimmed.mp4"
            if await _build_trimmed_clip(video_path, start, dur, keep, trimmed_file):
                remapped, trimmed_dur = _remap_segments_for_trim(
                    caption_segments if caption_segments is not None else segments,
                    start, end, keep,
                )
                render_src, render_ss, render_dur = trimmed_file, 0.0, trimmed_dur
                ass_segs, ass_clip_start, ass_clip_end = remapped, 0.0, trimmed_dur
                log(job_id, f"  Cuts ({base_label}): removed {removed:.1f}s ({dur:.1f}s → {trimmed_dur:.1f}s)")
            else:
                trimmed_file = None
                log(job_id, f"  Cut render failed ({base_label}) — rendering full clip")

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

        # Output resolution from the requested aspect ratio; multi-region
        # layouts (gameplay/split/screenshare) are portrait-only in V1.
        _layout_resolved = _LAYOUT_ALIASES.get(clip_layout, clip_layout)
        _ar = aspect_ratio if aspect_ratio in _ASPECT_RATIOS else "9:16"
        if _layout_resolved in _PORTRAIT_ONLY_LAYOUTS and _ar != "9:16":
            log(job_id, f"  {_layout_resolved} layout is 9:16-only — ignoring aspect_ratio={_ar}")
            _ar = "9:16"
        out_w, out_h = _ASPECT_RATIOS[_ar]

        # Crop the source to the output aspect, subtracting any detected
        # hardcoded caption bar from the bottom. At 16:9 output on a 16:9
        # source this degenerates to no horizontal crop (correct).
        effective_h = src_h - caption_crop_px
        crop_h = effective_h
        crop_w = min(int(effective_h * out_w / out_h), src_w)
        crop_w -= crop_w % 2
        center_crop_x = max(0, (src_w - crop_w) // 2)

        # For blur_bg, compute where the foreground video ends so captions land
        # in the bottom blurred zone rather than on top of the main video.
        blur_bg_margin_v = None
        if clip_layout == "blur_bg":
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
        if caption_position and caption_position != "default" and clip_layout != "blur_bg":
            pos_align, pos_mv = _CAPTION_POSITIONS.get(caption_position, (None, None))

        # Build ASS subtitle
        ass_path = job_dir / f"clip_{idx}.ass"
        cap_info = build_ass_subtitles(
            ass_segs,
            clip_start=ass_clip_start,
            clip_end=ass_clip_end,
            output_path=ass_path,
            video_width=out_w,
            video_height=out_h,
            caption_style=caption_style,
            font_size=font_size,
            highlight_color=highlight_color,
            margin_v_override=blur_bg_margin_v if clip_layout == "blur_bg" else pos_mv,
            # Force bottom-center alignment in blur_bg so captions land in the
            # bottom blur zone even for center-aligned styles like POP.
            alignment_override=2 if clip_layout == "blur_bg" else pos_align,
            keywords=clip.get("keywords") if caption_keywords else None,
        )

        # Persist the clip's FINAL caption words + cut metadata for exports
        # (SRT / Premiere XML / FCPXML). Reconstructing this later is impossible
        # for trimmed clips — every cut shifts every timestamp — so we snapshot
        # exactly what the renderer used. Never fatal.
        try:
            _exp_words = []
            for _seg in (ass_segs or []):
                for _w in _fill_words(_seg):
                    _ws, _we = float(_w["start"]), float(_w["end"])
                    if _we <= ass_clip_start or _ws >= ass_clip_end:
                        continue
                    _exp_words.append({"word": str(_w["word"]).strip(),
                                       "start": round(max(0.0, _ws - ass_clip_start), 3),
                                       "end": round(min(render_dur, _we - ass_clip_start), 3)})
            (OUTPUT_DIR / job_id).mkdir(exist_ok=True)
            (OUTPUT_DIR / job_id / f"captions_{idx}.json").write_text(json.dumps({
                "fps": round(clip_fps, 3), "src_w": src_w, "src_h": src_h,
                "start": start, "end": end, "duration": round(render_dur, 3),
                # keep = the cut plan in clip-relative seconds; None when uncut
                "keep": [[round(a, 3), round(b, 3)] for a, b in keep] if needs_trim and trimmed_file else None,
                "words": _exp_words,
            }), encoding="utf-8")
        except Exception as _xe:
            log(job_id, f"  export metadata skipped: {_xe}")

        safe_title = re.sub(r'[^\w]', '_', clip['title'][:30])
        clip_filename = f"clip_{idx+1}_{safe_title}.mp4"
        clip_path = OUTPUT_DIR / job_id / clip_filename
        clip_path.parent.mkdir(exist_ok=True)

        # basename-only for filter paths — avoids Windows drive-letter colon issue
        ass_filename = ass_path.name

        # Build the layout plan (Fill / Blur-BG / Gameplay, with fallbacks) and
        # assemble the final command generically: captions and music are
        # appended the same way for every layout.
        ctx = ClipRenderCtx(
            render_src=render_src, render_ss=render_ss, render_dur=render_dur,
            src_w=src_w, src_h=src_h, out_w=out_w, out_h=out_h,
            crop_w=crop_w, crop_h=crop_h, center_crop_x=center_crop_x,
            clip_fps=clip_fps, job_dir=job_dir, idx=idx, job_id=job_id,
            reframe=clip_reframe, n_clips=len(clip_defs),
            clip_title=clip.get("title", ""), facecam_region=clip_cam,
            split_speakers=clip_split,
        )
        plan = await _build_layout_plan(ctx, clip_layout)
        # One sendcmd-driven crop per graph — more cross-talk (sendcmd hits
        # every crop instance). Layouts needing more use pre-pass inputs.
        assert plan.filter_complex.count("sendcmd") <= 1, "layout plan violates one-sendcmd-per-graph"

        fc = plan.filter_complex + f";[vmain]ass={ass_filename}:fontsdir={_FONTSDIR_ESC}[vout]"
        ffmpeg_cmd = [FFMPEG, "-y", "-ss", str(render_ss), "-i", str(render_src)]
        for _p in plan.extra_inputs:
            ffmpeg_cmd += ["-i", str(_p)]
        if music_path:
            music_idx = 1 + len(plan.extra_inputs)
            fc += (
                f";[0:a]volume=1.0[speech];[{music_idx}:a]volume={bg_music_volume}[bgm];"
                f"[speech][bgm]amix=inputs=2:duration=first:dropout_transition=0.5[aout]"
            )
            ffmpeg_cmd += [
                "-stream_loop", "-1", "-i", str(music_path), "-t", str(render_dur),
                "-filter_complex", fc, "-map", "[vout]", "-map", "[aout]",
            ]
        else:
            ffmpeg_cmd += [
                "-t", str(render_dur),
                "-filter_complex", fc, "-map", "[vout]", "-map", "0:a?",
            ]
        ffmpeg_cmd += [
            "-c:v", "libx264", "-preset", "fast", "-crf", str(plan.encode_crf),
            "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(clip_path),
        ]

        log(job_id, f"  Running FFmpeg for clip {idx+1}...")
        code, _, err = await run_cmd_async(ffmpeg_cmd, str(job_dir))
        if code != 0:
            log(job_id, f"  !!! FFmpeg FAILED for clip {idx+1}: {err[-300:]}")
            await update_job(job_id, message=f"Clip {idx+1} render failed: {err[-200:]}")
            continue

        # Emoji post-pass — composited after the main render so it works
        # identically for every layout. Non-fatal on failure.
        if caption_emoji and clip.get("emojis") and cap_info and cap_info.get("lines"):
            try:
                placements = _emoji_placements(clip["emojis"], cap_info, render_dur)
                await _apply_emoji_overlays(clip_path, placements, job_id)
            except Exception as _ee:
                log(job_id, f"  Emoji overlay skipped: {_ee}")

        # Brand watermark post-pass (Pro brand kit) — after emoji so the logo
        # sits on top of everything.
        if brand_overlay:
            try:
                await _apply_watermark(clip_path, brand_overlay, out_w, out_h, job_id)
            except Exception as _we:
                log(job_id, f"  Watermark skipped: {_we}")

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
            # What auto-layout actually chose FOR THIS CLIP (equals the
            # requested layout when the user picked one explicitly).
            "layout": _LAYOUT_ALIASES.get(clip_layout, clip_layout),
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
                    req = _channel_clip_request(ch, video_url)
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


async def run_pipeline(job_id: str, req: ClipRequest, user_id: str = "", auto_upload: bool = False, auto_upload_yt_channel: Optional[str] = None, auto_upload_tt_account: Optional[str] = None, backfill_id: Optional[str] = None, backfill_video_id: Optional[str] = None, watchlist_channel_id: Optional[str] = None, watchlist_video_id: Optional[str] = None, watchlist_video_title: str = "", reprompt_parent_id: Optional[str] = None):
    job_dir = TEMP_DIR / job_id
    job_dir.mkdir(exist_ok=True)
    log(job_id, f"=== PIPELINE START === url={req.url}")

    try:
        # Reprompt: reuse the parent job's cached source + transcript so we skip
        # the download and transcription entirely. Cache-miss on either falls
        # back to the normal phase (the cache is an optimization, never a
        # dependency).
        video_path: Optional[Path] = None
        segments: Optional[list] = None
        if reprompt_parent_id:
            cached_src = SOURCE_CACHE_DIR / f"{reprompt_parent_id}.mp4"
            if cached_src.exists() and cached_src.stat().st_size > 0:
                video_path = job_dir / "video.mp4"
                await asyncio.to_thread(shutil.copy2, cached_src, video_path)
                log(job_id, f"Reprompt: reusing cached source from {reprompt_parent_id}")
            tr = OUTPUT_DIR / reprompt_parent_id / "transcript.json"
            if tr.exists():
                try:
                    segments = json.loads(tr.read_text(encoding="utf-8"))
                    log(job_id, f"Reprompt: reusing cached transcript ({len(segments)} segments)")
                except Exception as _te:
                    log(job_id, f"Reprompt: transcript cache unreadable ({_te}) — re-transcribing")
                    segments = None

        # 1. Download
        if video_path is None:
            log(job_id, "--- PHASE 1: DOWNLOAD ---")
            video_path = await download_video(req.url, job_dir, job_id)
            log(job_id, f"Download done → {video_path} ({video_path.stat().st_size / 1_048_576:.1f} MB)")

        # 2. Transcribe
        if segments is None:
            log(job_id, "--- PHASE 2: TRANSCRIBE ---")
            segments = await transcribe(video_path, job_id)
            log(job_id, f"Transcription done → {len(segments)} segments")

        # Save transcript alongside output clips so it survives temp cleanup
        out_dir = OUTPUT_DIR / job_id
        out_dir.mkdir(exist_ok=True)
        (out_dir / "transcript.json").write_text(json.dumps(segments, indent=2))

        # Excitement signals: a cheap audio-energy pass for every job (feeds
        # [HIGH ENERGY] annotations into the analysis); the visual scene pass
        # only for low-dialogue videos where speech alone can't rank moments.
        # Cached to signals.json so reprompts reuse it. Never fatal.
        excitement = None
        try:
            sig_path = out_dir / "signals.json"
            signals = None
            if reprompt_parent_id:
                _psig = OUTPUT_DIR / reprompt_parent_id / "signals.json"
                if _psig.exists():
                    signals = json.loads(_psig.read_text(encoding="utf-8"))
            if signals is None and sig_path.exists():
                signals = json.loads(sig_path.read_text(encoding="utf-8"))
            if signals is None:
                signals = await asyncio.to_thread(_compute_excitement_signals, video_path)
                dur_est = max(1, len(signals["rms"]))
                coverage = sum(s["end"] - s["start"] for s in segments) / dur_est
                if coverage < 0.6 and dur_est <= 7200:
                    log(job_id, f"  Low speech coverage ({coverage:.0%}) — running visual energy pass")
                    signals["cuts"] = await asyncio.to_thread(_compute_scene_cuts, video_path)
            sig_path.write_text(json.dumps(signals), encoding="utf-8")
            excitement = _excitement_windows(signals)
            if excitement:
                log(job_id, f"  Excitement: {len(excitement['hot'])} hot windows, {len(excitement['peaks'])} peaks")
        except Exception as _xe:
            log(job_id, f"  Excitement signals skipped: {_xe}")

        # 3. Clip selection: predefined (exact-clip mode / transcript editor —
        #    deterministic, no LLM selection) or the normal virality analysis.
        predefined = None
        if req.edit_keep:
            keep_abs = _normalize_keep(req.edit_keep)
            if keep_abs:
                c_start, c_end = keep_abs[0][0], keep_abs[-1][1]
                clip_def = {"start": c_start, "end": c_end,
                            "title": (req.edit_title or "").strip() or "Edited Clip"}
                if len(keep_abs) >= 2:  # mid-clip cuts → clip-relative intervals
                    clip_def["cut_keep"] = [[a - c_start, b - c_start] for a, b in keep_abs]
                predefined = [clip_def]
        elif req.exact_start_s is not None and req.exact_end_s is not None:
            predefined = [{"start": max(0.0, float(req.exact_start_s)),
                           "end": float(req.exact_end_s), "title": ""}]

        if predefined:
            log(job_id, "--- PHASE 3: PREDEFINED CLIP (selection skipped) ---")
            await update_job(job_id, status="analyzing", progress=76, message="Preparing your clip...")
            for c in predefined:
                spoken = " ".join(
                    w["word"].strip() for seg in segments for w in _fill_words(seg)
                    if c["start"] <= float(w["start"]) < c["end"])
                c.setdefault("description", "")
                c["_spoken"] = spoken
                # Grounded title/hook/tags via the shared describe pass — the
                # clip keeps a timestamp title if the LLM call fails (non-fatal).
                if not c.get("title"):
                    c["title"] = f"Clip {int(c['start'] // 60)}:{int(c['start'] % 60):02d}–{int(c['end'] // 60)}:{int(c['end'] % 60):02d}"
                    c["_energy"] = True
            try:
                await _describe_energy_clips(predefined, job_id)
            except Exception as _de:
                log(job_id, f"  describe pass skipped: {_de}")
            for c in predefined:
                c.pop("_energy", None)
                c.pop("_spoken", None)
            clips = predefined
            # Deterministic renders carry no AI keyword/emoji metadata — the
            # overlays would point at content the model never scored.
            if req.caption_overrides:
                segments = _apply_caption_overrides(segments, req.caption_overrides)
        else:
            log(job_id, "--- PHASE 3: ANALYZE ---")
            clips = await analyze_virality(
                segments, job_id,
                req.max_clips, req.min_duration, req.max_duration,
                style_prompt=req.style_prompt or "",
                exclude_prompt=req.exclude_prompt or "",
                timeframe_start=(req.timeframe_start_min * 60) if req.timeframe_start_min else None,
                timeframe_end=(req.timeframe_end_min * 60) if req.timeframe_end_min else None,
                excitement=excitement,
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
        # Brand kit (Pro): watermark overlay + brand color as the default
        # caption highlight when the user left the color on AUTO.
        brand_overlay = None
        if user_id:
            try:
                _bprof = await asyncio.to_thread(db_get_profile, user_id)
                _brand = ((_bprof or {}).get("options") or {}).get("brand") or {}
                if _brand.get("enabled") and (_bprof or {}).get("plan") == "pro":
                    _logo = BRAND_DIR / f"{user_id}.png"
                    if _logo.exists():
                        brand_overlay = {"logo": _logo,
                                         "position": _brand.get("position") or "br",
                                         "opacity": _brand.get("opacity") or 0.5,
                                         "size": _brand.get("size") or 0.15}
                    if _brand.get("color") and not req.caption_highlight_color:
                        req.caption_highlight_color = _brand["color"]
            except Exception as _be:
                log(job_id, f"  Brand kit skipped: {_be}")
        log(job_id, f"  caption_style={req.caption_style!r} lang={req.caption_language} font_size={req.caption_font_size} highlight={req.caption_highlight_color} reframe={req.reframe}")
        await _acquire_render_slot(job_id)
        try:
            final_clips = await create_clips(
                video_path, clips, segments, job_dir, job_id,
                reframe=req.reframe,
                clip_style=req.layout or req.clip_style,
                aspect_ratio=req.aspect_ratio or "9:16",
                manual_facecam_box=req.facecam_box,
                caption_style=req.caption_style or "bold_bottom",
                font_size=req.caption_font_size,
                highlight_color=req.caption_highlight_color,
                caption_position=req.caption_position,
                caption_keywords=req.caption_keywords,
                caption_emoji=req.caption_emoji,
                caption_segments=caption_segs,
                bg_music_url=req.bg_music_url,
                bg_music_volume=req.bg_music_volume,
                trim_silence=req.trim_silence,
                remove_fillers=req.remove_fillers,
                brand_overlay=brand_overlay,
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
        # Keep the source briefly so a reprompt can skip the re-download (moved,
        # not copied — the temp dir is deleted in finally anyway). Best-effort.
        try:
            if video_path.exists():
                await asyncio.to_thread(shutil.move, str(video_path), str(SOURCE_CACHE_DIR / f"{job_id}.mp4"))
        except Exception as _sce:
            log(job_id, f"source cache skipped: {_sce}")
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
            req = _channel_clip_request(bf, video["url"])
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


async def source_cache_sweeper():
    """Bound the reprompt source cache: delete sources older than
    SOURCE_RETENTION_HOURS, then oldest-first if the dir exceeds
    SOURCE_CACHE_MAX_GB. Runs hourly; the cache is only an optimization, so
    aggressive deletion is always safe (reprompt falls back to re-download)."""
    await asyncio.sleep(180)  # let startup settle
    while True:
        try:
            def _sweep():
                import time as _t
                files = sorted(SOURCE_CACHE_DIR.glob("*.mp4"), key=lambda p: p.stat().st_mtime)
                now = _t.time()
                removed = 0
                for p in list(files):
                    if now - p.stat().st_mtime > SOURCE_RETENTION_HOURS * 3600:
                        p.unlink(missing_ok=True)
                        files.remove(p)
                        removed += 1
                total = sum(p.stat().st_size for p in files if p.exists())
                budget = SOURCE_CACHE_MAX_GB * 1024 ** 3
                while files and total > budget:
                    p = files.pop(0)
                    try:
                        total -= p.stat().st_size
                        p.unlink(missing_ok=True)
                        removed += 1
                    except OSError:
                        pass
                return removed, total
            removed, total = await asyncio.to_thread(_sweep)
            if removed:
                print(f"[source_cache] swept {removed} sources, {total / 1024**3:.1f} GB kept", flush=True)
        except Exception as e:
            print(f"[source_cache] sweeper error: {e}", flush=True)
        await asyncio.sleep(3600)


async def temp_sweeper():
    """Delete stale job dirs (and stray files) from TEMP_DIR. Jobs clean up
    after themselves on success, but a crashed pipeline leaks its whole temp
    dir — 48 leaked dirs (~5 GB) filled the root disk on 2026-07-06. Anything
    older than TEMP_RETENTION_HOURS is garbage: no pipeline runs remotely that
    long (the download watchdog alone kills at 20 min)."""
    retention_s = float(os.getenv("TEMP_RETENTION_HOURS", "24") or "24") * 3600
    await asyncio.sleep(240)  # let startup settle
    while True:
        try:
            def _sweep():
                import time as _t
                now, removed = _t.time(), 0
                for p in TEMP_DIR.iterdir():
                    try:
                        if p.is_dir():
                            # Newest mtime inside decides: an active job keeps
                            # touching its files; a leaked dir goes cold.
                            newest = max([p.stat().st_mtime]
                                         + [f.stat().st_mtime for f in p.rglob("*")])
                            if now - newest > retention_s:
                                shutil.rmtree(p, ignore_errors=True)
                                removed += 1
                        elif now - p.stat().st_mtime > retention_s:
                            p.unlink(missing_ok=True)  # stray frame_*.jpg etc.
                            removed += 1
                    except OSError:
                        continue
                return removed
            removed = await asyncio.to_thread(_sweep)
            if removed:
                print(f"[temp] swept {removed} stale job dirs/files", flush=True)
        except Exception as e:
            print(f"[temp] sweeper error: {e}", flush=True)
        await asyncio.sleep(6 * 3600)


async def scheduled_post_publisher():
    """Publish due scheduled posts through the existing YouTube/TikTok upload
    workers. Runs every 60s; each post is claimed (status=publishing) before
    the upload so a crash can't double-post, and the final state is read back
    from the clip's upload record."""
    await asyncio.sleep(120)  # let startup settle
    while True:
        try:
            now_iso = datetime.now(timezone.utc).isoformat()
            due = await asyncio.to_thread(db_due_scheduled_posts, now_iso)
            for post in due:
                pid = post["id"]
                try:
                    await asyncio.to_thread(db_update_scheduled_post, pid, {"status": "publishing"})
                    job = db_get_job(post["job_id"])
                    clips = (job or {}).get("clips") or []
                    idx = int(post["clip_index"])
                    if not job or not (0 <= idx < len(clips)):
                        await asyncio.to_thread(db_update_scheduled_post, pid,
                                                {"status": "error", "error": "Clip no longer exists"})
                        continue
                    clip = clips[idx]
                    if post["platform"] == "youtube":
                        req_data = {
                            "title": post.get("title") or clip.get("title") or "Clip",
                            "description": post.get("description") or "",
                            "tags": clip.get("tags") or [],
                            "privacy_status": post.get("privacy") or "public",
                            "yt_channel_id": post.get("target_id"),
                        }
                        await asyncio.to_thread(do_youtube_upload, post["job_id"], idx, req_data, post["user_id"])
                        job2 = db_get_job(post["job_id"]) or {}
                        up = ((job2.get("clips") or [{}] * (idx + 1))[idx] or {}).get("yt_upload") or {}
                    else:
                        req_data = {
                            "tt_open_id": post.get("target_id"),
                            "title": post.get("title") or clip.get("title") or "",
                            "privacy_level": post.get("privacy"),
                        }
                        await asyncio.to_thread(do_tiktok_upload, post["job_id"], idx, req_data, post["user_id"])
                        job2 = db_get_job(post["job_id"]) or {}
                        up = ((job2.get("clips") or [{}] * (idx + 1))[idx] or {}).get("tt_upload") or {}
                    if up.get("status") == "done":
                        await asyncio.to_thread(db_update_scheduled_post, pid, {"status": "done"})
                    elif up.get("status") == "error":
                        await asyncio.to_thread(db_update_scheduled_post, pid,
                                                {"status": "error", "error": (up.get("error") or "upload failed")[:500]})
                    else:
                        # upload still in flight (chunked) — leave as publishing;
                        # the clip card shows live progress either way.
                        await asyncio.to_thread(db_update_scheduled_post, pid, {"status": "done"})
                except Exception as pe:
                    try:
                        await asyncio.to_thread(db_update_scheduled_post, pid,
                                                {"status": "error", "error": str(pe)[:500]})
                    except Exception:
                        pass
        except Exception as e:
            print(f"[scheduler] publisher error: {e}", flush=True)
        await asyncio.sleep(60)


@app.on_event("startup")
async def startup_event():
    asyncio.create_task(watchdog())
    asyncio.create_task(channel_poller())
    asyncio.create_task(analytics_refresher())
    asyncio.create_task(backfill_scheduler())
    asyncio.create_task(clip_cleanup_scheduler())
    asyncio.create_task(public_stats_aggregator())
    asyncio.create_task(source_cache_sweeper())
    asyncio.create_task(temp_sweeper())
    asyncio.create_task(scheduled_post_publisher())

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
    _effective_layout = _LAYOUT_ALIASES.get(req.layout or req.clip_style, req.layout or req.clip_style)
    if plan != "pro":
        if _effective_layout in ("blur_bg", "gameplay", "fit", "split", "screenshare", "auto"):
            raise HTTPException(403, "This layout requires a Pro plan. Upgrade to unlock.")
        if req.aspect_ratio and req.aspect_ratio != "9:16":
            raise HTTPException(403, "1:1 and 16:9 output formats require a Pro plan. Upgrade to unlock.")
        if req.trim_silence:
            raise HTTPException(403, "Trim silence requires a Pro plan. Upgrade to unlock.")
    req.max_clips = min(req.max_clips, max_clips_per_job)
    # Exact-clip mode: user picked a precise source range — validate it here so
    # a bad range fails fast instead of after a full download.
    req.edit_keep = None          # editor internals are never accepted from this endpoint
    req.caption_overrides = None
    if (req.exact_start_s is None) != (req.exact_end_s is None):
        raise HTTPException(400, "Exact clip needs both a start and an end time.")
    if req.exact_start_s is not None:
        if req.exact_start_s < 0 or req.exact_end_s <= req.exact_start_s:
            raise HTTPException(400, "Exact clip end must be after its start.")
        span = req.exact_end_s - req.exact_start_s
        if span < 3.0:
            raise HTTPException(400, "Exact clip must be at least 3 seconds.")
        if span > 180.0:
            raise HTTPException(400, "Exact clip can be at most 3 minutes.")
        req.max_clips = 1
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
            "caption_emoji": req.caption_emoji,
            "exclude_prompt": req.exclude_prompt,
            "timeframe_start_min": req.timeframe_start_min,
            "timeframe_end_min": req.timeframe_end_min,
            "clip_style": req.clip_style,
            "layout": req.layout,
            "aspect_ratio": req.aspect_ratio,
            "facecam_box": req.facecam_box,
            "trim_silence": req.trim_silence,
            "remove_fillers": req.remove_fillers,
            "exact_start_s": req.exact_start_s,
            "exact_end_s": req.exact_end_s,
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


@app.get("/api/jobs/{job_id}/frame")
async def job_frame(job_id: str, t: float = 2.0, user=Depends(require_auth)):
    """A single JPEG frame from the job's cached source video, for the manual
    facecam-box picker. 404s once the source cache has expired."""
    job = db_get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    if job.get("user_id") != user.id:
        raise HTTPException(403, "Forbidden")
    src = SOURCE_CACHE_DIR / f"{job_id}.mp4"
    if not src.exists():
        raise HTTPException(404, "Source video no longer cached — run the job again first")
    out = TEMP_DIR / f"frame_{job_id}_{int(max(0.0, t) * 1000)}.jpg"
    code, _, err = await run_cmd_async([
        FFMPEG, "-y", "-ss", str(max(0.0, t)), "-i", str(src),
        "-frames:v", "1", "-vf", "scale=960:-2", "-q:v", "5", str(out)])
    if code != 0 or not out.exists():
        raise HTTPException(500, "Could not extract a frame")
    data = out.read_bytes()
    out.unlink(missing_ok=True)
    return Response(content=data, media_type="image/jpeg",
                    headers={"Cache-Control": "private, max-age=300"})


def _srt_ts(t: float) -> str:
    ms = int(round(max(0.0, t) * 1000))
    h, rem = divmod(ms, 3600000)
    m, rem = divmod(rem, 60000)
    s, ms = divmod(rem, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _format_srt(words: list, max_chars: int = 42, max_gap: float = 0.6,
                max_span: float = 3.5) -> str:
    """Word timings → standard SRT blocks: new block on a speech gap, a
    too-long line, or a too-long span."""
    blocks, cur = [], []
    for w in words:
        if cur and (w["start"] - cur[-1]["end"] > max_gap
                    or w["end"] - cur[0]["start"] > max_span
                    or len(" ".join(x["word"] for x in cur)) + len(w["word"]) + 1 > max_chars):
            blocks.append(cur)
            cur = []
        cur.append(w)
    if cur:
        blocks.append(cur)
    out = []
    for i, b in enumerate(blocks, 1):
        out.append(f"{i}\n{_srt_ts(b[0]['start'])} --> {_srt_ts(b[-1]['end'])}\n"
                   + " ".join(x["word"] for x in b))
    return "\n\n".join(out) + "\n"


def _fps_rational(fps: float) -> tuple:
    """frameDuration as an exact rational for NTSC rates, 1/round(fps) otherwise."""
    for real, (num, den) in {23.976: (1001, 24000), 29.97: (1001, 30000),
                             59.94: (1001, 60000)}.items():
        if abs(fps - real) < 0.01:
            return num, den
    r = max(1, int(round(fps)))
    return 1, r


def _export_segments(meta: dict) -> list:
    """The clip's cut plan as SOURCE-time (in, out) pairs (uncut → one pair)."""
    start = float(meta["start"])
    if meta.get("keep"):
        return [(start + a, start + b) for a, b in meta["keep"]]
    return [(start, float(meta["end"]))]


def _format_xmeml(meta: dict, title: str, src_name: str) -> str:
    """Premiere-compatible 'Final Cut Pro XML' (xmeml v4): one video sequence
    whose clipitems reproduce the clip's cuts against the source file."""
    from xml.sax.saxutils import escape
    tb = max(1, int(round(float(meta.get("fps") or 30))))
    w, h = int(meta.get("src_w") or 1920), int(meta.get("src_h") or 1080)
    segs = _export_segments(meta)
    items, tl = [], 0
    for i, (a, b) in enumerate(segs, 1):
        fin, fout = int(round(a * tb)), int(round(b * tb))
        d = max(1, fout - fin)
        items.append(f"""      <clipitem id="clip-{i}">
        <name>{escape(title)}</name>
        <rate><timebase>{tb}</timebase><ntsc>FALSE</ntsc></rate>
        <start>{tl}</start><end>{tl + d}</end>
        <in>{fin}</in><out>{fout}</out>
        <file id="src-file">
          <name>{escape(src_name)}</name>
          <pathurl>file://localhost/{escape(src_name)}</pathurl>
          <rate><timebase>{tb}</timebase><ntsc>FALSE</ntsc></rate>
          <media><video><samplecharacteristics><width>{w}</width><height>{h}</height></samplecharacteristics></video><audio/></media>
        </file>
      </clipitem>""")
        tl += d
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="4">
 <sequence>
  <name>{escape(title)}</name>
  <rate><timebase>{tb}</timebase><ntsc>FALSE</ntsc></rate>
  <media><video>
    <format><samplecharacteristics><rate><timebase>{tb}</timebase><ntsc>FALSE</ntsc></rate><width>{w}</width><height>{h}</height></samplecharacteristics></format>
    <track>
{chr(10).join(items)}
    </track>
  </video></media>
 </sequence>
</xmeml>
"""


def _format_fcpxml(meta: dict, title: str, src_name: str) -> str:
    """FCPXML 1.9 for Final Cut Pro / DaVinci Resolve: asset-clips on a spine
    reproducing the clip's cuts. Times snapped to frame boundaries."""
    from xml.sax.saxutils import escape
    fps = float(meta.get("fps") or 30)
    num, den = _fps_rational(fps)
    w, h = int(meta.get("src_w") or 1920), int(meta.get("src_h") or 1080)

    def ts(t: float) -> str:
        frames = int(round(t * den / num))
        return f"{frames * num}/{den}s"

    segs = _export_segments(meta)
    clips, offset = [], 0.0
    for a, b in segs:
        clips.append(f'      <asset-clip ref="r2" offset="{ts(offset)}" start="{ts(a)}" '
                     f'duration="{ts(b - a)}" name="{escape(title)}"/>')
        offset += b - a
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.9">
  <resources>
    <format id="r1" name="FFVideoFormatRateUndefined" frameDuration="{num}/{den}s" width="{w}" height="{h}"/>
    <asset id="r2" name="{escape(src_name)}" src="file:///{escape(src_name)}" start="0s" hasVideo="1" hasAudio="1" format="r1"/>
  </resources>
  <library>
    <event name="ClipForge">
      <project name="{escape(title)}">
        <sequence format="r1">
          <spine>
{chr(10).join(clips)}
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
"""


@app.get("/api/jobs/{job_id}/clips/{clip_idx}/export")
async def export_clip(job_id: str, clip_idx: int, fmt: str = "srt", user=Depends(require_auth)):
    """Per-clip exports: SRT captions (free), Premiere XML / FCPXML timelines
    (Pro). Uses the render-time snapshot (captions_{idx}.json) so timings match
    the rendered video exactly, including editor/filler/silence cuts; falls
    back to the raw transcript window for pre-snapshot jobs (uncut only)."""
    job = db_get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    if job.get("user_id") != user.id:
        raise HTTPException(403, "Forbidden")
    if fmt not in ("srt", "xml", "fcpxml"):
        raise HTTPException(400, "fmt must be srt, xml, or fcpxml")
    clips = job.get("clips") or []
    if not (0 <= clip_idx < len(clips)):
        raise HTTPException(404, "clip not found")
    if fmt in ("xml", "fcpxml"):
        profile = db_check_and_reset_quota(user.id)
        if profile.get("plan", "free") != "pro":
            raise HTTPException(403, "Timeline export (Premiere/FCP XML) requires a Pro plan.")

    c = clips[clip_idx]
    title = c.get("title") or f"Clip {clip_idx + 1}"
    meta = None
    mf = OUTPUT_DIR / job_id / f"captions_{clip_idx}.json"
    if mf.exists():
        try:
            meta = json.loads(mf.read_text(encoding="utf-8"))
        except Exception:
            meta = None
    if meta is None:
        # Pre-snapshot job: rebuild from the transcript window (uncut clips only).
        tr = OUTPUT_DIR / job_id / "transcript.json"
        if not tr.exists():
            raise HTTPException(404, "Export data not available for this job — re-run it first")
        segs = json.loads(tr.read_text(encoding="utf-8"))
        cs, ce = float(c.get("start") or 0), float(c.get("end") or 0)
        words = [{"word": str(w["word"]).strip(),
                  "start": round(float(w["start"]) - cs, 3),
                  "end": round(float(w["end"]) - cs, 3)}
                 for seg in segs for w in _fill_words(seg)
                 if cs <= float(w["start"]) < ce]
        meta = {"fps": 30.0, "src_w": 1920, "src_h": 1080,
                "start": cs, "end": ce, "duration": ce - cs, "keep": None, "words": words}

    _vid_m = re.search(r"(?:v=|youtu\.be/|shorts/)([A-Za-z0-9_-]{6,})", job.get("url") or "")
    src_name = f"{_vid_m.group(1) if _vid_m else 'source'}.mp4"
    safe = re.sub(r"[^\w]+", "_", title)[:40] or f"clip_{clip_idx + 1}"
    if fmt == "srt":
        body, mt, ext = _format_srt(meta.get("words") or []), "application/x-subrip", "srt"
    elif fmt == "xml":
        body, mt, ext = _format_xmeml(meta, title, src_name), "application/xml", "xml"
    else:
        body, mt, ext = _format_fcpxml(meta, title, src_name), "application/xml", "fcpxml"
    return Response(content=body, media_type=mt,
                    headers={"Content-Disposition": f'attachment; filename="{safe}.{ext}"'})


@app.post("/api/schedule")
@_limiter.limit("20/minute")
async def create_schedule(request: Request, req: ScheduleRequest, user=Depends(require_pro)):
    """Queue a rendered clip for publishing at a specific time (Pro).
    Clips auto-expire from storage ~7 days after the job, so publish_at is
    capped at 6 days out."""
    if req.platform not in ("youtube", "tiktok"):
        raise HTTPException(400, "platform must be youtube or tiktok")
    job = db_get_job(req.job_id)
    if not job or job.get("user_id") != user.id:
        raise HTTPException(404, "Job not found")
    clips = job.get("clips") or []
    if not (0 <= req.clip_index < len(clips)):
        raise HTTPException(404, "clip not found")
    if job.get("clips_expired"):
        raise HTTPException(400, "This job's clips have expired from storage")
    try:
        when = parse_iso(req.publish_at)
    except Exception:
        raise HTTPException(400, "publish_at must be an ISO timestamp")
    now = datetime.now(timezone.utc)
    if when <= now:
        raise HTTPException(400, "publish_at must be in the future")
    if (when - now).total_seconds() > 6 * 86400:
        raise HTTPException(400, "Clips expire from storage after ~7 days — schedule at most 6 days out")
    post = await asyncio.to_thread(db_create_scheduled_post, {
        "user_id": user.id,
        "job_id": req.job_id,
        "clip_index": req.clip_index,
        "platform": req.platform,
        "target_id": req.target_id,
        "title": (req.title or "").strip() or None,
        "description": req.description,
        "privacy": req.privacy,
        "publish_at": when.isoformat(),
        "status": "scheduled",
    })
    return {"id": post["id"]}


@app.get("/api/schedule")
async def list_schedule(user=Depends(require_auth)):
    posts = await asyncio.to_thread(db_get_user_scheduled_posts, user.id)
    # decorate with clip titles/thumbnails for the calendar
    jobs_cache: dict = {}
    for p in posts:
        jid = p["job_id"]
        if jid not in jobs_cache:
            jobs_cache[jid] = db_get_job(jid) or {}
        clips = jobs_cache[jid].get("clips") or []
        c = clips[p["clip_index"]] if 0 <= p["clip_index"] < len(clips) else {}
        p["clip_title"] = p.get("title") or c.get("title") or f"Clip {p['clip_index'] + 1}"
        p["thumbnail_url"] = c.get("thumbnail_url")
    return {"posts": posts}


@app.delete("/api/schedule/{post_id}")
async def cancel_schedule(post_id: str, user=Depends(require_auth)):
    post = await asyncio.to_thread(db_get_scheduled_post, post_id)
    if not post or post.get("user_id") != user.id:
        raise HTTPException(404, "Not found")
    if post.get("status") not in ("scheduled", "error"):
        raise HTTPException(400, f"Cannot cancel a post that is {post.get('status')}")
    await asyncio.to_thread(db_update_scheduled_post, post_id, {"status": "cancelled"})
    return {"ok": True}


@app.get("/api/brand")
async def get_brand(user=Depends(require_auth)):
    """The user's brand kit settings (+ whether a logo is uploaded)."""
    profile = db_get_profile(user.id) or {}
    brand = ((profile.get("options") or {}).get("brand")) or {}
    return {
        "enabled": bool(brand.get("enabled")),
        "position": brand.get("position") or "br",
        "opacity": brand.get("opacity") if brand.get("opacity") is not None else 0.5,
        "size": brand.get("size") if brand.get("size") is not None else 0.15,
        "color": brand.get("color"),
        "has_logo": (BRAND_DIR / f"{user.id}.png").exists(),
    }


@app.put("/api/brand")
async def put_brand(req: BrandSettings, user=Depends(require_pro)):
    """Save brand kit settings into profiles.options.brand (requires the
    profiles.options JSONB column — see sql/profiles_options.sql)."""
    if req.position not in ("tl", "tr", "bl", "br"):
        raise HTTPException(400, "position must be tl/tr/bl/br")
    if not (0.05 <= req.opacity <= 1.0):
        raise HTTPException(400, "opacity must be 0.05-1.0")
    if not (0.05 <= req.size <= 0.35):
        raise HTTPException(400, "size must be 0.05-0.35")
    if req.color and not re.fullmatch(r"#[0-9a-fA-F]{6}", req.color):
        raise HTTPException(400, "color must be a #rrggbb hex")
    profile = db_get_profile(user.id) or {}
    options = profile.get("options") or {}
    options["brand"] = {"enabled": req.enabled, "position": req.position,
                        "opacity": req.opacity, "size": req.size, "color": req.color}
    await asyncio.to_thread(db_update_profile, user.id, {"options": options})
    return {"ok": True}


@app.post("/api/brand/logo")
async def upload_brand_logo(file: UploadFile = File(...), user=Depends(require_pro)):
    """Upload the watermark logo (PNG with transparency, max 2 MB)."""
    data = await file.read()
    if len(data) > 2 * 1024 * 1024:
        raise HTTPException(400, "Logo must be under 2 MB")
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        raise HTTPException(400, "Logo must be a PNG (transparency supported)")
    (BRAND_DIR / f"{user.id}.png").write_bytes(data)
    return {"ok": True}


@app.get("/api/brand/logo")
async def get_brand_logo(user=Depends(require_auth)):
    p = BRAND_DIR / f"{user.id}.png"
    if not p.exists():
        raise HTTPException(404, "No logo uploaded")
    return Response(content=p.read_bytes(), media_type="image/png",
                    headers={"Cache-Control": "private, max-age=60"})


@app.delete("/api/brand/logo")
async def delete_brand_logo(user=Depends(require_pro)):
    (BRAND_DIR / f"{user.id}.png").unlink(missing_ok=True)
    return {"ok": True}


@app.get("/api/jobs/{job_id}/transcript")
async def job_transcript(job_id: str, clip: Optional[int] = None, user=Depends(require_auth)):
    """Sentence-grouped transcript for the clip editor. With ?clip=N, returns a
    window spanning that clip ±60s (edit an existing clip); without it, the
    whole video (transcript browser / create-from-scratch)."""
    job = db_get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    if job.get("user_id") != user.id:
        raise HTTPException(403, "Forbidden")
    tr = OUTPUT_DIR / job_id / "transcript.json"
    if not tr.exists():
        raise HTTPException(404, "Transcript not available for this job")
    try:
        segments = json.loads(tr.read_text(encoding="utf-8"))
    except Exception:
        raise HTTPException(500, "Transcript unreadable")

    clip_info, t0, t1 = None, None, None
    if clip is not None:
        clips = job.get("clips") or []
        if not (0 <= clip < len(clips)):
            raise HTTPException(400, "clip index out of range")
        c = clips[clip]
        clip_info = {"start": c.get("start"), "end": c.get("end"), "title": c.get("title", "")}
        t0 = max(0.0, float(c.get("start", 0)) - 60.0)
        t1 = float(c.get("end", 0)) + 60.0
    sentences = _group_sentences(segments, t0, t1)
    last_end = 0.0
    for seg in segments or []:
        if seg.get("end"):
            last_end = max(last_end, float(seg["end"]))
    return {"clip": clip_info, "source_duration": round(last_end, 3),
            "cached_source": (SOURCE_CACHE_DIR / f"{job_id}.mp4").exists(),
            "sentences": sentences}


@app.post("/api/jobs/{job_id}/edit")
@_limiter.limit("10/minute")
async def edit_clip(request: Request, job_id: str, req: EditClipRequest, user=Depends(require_auth)):
    """Render a user-authored cut of an already-processed video: keep-intervals
    chosen in the transcript editor (trim/extend/mid-cuts) + optional caption
    text fixes. Deterministic child job — no AI selection phase."""
    parent = db_get_job(job_id)
    if not parent:
        raise HTTPException(404, "Job not found")
    if parent.get("user_id") != user.id:
        raise HTTPException(403, "Forbidden")
    if parent.get("status") != "done":
        raise HTTPException(400, "Editing is only available for finished jobs")

    keep = _normalize_keep(req.keep)
    if not keep:
        raise HTTPException(400, "No valid keep intervals")
    if len(keep) > 20:
        raise HTTPException(400, "Too many segments (max 20)")
    total = sum(b - a for a, b in keep)
    if total < 3.0:
        raise HTTPException(400, "Edited clip must be at least 3 seconds")
    if total > 180.0:
        raise HTTPException(400, "Edited clip can be at most 3 minutes")

    profile = db_check_and_reset_quota(user.id)
    plan = profile.get("plan", "free")
    if plan != "pro":
        claimed = db_claim_clips_atomic(user.id, 1, FREE_MONTHLY_JOB_LIMIT)
        if not claimed:
            raise HTTPException(403, f"Monthly free limit reached ({FREE_MONTHLY_JOB_LIMIT} jobs). Upgrade to Pro for unlimited.")

    popt = parent.get("options") or {}
    base_title = None
    if req.clip_index is not None:
        pclips = parent.get("clips") or []
        if 0 <= req.clip_index < len(pclips):
            base_title = pclips[req.clip_index].get("title")
    child_req = ClipRequest(
        url=parent.get("url", ""),
        max_clips=1,
        min_duration=3,
        max_duration=180,
        # Visual settings carry over from the parent; Pro features are stripped
        # (not errored) if the plan no longer allows them — mirrors reprompt.
        reframe=bool(parent.get("reframe")) and plan == "pro",
        clip_style=((popt.get("layout") or popt.get("clip_style") or "reframe")
                    if plan == "pro" else "reframe"),
        aspect_ratio=(popt.get("aspect_ratio") or "9:16") if plan == "pro" else "9:16",
        facecam_box=popt.get("facecam_box"),
        caption_style=parent.get("caption_style") or "bold_bottom",
        caption_font_size=parent.get("caption_font_size"),
        caption_highlight_color=parent.get("caption_highlight_color"),
        caption_position=popt.get("caption_position"),
        caption_keywords=popt.get("caption_keywords", True) is not False,
        caption_emoji=False,  # emoji were LLM-placed against the old cut
        caption_language=parent.get("caption_language") or "source",
        bg_music_url=parent.get("bg_music_url"),
        bg_music_volume=parent.get("bg_music_volume") or 0.15,
        edit_keep=[[a, b] for a, b in keep],
        edit_title=(req.title or "").strip() or (f"{base_title} (edited)" if base_title else None),
        caption_overrides=req.caption_overrides,
        remove_fillers=req.remove_fillers,
    )

    child = db_create_job({
        "user_id": user.id,
        "status": "queued",
        "progress": 0,
        "message": "Queued (edit)...",
        "clips": [],
        "error": None,
        "url": child_req.url,
        "reframe": child_req.reframe,
        "max_clips": 1,
        "min_duration": 3,
        "max_duration": 180,
        "style_prompt": "",
        "caption_style": child_req.caption_style,
        "caption_font_size": child_req.caption_font_size,
        "caption_highlight_color": child_req.caption_highlight_color,
        "caption_language": child_req.caption_language,
        "bg_music_url": child_req.bg_music_url,
        "bg_music_volume": child_req.bg_music_volume,
        "parent_job_id": job_id,
        "options": {
            "caption_position": child_req.caption_position,
            "caption_keywords": child_req.caption_keywords,
            "caption_emoji": False,
            "clip_style": child_req.clip_style,
            "aspect_ratio": child_req.aspect_ratio,
            "facecam_box": child_req.facecam_box,
            "edit_keep": child_req.edit_keep,
            "edit_of_clip": req.clip_index,
            "remove_fillers": child_req.remove_fillers,
        },
    })
    child_id = child["id"]
    task = asyncio.create_task(run_pipeline(child_id, child_req, user_id=user.id, reprompt_parent_id=job_id))
    _running_tasks[child_id] = task
    return {"job_id": child_id}


@app.post("/api/jobs/{job_id}/reprompt")
@_limiter.limit("10/minute")
async def reprompt_job(request: Request, job_id: str, req: RepromptRequest, user=Depends(require_auth)):
    """Find more/different clips in an already-processed video. Creates a child
    job that reuses the parent's cached source + transcript (skipping download
    and transcription when the cache is warm) with a new find/exclude prompt."""
    parent = db_get_job(job_id)
    if not parent:
        raise HTTPException(404, "Job not found")
    if parent.get("user_id") != user.id:
        raise HTTPException(403, "Forbidden")
    if parent.get("status") != "done":
        raise HTTPException(400, "Reprompt is only available for finished jobs")

    profile = db_check_and_reset_quota(user.id)
    plan = profile.get("plan", "free")
    max_clips_per_job = PRO_MAX_CLIPS_PER_JOB if plan == "pro" else FREE_MAX_CLIPS_PER_JOB
    if plan != "pro":
        claimed = db_claim_clips_atomic(user.id, 1, FREE_MONTHLY_JOB_LIMIT)
        if not claimed:
            raise HTTPException(403, f"Monthly free limit reached ({FREE_MONTHLY_JOB_LIMIT} jobs). Upgrade to Pro for unlimited.")

    popt = parent.get("options") or {}
    child_req = ClipRequest(
        url=parent.get("url", ""),
        max_clips=min(req.max_clips or parent.get("max_clips") or 3, max_clips_per_job),
        min_duration=req.min_duration or parent.get("min_duration") or 30,
        max_duration=req.max_duration or parent.get("max_duration") or 90,
        # Visual settings carry over from the parent; Pro features are stripped
        # (not errored) if the plan no longer allows them.
        reframe=bool(parent.get("reframe")) and plan == "pro",
        clip_style=((req.layout or popt.get("layout") or popt.get("clip_style") or "reframe")
                    if plan == "pro" else "reframe"),
        aspect_ratio=(popt.get("aspect_ratio") or "9:16") if plan == "pro" else "9:16",
        facecam_box=req.facecam_box if req.facecam_box is not None else popt.get("facecam_box"),
        trim_silence=bool(popt.get("trim_silence")) and plan == "pro",
        remove_fillers=bool(popt.get("remove_fillers")),
        style_prompt=(req.find if req.find is not None else parent.get("style_prompt")) or None,
        exclude_prompt=(req.exclude if req.exclude is not None else popt.get("exclude_prompt")) or None,
        timeframe_start_min=req.timeframe_start_min if req.timeframe_start_min is not None else popt.get("timeframe_start_min"),
        timeframe_end_min=req.timeframe_end_min if req.timeframe_end_min is not None else popt.get("timeframe_end_min"),
        caption_style=parent.get("caption_style") or "bold_bottom",
        caption_font_size=parent.get("caption_font_size"),
        caption_highlight_color=parent.get("caption_highlight_color"),
        caption_position=popt.get("caption_position"),
        caption_keywords=popt.get("caption_keywords", True) is not False,
        caption_emoji=popt.get("caption_emoji", True) is not False,
        caption_language=parent.get("caption_language") or "source",
        bg_music_url=parent.get("bg_music_url"),
        bg_music_volume=parent.get("bg_music_volume") or 0.15,
    )

    child = db_create_job({
        "user_id": user.id,
        "status": "queued",
        "progress": 0,
        "message": "Queued (reprompt)...",
        "clips": [],
        "error": None,
        "url": child_req.url,
        "reframe": child_req.reframe,
        "max_clips": child_req.max_clips,
        "min_duration": child_req.min_duration,
        "max_duration": child_req.max_duration,
        "style_prompt": child_req.style_prompt or "",
        "caption_style": child_req.caption_style,
        "caption_font_size": child_req.caption_font_size,
        "caption_highlight_color": child_req.caption_highlight_color,
        "caption_language": child_req.caption_language,
        "bg_music_url": child_req.bg_music_url,
        "bg_music_volume": child_req.bg_music_volume,
        "parent_job_id": job_id,
        "options": {
            "caption_position": child_req.caption_position,
            "caption_keywords": child_req.caption_keywords,
            "caption_emoji": child_req.caption_emoji,
            "exclude_prompt": child_req.exclude_prompt,
            "timeframe_start_min": child_req.timeframe_start_min,
            "timeframe_end_min": child_req.timeframe_end_min,
            "clip_style": child_req.clip_style,
            "aspect_ratio": child_req.aspect_ratio,
            "facecam_box": child_req.facecam_box,
            "trim_silence": child_req.trim_silence,
            "remove_fillers": child_req.remove_fillers,
        },
    })
    child_id = child["id"]
    task = asyncio.create_task(run_pipeline(child_id, child_req, user_id=user.id, reprompt_parent_id=job_id))
    _running_tasks[child_id] = task
    return {"job_id": child_id}


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
        "options": {k: getattr(req, k) for k in _OPTIONS_FIELDS},
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
    # New-style knobs live in the options JSONB bag — merge, don't clobber.
    opt_updates = {k: updates.pop(k) for k in list(updates) if k in _OPTIONS_FIELDS}
    if opt_updates:
        updates["options"] = {**(bf.get("options") or {}), **opt_updates}
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
        "options": {k: getattr(req, k) for k in _OPTIONS_FIELDS},
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
    # New-style knobs live in the options JSONB bag — merge, don't clobber.
    opt_updates = {k: updates.pop(k) for k in list(updates) if k in _OPTIONS_FIELDS}
    if opt_updates:
        current = db_get_channel(channel_id) or {}
        updates["options"] = {**(current.get("options") or {}), **opt_updates}
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
        # Same builder as the poller — the manual check previously dropped
        # clip_style/music/trim (and all the new knobs).
        clip_req = _channel_clip_request(ch, video_url)
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

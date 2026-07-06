"""
Supabase database layer for ClipForge.
All tables: jobs, channels, youtube_tokens, profiles.
Uses the service_role key so RLS is bypassed — the API layer enforces ownership.
"""
import os
import re
import time
from datetime import datetime, timezone
from typing import Optional
import httpx
from supabase import create_client, Client

_client: Optional[Client] = None


def parse_iso(ts: str) -> datetime:
    """Parse an ISO-8601 timestamp tolerantly and return a tz-aware datetime.

    Postgres/Supabase return variable fractional-second precision (trailing
    zeros stripped, e.g. '...45.11825+00:00'), which datetime.fromisoformat()
    rejects before Python 3.11 unless the fraction is exactly 3 or 6 digits.
    Normalize the fraction to 6 digits so it parses on every Python version.
    """
    s = (ts or "").strip().replace("Z", "+00:00")
    m = re.match(r'^(.*T\d{2}:\d{2}:\d{2})\.(\d+)(.*)$', s)
    if m:
        s = f"{m.group(1)}.{(m.group(2) + '000000')[:6]}{m.group(3)}"
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt

# Transient connection errors. The Supabase client uses a single shared HTTP/2
# connection; when many pipelines write concurrently (e.g. a digest running
# several videos at once), that multiplexed connection can get corrupted and the
# server drops it ("Server disconnected"). These are safe to retry on a fresh
# connection — a single one-off manual run never hits this, which is why digest
# failed while manual worked.
_RETRYABLE = (
    httpx.RemoteProtocolError,
    httpx.ConnectError,
    httpx.ReadError,
    httpx.WriteError,
    httpx.PoolTimeout,
    httpx.ConnectTimeout,
    httpx.ReadTimeout,
    httpx.WriteTimeout,
)


def get_db() -> Client:
    global _client
    if _client is None:
        url = os.getenv("SUPABASE_URL", "")
        key = os.getenv("SUPABASE_SERVICE_KEY", "")
        _client = create_client(url, key)
    return _client


def _retry_db(fn, attempts: int = 4):
    """Run a Supabase call, retrying transient connection drops on a fresh client.

    On a retryable error we null the global client so the next get_db() rebuilds
    a brand-new connection instead of reusing the corrupted one.
    """
    global _client
    last = None
    for i in range(attempts):
        try:
            return fn()
        except _RETRYABLE as e:
            last = e
            _client = None  # force a clean connection on the next get_db()
            time.sleep(0.3 * (i + 1))
    if last:
        raise last


# ── Jobs ──────────────────────────────────────────────────────────────────────

def db_create_job(data: dict) -> dict:
    r = _retry_db(lambda: get_db().table("jobs").insert(data).execute())
    return r.data[0]


def db_get_job(job_id: str) -> Optional[dict]:
    try:
        r = _retry_db(lambda: get_db().table("jobs").select("*").eq("id", job_id).execute())
        return r.data[0] if r.data else None
    except Exception as e:
        print(f"[db_get_job] error for {job_id}: {e}", flush=True)
        return None


def db_update_job(job_id: str, updates: dict) -> None:
    _retry_db(lambda: get_db().table("jobs").update(updates).eq("id", job_id).execute())


def db_delete_job(job_id: str) -> None:
    _retry_db(lambda: get_db().table("jobs").delete().eq("id", job_id).execute())


def db_get_user_jobs(user_id: str, limit: int = 20, offset: int = 0) -> list:
    r = (
        get_db().table("jobs")
        .select("*")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .range(offset, offset + limit - 1)
        .execute()
    )
    return r.data or []


def db_get_active_jobs() -> list:
    """All non-terminal jobs — used by the watchdog."""
    r = (
        get_db().table("jobs")
        .select("id,status,created_at,updated_at")
        .not_.in_("status", ["done", "error", "cancelled"])
        .execute()
    )
    return r.data or []


def db_update_clip_yt_upload(job_id: str, clip_index: int, yt_upload: dict) -> None:
    """Update the yt_upload field on a single clip inside the clips JSONB array."""
    job = db_get_job(job_id)
    if not job:
        return
    clips = job.get("clips", [])
    if clip_index < len(clips):
        clips[clip_index]["yt_upload"] = yt_upload
        get_db().table("jobs").update({"clips": clips}).eq("id", job_id).execute()


def db_update_clip_tt_upload(job_id: str, clip_index: int, tt_upload: dict) -> None:
    """Update the tt_upload field on a single clip inside the clips JSONB array."""
    job = db_get_job(job_id)
    if not job:
        return
    clips = job.get("clips", [])
    if clip_index < len(clips):
        clips[clip_index]["tt_upload"] = tt_upload
        get_db().table("jobs").update({"clips": clips}).eq("id", job_id).execute()


def db_update_clip_analytics(job_id: str, clip_index: int, analytics: dict) -> None:
    """Store YouTube performance stats on a single clip."""
    job = db_get_job(job_id)
    if not job:
        return
    clips = job.get("clips", [])
    if clip_index < len(clips):
        clips[clip_index]["yt_analytics"] = analytics
        get_db().table("jobs").update({"clips": clips}).eq("id", job_id).execute()


def db_get_expirable_jobs(days: int = 7) -> list:
    """Done jobs older than `days` whose clips haven't been expired/deleted yet."""
    from datetime import datetime, timezone, timedelta
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    r = (
        get_db().table("jobs")
        .select("id,created_at,clips_expired,clips")
        .eq("status", "done")
        .lt("created_at", cutoff)
        .execute()
    )
    return [j for j in (r.data or []) if not j.get("clips_expired") and (j.get("clips") or [])]


def db_get_done_jobs_with_uploads() -> list:
    """All done jobs that have at least one YouTube-uploaded clip (for analytics refresh)."""
    r = (
        get_db().table("jobs")
        .select("id,clips,created_at")
        .eq("status", "done")
        .execute()
    )
    return [j for j in (r.data or []) if any(
        c.get("yt_upload", {}).get("video_id") for c in (j.get("clips") or [])
    )]


# ── Channels ──────────────────────────────────────────────────────────────────

def db_create_channel(data: dict) -> dict:
    r = get_db().table("channels").insert(data).execute()
    return r.data[0]


def db_get_channel(channel_id: str) -> Optional[dict]:
    try:
        r = get_db().table("channels").select("*").eq("id", channel_id).execute()
        return r.data[0] if r.data else None
    except Exception as e:
        print(f"[db_get_channel] error for {channel_id}: {e}", flush=True)
        return None


def db_get_user_channels(user_id: str) -> list:
    r = get_db().table("channels").select("*").eq("user_id", user_id).execute()
    return r.data or []


def db_get_all_channels() -> list:
    """All channels across all users — used by the global poller."""
    r = get_db().table("channels").select("*").execute()
    return r.data or []


def db_update_channel(channel_id: str, updates: dict) -> None:
    get_db().table("channels").update(updates).eq("id", channel_id).execute()


def db_delete_channel(channel_id: str) -> None:
    get_db().table("channels").delete().eq("id", channel_id).execute()


def db_channel_owned_by(channel_id: str, user_id: str) -> bool:
    r = (
        get_db().table("channels")
        .select("id")
        .eq("id", channel_id)
        .eq("user_id", user_id)
        .execute()
    )
    return bool(r.data)


# ── YouTube tokens ─────────────────────────────────────────────────────────────

def db_get_youtube_token(user_id: str, yt_channel_id: Optional[str] = None) -> Optional[dict]:
    """Return one token row — the specific channel if given, otherwise the first available."""
    try:
        q = get_db().table("youtube_tokens").select("*").eq("user_id", user_id)
        if yt_channel_id:
            q = q.eq("yt_channel_id", yt_channel_id)
        r = q.limit(1).execute()
        return r.data[0] if r.data else None
    except Exception as e:
        print(f"[db_get_youtube_token] error for {user_id}: {e}", flush=True)
        return None


def db_get_user_youtube_tokens(user_id: str) -> list:
    """Return all connected YouTube channel tokens for a user."""
    try:
        r = get_db().table("youtube_tokens").select("*").eq("user_id", user_id).execute()
        return r.data or []
    except Exception:
        return []


def db_upsert_youtube_token(
    user_id: str,
    access_token: str,
    refresh_token: Optional[str],
    yt_channel_id: str = "",
    yt_channel_name: str = "",
) -> None:
    db = get_db()
    # Look up by exact (user_id, yt_channel_id) pair — table has no surrogate id column
    r = db.table("youtube_tokens").select("user_id").eq("user_id", user_id).eq("yt_channel_id", yt_channel_id).execute()
    if r.data:
        db.table("youtube_tokens").update({
            "access_token": access_token,
            "refresh_token": refresh_token,
            "yt_channel_name": yt_channel_name,
        }).eq("user_id", user_id).eq("yt_channel_id", yt_channel_id).execute()
    else:
        try:
            db.table("youtube_tokens").insert({
                "user_id": user_id,
                "access_token": access_token,
                "refresh_token": refresh_token,
                "yt_channel_id": yt_channel_id,
                "yt_channel_name": yt_channel_name,
            }).execute()
        except Exception:
            # Fallback: schema still has single-user-id constraint (SQL migration pending)
            # Update the first row for this user so auth at least works
            db.table("youtube_tokens").update({
                "access_token": access_token,
                "refresh_token": refresh_token,
                "yt_channel_id": yt_channel_id,
                "yt_channel_name": yt_channel_name,
            }).eq("user_id", user_id).execute()


def db_delete_youtube_token(user_id: str, yt_channel_id: Optional[str] = None) -> None:
    q = get_db().table("youtube_tokens").delete().eq("user_id", user_id)
    if yt_channel_id:
        q = q.eq("yt_channel_id", yt_channel_id)
    q.execute()


# ── TikTok tokens ──────────────────────────────────────────────────────────────

def db_get_tiktok_token(user_id: str, tt_open_id: Optional[str] = None) -> Optional[dict]:
    """Return one TikTok token row — the specific account if given, else the first."""
    try:
        q = get_db().table("tiktok_tokens").select("*").eq("user_id", user_id)
        if tt_open_id:
            q = q.eq("tt_open_id", tt_open_id)
        r = q.limit(1).execute()
        return r.data[0] if r.data else None
    except Exception as e:
        print(f"[db_get_tiktok_token] error for {user_id}: {e}", flush=True)
        return None


def db_get_user_tiktok_tokens(user_id: str) -> list:
    try:
        r = get_db().table("tiktok_tokens").select("*").eq("user_id", user_id).execute()
        return r.data or []
    except Exception:
        return []


def db_upsert_tiktok_token(
    user_id: str, access_token: str, refresh_token: Optional[str],
    tt_open_id: str = "", tt_display_name: str = "", expires_at: Optional[str] = None,
) -> None:
    db = get_db()
    r = db.table("tiktok_tokens").select("id").eq("user_id", user_id).eq("tt_open_id", tt_open_id).execute()
    payload = {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "tt_display_name": tt_display_name,
        "expires_at": expires_at,
    }
    if r.data:
        db.table("tiktok_tokens").update(payload).eq("id", r.data[0]["id"]).execute()
    else:
        db.table("tiktok_tokens").insert({
            "user_id": user_id, "tt_open_id": tt_open_id, **payload,
        }).execute()


def db_delete_tiktok_token(user_id: str, tt_open_id: Optional[str] = None) -> None:
    q = get_db().table("tiktok_tokens").delete().eq("user_id", user_id)
    if tt_open_id:
        q = q.eq("tt_open_id", tt_open_id)
    q.execute()


def db_get_user_email(user_id: str) -> Optional[str]:
    try:
        response = get_db().auth.admin.get_user_by_id(user_id)
        return response.user.email if response.user else None
    except Exception:
        return None


# ── Profiles / plan ────────────────────────────────────────────────────────────

# Free tier: 10 jobs per month, up to 3 clips each (so up to ~30 clips/month).
# The monthly counter (profiles.clips_used) counts JOBS, not individual clips.
FREE_MONTHLY_JOB_LIMIT    = 10
FREE_MAX_CLIPS_PER_JOB    = 3
PRO_MAX_CLIPS_PER_JOB     = 10


def db_get_profile(user_id: str) -> Optional[dict]:
    try:
        r = get_db().table("profiles").select("*").eq("id", user_id).single().execute()
        return r.data
    except Exception:
        return None


def db_update_profile(user_id: str, updates: dict) -> None:
    """Patch arbitrary profile fields (plan, billing metadata). Used by the
    Lemon Squeezy webhook to grant/revoke Pro."""
    _retry_db(lambda: get_db().table("profiles").update(updates).eq("id", user_id).execute())


def db_check_and_reset_quota(user_id: str) -> dict:
    """
    Return the profile, resetting the monthly clip counter if 30+ days have passed.
    Creates a minimal profile row if one doesn't exist yet.
    """
    from datetime import datetime, timezone, timedelta

    profile = db_get_profile(user_id)
    if not profile:
        try:
            get_db().table("profiles").insert({"id": user_id}).execute()
        except Exception:
            pass  # concurrent request may have already inserted it
        profile = db_get_profile(user_id) or {"id": user_id, "plan": "free", "clips_used": 0}

    reset_at_str = profile.get("clips_reset_at", "")
    if reset_at_str:
        reset_at = parse_iso(reset_at_str)
        if (datetime.now(timezone.utc) - reset_at) >= timedelta(days=30):
            get_db().table("profiles").update({
                "clips_used": 0,
                "clips_reset_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", user_id).execute()
            profile["clips_used"] = 0

    # Promo/trial Pro expiry: a promo grants Pro via pro_expires_at (no subscription).
    # Once it lapses, revert to Free. Paid subscribers (ls_subscription_id set) are
    # never downgraded here — their plan is governed by the billing webhook.
    exp_str = profile.get("pro_expires_at")
    if exp_str and profile.get("plan") == "pro" and not profile.get("ls_subscription_id"):
        try:
            exp = parse_iso(exp_str)
            if datetime.now(timezone.utc) >= exp:
                get_db().table("profiles").update({
                    "plan": "free", "pro_expires_at": None,
                }).eq("id", user_id).execute()
                profile["plan"] = "free"
                profile["pro_expires_at"] = None
        except Exception:
            pass

    return profile


def db_redeem_promo(code: str, user_id: str) -> dict:
    """Atomically redeem a promo code via the redeem_promo() Postgres RPC.
    Returns the RPC result dict, e.g. {"ok": true, "pro_days": 10, ...}."""
    try:
        r = get_db().rpc("redeem_promo", {"p_code": code, "p_user_id": user_id}).execute()
        return r.data if isinstance(r.data, dict) else (r.data or {"ok": False, "reason": "error"})
    except Exception as e:
        print(f"[db_redeem_promo] RPC failed for {user_id}: {e}", flush=True)
        return {"ok": False, "reason": "error"}


def db_claim_clips_atomic(user_id: str, count: int, limit: int) -> bool:
    """
    Atomically check quota and increment clips_used in one Postgres RPC call.
    Returns True if the claim succeeded (user is within quota), False otherwise.
    Requires the claim_clips() function to be created in Supabase — see
    backend/sql/quota_rpc.sql.
    """
    try:
        result = get_db().rpc("claim_clips", {
            "p_user_id": user_id,
            "p_count": count,
            "p_limit": limit,
        }).execute()
        return bool(result.data)
    except Exception as e:
        print(f"[db_claim_clips_atomic] RPC failed, falling back to non-atomic check: {e}", flush=True)
        return False


def db_increment_clips_used(user_id: str, count: int) -> None:
    """Atomically increment clips_used via Postgres RPC to avoid read-modify-write races."""
    try:
        get_db().rpc("increment_clips_used", {
            "p_user_id": user_id,
            "p_count": count,
        }).execute()
    except Exception as e:
        print(f"[db_increment_clips_used] RPC failed: {e}", flush=True)


# ── Backfill channels ──────────────────────────────────────────────────────────

def db_create_backfill(data: dict) -> dict:
    r = get_db().table("backfill_channels").insert(data).execute()
    return r.data[0]


def db_get_user_backfills(user_id: str) -> list:
    r = (
        get_db().table("backfill_channels")
        .select("*")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .execute()
    )
    return r.data or []


def db_get_active_backfills() -> list:
    r = get_db().table("backfill_channels").select("*").eq("status", "active").execute()
    return r.data or []


def db_get_backfill(backfill_id: str) -> Optional[dict]:
    try:
        r = get_db().table("backfill_channels").select("*").eq("id", backfill_id).single().execute()
        return r.data
    except Exception:
        return None


def db_update_backfill(backfill_id: str, updates: dict) -> None:
    get_db().table("backfill_channels").update(updates).eq("id", backfill_id).execute()


def db_delete_backfill(backfill_id: str) -> None:
    get_db().table("backfill_channels").delete().eq("id", backfill_id).execute()


# ── Scheduled posts (W5.5 scheduler/calendar) ─────────────────────────────────

def db_create_scheduled_post(data: dict) -> dict:
    r = get_db().table("scheduled_posts").insert(data).execute()
    return r.data[0]


def db_get_user_scheduled_posts(user_id: str, limit: int = 200) -> list:
    r = (
        get_db().table("scheduled_posts")
        .select("*")
        .eq("user_id", user_id)
        .order("publish_at", desc=False)
        .limit(limit)
        .execute()
    )
    return r.data or []


def db_get_scheduled_post(post_id: str) -> Optional[dict]:
    try:
        r = get_db().table("scheduled_posts").select("*").eq("id", post_id).single().execute()
        return r.data
    except Exception:
        return None


def db_update_scheduled_post(post_id: str, updates: dict) -> None:
    _retry_db(lambda: get_db().table("scheduled_posts").update(updates).eq("id", post_id).execute())


def db_due_scheduled_posts(now_iso: str, limit: int = 10) -> list:
    """Posts whose publish time has arrived, oldest first."""
    r = (
        get_db().table("scheduled_posts")
        .select("*")
        .eq("status", "scheduled")
        .lte("publish_at", now_iso)
        .order("publish_at", desc=False)
        .limit(limit)
        .execute()
    )
    return r.data or []

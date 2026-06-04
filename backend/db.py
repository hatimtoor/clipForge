"""
Supabase database layer for ClipForge.
All tables: jobs, channels, youtube_tokens, profiles.
Uses the service_role key so RLS is bypassed — the API layer enforces ownership.
"""
import os
from typing import Optional
from supabase import create_client, Client

_client: Optional[Client] = None


def get_db() -> Client:
    global _client
    if _client is None:
        url = os.getenv("SUPABASE_URL", "")
        key = os.getenv("SUPABASE_SERVICE_KEY", "")
        _client = create_client(url, key)
    return _client


# ── Jobs ──────────────────────────────────────────────────────────────────────

def db_create_job(data: dict) -> dict:
    r = get_db().table("jobs").insert(data).execute()
    return r.data[0]


def db_get_job(job_id: str) -> Optional[dict]:
    try:
        r = get_db().table("jobs").select("*").eq("id", job_id).execute()
        return r.data[0] if r.data else None
    except Exception as e:
        print(f"[db_get_job] error for {job_id}: {e}", flush=True)
        return None


def db_update_job(job_id: str, updates: dict) -> None:
    get_db().table("jobs").update(updates).eq("id", job_id).execute()


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


def db_get_user_email(user_id: str) -> Optional[str]:
    try:
        response = get_db().auth.admin.get_user_by_id(user_id)
        return response.user.email if response.user else None
    except Exception:
        return None


# ── Profiles / plan ────────────────────────────────────────────────────────────

FREE_MONTHLY_CLIP_LIMIT   = 10
FREE_MAX_CLIPS_PER_JOB    = 3
PRO_MAX_CLIPS_PER_JOB     = 10


def db_get_profile(user_id: str) -> Optional[dict]:
    try:
        r = get_db().table("profiles").select("*").eq("id", user_id).single().execute()
        return r.data
    except Exception:
        return None


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
        reset_at = datetime.fromisoformat(reset_at_str.replace("Z", "+00:00"))
        if (datetime.now(timezone.utc) - reset_at) >= timedelta(days=30):
            get_db().table("profiles").update({
                "clips_used": 0,
                "clips_reset_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", user_id).execute()
            profile["clips_used"] = 0

    return profile


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

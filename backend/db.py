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


def db_get_user_jobs(user_id: str) -> list:
    r = get_db().table("jobs").select("*").eq("user_id", user_id).order("created_at", desc=True).execute()
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

def db_get_youtube_token(user_id: str) -> Optional[dict]:
    try:
        r = get_db().table("youtube_tokens").select("*").eq("user_id", user_id).single().execute()
        return r.data
    except Exception:
        return None


def db_upsert_youtube_token(user_id: str, access_token: str, refresh_token: Optional[str]) -> None:
    get_db().table("youtube_tokens").upsert(
        {"user_id": user_id, "access_token": access_token, "refresh_token": refresh_token},
        on_conflict="user_id",
    ).execute()


def db_delete_youtube_token(user_id: str) -> None:
    get_db().table("youtube_tokens").delete().eq("user_id", user_id).execute()


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
        get_db().table("profiles").insert({"id": user_id}).execute()
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


def db_increment_clips_used(user_id: str, count: int) -> None:
    from datetime import datetime, timezone
    profile = db_get_profile(user_id)
    if not profile:
        return
    new_count = (profile.get("clips_used") or 0) + count
    updates: dict = {"clips_used": new_count}
    if not profile.get("clips_reset_at"):
        updates["clips_reset_at"] = datetime.now(timezone.utc).isoformat()
    get_db().table("profiles").update(updates).eq("id", user_id).execute()

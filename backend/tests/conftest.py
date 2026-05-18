import os
import sys
import pytest
from contextlib import ExitStack
from unittest.mock import patch, AsyncMock, MagicMock
from fastapi import Header, HTTPException

# Must happen before any imports from main/db
os.environ.setdefault("GROQ_API_KEY", "test_key_ci")
os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test_anon_key")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "test_service_key")

# Stub supabase so CI works without real Supabase credentials
_sb_stub = MagicMock()
sys.modules.setdefault("supabase", _sb_stub)

from fastapi.testclient import TestClient
from main import app, require_auth

VALID_TOKEN = "ci_test_valid_token"


class MockUser:
    id = "test-user-id-000"


# Replace require_auth with one that enforces auth properly:
# valid token → MockUser, anything else → 401
async def _mock_require_auth(authorization: str = Header(default="")):
    if authorization == f"Bearer {VALID_TOKEN}":
        return MockUser()
    raise HTTPException(status_code=401, detail="Not authenticated")

app.dependency_overrides[require_auth] = _mock_require_auth


MOCK_JOB = {
    "id": "test-job-id-000",
    "job_id": "test-job-id-000",
    "user_id": "test-user-id-000",
    "status": "queued",
    "progress": 0,
    "message": "Queued...",
    "clips": [],
    "error": None,
    "url": "https://youtube.com/watch?v=dQw4w9WgXcQ",
    "created_at": "2026-01-01T00:00:00+00:00",
}

MOCK_PROFILE = {
    "id": "test-user-id-000",
    "plan": "pro",
    "clips_used": 0,
    "clips_reset_at": "2026-01-01T00:00:00+00:00",
}


def _mock_db_get_job(job_id):
    return MOCK_JOB if job_id == MOCK_JOB["id"] else None


_PATCHES = [
    ("main.run_pipeline",            dict(new_callable=AsyncMock)),
    ("main.db_create_job",           dict(return_value=MOCK_JOB)),
    ("main.db_get_job",              dict(side_effect=_mock_db_get_job)),
    ("main.db_update_job",           {}),
    ("main.db_get_user_jobs",        dict(return_value=[MOCK_JOB])),
    ("main.db_get_active_jobs",      dict(return_value=[])),
    ("main.db_get_user_channels",    dict(return_value=[])),
    ("main.db_get_all_channels",     dict(return_value=[])),
    ("main.db_create_channel",       dict(return_value={"id": "ch-1", "channel_id": "ch-1"})),
    ("main.db_get_channel",          dict(return_value=None)),
    ("main.db_channel_owned_by",     dict(return_value=False)),
    ("main.db_update_channel",       {}),
    ("main.db_delete_channel",       {}),
    ("main.db_get_youtube_token",    dict(return_value=None)),
    ("main.db_upsert_youtube_token", {}),
    ("main.db_delete_youtube_token", {}),
    ("main.db_get_profile",          dict(return_value=MOCK_PROFILE)),
    ("main.db_update_clip_yt_upload",{}),
    ("main.db_check_and_reset_quota",dict(return_value=MOCK_PROFILE)),
    ("main.db_increment_clips_used", {}),
    ("main.db_get_user_email",       dict(return_value="test@example.com")),
    ("main.send_job_notification",   dict(new_callable=AsyncMock)),
]


@pytest.fixture(scope="session")
def client():
    with ExitStack() as stack:
        for target, kwargs in _PATCHES:
            stack.enter_context(patch(target, **kwargs))
        with TestClient(app) as c:
            yield c


@pytest.fixture(scope="session")
def auth():
    return {"Authorization": f"Bearer {VALID_TOKEN}"}


@pytest.fixture(scope="session")
def bad_auth():
    return {"Authorization": "Bearer this_is_definitely_wrong"}

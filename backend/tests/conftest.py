import os
import sys
import pytest
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


@pytest.fixture(scope="session")
def client():
    with patch("main.run_pipeline", new_callable=AsyncMock), \
         patch("main.db_create_job", return_value=MOCK_JOB), \
         patch("main.db_get_job", return_value=MOCK_JOB), \
         patch("main.db_update_job"), \
         patch("main.db_get_user_jobs", return_value=[MOCK_JOB]), \
         patch("main.db_get_active_jobs", return_value=[]), \
         patch("main.db_get_user_channels", return_value=[]), \
         patch("main.db_get_all_channels", return_value=[]), \
         patch("main.db_create_channel", return_value={"id": "ch-1", "channel_id": "ch-1"}), \
         patch("main.db_get_channel", return_value=None), \
         patch("main.db_channel_owned_by", return_value=False), \
         patch("main.db_update_channel"), \
         patch("main.db_delete_channel"), \
         patch("main.db_get_youtube_token", return_value=None), \
         patch("main.db_check_and_reset_quota", return_value=MOCK_PROFILE), \
         patch("main.db_increment_clips_used"):
        with TestClient(app) as c:
            yield c


@pytest.fixture(scope="session")
def auth():
    return {"Authorization": f"Bearer {VALID_TOKEN}"}


@pytest.fixture(scope="session")
def bad_auth():
    return {"Authorization": "Bearer this_is_definitely_wrong"}

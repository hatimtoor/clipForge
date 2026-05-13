import os
import base64
import pytest
from unittest.mock import patch, AsyncMock

# Set env vars before app import so they're available at module load time
os.environ.setdefault("GROQ_API_KEY", "test_key_ci")
os.environ.setdefault("CLIP_USER", "testuser")
os.environ.setdefault("CLIP_PASS", "testpass")

from fastapi.testclient import TestClient
from main import app


@pytest.fixture(autouse=True, scope="session")
def mock_pipeline():
    # Prevent tests from actually calling yt-dlp/ffmpeg/groq — we're testing
    # the API contract, not the pipeline internals.
    with patch("main.run_pipeline", new_callable=AsyncMock):
        yield


@pytest.fixture(scope="session")
def client(mock_pipeline):
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="session")
def auth():
    creds = base64.b64encode(b"testuser:testpass").decode()
    return {"X-Clip-Auth": creds}


@pytest.fixture(scope="session")
def bad_auth():
    creds = base64.b64encode(b"wrong:credentials").decode()
    return {"X-Clip-Auth": creds}

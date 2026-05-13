import os
import base64
import pytest

# Set env vars before app import so they're available at module load time
os.environ.setdefault("GROQ_API_KEY", "test_key_ci")
os.environ.setdefault("CLIP_USER", "testuser")
os.environ.setdefault("CLIP_PASS", "testpass")

from fastapi.testclient import TestClient
from main import app


@pytest.fixture(scope="session")
def client():
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

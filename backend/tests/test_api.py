"""
ClipForge API tests.
Covers auth enforcement, input validation, and CRUD for all major endpoints.
Does NOT make real external calls (Groq / yt-dlp / YouTube).
"""


# ── Auth ──────────────────────────────────────────────────────────────────────

def test_jobs_no_auth_returns_401(client):
    assert client.get("/api/jobs").status_code == 401

def test_jobs_wrong_auth_returns_401(client, bad_auth):
    assert client.get("/api/jobs", headers=bad_auth).status_code == 401

def test_jobs_with_auth_returns_list(client, auth):
    r = client.get("/api/jobs", headers=auth)
    assert r.status_code == 200
    assert isinstance(r.json(), list)


# ── Clip job ──────────────────────────────────────────────────────────────────

def test_clip_no_auth_returns_401(client):
    r = client.post("/api/clip", json={"url": "https://youtube.com/watch?v=test"})
    assert r.status_code == 401

def test_clip_missing_body_returns_422(client, auth):
    r = client.post("/api/clip", headers=auth, json={})
    assert r.status_code == 422

def test_clip_returns_job_id(client, auth):
    r = client.post(
        "/api/clip", headers=auth,
        json={"url": "https://youtube.com/watch?v=dQw4w9WgXcQ", "max_clips": 2},
    )
    assert r.status_code == 200
    data = r.json()
    assert "job_id" in data
    assert isinstance(data["job_id"], str)

def test_status_unknown_job_returns_404(client, auth):
    r = client.get("/api/status/nonexistent-job-id", headers=auth)
    assert r.status_code == 404

def test_status_returns_job(client, auth):
    # Create a job then immediately fetch its status
    r = client.post(
        "/api/clip", headers=auth,
        json={"url": "https://youtube.com/watch?v=dQw4w9WgXcQ"},
    )
    job_id = r.json()["job_id"]
    r2 = client.get(f"/api/status/{job_id}", headers=auth)
    assert r2.status_code == 200
    data = r2.json()
    assert data["job_id"] == job_id
    assert "status" in data
    assert "progress" in data


# ── Channels (watchlist) ──────────────────────────────────────────────────────

def test_channels_no_auth_returns_401(client):
    assert client.get("/api/channels").status_code == 401

def test_channels_list_returns_list(client, auth):
    r = client.get("/api/channels", headers=auth)
    assert r.status_code == 200
    assert isinstance(r.json(), list)

def test_channels_add_missing_url_returns_422(client, auth):
    r = client.post("/api/channels", headers=auth, json={})
    assert r.status_code == 422

def test_channels_delete_unknown_returns_404(client, auth):
    r = client.delete("/api/channels/nonexistent-id", headers=auth)
    assert r.status_code == 404

def test_channels_patch_unknown_returns_404(client, auth):
    r = client.patch("/api/channels/nonexistent-id", headers=auth,
                     json={"auto_upload": True})
    assert r.status_code == 404

def test_channels_check_unknown_returns_404(client, auth):
    r = client.post("/api/channels/nonexistent-id/check", headers=auth)
    assert r.status_code == 404


# ── YouTube ───────────────────────────────────────────────────────────────────

def test_youtube_status_no_auth_returns_401(client):
    assert client.get("/api/youtube/status").status_code == 401

def test_youtube_status_returns_connected_field(client, auth):
    r = client.get("/api/youtube/status", headers=auth)
    assert r.status_code == 200
    assert "connected" in r.json()

def test_youtube_upload_unknown_job_returns_404(client, auth):
    r = client.post(
        "/api/youtube/upload/nonexistent-job/0", headers=auth,
        json={"title": "Test", "description": "", "tags": [], "privacy_status": "public"},
    )
    assert r.status_code == 404

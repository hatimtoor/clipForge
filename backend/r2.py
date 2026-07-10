import os
from pathlib import Path


def _safe_segment(value: str) -> str:
    """Reject any value that isn't a single path/key segment before it's joined
    into an object key. Blocks path separators, traversal, and control chars;
    permits unicode so legitimately-titled clip filenames (e.g. "Café") pass.
    Defense-in-depth against path traversal."""
    v = str(value or "")
    if (
        v in ("", ".", "..")
        or ".." in v
        or "/" in v
        or "\\" in v
        or "\x00" in v
    ):
        raise ValueError(f"Unsafe path segment: {value!r}")
    return v


R2_ACCOUNT_ID        = os.getenv("R2_ACCOUNT_ID", "")
R2_ACCESS_KEY_ID     = os.getenv("R2_ACCESS_KEY_ID", "")
R2_SECRET_ACCESS_KEY = os.getenv("R2_SECRET_ACCESS_KEY", "")
R2_BUCKET            = os.getenv("R2_BUCKET_NAME", "")
R2_ENABLED = bool(R2_ACCOUNT_ID and R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY and R2_BUCKET)

_client = None


def _get_client():
    global _client
    if _client is None:
        import boto3
        from botocore.config import Config
        _client = boto3.client(
            "s3",
            endpoint_url=f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com",
            aws_access_key_id=R2_ACCESS_KEY_ID,
            aws_secret_access_key=R2_SECRET_ACCESS_KEY,
            config=Config(signature_version="s3v4"),
            region_name="auto",
        )
    return _client


def clip_key(job_id: str, filename: str) -> str:
    # Validate both segments here so every R2 helper (upload/stream/presign/
    # delete) that routes through clip_key is traversal-safe by construction.
    return f"clips/{_safe_segment(job_id)}/{_safe_segment(filename)}"


def upload_clip(local_path: Path, job_id: str, filename: str) -> None:
    """Upload a rendered clip to R2 as a persistent backup."""
    key = clip_key(job_id, filename)
    with open(local_path, "rb") as f:
        _get_client().upload_fileobj(
            f, R2_BUCKET, key,
            ExtraArgs={
                "ContentType": "video/mp4",
                "ContentDisposition": f'attachment; filename="{filename}"',
            },
        )


def upload_thumbnail(local_path: Path, job_id: str, filename: str) -> None:
    """Upload a clip thumbnail (JPEG) to R2, served inline for <img> display."""
    key = clip_key(job_id, filename)
    with open(local_path, "rb") as f:
        _get_client().upload_fileobj(
            f, R2_BUCKET, key,
            ExtraArgs={"ContentType": "image/jpeg", "ContentDisposition": "inline"},
        )


def presigned_url(job_id: str, filename: str, expires: int = 3600) -> str | None:
    """Generate a short-lived presigned URL for direct browser access to a private R2 clip."""
    try:
        return _get_client().generate_presigned_url(
            "get_object",
            Params={"Bucket": R2_BUCKET, "Key": clip_key(job_id, filename)},
            ExpiresIn=expires,
        )
    except Exception:
        return None


def stream_clip(job_id: str, filename: str):
    """Return an R2 object body stream, or None if not found."""
    try:
        resp = _get_client().get_object(Bucket=R2_BUCKET, Key=clip_key(job_id, filename))
        return resp["Body"]
    except Exception:
        return None


def download_clip_to_temp(job_id: str, filename: str) -> "Path | None":
    """Download a clip from R2 into a temp file. Caller must delete it when done."""
    import tempfile
    key = clip_key(job_id, filename)
    try:
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4")
        _get_client().download_fileobj(R2_BUCKET, key, tmp)
        tmp.close()
        return Path(tmp.name)
    except Exception:
        return None


def delete_job_clips(job_id: str) -> int:
    """Delete every R2 object under clips/{job_id}/. Returns the count deleted."""
    client = _get_client()
    prefix = f"clips/{job_id}/"
    deleted = 0
    try:
        paginator = client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=R2_BUCKET, Prefix=prefix):
            objs = [{"Key": o["Key"]} for o in page.get("Contents", [])]
            if objs:
                client.delete_objects(Bucket=R2_BUCKET, Delete={"Objects": objs})
                deleted += len(objs)
    except Exception as e:
        print(f"[r2.delete_job_clips] error for {job_id}: {e}", flush=True)
    return deleted

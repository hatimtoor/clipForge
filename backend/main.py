import os
import json
import uuid
import asyncio
import subprocess
import shutil
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, BackgroundTasks, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

app = FastAPI(title="ClipForge API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR   = Path(__file__).parent.parent
OUTPUT_DIR = BASE_DIR / "output"
TEMP_DIR   = BASE_DIR / "temp"
OUTPUT_DIR.mkdir(exist_ok=True)
TEMP_DIR.mkdir(exist_ok=True)

from jobs_store import load_jobs, save_jobs
jobs: dict[str, dict] = load_jobs()

class ClipRequest(BaseModel):
    url: str
    max_clips: int = 5
    min_duration: int = 30
    max_duration: int = 90

class JobStatus(BaseModel):
    job_id: str
    status: str
    progress: int
    message: str
    clips: list = []
    error: Optional[str] = None

def update_job(job_id: str, **kwargs):
    jobs[job_id].update(kwargs)
    save_jobs(jobs)

def run_cmd(cmd: list[str], cwd=None) -> tuple[int, str, str]:
    result = subprocess.run(cmd, capture_output=True, text=True, cwd=cwd)
    return result.returncode, result.stdout, result.stderr


async def download_video(url: str, job_dir: Path, job_id: str) -> Path:
    update_job(job_id, status="downloading", progress=10, message="Downloading video...")
    video_path = job_dir / "video.mp4"
    cmd = [
        "/home/ubuntu/clipforge/venv/bin/yt-dlp",
        "-f", "bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/best[ext=mp4]/best",
        "--merge-output-format", "mp4",
        "-o", str(video_path),
        "--no-playlist",
        "--cookies-from-browser", "chromium",
        url,
    ]
    code, out, err = run_cmd(cmd)
    if code != 0:
        raise RuntimeError(f"yt-dlp failed: {err}")
    update_job(job_id, progress=20, message="Download complete, transcribing...")
    return video_path


async def transcribe(video_path: Path, job_id: str) -> dict:
    update_job(job_id, status="transcribing", progress=30,
               message="Transcribing audio (this takes a few minutes)...")

    script = f'''
import json
from faster_whisper import WhisperModel

model = WhisperModel("medium", device="cpu", compute_type="int8")
segments, info = model.transcribe(
    "{video_path}",
    beam_size=5,
    word_timestamps=True,
    language=None,
    vad_filter=True,
)

out = []
for seg in segments:
    words = []
    if seg.words:
        for w in seg.words:
            words.append({{"word": w.word, "start": round(w.start, 3), "end": round(w.end, 3)}})
    out.append({{"start": round(seg.start, 3), "end": round(seg.end, 3), "text": seg.text.strip(), "words": words}})

print(json.dumps(out))
'''

    proc = await asyncio.create_subprocess_exec(
        "python3", "-c", script,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(f"Whisper failed: {stderr.decode()}")

    segments = json.loads(stdout.decode())
    update_job(job_id, progress=50, message="Transcription complete, analyzing virality...")
    return segments

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

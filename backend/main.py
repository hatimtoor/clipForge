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


async def analyze_virality(segments: list, job_id: str, max_clips: int,
                           min_dur: int, max_dur: int) -> list:
    update_job(job_id, status="analyzing", progress=55,
               message="AI is identifying viral moments...")

    transcript_lines = [
        f"[{s['start']:.1f}s - {s['end']:.1f}s] {s['text']}" for s in segments
    ]
    CHUNK_SIZE = 3000
    full_text = "\n".join(transcript_lines)
    chunks = []
    while full_text:
        chunk = full_text[:CHUNK_SIZE]
        ln = chunk.rfind("\n")
        if ln > 0 and len(full_text) > CHUNK_SIZE:
            chunk = full_text[:ln]
        chunks.append(chunk)
        full_text = full_text[len(chunk):].lstrip("\n")

    clips_per_chunk = max(2, max_clips // len(chunks) + 1)
    all_clips = []

    for chunk_idx, transcript_text in enumerate(chunks):
        prompt = f"""You are a viral short-form content expert. Identify the {clips_per_chunk} most viral-worthy moments.

TRANSCRIPT:
{transcript_text}

Return ONLY a JSON array. Each item: start, end, title, hook, virality_score (1-10), reason, tags.
Clips must be {min_dur}s to {max_dur}s. Valid JSON only."""

        try:
            import requests
            response = requests.post(
                "http://localhost:11434/api/generate",
                json={"model": "llama3.1:8b", "prompt": prompt, "stream": False},
                timeout=120
            )
            raw = response.json()["response"].strip()
            if raw.startswith("```"):
                raw = raw.split("```")[1]
                if raw.startswith("json"):
                    raw = raw[4:]
                raw = raw.strip()
            all_clips.extend(json.loads(raw))
        except Exception:
            continue

    all_clips.sort(key=lambda x: x.get("virality_score", 0), reverse=True)
    clips = all_clips[:max_clips]
    valid = []
    for c in clips:
        dur = c["end"] - c["start"]
        if dur < min_dur:
            c["end"] = c["start"] + min_dur
        if dur > max_dur:
            c["end"] = c["start"] + max_dur
        valid.append(c)
    return valid


def build_ass_subtitles(
    segments: list, clip_start: float, clip_end: float,
    output_path: Path, video_width: int = 1080, video_height: int = 1920,
):
    ass_header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {video_width}
PlayResY: {video_height}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Montserrat,72,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,2,0,1,3,2,5,80,80,120,1
Style: Highlight,Montserrat,72,&H0000D4FF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,2,0,1,3,2,5,80,80,120,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

    def ts(t: float) -> str:
        t = max(0, t - clip_start)
        h = int(t // 3600)
        m = int((t % 3600) // 60)
        s = int(t % 60)
        cs = int((t % 1) * 100)
        return f"{h}:{m:02d}:{s:02d}.{cs:02d}"

    words_in_clip = []
    for seg in segments:
        if seg["end"] < clip_start or seg["start"] > clip_end:
            continue
        for w in seg.get("words", []):
            if w["start"] >= clip_start and w["end"] <= clip_end:
                words_in_clip.append(w)

    events = []
    LINE_SIZE = 5
    for i in range(0, len(words_in_clip), LINE_SIZE):
        group = words_in_clip[i:i + LINE_SIZE]
        if not group:
            continue
        line_start = group[0]["start"]
        line_end   = group[-1]["end"]
        karaoke_text = ""
        for word in group:
            dur_cs = max(1, int((word["end"] - word["start"]) * 100))
            karaoke_text += f"{{\k{dur_cs}}}{word['word'].strip()} "
        karaoke_text = karaoke_text.strip()
        events.append(
            f"Dialogue: 0,{ts(line_start)},{ts(line_end)},Default,,0,0,0,,{karaoke_text}"
        )

    ass_content = ass_header + "\n".join(events) + "\n"
    output_path.write_text(ass_content, encoding="utf-8")


async def create_clips(
    video_path: Path, clip_defs: list, segments: list,
    job_dir: Path, job_id: str,
) -> list:
    update_job(job_id, status="clipping", progress=70,
               message="Cutting clips and burning subtitles...")
    results = []
    for idx, clip in enumerate(clip_defs):
        start = clip["start"]
        end   = clip["end"]
        dur   = end - start

        progress = 70 + int((idx / len(clip_defs)) * 25)
        update_job(job_id, progress=progress,
                   message=f"Rendering clip {idx+1}/{len(clip_defs)}: {clip['title']}")

        probe_cmd = ["ffprobe", "-v", "quiet", "-print_format", "json",
                     "-show_streams", str(video_path)]
        _, probe_out, _ = run_cmd(probe_cmd)
        probe = json.loads(probe_out)
        vstream = next((s for s in probe["streams"] if s["codec_type"] == "video"), None)
        src_w = int(vstream["width"])  if vstream else 1920
        src_h = int(vstream["height"]) if vstream else 1080

        out_h = src_h
        out_w = int(src_h * 9 / 16)
        crop_x = max(0, (src_w - out_w) // 2)

        ass_path = job_dir / f"clip_{idx}.ass"
        build_ass_subtitles(segments, clip_start=start, clip_end=end,
                            output_path=ass_path, video_width=out_w, video_height=out_h)

        clip_filename = f"clip_{idx+1}_{clip['title'][:30].replace(' ','_')}.mp4"
        clip_path = OUTPUT_DIR / job_id / clip_filename
        clip_path.parent.mkdir(exist_ok=True)

        ffmpeg_cmd = [
            "ffmpeg", "-y",
            "-ss", str(start),
            "-i", str(video_path),
            "-t", str(dur),
            "-vf", f"crop={out_w}:{out_h}:{crop_x}:0,ass={ass_path}",
            "-c:v", "libx264", "-preset", "fast", "-crf", "23",
            "-c:a", "aac", "-b:a", "128k",
            str(clip_path),
        ]
        code, _, err = run_cmd(ffmpeg_cmd)
        if code != 0:
            print(f"FFmpeg error for clip {idx}: {err}")
            continue

        results.append({
            **clip,
            "filename": clip_filename,
            "path": f"/clips/{job_id}/{clip_filename}",
            "duration": round(dur, 1),
        })

    return results


async def run_pipeline(job_id: str, req: ClipRequest):
    from datetime import datetime
    job_dir = TEMP_DIR / job_id
    job_dir.mkdir(exist_ok=True)
    try:
        video_path = await download_video(req.url, job_dir, job_id)
        segments   = await transcribe(video_path, job_id)
        (job_dir / "transcript.json").write_text(json.dumps(segments, indent=2))
        clips      = await analyze_virality(segments, job_id, req.max_clips,
                                            req.min_duration, req.max_duration)
        final_clips = await create_clips(video_path, clips, segments, job_dir, job_id)
        update_job(job_id, status="done", progress=100,
                   message=f"Done! {len(final_clips)} clips created.", clips=final_clips)
    except Exception as e:
        update_job(job_id, status="error", progress=0,
                   message="Pipeline failed", error=str(e))
        raise
    finally:
        if job_dir.exists():
            shutil.rmtree(job_dir, ignore_errors=True)


async def watchdog():
    from datetime import datetime, timezone
    while True:
        await asyncio.sleep(60)
        now = datetime.now(timezone.utc)
        for job_id, job in list(jobs.items()):
            if job["status"] in ("done", "error"):
                continue
            try:
                created = datetime.fromisoformat(job["created_at"])
                age = (now - created).total_seconds() / 60
                if age > 15:
                    update_job(job_id, status="error", progress=0,
                               message="Pipeline failed", error="Job timed out after 15 minutes")
            except Exception:
                pass

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(watchdog())

@app.post("/api/clip")
async def start_clip(req: ClipRequest, background_tasks: BackgroundTasks):
    from datetime import datetime
    job_id = str(uuid.uuid4())
    jobs[job_id] = {
        "job_id": job_id, "status": "queued", "progress": 0,
        "message": "Queued...", "clips": [], "error": None,
        "url": req.url, "created_at": datetime.utcnow().isoformat(),
    }
    save_jobs(jobs)
    background_tasks.add_task(run_pipeline, job_id, req)
    return {"job_id": job_id}

@app.get("/api/status/{job_id}")
async def get_status(job_id: str):
    if job_id not in jobs:
        raise HTTPException(404, "Job not found")
    return jobs[job_id]

@app.get("/api/jobs")
async def list_jobs():
    return list(jobs.values())

@app.get("/clips/{job_id}/{filename}")
async def serve_clip(job_id: str, filename: str):
    clip_path = OUTPUT_DIR / job_id / filename
    if not clip_path.exists():
        raise HTTPException(404, "Clip not found")
    return FileResponse(str(clip_path), media_type="video/mp4")

@app.get("/api/transcript/{job_id}")
async def get_transcript(job_id: str):
    transcript_path = TEMP_DIR / job_id / "transcript.json"
    if not transcript_path.exists():
        raise HTTPException(404, "Transcript not found")
    return json.loads(transcript_path.read_text())

FRONTEND_BUILD = BASE_DIR / "frontend" / "dist"
if FRONTEND_BUILD.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_BUILD), html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

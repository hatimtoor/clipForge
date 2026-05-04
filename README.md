# ✂️ ClipForge

Turn any YouTube video into viral short-form clips — fully self-hosted.

AI identifies the highest-engagement moments, cuts the video, and burns TikTok-style
word-by-word captions automatically.

## How It Works

```
YouTube URL
    │
    ▼
yt-dlp          ← downloads best quality mp4
    │
    ▼
Groq Whisper    ← transcribes audio + generates word timestamps (whisper-large-v3 via API)
    │
    ▼
Groq / Llama3.3 ← reads transcript, scores + identifies viral segments (llama-3.3-70b via API)
    │
    ▼
FFmpeg          ← crops to 9:16, cuts clips, burns karaoke-style word captions
    │
    ▼
Output clips    ← ready to upload to TikTok / Reels / Shorts
```

## Requirements

- Ubuntu / Debian Linux
- Python 3.10+, Node.js 18+, ffmpeg
- A **Groq API key** (free tier available at console.groq.com)

## Setup

```bash
chmod +x setup.sh start.sh
bash setup.sh
```

Add your Groq API key to `/home/ubuntu/.env`:
```
GROQ_API_KEY=gsk_...
```

## Running

```bash
bash start.sh
```

Open http://localhost:8000

## Output

Clips are saved to `output/<job-id>/` as `.mp4` files:
- Cropped to **9:16 vertical** format
- TikTok-style **word-by-word karaoke captions** burned in
- H.264 encoded, ready for direct upload

## Troubleshooting

**yt-dlp fails:** `pip install -U yt-dlp`

**FFmpeg not found:** `sudo apt install ffmpeg`

**Groq API error:** Check `GROQ_API_KEY` in `/home/ubuntu/.env`

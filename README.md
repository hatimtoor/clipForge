# ✂️ ClipForge

Turn any YouTube video into viral short-form clips — self-hosted.

AI identifies the best moments, cuts the video, and burns TikTok-style captions.

## How It Works

```
YouTube URL → yt-dlp → faster-whisper → Ollama/Llama3 → FFmpeg → clips
```

## Requirements

- Ubuntu / Debian Linux
- 24 GB RAM (Whisper large-v2 + Llama3.1:8b)
- Python 3.10+, Node.js 18+, ffmpeg

## Setup

```bash
chmod +x setup.sh start.sh
bash setup.sh
```

## Usage

1. Paste a YouTube URL
2. Set clip count and duration
3. Click Forge Clips
4. Download results

## Output

Clips saved to `output/<job-id>/` as 9:16 vertical MP4 with burned captions.

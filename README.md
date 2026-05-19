# ✂️ ClipForge

![release](https://img.shields.io/github/v/release/hatimtoor/clipForge?include_prereleases&label=release&color=ff6b35)
![license](https://img.shields.io/github/license/hatimtoor/clipForge?color=a8e6cf)
![python](https://img.shields.io/badge/python-3.10%2B-3776ab?logo=python&logoColor=white)
![react](https://img.shields.io/badge/react-18-61dafb?logo=react&logoColor=white)
![fastapi](https://img.shields.io/badge/FastAPI-0.110-009688?logo=fastapi&logoColor=white)
![supabase](https://img.shields.io/badge/Supabase-auth%20%2B%20db-3ecf8e?logo=supabase&logoColor=white)
![groq](https://img.shields.io/badge/Groq-Whisper%20%2B%20Llama-f55036)

![ClipForge Login](screenshot-login.png)

Turn any YouTube video into viral short-form clips — fully automatic.

AI finds the highest-engagement moments, cuts the video, crops to 9:16, and burns word-by-word karaoke captions. Clips are ready to post to YouTube Shorts, TikTok, or Instagram Reels in under 5 minutes.

---

## Features

- **AI clip extraction** — Groq Llama scores every transcript segment for virality (hooks, tension, confessions, numbers, story arcs) and picks the best moments
- **Word-by-word karaoke captions** — three styles (Bold Bottom, Center Pop, Minimal), custom font size, custom highlight color
- **Caption translation** — 15 languages via Groq Llama (Arabic, Chinese, Dutch, French, German, Hindi, Italian, Japanese, Korean, Portuguese, Russian, Spanish, Turkish, Ukrainian)
- **Smart 9:16 reframe** — YOLO face-tracking pan keeps the subject centred, no manual cropping
- **YouTube auto-upload** — OAuth-linked, upload clips directly to your channel from the app
- **Per-clip analytics** — views, likes, and comments pulled from the YouTube Data API, auto-refreshed every 6 hours
- **Watchlist / channel monitoring** — add any YouTube channel; ClipForge detects new uploads and starts clipping automatically (Pro)
- **Job archive** — every job stored with full settings; one-click retry carries all original parameters
- **Email notifications** — Resend email when your clips are ready
- **Free / Pro tiers** — Free: 10 clips/month, 3 per job. Pro: unlimited (coming soon)

---

## How It Works

```
┌─────────────────────────────────────┐
│         🎬  YouTube URL             │
└──────────────────┬──────────────────┘
                   │
          ╔════════▼════════╗
          ║   📥  DOWNLOAD  ║  yt-dlp — best quality video + audio
          ╚════════╤════════╝
                   │
          ╔════════▼════════╗
          ║   🔀  MERGE     ║  FFmpeg — combines streams into mp4
          ╚════════╤════════╝
                   │
          ╔════════▼════════╗
          ║  🎙  TRANSCRIBE ║  Groq Whisper (whisper-large-v3)
          ║                 ║  word-level timestamps · hallucination filter
          ║                 ║  auto-chunks files > 20 MB
          ╚════════╤════════╝
                   │
          ╔════════▼════════╗
          ║  🧠  ANALYZE    ║  Groq Llama (llama-3.3-70b-versatile)
          ║                 ║  multi-signal virality scoring
          ║                 ║  optional caption translation
          ╚════════╤════════╝
                   │
          ╔════════▼════════╗
          ║  ✂️   CLIP       ║  FFmpeg — cuts clips
          ║                 ║  YOLO 9:16 face-tracking crop
          ║                 ║  burns ASS karaoke captions
          ╚════════╤════════╝
                   │
┌──────────────────▼──────────────────┐
│   ☁️   Stored in Cloudflare R2      │
│   🚀  Download · YouTube upload     │
└─────────────────────────────────────┘
```

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite, React Router v6 |
| Backend | FastAPI (Python) |
| Auth & Database | Supabase (Postgres + Auth) |
| Clip Storage | Cloudflare R2 (S3-compatible) |
| Transcription | Groq Whisper (whisper-large-v3) |
| AI Analysis | Groq Llama (llama-3.3-70b-versatile) |
| Video processing | FFmpeg, yt-dlp, OpenCV + Ultralytics YOLO |
| Email | Resend |

---

## Requirements

- Python 3.10+, Node.js 18+, `ffmpeg`, `yt-dlp`
- A [Groq API key](https://console.groq.com) (free tier works)
- A [Supabase](https://supabase.com) project
- A [Cloudflare R2](https://developers.cloudflare.com/r2/) bucket

---

## Setup

```bash
chmod +x setup.sh start.sh
bash setup.sh
```

Create a `.env` file in the project root and a `frontend/.env.local` file for Vite:

**`frontend/.env.local`**
```env
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

**`.env` (project root)**

```env
# Required
GROQ_API_KEY=gsk_...
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_KEY=eyJ...

# Cloudflare R2 (clip storage)
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=clipforge-clips

# Optional — additional Groq keys for rate-limit rotation
GROQ_API_KEY_2=gsk_...
GROQ_API_KEY_3=gsk_...

# Optional — YouTube OAuth upload
YOUTUBE_CLIENT_ID=...
YOUTUBE_CLIENT_SECRET=...
YOUTUBE_REDIRECT_URI=https://yourdomain.com/api/youtube/callback

# Optional — YouTube Data API (per-clip analytics)
YOUTUBE_API_KEY=...

# Optional — email notifications
RESEND_API_KEY=re_...
APP_URL=https://yourdomain.com

# Optional — yt-dlp cookie source (recommended on servers)
COOKIES_FROM_BROWSER=chromium
```

> **COOKIES_FROM_BROWSER**: when set, yt-dlp reads live cookies directly from the browser profile — they never expire. If not set, falls back to a `cookies.txt` file at the repo root.

---

## Running

```bash
bash start.sh
```

Open `http://localhost:8000`, create an account, and start forging clips.

---

## Pipeline Stages

| Stage | What happens |
|---|---|
| DOWNLOAD | yt-dlp fetches best quality video + audio |
| MERGE | FFmpeg combines streams into a single mp4 |
| TRANSCRIBE | Groq Whisper generates word-level timestamps |
| ANALYZE | Groq Llama scores moments for virality; optionally translates captions |
| CLIP | FFmpeg cuts, crops (YOLO 9:16), and burns karaoke captions |

---

## Troubleshooting

**yt-dlp fails:** `pip install -U yt-dlp`

**FFmpeg not found:** `sudo apt install ffmpeg` (Linux) or `winget install Gyan.FFmpeg` (Windows)

**Groq rate limits:** Add `GROQ_API_KEY_2` … `GROQ_API_KEY_5` to spread load across keys automatically

**Supabase 400 on insert:** Make sure all columns exist in the database — PostgREST silently drops unknown fields

**R2 clips not loading:** Check `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_BUCKET_NAME` are all set

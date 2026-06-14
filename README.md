# ✂️ ClipForge

![release](https://img.shields.io/github/v/release/hatimtoor/clipForge?include_prereleases&label=release&color=ff6b35)
![license](https://img.shields.io/github/license/hatimtoor/clipForge?color=a8e6cf)
![python](https://img.shields.io/badge/python-3.10%2B-3776ab?logo=python&logoColor=white)
![react](https://img.shields.io/badge/react-18-61dafb?logo=react&logoColor=white)
![fastapi](https://img.shields.io/badge/FastAPI-0.110-009688?logo=fastapi&logoColor=white)
![supabase](https://img.shields.io/badge/Supabase-auth%20%2B%20db-3ecf8e?logo=supabase&logoColor=white)
![groq](https://img.shields.io/badge/Groq-Whisper%20%2B%20Llama-f55036)
![openrouter](https://img.shields.io/badge/OpenRouter-analysis-7c5cff)

![ClipForge Login](screenshot-login.png)

Turn any YouTube video into viral short-form clips — fully automatic.

AI finds the highest-engagement moments, cuts the video, crops to 9:16 while tracking the active speaker, and burns word-by-word karaoke captions. Clips can be downloaded or posted straight to YouTube Shorts and TikTok — manually or fully hands-off via channel monitoring.

Live at **[clipforging.com](https://clipforging.com)**.

---

## Features

**Clip generation**
- **AI clip extraction** — OpenRouter model scores every transcript segment for virality (hooks, tension, confessions, numbers, story arcs) and picks the best moments; automatically falls back to Groq Llama if OpenRouter is unset or unavailable
- **Word-by-word karaoke captions** — three styles (Bold Bottom, Center Pop, Minimal), custom font size, custom highlight color
- **Caption translation** — 15 languages (Arabic, Chinese, Dutch, French, German, Hindi, Italian, Japanese, Korean, Portuguese, Russian, Spanish, Turkish, Ukrainian)
- **Smart 9:16 reframe** — YOLO + audio-gated active-speaker tracking pans to whoever is talking, with dead-zone smoothing to avoid jitter; no manual cropping
- **Hardcoded-caption detection** — detects and crops out burned-in subtitle bars so they don't end up doubled in the clip
- **Scene-aware boundaries** — snaps clip cuts to scene changes so clips don't start/end mid-shot
- **Silence trimming** — strips dead air from the ends of clips
- **Background music** — mix a track (from a YouTube URL) underneath clips
- **Custom style prompt** — steer the AI toward a specific clip style or topic
- **Auto thumbnails** — a thumbnail is generated for every clip

**Publishing**
- **YouTube auto-upload** — OAuth-linked; connect multiple channels and upload clips straight to any of them
- **TikTok cross-posting** — Login Kit + Content Posting API (Direct Post); connect multiple accounts, pick privacy live from creator settings
- **Per-clip analytics** — views, likes, and comments from the YouTube Data API, auto-refreshed every 6 hours

**Automation**
- **Watchlist / channel monitoring** — add any YouTube channel; ClipForge detects new uploads and clips them automatically (Pro)
- **Channel Digest** — backfill a channel's historical videos on a daily schedule with a look-back window (30/60/90 days, 6mo, 1yr) and a per-day cap; auto-stops when caught up
- **Auto-upload** — watchlist and digest clips can publish themselves to a chosen YouTube channel and/or TikTok account
- **Email notifications** — Resend email when your clips are ready

**Platform**
- **Job archive** — every job stored with full settings; one-click retry carries all original parameters; cancel a running job or delete one outright
- **Cloudflare R2 storage** — clips served via short-lived presigned URLs; auto-deleted after 7 days
- **Anti-abuse** — disposable/temp-email blocking and Gmail alias normalization at signup
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
          ║  🧠  ANALYZE    ║  OpenRouter (Groq Llama fallback)
          ║                 ║  multi-signal virality scoring
          ║                 ║  optional caption translation
          ╚════════╤════════╝
                   │
          ╔════════▼════════╗
          ║  ✂️   CLIP       ║  FFmpeg — cuts on scene boundaries
          ║                 ║  YOLO active-speaker 9:16 crop
          ║                 ║  caption-bar crop · silence trim
          ║                 ║  burns ASS captions · bg music · thumb
          ╚════════╤════════╝
                   │
┌──────────────────▼──────────────────┐
│   ☁️   Stored in Cloudflare R2      │
│   🚀  Download · YouTube · TikTok   │
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
| AI Analysis | OpenRouter (primary) → Groq Llama (fallback) |
| Video processing | FFmpeg, yt-dlp, OpenCV + Ultralytics YOLO |
| Publishing | YouTube Data API, TikTok Content Posting API |
| Email | Resend |

---

## Requirements

- Python 3.10+, Node.js 18+, `ffmpeg`, `yt-dlp`
- A [Groq API key](https://console.groq.com) (free tier works) — transcription + analysis fallback
- A [Supabase](https://supabase.com) project
- A [Cloudflare R2](https://developers.cloudflare.com/r2/) bucket
- **Optional:** [OpenRouter](https://openrouter.ai) (primary analysis model), [YouTube OAuth + Data API](https://console.cloud.google.com), a [TikTok developer app](https://developers.tiktok.com), and a [Resend](https://resend.com) key for emails

---

## Setup

```bash
chmod +x setup.sh start.sh
bash setup.sh
```

Copy the two templates and fill in your values:

```bash
cp .env.example .env                      # backend secrets
cp frontend/.env.example frontend/.env.local   # Vite (browser) config
```

- **`frontend/.env.local`** holds only the two `VITE_` Supabase values (these are exposed to the browser — never put a secret here).
- **`.env`** holds everything else. Only the four Required values plus the R2 block are needed to boot; every other section (OpenRouter, YouTube, TikTok, Resend, cookies) is optional and unlocks the matching feature when set. See [`.env.example`](.env.example) for the full annotated list.

> **Where `.env` is loaded from:** the backend reads `.env` from the clipforge root (one level above the `clipper/` folder) in local dev, or `/home/ubuntu/.env` on the server.
>
> **COOKIES_FROM_BROWSER:** when set, yt-dlp reads live cookies directly from the browser profile — they never expire. If not set, it falls back to a `cookies.txt` file at the clipforge root.

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
| ANALYZE | OpenRouter (Groq Llama fallback) scores moments for virality; optionally translates captions |
| CLIP | FFmpeg cuts on scene boundaries, crops to 9:16 with active-speaker tracking, removes caption bars, trims silence, burns karaoke captions, mixes background music, and generates a thumbnail |

---

## Troubleshooting

**yt-dlp fails:** `pip install -U yt-dlp`

**FFmpeg not found:** `sudo apt install ffmpeg` (Linux) or `winget install Gyan.FFmpeg` (Windows)

**Groq rate limits:** Add `GROQ_API_KEY_2` … `GROQ_API_KEY_5` to spread load across keys automatically

**Supabase 400 on insert:** Make sure all columns exist in the database — PostgREST silently drops unknown fields

**R2 clips not loading:** Check `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_BUCKET_NAME` are all set

**Analysis using the wrong model:** OpenRouter is primary only when `OPENROUTER_API_KEY` is set; otherwise it silently uses Groq Llama. Check the key and `OPENROUTER_MODEL`.

**YouTube "Sign in to confirm you're not a bot":** set `COOKIES_FROM_BROWSER` (or provide `cookies.txt`), and optionally run the PO-token sidecar and set `POTTOKEN_URL`.

**TikTok posts only to private:** while the app is unaudited, TikTok forces `SELF_ONLY`. After production approval, set `TIKTOK_PRIVACY_LEVEL=PUBLIC_TO_EVERYONE`.

**Digest jobs fail with "Server disconnected":** fixed — concurrent pipelines no longer share a corrupted Supabase connection (the DB layer retries on a fresh one).

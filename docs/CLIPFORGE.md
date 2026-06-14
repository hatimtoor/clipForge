# ClipForge — Complete Functionality Reference

> What ClipForge does today, end to end. This document describes the system as it
> currently runs in production at **clipforging.com** — every feature, every
> pipeline stage, every API endpoint, and how the pieces fit together.

---

## 1. What ClipForge Is

ClipForge is an AI-powered SaaS that turns one long YouTube video into multiple
short, vertical, caption-burned clips ready to post to YouTube Shorts, TikTok,
Instagram Reels, etc. A user pastes a YouTube link; ClipForge downloads the
video, transcribes it, uses an LLM to find the most viral-worthy moments, cuts
those moments into 9:16 clips with word-by-word animated captions, and delivers
them for download or direct publishing.

Beyond the one-off manual flow, it offers **automation** (watch a channel and
clip new uploads automatically; backfill a channel's history) and **publishing**
(push clips straight to connected YouTube and TikTok accounts).

---

## 2. Architecture & Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + Vite (SPA), React Router v6, custom pixel/retro UI |
| Backend | FastAPI (Python), async pipeline on asyncio |
| Auth | Supabase Auth (JWT bearer tokens) |
| Database | Supabase Postgres (accessed via service_role key; ownership enforced in API layer) |
| Object storage | Cloudflare R2 (private bucket, presigned-URL delivery) |
| Transcription | Groq Whisper (`whisper-large-v3`) |
| Virality analysis | OpenRouter (primary, configurable model) → Groq Llama (`llama-3.3-70b-versatile`) fallback |
| Caption translation | Groq Llama |
| Video tooling | yt-dlp (download), FFmpeg/FFprobe (cut, crop, burn, blur, music, silence) |
| Speaker tracking | YOLOv8 (`yolov8n`) + OpenCV + audio RMS |
| Email | Resend (HTML job-notification emails) |
| Hosting | Linux server (systemd service) behind Cloudflare |

**Backend entry point:** `backend/main.py` (~3,700 lines). Supporting modules:
`db.py` (Supabase layer), `r2.py` (object storage), `reframe.py` (speaker
tracking), `groq_limiter.py` (rate-limited Groq calls with key rotation).

---

## 3. Accounts, Plans & Quotas

Two plans, enforced server-side:

| | Free | Pro |
|---|------|-----|
| Monthly clip limit | 10 clips/month | Unlimited |
| Clips per job | 3 | 10 |
| 9:16 auto-reframe | ❌ | ✅ |
| Blur-background style | ✅ | ✅ |
| Background music | ✅ | ✅ |
| Trim silence | ✅ | ✅ |
| Caption styles & colors | ✅ | ✅ |
| Watchlist automation | ❌ | ✅ |
| Digest (backfill) | ❌ | ✅ |
| YouTube auto-upload | ❌ | ✅ |
| TikTok auto-upload | ❌ (coming soon) | ✅ (coming soon) |

- **Quota enforcement:** Free users have their monthly count claimed atomically
  via a Postgres RPC (`claim_clips`) before a job runs, preventing race-condition
  overruns. The counter resets 30 days after the last reset.
- **Plan gating:** Pro-only endpoints use a `require_pro` dependency; everything
  else uses `require_auth`. Both validate the Supabase JWT on every request.
- Constants: `FREE_MONTHLY_JOB_LIMIT = 10`, `FREE_MAX_CLIPS_PER_JOB = 3`,
  `PRO_MAX_CLIPS_PER_JOB = 10`.

---

## 4. The Core Clipping Pipeline

When a job is created (`POST /api/clip`), an async task runs `run_pipeline`,
which moves through these phases. Progress is reported 0–100 and surfaced live to
the frontend.

### Phase 1 — Download (progress 2–37)
- `yt-dlp` downloads the best ≤1080p MP4 + best M4A audio, merged to MP4.
- Resilience: 10 retries, fragment retries, file-access retries, retry-sleep —
  to survive YouTube throttling that otherwise causes stream-merge failures.
- Optional cookies (from a browser or `cookies.txt`) and an optional
  "POT token" bot-bypass sidecar are attached if configured.
- Concurrent downloads are capped at 2 (a semaphore) so parallel digest videos
  don't throttle each other.
- Live download percentage is parsed from yt-dlp output and pushed to the job.

### Phase 2 — Transcribe (progress 40–65)
- Audio is extracted as 16 kHz mono MP3 via FFmpeg.
- Sent to **Groq Whisper (`whisper-large-v3`)** with `verbose_json` and both
  segment- and word-level timestamps.
- Files >20 MB are split into 10-minute chunks and transcribed sequentially,
  with timestamps offset back to absolute time.
- **Hallucination filter:** segments with `no_speech_prob > 0.65` or
  `avg_logprob < -1.3` are dropped (tuned to avoid cutting real speech over
  background noise/music).
- The full transcript is saved as `transcript.json` (survives temp cleanup).

### Phase 3 — Virality Analysis (progress 65–77)
- The transcript is chunked (~3,000 chars) and each chunk is sent to the LLM.
- **Primary model:** OpenRouter (model configurable via `OPENROUTER_MODEL`).
  **Fallback:** Groq Llama `llama-3.3-70b-versatile` — used automatically if
  OpenRouter is disabled, errors, or returns empty.
- The prompt asks for the most viral moments based on: strong hooks, emotional
  peaks, story arcs, quotable lines, high-value tips, and bold/controversial
  takes. An optional **Focus prompt** ("controversial takes", "funny moments",
  etc.) steers selection.
- Each candidate returns: `start`, `end`, `title`, `hook`, `virality_score`
  (1–10), `reason`, and 3 `tags`. JSON is parsed defensively (markdown-fence
  stripping + regex fallback + a lower-temperature retry).
- Candidates are sorted by virality score; the top `max_clips` are kept.
- Durations are validated and clamped to the user's min/max (short clips are
  extended toward the midpoint of the allowed range).

### Phase 3b — Caption Translation (optional, ~progress 77)
- If a non-source caption language is chosen, transcript segments are translated
  via Groq Llama, with per-word timing proportionally redistributed across the
  translated text. **Clip selection always uses the original language**; only the
  burned captions are translated.

### Phase 4 — Cut + Subtitle (progress 78–100)
- For each selected moment, the clip is cut and rendered to **1080×1920** with
  burned-in animated captions (see §5–§9 for the per-clip options).
- A thumbnail is generated per clip.
- On completion the job is marked `done`, clips are stored, the user's clip count
  is incremented, optional auto-uploads fire, and an email notification is sent.

**Job lifecycle states:** `queued → downloading → transcribing → analyzing →
clipping → done` (or `error` / `cancelled`).

**Cleanup:** the per-job temp directory is always removed at the end (success or
failure). Rendered clips go to `output/{job_id}/` and are mirrored to R2.

---

## 5. Clip Styles

Selected per job (and per watchlist/digest channel). Mutually exclusive:

### Reframe (9:16 speaker tracking) — *Pro only*
- Crops landscape to vertical **and follows the active speaker** so faces stay
  centered.
- Uses **YOLOv8** to detect people, then picks the *active speaker* by combining
  bounding boxes with **audio RMS energy** and **inter-frame head-region pixel
  change** (a moving mouth/head = who's talking) rather than just the biggest box.
- The crop trajectory is smoothed (0.5 s Gaussian) so it pans to new speakers
  quickly without jitter, driven via an FFmpeg `sendcmd` file.
- Extra smart-framing only in reframe mode:
  - **Scene-cut snapping** — clip start/end are nudged to nearby shot boundaries
    so clips don't begin/end mid-cut.
  - **Hardcoded caption-bar detection** — if the source already has burned
    subtitles at the bottom, that bar is detected and cropped out.

### Blur Background
- The clip stays in its original landscape framing, centered in the 9:16 frame,
  with a **scaled, blurred copy of the same clip filling the background** — no
  black bars, no cropping of content.
- Optimized FFmpeg filter: background is blurred at half resolution (540×960)
  then upscaled (fewer blur passes) for speed.
- Captions are positioned **inside the bottom blurred zone** via a dynamically
  computed `MarginV`, so they don't overlap the main video.

### Standard center-crop (Free, non-reframe)
- A plain centered 9:16 crop with no speaker tracking, scene snapping, or zoom.

---

## 6. Captions

Every clip gets word-by-word animated (karaoke-style) captions burned in,
generated as an ASS subtitle file and rendered by FFmpeg.

- **Three style presets:**
  - `bold_bottom` — white text with a yellow per-word highlight, bottom-aligned
    (default, 72 px).
  - `center_pop` — large centered text (88 px).
  - `minimal` — smaller, clean, no per-word color change (56 px).
- **Font size:** auto per style, or a user override (40–120 px).
- **Highlight color:** the karaoke "sweep" color (color a word shows before it's
  spoken). Choosable from a swatch palette or AUTO. Invalid colors are ignored
  and fall back to the preset (never crash the render).
- **Caption language:** "Source (no translation)" or one of ~15 target languages
  (English, Spanish, French, German, Portuguese, Italian, Hindi, Arabic, Chinese,
  Japanese, Korean, Russian, Dutch, Turkish, Polish).
- Words are grouped ~3 per line; each word is timed and highlighted as spoken.
- Transcript text is sanitized before insertion (override braces/backslashes/
  newlines stripped) so it can't corrupt the subtitle file.

---

## 7. Background Music

- Optional: paste a YouTube music URL; it's downloaded as audio (yt-dlp `-x`),
  cached by URL hash, and mixed under every clip in the job.
- **Volume presets:** Quiet (0.08), Soft (0.15, default), Medium (0.30),
  Loud (0.50).
- The music URL is validated as a real YouTube URL before reaching yt-dlp
  (blocks SSRF / argument injection); invalid URLs are skipped gracefully and the
  clip renders without music.

---

## 8. Silence Trimming

- Optional toggle. Detects silent gaps within each selected moment and cuts them
  out, tightening pacing and raising watch-time.
- Only applied when it meaningfully helps (≥2 keep-intervals and ≥0.8 s removed);
  otherwise the full clip renders.
- Caption word timings are **remapped** to the trimmed timeline so subtitles stay
  in sync after gaps are removed.

---

## 9. Thumbnails

- A thumbnail is auto-generated per clip (a frame with the clip title wrapped and
  overlaid), uploaded to R2, and served inline for display in the UI.

---

## 10. Automation — Watchlist (*Pro*)

Monitor YouTube channels and clip new uploads automatically.

- Add a channel URL (`POST /api/channels`); ClipForge resolves the channel name
  and records the latest video as a baseline.
- A **background poller** (`channel_poller`) periodically checks every watched
  channel across all users. When a *new* upload appears, it automatically starts
  a full clipping job using that channel's saved settings (clip count, durations,
  clip style, caption settings, music, trim, target upload accounts).
- Per-channel settings are editable (`PATCH /api/channels/{id}`), including
  **auto-upload** to a chosen YouTube channel and/or TikTok account.
- Manual "check now" is available (`POST /api/channels/{id}/check`, rate-limited
  6/min).
- Channel URLs are validated before reaching yt-dlp.

---

## 11. Automation — Digest / Backfill (*Pro*)

Clip a channel's back catalog, not just new uploads.

- Create a backfill (`POST /api/backfill`) with a channel URL, a `days_back`
  window (1–365), and `videos_per_day` pacing, plus the same render/caption/music
  settings as a normal job.
- A **background scheduler** (`backfill_scheduler`) walks the channel's history
  within the window and processes videos gradually, tracking
  `processed_video_ids` so nothing is clipped twice.
- Can auto-upload results to a chosen YouTube channel and/or TikTok account.
- "Run now" (`POST /api/backfill/{id}/run`, rate-limited 4/min), edit
  (`PATCH`), and delete are supported.

---

## 12. Publishing — YouTube (*Pro*)

- **Connect:** OAuth 2.0 with PKCE (`/api/youtube/auth` → Google →
  `/api/youtube/callback`). Multiple channels can be connected; the authorized
  channel's id/name are stored with the tokens. Scopes: `youtube.upload` +
  `youtube.readonly`.
- **Upload a clip:** `POST /api/youtube/upload/{job_id}/{clip_index}` with
  title, description, tags, privacy, and which connected channel to post to.
  Runs as a background task; status is pollable.
- **Auto-upload:** watchlist/digest jobs can push every clip to a chosen channel
  automatically, building descriptions from the clip hook/reason/tags plus a link
  back to the source video.
- Tokens auto-refresh; connect/disconnect and multi-channel status via
  `/api/youtube/status` and `/api/youtube/disconnect`.

---

## 13. Publishing — TikTok (*Pro, in review*)

- **Connect:** OAuth 2.0 with PKCE (`/api/tiktok/auth` → TikTok →
  `/api/tiktok/callback`). Scopes: `user.info.basic`, `video.publish`. Multiple
  accounts supported; tokens auto-refresh ahead of expiry.
- **Creator info:** `/api/tiktok/creator_info` fetches the account's allowed
  privacy levels and interaction settings (required by TikTok's Content Posting
  API before posting).
- **Upload a clip:** `POST /api/tiktok/upload/{job_id}/{clip_index}` pushes the
  rendered clip via the Content Posting API with a caption (user-typed or built
  from title/tags) and interaction toggles (disable comment/duet/stitch).
- **Privacy:** defaults to `SELF_ONLY` (forced for apps pending audit); resolves
  against the creator's allowed options. After TikTok approves the production
  review, this can be set to public via `TIKTOK_PRIVACY_LEVEL`.
- Status (`/api/tiktok/status`), disconnect, and auto-upload from watchlist/
  digest are supported. (Production review was submitted; public posting unlocks
  on approval.)

---

## 14. Analytics

- For clips uploaded to YouTube, ClipForge fetches **view/like/comment counts**
  via the YouTube Data API and stores them on the clip.
- A **background refresher** (`analytics_refresher`) periodically updates stats
  for clips uploaded 7+ days ago.
- Manual refresh: `POST /api/jobs/{job_id}/clips/{clip_index}/refresh_analytics`.

---

## 15. Email Notifications

- On job success or failure, the user gets a **Resend** HTML email styled to match
  the app's pixel/retro aesthetic (table-based layout for client compatibility).
- Success emails show the clip count, source URL, and a CTA; error emails report
  a generic failure with a retry CTA.

---

## 16. Storage & Clip Delivery

- Rendered clips live locally at `output/{job_id}/` and are mirrored to a
  **private Cloudflare R2 bucket** as durable backup.
- **Delivery is access-controlled:**
  1. The owner requests a short-lived clip token (`GET /api/clip-token/...`),
     valid 1 hour, after an ownership + filename check.
  2. The player hits `GET /clips/{job_id}/{filename}?t=token`. The server
     verifies the token, resolves the real path from DB data (never from user
     input), and either streams the local file or **307-redirects to a presigned
     R2 URL** (1-hour expiry).
- Path safety: UUID + safe-filename regexes, `..` rejection, and
  `is_relative_to` checks on every file-serving route.
- **Auto-expiry:** a cleanup scheduler removes clips from R2 ~7 days after a job
  completes (`clips_expired` flag prevents re-processing).

---

## 17. Background Schedulers / Workers

Started on app startup, all run continuously:

| Worker | Job |
|--------|-----|
| `channel_poller` | Detect new uploads on watched channels → start clip jobs |
| `backfill_scheduler` | Process channel backlogs gradually within the day window |
| `analytics_refresher` | Refresh YouTube stats for older uploaded clips |
| `clip_cleanup_scheduler` | Expire/delete clips ~7 days after completion |
| `watchdog` | Auto-fail stuck jobs (no DB activity 20 min, or older than 90 min) |

---

## 18. API Reference

All endpoints require a Supabase JWT (`Authorization: Bearer …`) unless noted.
`[Pro]` = requires Pro plan.

### Jobs & clips
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/clip` | Start a clipping job (rate-limited 10/min) |
| POST | `/api/jobs/{job_id}/cancel` | Cancel a running job |
| DELETE | `/api/jobs/{job_id}` | Delete a job + its R2 clips |
| GET | `/api/status/{job_id}` | Live job status + clips |
| GET | `/api/jobs` | List the user's jobs (paginated) |
| GET | `/api/transcript/{job_id}` | Fetch a job's transcript |
| GET | `/api/clip-token/{job_id}/{filename}` | Mint a short-lived clip-access token |
| GET | `/clips/{job_id}/{filename}?t=` | Stream/redirect to a clip (token-gated) |
| POST | `/api/jobs/{job_id}/clips/{clip_index}/refresh_analytics` | Refresh YouTube stats |

### Account
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/profile` | Plan, clips used, limit |
| GET | `/api/system` | Whether reframe (YOLO) is available |

### Watchlist `[Pro]`
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/channels` | List watched channels |
| POST | `/api/channels` | Add a channel |
| PATCH | `/api/channels/{id}` | Edit channel settings |
| DELETE | `/api/channels/{id}` | Remove a channel |
| POST | `/api/channels/{id}/check` | Check for new uploads now (6/min) |

### Digest / Backfill `[Pro]`
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/backfill` | List backfills |
| POST | `/api/backfill` | Create a backfill |
| PATCH | `/api/backfill/{id}` | Edit a backfill |
| POST | `/api/backfill/{id}/run` | Run now (4/min) |
| DELETE | `/api/backfill/{id}` | Delete a backfill |

### YouTube `[Pro]`
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/youtube/auth` | Begin OAuth |
| GET | `/api/youtube/callback` | OAuth callback |
| GET | `/api/youtube/status` | Connected channels |
| DELETE | `/api/youtube/disconnect` | Disconnect a channel |
| POST | `/api/youtube/upload/{job_id}/{clip_index}` | Upload a clip |
| GET | `/api/youtube/upload_status/{job_id}/{clip_index}` | Upload progress |

### TikTok `[Pro]`
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/tiktok/auth` | Begin OAuth |
| GET | `/api/tiktok/callback` | OAuth callback |
| GET | `/api/tiktok/status` | Connected accounts |
| GET | `/api/tiktok/creator_info` | Allowed privacy/interaction settings |
| DELETE | `/api/tiktok/disconnect` | Disconnect an account |
| POST | `/api/tiktok/upload/{job_id}/{clip_index}` | Upload a clip |
| GET | `/api/tiktok/upload_status/{job_id}/{clip_index}` | Upload progress |

### SPA
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/{full_path}` | Serves the React app (traversal-safe) |

---

## 19. Frontend Pages

| Route | Page | Access |
|-------|------|--------|
| `/` | Landing page (marketing) | Public (redirects to `/hello` if signed in) |
| `/login` | Login / signup | Public |
| `/hello` | **New Job** — paste URL, choose clip count/durations, focus prompt, clip style (reframe/blur bg), trim, captions (style/language/font/highlight), background music | Authed |
| `/work` | **Job progress** — live phase/percentage, then the clip grid with download + publish buttons | Authed |
| `/watchlist` | Manage watched channels + per-channel settings | Pro |
| `/digest` | Manage channel backfills | Pro |
| `/connections` | Connect/disconnect YouTube & TikTok accounts | Pro |
| `/archive` | Past jobs and their clips | Authed |
| `/privacy`, `/terms` | Legal pages | Public |

---

## 20. Security Model

- **Auth:** Supabase JWT validated on every request; `require_pro` adds plan
  enforcement.
- **Ownership:** the DB layer uses the service_role key (bypasses RLS), so the
  API layer re-checks `user_id` ownership on every job/channel/backfill resource.
- **No shell execution:** all subprocess calls use list-form argv (no
  `shell=True`); user URLs are validated against a YouTube-URL regex and passed
  after a `--` separator so they can't be parsed as yt-dlp options (blocks SSRF
  and argument injection).
- **File serving:** UUID/filename validation, `..` rejection, `is_relative_to`
  base-dir checks, and DB-resolved paths on every file route.
- **Clip access:** short-lived random tokens + private R2 presigned URLs.
- **OAuth:** server-side state with a 10-minute TTL and PKCE on both providers;
  `postMessage` responses are JSON-escaped and targeted at a fixed origin.
- **Hardening:** rate limiting (slowapi), CSP / X-Frame-Options / nosniff
  headers, a specific CORS allow-list, and atomic quota claiming.
- **Secrets:** all from environment; `.env` and `cookies.txt` are gitignored.

---

## 21. Configuration (Environment Variables)

| Variable | Purpose |
|----------|---------|
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_ANON_KEY` | Database + auth |
| `GROQ_API_KEY`, `GROQ_API_KEY_2..5` | Whisper + Llama (rotated by the limiter) |
| `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` | Primary virality model (optional; falls back to Groq) |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` | Cloudflare R2 storage |
| `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REDIRECT_URI`, `YOUTUBE_API_KEY` | YouTube OAuth + analytics |
| `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REDIRECT_URI`, `TIKTOK_PRIVACY_LEVEL` | TikTok OAuth + posting |
| `RESEND_*` / `RESEND_FROM` | Email notifications |
| `APP_URL`, `ALLOWED_ORIGINS` | Public URL + CORS |
| `COOKIES_FROM_BROWSER`, `POTTOKEN_URL` | yt-dlp cookie source + bot-bypass sidecar |

---

## 22. Key Limits & Constants

| Thing | Value |
|-------|-------|
| Output resolution | 1080×1920 (9:16) |
| Free monthly clips | 10 |
| Clips per job | 3 (Free) / 10 (Pro) |
| Clip duration | user-set min/max (defaults 30–90 s) |
| Concurrent downloads | 2 |
| Whisper chunk threshold | 20 MB → 10-minute chunks |
| Analysis transcript chunk | ~3,000 chars |
| Hallucination drop | `no_speech_prob > 0.65` or `avg_logprob < -1.3` |
| Clip access token TTL | 1 hour |
| OAuth state TTL | 10 minutes |
| Presigned R2 URL TTL | 1 hour |
| Clip auto-expiry | ~7 days after job completion |
| Job watchdog | 20 min idle / 90 min total |
| Rate limits | `/api/clip` 10/min · backfill run 4/min · channel check 6/min |

---

*This document reflects the production system as of June 2026. Pipeline stage
behavior, model choices, and constants are drawn directly from `backend/main.py`,
`db.py`, `r2.py`, and `reframe.py`.*

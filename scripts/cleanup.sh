#!/usr/bin/env bash
# ClipForge disk hygiene — clears local working dirs so disk usage can't creep.
# Clips are mirrored to Cloudflare R2, so deleting local copies is safe.
# Runs as the app user (no sudo needed). Install via cron — see bottom of file.
#
# ── One-time log caps (run ONCE as root; the real fix for the disk-full outage) ──
#   journald:  sudo sed -i 's/^#\?SystemMaxUse=.*/SystemMaxUse=500M/' /etc/systemd/journald.conf \
#                && sudo systemctl restart systemd-journald
#   docker:    add to /etc/docker/daemon.json then `sudo systemctl restart docker`:
#                { "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }
# ────────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# Repo root (contains backend/, frontend/, output/, temp/, music_cache/).
# Override with CLIPFORGE_DIR if your layout differs.
ROOT="${CLIPFORGE_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"

echo "[cleanup] $(date -u +%FT%TZ) root=$ROOT"
df -h "$ROOT" | tail -1

# temp/: per-job scratch (downloads, intermediates). The pipeline removes its own
# job dir on finish; anything older than 12h is orphaned from a crash. Delete it.
if [ -d "$ROOT/temp" ]; then
  find "$ROOT/temp" -mindepth 1 -maxdepth 1 -mmin +720 -exec rm -rf {} + 2>/dev/null || true
fi

# output/: local clip copies + transcript.json. Clips are on R2; the in-app
# download/serve falls back to R2 presigned URLs, so local copies >2 days are safe.
if [ -d "$ROOT/output" ]; then
  find "$ROOT/output" -mindepth 1 -maxdepth 1 -mtime +2 -exec rm -rf {} + 2>/dev/null || true
fi

# music_cache/: bg-music audio keyed by URL hash. Re-downloaded on demand; expire weekly.
if [ -d "$ROOT/music_cache" ]; then
  find "$ROOT/music_cache" -type f -mtime +7 -delete 2>/dev/null || true
fi

# Best-effort journald safety net (no-op without passwordless sudo; the one-time
# SystemMaxUse cap above is the durable fix).
command -v journalctl >/dev/null 2>&1 && sudo -n journalctl --vacuum-size=400M >/dev/null 2>&1 || true

echo "[cleanup] done"
df -h "$ROOT" | tail -1

# ── Install (run once on the server) ──────────────────────────────────────────
#   chmod +x /home/ubuntu/clipforge_new/scripts/cleanup.sh
#   ( crontab -l 2>/dev/null; echo "0 * * * * /home/ubuntu/clipforge_new/scripts/cleanup.sh >> /home/ubuntu/cleanup.log 2>&1" ) | crontab -
#   # ^ runs hourly; check /home/ubuntu/cleanup.log

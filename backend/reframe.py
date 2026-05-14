"""
Auto-reframe: audio + motion guided smooth 9:16 portrait crop.

No model downloads required — uses only OpenCV and numpy (already installed).

How it works:
  1. Extract audio RMS per frame via FFmpeg.  Frames louder than the 35th-
     percentile are tagged as "speech frames."
  2. On each speech frame, compute a frame-difference image against the
     previous frame.  The centroid of the high-motion region is where the
     speaker is — their mouth, head, and hands move when they talk.
  3. On silent frames, hold the last known position so the camera doesn't
     snap back to centre during pauses.
  4. Smooth the trajectory with a ~2 s moving-average so the pan glides
     like a camera operator rather than jittering.
  5. Pipe per-frame crops to FFmpeg, preserving the original audio track.

Works at any distance and any face angle because it tracks motion, not faces.
Best on static-camera footage (typical for podcasts / interviews / talks).
"""
import subprocess
import numpy as np
import cv2
from pathlib import Path


# ── Audio energy ──────────────────────────────────────────────────────────────

def _audio_rms_per_frame(clip_path: Path, fps: float, ffmpeg: str) -> np.ndarray:
    """Return RMS audio energy aligned to each video frame. Empty if no audio."""
    sr = 16_000
    result = subprocess.run(
        [ffmpeg, "-i", str(clip_path),
         "-f", "s16le", "-ac", "1", "-ar", str(sr), "pipe:1"],
        capture_output=True,
    )
    if not result.stdout:
        return np.array([])

    audio = np.frombuffer(result.stdout, dtype=np.int16).astype(np.float32) / 32_768.0
    spf   = max(1, int(sr / fps))
    n     = len(audio) // spf
    return np.array([
        np.sqrt(np.mean(audio[i * spf : (i + 1) * spf] ** 2))
        for i in range(n)
    ])


# ── Motion centroid ───────────────────────────────────────────────────────────

def _motion_cx(prev_gray: np.ndarray, curr_gray: np.ndarray) -> float | None:
    """
    Return the horizontal centroid of significant motion between two frames,
    or None if there isn't enough motion to be meaningful.
    """
    diff = cv2.absdiff(prev_gray, curr_gray)
    # Blur slightly to merge nearby motion blobs
    diff = cv2.GaussianBlur(diff, (5, 5), 0)
    _, mask = cv2.threshold(diff, 12, 255, cv2.THRESH_BINARY)

    # Ignore the very bottom strip (often text overlays / static captions)
    h = mask.shape[0]
    mask[int(h * 0.88):] = 0

    M = cv2.moments(mask)
    if M["m00"] < 500:   # not enough motion pixels — skip this frame
        return None
    return float(M["m10"] / M["m00"])


# ── Trajectory ────────────────────────────────────────────────────────────────

def _build_crop_trajectory(clip_path: Path, vid_w: int, crop_w: int,
                            fps: float, ffmpeg: str) -> np.ndarray:
    """Return crop_x (int) for every frame."""
    rms       = _audio_rms_per_frame(clip_path, fps, ffmpeg)
    threshold = float(np.percentile(rms, 35)) if len(rms) else 0.0

    sampled: dict[int, float] = {}   # frame_idx → speaker center x

    cap       = cv2.VideoCapture(str(clip_path))
    prev_gray = None
    idx       = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        curr_gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        if prev_gray is not None:
            is_speech = (idx < len(rms) and rms[idx] >= threshold) or threshold == 0.0
            if is_speech:
                cx = _motion_cx(prev_gray, curr_gray)
                if cx is not None:
                    sampled[idx] = cx

        prev_gray = curr_gray
        idx += 1

    cap.release()
    total = idx
    if total == 0:
        return np.array([vid_w // 2], dtype=int)

    # Build dense speaker-center array; default to video centre
    dense = np.full(total, float(vid_w // 2))

    if sampled:
        keys = sorted(sampled)
        for k in keys:
            dense[k] = sampled[k]

        # Linear interpolation between detections
        for i in range(len(keys) - 1):
            f0, f1 = keys[i], keys[i + 1]
            t = np.linspace(0, 1, f1 - f0, endpoint=False)
            dense[f0:f1] = dense[f0] + t * (dense[f1] - dense[f0])

        # Hold first/last detections at edges
        dense[: keys[0]]  = dense[keys[0]]
        dense[keys[-1] :] = dense[keys[-1]]

    # Moving-average smooth: ~2 s window → camera-operator glide
    window    = max(1, int(fps * 2))
    cx_smooth = np.convolve(dense, np.ones(window) / window, mode="same")
    return np.clip(cx_smooth - crop_w / 2, 0, vid_w - crop_w).astype(int)


# ── Public entry point ────────────────────────────────────────────────────────

def reframe_to_portrait(clip_path: Path, ffmpeg: str = "ffmpeg") -> bool:
    """
    Reframe clip_path in-place to 9:16 with audio+motion speaker tracking.
    Returns True if applied, False if skipped (already portrait/square).
    """
    cap   = cv2.VideoCapture(str(clip_path))
    vid_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    vid_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps   = cap.get(cv2.CAP_PROP_FPS) or 30.0
    cap.release()

    crop_w = int(vid_h * 9 / 16)
    crop_h = vid_h

    if crop_w >= vid_w:
        return False

    crop_x_arr = _build_crop_trajectory(clip_path, vid_w, crop_w, fps, ffmpeg)
    n_traj     = len(crop_x_arr)
    tmp        = clip_path.with_name(clip_path.stem + "_rf.mp4")

    ffmpeg_proc = subprocess.Popen(
        [
            ffmpeg, "-y",
            "-f", "rawvideo", "-vcodec", "rawvideo",
            "-s", f"{crop_w}x{crop_h}",
            "-pix_fmt", "bgr24",
            "-r", str(fps),
            "-i", "pipe:0",
            "-i", str(clip_path),
            "-c:v", "libx264", "-preset", "fast", "-crf", "23",
            "-c:a", "copy",
            "-map", "0:v", "-map", "1:a",
            "-shortest",
            str(tmp),
        ],
        stdin=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )

    cap = cv2.VideoCapture(str(clip_path))
    frame_idx = 0
    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                break
            x = int(crop_x_arr[min(frame_idx, n_traj - 1)])
            ffmpeg_proc.stdin.write(frame[:, x : x + crop_w].tobytes())
            frame_idx += 1
    finally:
        cap.release()
        ffmpeg_proc.stdin.close()

    ffmpeg_proc.wait()

    if ffmpeg_proc.returncode != 0:
        if tmp.exists():
            tmp.unlink()
        return False

    tmp.replace(clip_path)
    return True

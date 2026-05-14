"""
Auto-reframe: audio-guided smooth 9:16 portrait crop using YOLOv8.

Pipeline:
  1. Audio RMS per frame — only search for the speaker during speech frames.
  2. YOLOv8n person detection — works at any distance, angle, and lighting.
     The ~6 MB model downloads once on first use, then is cached permanently.
  3. Outlier rejection — discard detections that jump > 25 % of frame width.
  4. Gaussian smooth (3 s sigma) — natural camera-operator glide, no jitter.
  5. Per-frame FFmpeg pipe — encode the crop while preserving the audio track.
"""
import subprocess
import numpy as np
import cv2
from pathlib import Path

from ultralytics import YOLO

_yolo: YOLO | None = None


def _get_yolo() -> YOLO:
    global _yolo
    if _yolo is None:
        _yolo = YOLO("yolov8n.pt")   # ~6 MB, downloaded once by ultralytics
    return _yolo


# ── Audio energy ──────────────────────────────────────────────────────────────

def _audio_rms_per_frame(clip_path: Path, fps: float, ffmpeg: str) -> np.ndarray:
    """RMS energy per video frame extracted via FFmpeg. Empty array if no audio."""
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


# ── Person detection ──────────────────────────────────────────────────────────

def _person_cx(frame: np.ndarray, model: YOLO) -> float | None:
    """
    Run YOLOv8 and return the center-x of the largest detected person,
    or None if no person is found.
    """
    results = model(frame, classes=[0], verbose=False)   # class 0 = person
    boxes   = results[0].boxes
    if boxes is None or len(boxes) == 0:
        return None
    xywh  = boxes.xywh.cpu().numpy()    # columns: cx, cy, w, h
    areas = xywh[:, 2] * xywh[:, 3]
    best  = xywh[int(areas.argmax())]
    return float(best[0])               # center-x in pixels


# ── Trajectory ────────────────────────────────────────────────────────────────

def _build_crop_trajectory(clip_path: Path, vid_w: int, crop_w: int,
                            fps: float, ffmpeg: str) -> np.ndarray:
    """Return an array of crop_x values (one per frame) ready for the encoder."""
    rms       = _audio_rms_per_frame(clip_path, fps, ffmpeg)
    threshold = float(np.percentile(rms, 35)) if len(rms) else 0.0

    sample_every = max(1, int(fps))          # sample once per second
    sampled: dict[int, float] = {}

    model = _get_yolo()
    cap   = cv2.VideoCapture(str(clip_path))
    idx   = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break
        is_speech = (idx < len(rms) and rms[idx] >= threshold) or threshold == 0.0
        if is_speech and idx % sample_every == 0:
            cx = _person_cx(frame, model)
            if cx is not None:
                sampled[idx] = cx
        idx += 1

    cap.release()
    total = idx
    if total == 0:
        return np.array([vid_w // 2], dtype=int)

    # Default to first detection found; fall back to centre if none at all
    default_cx = float(next(iter(sampled.values()))) if sampled else float(vid_w // 2)
    dense = np.full(total, default_cx)

    if sampled:
        # Reject detections that jump more than 25 % of frame width (noise)
        max_jump = vid_w * 0.25
        keys_raw = sorted(sampled)
        filtered: dict[int, float] = {keys_raw[0]: sampled[keys_raw[0]]}
        for k in keys_raw[1:]:
            if abs(sampled[k] - list(filtered.values())[-1]) <= max_jump:
                filtered[k] = sampled[k]

        keys = sorted(filtered)
        for k in keys:
            dense[k] = filtered[k]

        # Linearly interpolate between accepted detections
        for i in range(len(keys) - 1):
            f0, f1 = keys[i], keys[i + 1]
            t = np.linspace(0, 1, f1 - f0, endpoint=False)
            dense[f0:f1] = dense[f0] + t * (dense[f1] - dense[f0])

        dense[: keys[0]]  = dense[keys[0]]
        dense[keys[-1] :] = dense[keys[-1]]

    # Gaussian smooth — 3-second sigma gives a natural camera-operator glide
    sigma  = fps * 3
    half_w = int(3 * sigma)
    x      = np.arange(-half_w, half_w + 1)
    kernel = np.exp(-x ** 2 / (2 * sigma ** 2))
    kernel /= kernel.sum()
    cx_smooth = np.convolve(dense, kernel, mode="same")

    return np.clip(cx_smooth - crop_w / 2, 0, vid_w - crop_w).astype(int)


# ── Public entry point ────────────────────────────────────────────────────────

def reframe_to_portrait(clip_path: Path, ffmpeg: str = "ffmpeg") -> bool:
    """
    Reframe clip_path in-place to 9:16 with audio-guided speaker tracking.
    Returns True if applied, False if skipped (video already portrait/square).
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

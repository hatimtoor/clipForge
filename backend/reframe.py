"""
Auto-reframe: audio-guided smooth 9:16 portrait crop using YOLOv8.

Three fixes vs. the previous version:
  1. No outlier rejection — speaker switches between hosts look like big jumps
     and were being silently discarded. Every detection is now trusted.
  2. 0.5 s Gaussian sigma instead of 3 s — fast enough to pan to a new speaker
     within half a second, still smooth enough to avoid jitter.
  3. Active-speaker selection — when multiple people are detected, pick the one
     whose head region has the most inter-frame pixel change (moving mouth/head
     = the person talking), not just the largest bounding box.
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
        _yolo = YOLO("yolov8n.pt")
    return _yolo


# ── Audio energy ──────────────────────────────────────────────────────────────

def _audio_rms_per_frame(clip_path: Path, fps: float, ffmpeg: str) -> np.ndarray:
    """RMS energy per video frame via FFmpeg PCM dump. Empty if no audio."""
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


# ── Speaker selection ─────────────────────────────────────────────────────────

def _speaking_person_cx(frame: np.ndarray, prev_frame: np.ndarray | None,
                         model: YOLO) -> float | None:
    """
    Detect all people with YOLO, then return the center-x of whoever is
    most likely speaking.

    Speaking proxy: the person whose head region (top 35 % of their bounding
    box) has the highest mean pixel difference vs. the previous frame.
    This catches mouth and head movement without needing a separate landmark
    model.  Falls back to largest-box selection when prev_frame is unavailable.
    """
    results = model(frame, classes=[0], verbose=False, conf=0.15)
    boxes   = results[0].boxes
    if boxes is None or len(boxes) == 0:
        return None

    # xyxy: absolute pixel coords [x1, y1, x2, y2]
    xyxy  = boxes.xyxy.cpu().numpy().astype(int)
    xywh  = boxes.xywh.cpu().numpy()

    if prev_frame is None or len(xyxy) == 1:
        # Only one person, or no previous frame to diff against → largest box
        areas = xywh[:, 2] * xywh[:, 3]
        best  = int(areas.argmax())
        return float(xywh[best, 0])

    # Compute head-region activity for each detected person
    h, w = frame.shape[:2]
    scores = []
    for x1, y1, x2, y2 in xyxy:
        x1, y1, x2, y2 = (max(0, x1), max(0, y1),
                           min(w, x2), min(h, y2))
        box_h = y2 - y1
        # Head region = top 35 % of the bounding box
        head_y2 = y1 + max(1, int(box_h * 0.35))
        curr_head = frame    [y1:head_y2, x1:x2].astype(np.float32)
        prev_head = prev_frame[y1:head_y2, x1:x2].astype(np.float32)
        if curr_head.size == 0:
            scores.append(0.0)
        else:
            scores.append(float(np.mean(np.abs(curr_head - prev_head))))

    best = int(np.argmax(scores))
    return float(xywh[best, 0])


# ── Trajectory ────────────────────────────────────────────────────────────────

def _build_crop_trajectory(clip_path: Path, vid_w: int, crop_w: int,
                            fps: float, ffmpeg: str) -> np.ndarray:
    """Return crop_x (int) for every frame."""
    rms       = _audio_rms_per_frame(clip_path, fps, ffmpeg)
    threshold = float(np.percentile(rms, 35)) if len(rms) else 0.0

    sample_every = max(1, int(fps / 2))      # sample twice per second
    sampled: dict[int, float] = {}

    model      = _get_yolo()
    cap        = cv2.VideoCapture(str(clip_path))
    prev_frame : np.ndarray | None = None
    idx        = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        is_speech = (idx < len(rms) and rms[idx] >= threshold) or threshold == 0.0
        if is_speech and idx % sample_every == 0:
            cx = _speaking_person_cx(frame, prev_frame, model)
            if cx is not None:
                sampled[idx] = cx

        prev_frame = frame
        idx += 1

    cap.release()
    total = idx
    if total == 0:
        return np.array([vid_w // 2], dtype=int)

    # Build dense trajectory — default to first detection or centre
    default_cx = float(next(iter(sampled.values()))) if sampled else float(vid_w // 2)
    dense = np.full(total, default_cx)

    if sampled:
        keys = sorted(sampled)
        for k in keys:
            dense[k] = sampled[k]

        # Linear interpolation between detections (no outlier filter)
        for i in range(len(keys) - 1):
            f0, f1 = keys[i], keys[i + 1]
            t = np.linspace(0, 1, f1 - f0, endpoint=False)
            dense[f0:f1] = dense[f0] + t * (dense[f1] - dense[f0])

        dense[: keys[0]]  = dense[keys[0]]
        dense[keys[-1] :] = dense[keys[-1]]

    # Gaussian smooth — 0.5 s sigma: fast speaker-switch response, no jitter
    sigma  = max(1.0, fps * 0.5)
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

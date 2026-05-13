"""
Auto-reframe: smooth 9:16 portrait crop that pans to follow the speaker.

Detection cascade (all bundled with OpenCV — no extra deps):
  1. Frontal face  — works for close, direct shots
  2. Profile face  — works for angled / side-on speakers (both directions)
  3. Upper body    — fallback for far-away speakers where the face is too small
  4. Center        — last resort if nothing is detected

Tracking pipeline:
  - Sample at 2 fps to detect subject position
  - Linearly interpolate between sample points
  - Apply ~2 s moving-average so the pan glides like a camera operator
  - Pipe per-frame crops to FFmpeg, preserving the original audio track
"""
import subprocess
import numpy as np
import cv2
from pathlib import Path


_FRONTAL  = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
_PROFILE  = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_profileface.xml")
_UPPERBODY = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_upperbody.xml")


def _detect_subject_cx(gray: np.ndarray) -> float | None:
    """
    Try progressively looser detectors and return the center-x of the best
    detection, or None if nothing is found.
    """
    h, w = gray.shape

    # 1. Frontal face — most reliable when the speaker faces camera
    faces = _FRONTAL.detectMultiScale(gray, 1.1, 5, minSize=(40, 40))
    if len(faces):
        x, y, bw, bh = max(faces, key=lambda f: f[2] * f[3])
        return float(x + bw / 2)

    # 2. Profile face facing left
    left = _PROFILE.detectMultiScale(gray, 1.1, 4, minSize=(40, 40))
    if len(left):
        x, y, bw, bh = max(left, key=lambda f: f[2] * f[3])
        return float(x + bw / 2)

    # 3. Profile face facing right (mirror the frame, then unflip the x)
    gray_flip = cv2.flip(gray, 1)
    right = _PROFILE.detectMultiScale(gray_flip, 1.1, 4, minSize=(40, 40))
    if len(right):
        x, y, bw, bh = max(right, key=lambda f: f[2] * f[3])
        return float(w - x - bw / 2)   # unflip

    # 4. Upper body — catches far-away or partially obscured speakers
    bodies = _UPPERBODY.detectMultiScale(gray, 1.05, 3, minSize=(60, 100))
    if len(bodies):
        x, y, bw, bh = max(bodies, key=lambda f: f[2] * f[3])
        return float(x + bw / 2)

    return None


def _build_crop_trajectory(clip_path: Path, vid_w: int, crop_w: int,
                            fps: float) -> np.ndarray:
    """
    Return crop_x per frame: where to start the horizontal crop so the
    detected subject stays centred, with a smooth camera-operator glide.
    """
    cap = cv2.VideoCapture(str(clip_path))
    sample_every = max(1, int(fps / 2))   # 2 samples per second
    sampled: dict[int, float] = {}

    idx = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        if idx % sample_every == 0:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            cx = _detect_subject_cx(gray)
            if cx is not None:
                sampled[idx] = cx
        idx += 1
    cap.release()

    total = idx
    if total == 0:
        return np.array([vid_w // 2], dtype=int)

    # Dense face-center array — default to video centre
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

        # Extrapolate edges from nearest detection
        dense[: keys[0]] = dense[keys[0]]
        dense[keys[-1] :] = dense[keys[-1]]

    # Moving-average: ~2 s window → smooth glide, not a shaky-cam snap
    window = max(1, int(fps * 2))
    kernel = np.ones(window) / window
    cx_smooth = np.convolve(dense, kernel, mode="same")

    crop_x = np.clip(cx_smooth - crop_w / 2, 0, vid_w - crop_w).astype(int)
    return crop_x


def reframe_to_portrait(clip_path: Path, ffmpeg: str = "ffmpeg") -> bool:
    """
    Reframe clip_path in-place to 9:16 portrait with smooth speaker tracking.
    Returns True if applied, False if skipped (already portrait/square).
    """
    cap = cv2.VideoCapture(str(clip_path))
    vid_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    vid_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps   = cap.get(cv2.CAP_PROP_FPS) or 30.0
    cap.release()

    crop_w = int(vid_h * 9 / 16)
    crop_h = vid_h

    if crop_w >= vid_w:
        return False   # already portrait or square

    crop_x_arr = _build_crop_trajectory(clip_path, vid_w, crop_w, fps)
    n_traj = len(crop_x_arr)

    tmp = clip_path.with_name(clip_path.stem + "_rf.mp4")

    # Pipe raw BGR frames → FFmpeg (keeps original audio in sync)
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

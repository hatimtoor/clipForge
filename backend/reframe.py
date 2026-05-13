"""
Auto-reframe: smooth 9:16 portrait crop that pans to follow the speaker.

Pipeline:
  1. Sample face positions every N frames using OpenCV Haar cascade.
  2. Linearly interpolate to get a face-center value for every frame.
  3. Apply a moving-average (~2 s window) so the "camera" glides instead of snapping.
  4. Pipe the cropped frames to FFmpeg for encoding, preserving the original audio track.
"""
import subprocess
import numpy as np
import cv2
from pathlib import Path


_CASCADE = cv2.CascadeClassifier(
    cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
)


def _smooth_crop_trajectory(clip_path: Path, vid_w: int, vid_h: int,
                             crop_w: int, fps: float) -> np.ndarray:
    """
    Return an array of length total_frames with the crop_x for each frame,
    smoothed so the pan feels like a camera operator rather than a jittery bot.
    """
    cap = cv2.VideoCapture(str(clip_path))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 0

    sample_every = max(1, int(fps / 2))  # sample twice per second
    sampled: dict[int, float] = {}       # frame_idx -> face center x

    idx = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        if idx % sample_every == 0:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            faces = _CASCADE.detectMultiScale(gray, 1.1, 5, minSize=(40, 40))
            if len(faces):
                x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
                sampled[idx] = float(x + w // 2)
        idx += 1

    cap.release()
    actual_frames = idx  # use real count in case CAP_PROP_FRAME_COUNT was wrong
    if actual_frames == 0:
        return np.full(1, float(vid_w // 2))

    # Build dense face-center array, starting from video center
    dense = np.full(actual_frames, float(vid_w // 2))

    if sampled:
        keys = sorted(sampled)
        for k in keys:
            dense[k] = sampled[k]

        # Linear interpolation between detected positions
        for i in range(len(keys) - 1):
            f0, f1 = keys[i], keys[i + 1]
            v0, v1 = dense[f0], dense[f1]
            t = np.linspace(0, 1, f1 - f0, endpoint=False)
            dense[f0:f1] = v0 + t * (v1 - v0)

        # Extrapolate edges
        dense[: keys[0]] = dense[keys[0]]
        dense[keys[-1] :] = dense[keys[-1]]

    # Moving-average smooth: ~2 s window so the pan glides naturally
    window = max(1, int(fps * 2))
    kernel = np.ones(window) / window
    cx_smooth = np.convolve(dense, kernel, mode="same")

    # Convert face center → crop_x, clamped to valid range
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
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    cap.release()

    crop_w = int(vid_h * 9 / 16)
    crop_h = vid_h

    if crop_w >= vid_w:
        return False  # already portrait or square — nothing to do

    # Build smooth crop trajectory
    crop_x_per_frame = _smooth_crop_trajectory(clip_path, vid_w, vid_h, crop_w, fps)
    n_traj = len(crop_x_per_frame)

    tmp = clip_path.with_name(clip_path.stem + "_rf.mp4")

    # Pipe raw BGR frames → FFmpeg (mux with original audio)
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
            x = int(crop_x_per_frame[min(frame_idx, n_traj - 1)])
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

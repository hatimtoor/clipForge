"""
Auto-reframe: audio-guided smooth 9:16 portrait crop.

Detection strategy (most-accurate to least, in fallback order):
  1. MediaPipe Face Detection  — accurate for close / mid-range frontal faces.
  2. Motion centroid           — frame-diff centroid during audio-active frames;
                                 catches far-away / angled / profile speakers
                                 where face detection fails.
  3. Hold last known position  — never snap back to centre during a gap.

Trajectory is smoothed with a ~2 s moving-average so the pan glides like
a camera operator. Frames are piped to FFmpeg to preserve the audio track.

The MediaPipe TFLite model (~800 KB) is downloaded once on first use and
cached next to this file.
"""
import subprocess
import urllib.request
import numpy as np
import cv2
from pathlib import Path

from mediapipe.tasks import python as _mp_python
from mediapipe.tasks.python import vision as _mp_vision
from mediapipe import Image as _MpImage, ImageFormat as _MpFmt

_MODEL_URL  = (
    "https://storage.googleapis.com/mediapipe-models/"
    "face_detector/blaze_face_short_range/float16/1/"
    "blaze_face_short_range.tflite"
)
_MODEL_PATH = Path(__file__).parent / "_face_detector.tflite"


def _get_detector():
    if not _MODEL_PATH.exists():
        print("reframe: downloading face detector model (~800 KB)...", flush=True)
        urllib.request.urlretrieve(_MODEL_URL, str(_MODEL_PATH))
    opts = _mp_vision.FaceDetectorOptions(
        base_options=_mp_python.BaseOptions(model_asset_path=str(_MODEL_PATH)),
        min_detection_confidence=0.3,   # low threshold → catch distant faces
    )
    return _mp_vision.FaceDetector.create_from_options(opts)


# ── Audio energy ──────────────────────────────────────────────────────────────

def _audio_rms_per_frame(clip_path: Path, fps: float, ffmpeg: str) -> np.ndarray:
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


# ── Detection helpers ─────────────────────────────────────────────────────────

def _face_cx(rgb_frame: np.ndarray, detector) -> float | None:
    """Largest face center-x via MediaPipe, or None."""
    result = detector.detect(_MpImage(image_format=_MpFmt.SRGB, data=rgb_frame))
    if not result.detections:
        return None
    best = max(result.detections,
               key=lambda d: d.bounding_box.width * d.bounding_box.height)
    bb = best.bounding_box
    return float(bb.origin_x + bb.width / 2)


def _motion_cx(prev_gray: np.ndarray, curr_gray: np.ndarray) -> float | None:
    """Centroid of significant inter-frame motion, or None if too little motion."""
    diff = cv2.absdiff(prev_gray, curr_gray)
    diff = cv2.GaussianBlur(diff, (5, 5), 0)
    _, mask = cv2.threshold(diff, 12, 255, cv2.THRESH_BINARY)
    # Ignore bottom strip (static captions / lower-thirds)
    mask[int(mask.shape[0] * 0.88):] = 0
    M = cv2.moments(mask)
    if M["m00"] < 500:
        return None
    return float(M["m10"] / M["m00"])


# ── Trajectory ────────────────────────────────────────────────────────────────

def _build_crop_trajectory(clip_path: Path, vid_w: int, crop_w: int,
                            fps: float, ffmpeg: str) -> np.ndarray:
    rms       = _audio_rms_per_frame(clip_path, fps, ffmpeg)
    threshold = float(np.percentile(rms, 35)) if len(rms) else 0.0

    sample_every = max(1, int(fps / 2))   # 2 samples per second
    sampled: dict[int, float] = {}

    detector  = _get_detector()
    cap       = cv2.VideoCapture(str(clip_path))
    prev_gray = None
    idx       = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        curr_gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        is_speech = (idx < len(rms) and rms[idx] >= threshold) or threshold == 0.0

        if is_speech and idx % sample_every == 0:
            # 1. Try MediaPipe face detection
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            cx  = _face_cx(rgb, detector)

            # 2. Fall back to motion centroid if no face found
            if cx is None and prev_gray is not None:
                cx = _motion_cx(prev_gray, curr_gray)

            if cx is not None:
                sampled[idx] = cx

        prev_gray = curr_gray
        idx += 1

    cap.release()
    total = idx
    if total == 0:
        return np.array([vid_w // 2], dtype=int)

    # Start from last known position if available, else centre
    default_cx = float(next(iter(sampled.values()))) if sampled else float(vid_w // 2)
    dense = np.full(total, default_cx)

    if sampled:
        keys = sorted(sampled)
        for k in keys:
            dense[k] = sampled[k]

        # Linear interpolation between detections
        for i in range(len(keys) - 1):
            f0, f1 = keys[i], keys[i + 1]
            t = np.linspace(0, 1, f1 - f0, endpoint=False)
            dense[f0:f1] = dense[f0] + t * (dense[f1] - dense[f0])

        # Hold edge detections at the boundaries
        dense[: keys[0]]  = dense[keys[0]]
        dense[keys[-1] :] = dense[keys[-1]]

    # Moving-average smooth: ~2 s window → camera-operator glide
    window    = max(1, int(fps * 2))
    cx_smooth = np.convolve(dense, np.ones(window) / window, mode="same")
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

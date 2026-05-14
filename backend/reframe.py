"""
Auto-reframe: audio-guided smooth 9:16 portrait crop.

Detection cascade (most-accurate to least, each is a fallback for the previous):
  1. MediaPipe Face Detection  — fast, accurate for close / mid-range faces.
  2. HOG Person Detector       — built into OpenCV, no download needed.
                                 Detects full-body humans at any distance and
                                 angle — exactly what TEDx/stage shots need.
  3. Motion centroid           — frame-diff centroid for anything that moves
                                 while audio is active.
  4. Hold last known position  — never snap to centre during a gap.

The MediaPipe TFLite model (~800 KB) is downloaded once and cached locally.
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

# HOG person detector — built into OpenCV, no extra install
_HOG = cv2.HOGDescriptor()
_HOG.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())


def _get_detector():
    if not _MODEL_PATH.exists():
        print("reframe: downloading face detector model (~800 KB)...", flush=True)
        urllib.request.urlretrieve(_MODEL_URL, str(_MODEL_PATH))
    opts = _mp_vision.FaceDetectorOptions(
        base_options=_mp_python.BaseOptions(model_asset_path=str(_MODEL_PATH)),
        min_detection_confidence=0.3,
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


def _person_cx(frame: np.ndarray) -> float | None:
    """
    HOG full-body person detector center-x, or None.
    Resize to max 640 px wide first so it runs in reasonable time.
    Works on stage / far-away shots where faces are too small for MediaPipe.
    """
    h, w = frame.shape[:2]
    scale = min(1.0, 640.0 / w)
    small = cv2.resize(frame, (int(w * scale), int(h * scale)))

    rects, weights = _HOG.detectMultiScale(
        small, winStride=(8, 8), padding=(4, 4), scale=1.05
    )
    if len(rects) == 0:
        return None

    best = rects[int(np.argmax(weights))]
    x, y, bw, bh = best
    return float((x + bw / 2) / scale)   # scale back to original coords


def _motion_cx(prev_gray: np.ndarray, curr_gray: np.ndarray) -> float | None:
    """Centroid of significant inter-frame motion, or None."""
    diff = cv2.absdiff(prev_gray, curr_gray)
    diff = cv2.GaussianBlur(diff, (9, 9), 0)
    _, mask = cv2.threshold(diff, 20, 255, cv2.THRESH_BINARY)
    mask[int(mask.shape[0] * 0.88):] = 0
    M = cv2.moments(mask)
    if M["m00"] < 1500:
        return None
    return float(M["m10"] / M["m00"])


# ── Trajectory ────────────────────────────────────────────────────────────────

def _build_crop_trajectory(clip_path: Path, vid_w: int, crop_w: int,
                            fps: float, ffmpeg: str) -> np.ndarray:
    rms       = _audio_rms_per_frame(clip_path, fps, ffmpeg)
    threshold = float(np.percentile(rms, 35)) if len(rms) else 0.0

    sample_every = max(1, int(fps))        # 1 sample per second
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
            # 1. MediaPipe face detection
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            cx  = _face_cx(rgb, detector)

            # 2. HOG person detection — catches far-away / stage speakers
            if cx is None:
                cx = _person_cx(frame)

            # 3. Motion centroid — last visual fallback
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

    default_cx = float(next(iter(sampled.values()))) if sampled else float(vid_w // 2)
    dense = np.full(total, default_cx)

    if sampled:
        # Reject detections that jump more than 25 % of frame width
        max_jump  = vid_w * 0.25
        keys_raw  = sorted(sampled)
        filtered: dict[int, float] = {keys_raw[0]: sampled[keys_raw[0]]}
        for k in keys_raw[1:]:
            prev = list(filtered.values())[-1]
            if abs(sampled[k] - prev) <= max_jump:
                filtered[k] = sampled[k]
        sampled = filtered

        keys = sorted(sampled)
        for k in keys:
            dense[k] = sampled[k]

        for i in range(len(keys) - 1):
            f0, f1 = keys[i], keys[i + 1]
            t = np.linspace(0, 1, f1 - f0, endpoint=False)
            dense[f0:f1] = dense[f0] + t * (dense[f1] - dense[f0])

        dense[: keys[0]]  = dense[keys[0]]
        dense[keys[-1] :] = dense[keys[-1]]

    # Gaussian smooth — 3-second sigma for natural camera-operator glide
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

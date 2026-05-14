"""
Auto-reframe: audio-guided smooth 9:16 portrait crop using MediaPipe.

How it works:
  1. Extract audio RMS per frame via FFmpeg. Frames above the 35th-percentile
     are tagged as "speech frames."
  2. On speech frames, run MediaPipe Face Detection — handles far-away, angled,
     and partially-visible faces that Haar cascades miss entirely.
  3. On silent frames, hold the last known speaker position so the camera
     doesn't drift back to centre during pauses.
  4. Smooth the trajectory with a ~2 s moving-average (camera-operator glide).
  5. Pipe per-frame crops to FFmpeg, preserving the original audio track.

The TFLite model (~800 KB) is downloaded once on first use and cached next to
this file. Every subsequent run uses the cached copy — no re-download.
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
    """Download the TFLite model once, return a MediaPipe FaceDetector."""
    if not _MODEL_PATH.exists():
        print("reframe: downloading face detector model (~800 KB)...", flush=True)
        urllib.request.urlretrieve(_MODEL_URL, str(_MODEL_PATH))
    opts = _mp_vision.FaceDetectorOptions(
        base_options=_mp_python.BaseOptions(model_asset_path=str(_MODEL_PATH)),
        min_detection_confidence=0.4,
    )
    return _mp_vision.FaceDetector.create_from_options(opts)


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


# ── Face detection ────────────────────────────────────────────────────────────

def _largest_face_cx(rgb_frame: np.ndarray, detector) -> float | None:
    """Return center-x (pixels) of the largest detected face, or None."""
    mp_img = _MpImage(image_format=_MpFmt.SRGB, data=rgb_frame)
    result = detector.detect(mp_img)
    if not result.detections:
        return None
    best = max(result.detections,
               key=lambda d: d.bounding_box.width * d.bounding_box.height)
    bb = best.bounding_box
    return float(bb.origin_x + bb.width / 2)


# ── Trajectory ────────────────────────────────────────────────────────────────

def _build_crop_trajectory(clip_path: Path, vid_w: int, crop_w: int,
                            fps: float, ffmpeg: str) -> np.ndarray:
    """Return crop_x (int) for every frame."""
    rms       = _audio_rms_per_frame(clip_path, fps, ffmpeg)
    threshold = float(np.percentile(rms, 35)) if len(rms) else 0.0

    sample_every = max(1, int(fps / 2))   # 2 samples per second
    sampled: dict[int, float] = {}

    detector = _get_detector()
    cap = cv2.VideoCapture(str(clip_path))
    idx = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        if idx % sample_every == 0:
            is_speech = (idx < len(rms) and rms[idx] >= threshold) or threshold == 0.0
            if is_speech:
                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                cx  = _largest_face_cx(rgb, detector)
                if cx is not None:
                    sampled[idx] = cx
        idx += 1
    cap.release()

    total = idx
    if total == 0:
        return np.array([vid_w // 2], dtype=int)

    dense = np.full(total, float(vid_w // 2))
    if sampled:
        keys = sorted(sampled)
        for k in keys:
            dense[k] = sampled[k]

        for i in range(len(keys) - 1):
            f0, f1 = keys[i], keys[i + 1]
            t = np.linspace(0, 1, f1 - f0, endpoint=False)
            dense[f0:f1] = dense[f0] + t * (dense[f1] - dense[f0])

        dense[: keys[0]]  = dense[keys[0]]
        dense[keys[-1] :] = dense[keys[-1]]

    window    = max(1, int(fps * 2))
    cx_smooth = np.convolve(dense, np.ones(window) / window, mode="same")
    return np.clip(cx_smooth - crop_w / 2, 0, vid_w - crop_w).astype(int)


# ── Public entry point ────────────────────────────────────────────────────────

def reframe_to_portrait(clip_path: Path, ffmpeg: str = "ffmpeg") -> bool:
    """
    Reframe clip_path in-place to 9:16 portrait with audio-guided speaker tracking.
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

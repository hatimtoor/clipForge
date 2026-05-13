"""
Auto-reframe: audio-guided smooth 9:16 portrait crop.

How it works:
  1. Extract audio energy per frame (FFmpeg PCM → numpy RMS).
     Frames above the speech threshold are "active speech" frames.
  2. On speech frames, run MediaPipe Face Detection — handles far-away,
     angled, and partially-visible faces that Haar cascades miss entirely.
  3. On silent frames, hold the last known speaker position so the camera
     doesn't drift back to center every time someone pauses.
  4. Smooth the trajectory with a ~2 s moving average (camera-operator glide).
  5. Pipe per-frame crops to FFmpeg for encoding, keeping the original audio.
"""
import subprocess
import numpy as np
import cv2
from pathlib import Path

import mediapipe as mp

_mp_detect = mp.solutions.face_detection


# ── Audio energy ──────────────────────────────────────────────────────────────

def _audio_rms_per_frame(clip_path: Path, fps: float, ffmpeg: str) -> np.ndarray:
    """
    Dump the audio track as raw 16-bit PCM mono at 16 kHz and return the
    RMS energy aligned to each video frame.  Empty array if no audio.
    """
    sr = 16_000
    result = subprocess.run(
        [ffmpeg, "-i", str(clip_path),
         "-f", "s16le", "-ac", "1", "-ar", str(sr), "pipe:1"],
        capture_output=True,
    )
    if not result.stdout:
        return np.array([])

    audio = np.frombuffer(result.stdout, dtype=np.int16).astype(np.float32) / 32_768.0
    spf = max(1, int(sr / fps))          # samples per video frame
    n = len(audio) // spf
    rms = np.array([
        np.sqrt(np.mean(audio[i * spf : (i + 1) * spf] ** 2))
        for i in range(n)
    ])
    return rms


# ── Face detection with MediaPipe ─────────────────────────────────────────────

def _largest_face_cx(rgb_frame: np.ndarray, detector) -> float | None:
    """
    Run MediaPipe face detection and return the center-x of the largest face,
    or None if nothing is detected.  MediaPipe handles far-away, angled, and
    partially-visible faces that Haar cascades miss.
    """
    h, w = rgb_frame.shape[:2]
    results = detector.process(rgb_frame)
    if not results.detections:
        return None

    best = max(
        results.detections,
        key=lambda d: (d.location_data.relative_bounding_box.width *
                       d.location_data.relative_bounding_box.height),
    )
    bb = best.location_data.relative_bounding_box
    cx = (bb.xmin + bb.width / 2) * w
    return float(cx)


# ── Trajectory building ───────────────────────────────────────────────────────

def _build_crop_trajectory(clip_path: Path, vid_w: int, crop_w: int,
                            fps: float, ffmpeg: str) -> np.ndarray:
    """
    Return crop_x (int) for every frame: where to start the horizontal crop.
    """
    # 1. Audio energy per frame — tells us when someone is speaking
    rms = _audio_rms_per_frame(clip_path, fps, ffmpeg)
    if len(rms):
        # Adaptive threshold: anything louder than the 35th percentile = speech
        threshold = float(np.percentile(rms, 35))
    else:
        threshold = 0.0   # no audio track — treat every frame as speech

    sample_every = max(1, int(fps / 2))   # sample at 2 fps
    sampled: dict[int, float] = {}        # frame_idx → face center x

    cap = cv2.VideoCapture(str(clip_path))
    with _mp_detect.FaceDetection(model_selection=1,        # model 1 = better at distance
                                   min_detection_confidence=0.4) as detector:
        idx = 0
        while True:
            ret, frame = cap.read()
            if not ret:
                break

            if idx % sample_every == 0:
                # Only bother detecting on frames where audio is active
                is_speech = (idx < len(rms) and rms[idx] >= threshold) or threshold == 0.0
                if is_speech:
                    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                    cx = _largest_face_cx(rgb, detector)
                    if cx is not None:
                        sampled[idx] = cx

            idx += 1

    cap.release()
    total = idx
    if total == 0:
        return np.array([vid_w // 2], dtype=int)

    # 2. Build dense face-center array; default to video centre
    dense = np.full(total, float(vid_w // 2))

    if sampled:
        keys = sorted(sampled)

        # Fill known detections
        for k in keys:
            dense[k] = sampled[k]

        # Linear interpolation between detections
        for i in range(len(keys) - 1):
            f0, f1 = keys[i], keys[i + 1]
            t = np.linspace(0, 1, f1 - f0, endpoint=False)
            dense[f0:f1] = dense[f0] + t * (dense[f1] - dense[f0])

        # Hold first/last detections at the edges
        dense[: keys[0]]  = dense[keys[0]]
        dense[keys[-1] :] = dense[keys[-1]]

    # 3. Moving-average smooth (~2 s window) → camera-operator glide
    window = max(1, int(fps * 2))
    kernel = np.ones(window) / window
    cx_smooth = np.convolve(dense, kernel, mode="same")

    crop_x = np.clip(cx_smooth - crop_w / 2, 0, vid_w - crop_w).astype(int)
    return crop_x


# ── Public entry point ────────────────────────────────────────────────────────

def reframe_to_portrait(clip_path: Path, ffmpeg: str = "ffmpeg") -> bool:
    """
    Reframe clip_path in-place to 9:16 portrait with audio-guided speaker tracking.
    Returns True if applied, False if skipped (video is already portrait/square).
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

    crop_x_arr = _build_crop_trajectory(clip_path, vid_w, crop_w, fps, ffmpeg)
    n_traj = len(crop_x_arr)

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

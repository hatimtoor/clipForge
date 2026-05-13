"""
Auto-reframe: crops landscape clips to 9:16 portrait centered on the
detected speaker face. Uses OpenCV Haar cascade — no extra dependencies.
"""
import subprocess
import numpy as np
import cv2
from pathlib import Path

_CASCADE = cv2.CascadeClassifier(
    cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
)


def _median_face_center(clip_path: Path, sample_every: int = 6):
    """Sample frames, return median (cx, cy) of the largest detected face, or None."""
    cap = cv2.VideoCapture(str(clip_path))
    centers = []
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
                centers.append((x + w // 2, y + h // 2))
        idx += 1
    cap.release()
    if not centers:
        return None
    return (int(np.median([c[0] for c in centers])),
            int(np.median([c[1] for c in centers])))


def reframe_to_portrait(clip_path: Path, ffmpeg: str = "ffmpeg") -> bool:
    """
    Reframe clip_path in-place to 9:16 portrait, centered on the detected speaker.
    Falls back to center-crop if no face found.
    Returns True if applied, False if skipped (already portrait/square).
    """
    cap = cv2.VideoCapture(str(clip_path))
    vid_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    vid_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    cap.release()

    crop_w = int(vid_h * 9 / 16)
    crop_h = vid_h

    if crop_w >= vid_w:
        return False  # already portrait or square — nothing to do

    center = _median_face_center(clip_path)
    cx = center[0] if center else vid_w // 2
    crop_x = max(0, min(cx - crop_w // 2, vid_w - crop_w))

    tmp = clip_path.with_name(clip_path.stem + "_rf.mp4")
    cmd = [
        ffmpeg, "-y",
        "-i", str(clip_path),
        "-vf", f"crop={crop_w}:{crop_h}:{crop_x}:0",
        "-c:v", "libx264", "-preset", "fast", "-crf", "23",
        "-c:a", "copy",
        str(tmp),
    ]
    result = subprocess.run(cmd, capture_output=True)
    if result.returncode != 0:
        if tmp.exists():
            tmp.unlink()
        return False

    tmp.replace(clip_path)
    return True

import { useRef, useState } from "react";
import { Modal, Button } from "./kit";

// Extract a YouTube video id from any common URL shape.
export function youtubeId(url) {
  if (!url) return null;
  const m = String(url).match(
    /(?:youtube\.com\/(?:watch\?[^#]*v=|shorts\/|live\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/
  );
  return m ? m[1] : null;
}

// Draw-a-box modal for manually marking the facecam region. Uses YouTube's
// mq2.jpg — a REAL frame from the middle of the video, already 16:9, so the
// normalized box maps directly onto the source. Falls back to a grid when no
// video frame is available (e.g. a channel with no seen uploads yet).
export default function FacecamBoxModal({ videoId, value, onSave, onClose }) {
  const [box, setBox] = useState(value || null);
  const [drag, setDrag] = useState(null);
  const [imgFailed, setImgFailed] = useState(false);
  const areaRef = useRef(null);

  const frameUrl = videoId && !imgFailed ? `https://i.ytimg.com/vi/${videoId}/mq2.jpg` : null;

  const point = (e) => {
    const r = areaRef.current.getBoundingClientRect();
    const cx = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
    const cy = (e.touches ? e.touches[0].clientY : e.clientY) - r.top;
    return { x: Math.max(0, Math.min(1, cx / r.width)), y: Math.max(0, Math.min(1, cy / r.height)) };
  };
  const down = (e) => {
    e.preventDefault();
    const p = point(e);
    setDrag(p);
    setBox({ x: p.x, y: p.y, w: 0, h: 0 });
  };
  const move = (e) => {
    if (!drag) return;
    const p = point(e);
    setBox({
      x: Math.min(drag.x, p.x),
      y: Math.min(drag.y, p.y),
      w: Math.abs(p.x - drag.x),
      h: Math.abs(p.y - drag.y),
    });
  };
  const up = () => setDrag(null);
  const usable = box && box.w > 0.02 && box.h > 0.02;

  return (
    <Modal
      title="Mark the facecam"
      icon="▦"
      size="lg"
      onClose={onClose}
      footer={
        <>
          {usable && (
            <span className="t-sm" style={{ marginRight: "auto", alignSelf: "center" }}>
              {Math.round(box.w * 100)}% × {Math.round(box.h * 100)}%
            </span>
          )}
          <Button
            variant="ghost"
            onClick={() => {
              setBox(null);
              onSave(null);
              onClose();
            }}
          >
            Clear
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!usable}
            onClick={() => {
              onSave([box.x, box.y, box.w, box.h]);
              onClose();
            }}
          >
            ✓ Save box
          </Button>
        </>
      }
    >
      <div className="t-sm" style={{ marginBottom: 12 }}>
        Drag a box around the streamer's camera — the layout will frame it exactly.
      </div>
      <div
        ref={areaRef}
        onMouseDown={down}
        onMouseMove={move}
        onMouseUp={up}
        onMouseLeave={up}
        onTouchStart={down}
        onTouchMove={move}
        onTouchEnd={up}
        style={{
          position: "relative",
          cursor: "crosshair",
          userSelect: "none",
          touchAction: "none",
          width: "100%",
          aspectRatio: "16/9",
          border: "var(--border-w) solid var(--card-border-color)",
          borderRadius: "var(--radius-md)",
          overflow: "hidden",
          background: frameUrl
            ? `url(${frameUrl}) center/cover no-repeat #111`
            : `repeating-linear-gradient(0deg, #26262e 0 1px, transparent 1px 40px),
               repeating-linear-gradient(90deg, #26262e 0 1px, transparent 1px 40px), #17171d`,
        }}
      >
        {frameUrl && <img src={frameUrl} alt="" onError={() => setImgFailed(true)} style={{ display: "none" }} />}
        {!frameUrl && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#8a8a95",
              fontSize: "var(--fs-sm)",
              pointerEvents: "none",
            }}
          >
            No preview frame — draw roughly where the cam sits
          </div>
        )}
        {box && box.w > 0 && (
          <div
            style={{
              position: "absolute",
              left: `${box.x * 100}%`,
              top: `${box.y * 100}%`,
              width: `${box.w * 100}%`,
              height: `${box.h * 100}%`,
              border: "2px solid #2BFF00",
              background: "#2BFF0022",
              pointerEvents: "none",
            }}
          />
        )}
      </div>
    </Modal>
  );
}

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { authFetch } from "../../lib/supabase";
import { Modal, Button, Field, TextInput, Banner } from "../../components/kit";

/* "Find more clips": re-clips the same source with new find/exclude prompts —
   no reprocessing. Optionally lets the user draw the correct facecam box on a
   source frame (sent normalized). Logic identical to the legacy popover,
   except navigation: the parent remounts on ?job= change, so no reload. */
export default function RepromptModal({ job, onClose }) {
  const navigate = useNavigate();
  const [find, setFind] = useState("");
  const [exclude, setExclude] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const [camOpen, setCamOpen] = useState(false);
  const [camFrameUrl, setCamFrameUrl] = useState(null);
  const [camBox, setCamBox] = useState(null); // {x,y,w,h} normalized
  const [camDrag, setCamDrag] = useState(null);
  const camImgRef = useRef(null);
  useEffect(
    () => () =>
      setCamFrameUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      }),
    []
  );

  const openCamPicker = async () => {
    setCamOpen((o) => !o);
    if (camFrameUrl || camOpen) return;
    try {
      const res = await authFetch(`/api/jobs/${job.job_id}/frame?t=3`);
      if (!res.ok) {
        setErr("Source expired — cam box unavailable for this job");
        setCamOpen(false);
        return;
      }
      const blob = await res.blob();
      setCamFrameUrl(URL.createObjectURL(blob));
    } catch {
      setCamOpen(false);
    }
  };

  const camPoint = (e) => {
    const r = camImgRef.current.getBoundingClientRect();
    const cx = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
    const cy = (e.touches ? e.touches[0].clientY : e.clientY) - r.top;
    return { x: Math.max(0, Math.min(1, cx / r.width)), y: Math.max(0, Math.min(1, cy / r.height)) };
  };
  const camDown = (e) => {
    e.preventDefault();
    const p = camPoint(e);
    setCamDrag(p);
    setCamBox({ x: p.x, y: p.y, w: 0, h: 0 });
  };
  const camMove = (e) => {
    if (!camDrag) return;
    const p = camPoint(e);
    setCamBox({
      x: Math.min(camDrag.x, p.x),
      y: Math.min(camDrag.y, p.y),
      w: Math.abs(p.x - camDrag.x),
      h: Math.abs(p.y - camDrag.y),
    });
  };
  const camUp = () => setCamDrag(null);

  const go = async () => {
    setBusy(true);
    setErr("");
    try {
      const body = {
        find: find.trim() || undefined,
        exclude: exclude.trim() || undefined,
      };
      if (camBox && camBox.w > 0.02 && camBox.h > 0.02) {
        body.facecam_box = [camBox.x, camBox.y, camBox.w, camBox.h];
        // A manual cam box implies a cam layout — keep the parent's if it was
        // already gameplay/screenshare, else default to gameplay.
        body.layout = ["facecam", "gameplay", "screenshare"].includes(
          job.options?.clip_style || job.options?.layout
        )
          ? undefined
          : "gameplay";
      }
      const res = await authFetch(`/api/jobs/${job.job_id}/reprompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.detail || "Reprompt failed");
        setBusy(false);
        return;
      }
      onClose();
      navigate(`/work?job=${data.job_id}`);
    } catch {
      setErr("Reprompt failed. Is the server running?");
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Find more clips"
      icon="✦"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={go} disabled={busy}>
            {busy ? "…" : "→ Go"}
          </Button>
        </>
      }
    >
      <div style={{ display: "grid", gap: 14 }}>
        <Banner tone="info">Re-clips this video with new direction — no reprocessing, so it's fast.</Banner>
        <Field label="Find">
          <TextInput
            value={find}
            onChange={(e) => setFind(e.target.value)}
            placeholder="e.g. moments about money"
          />
        </Field>
        <Field label="Exclude">
          <TextInput
            value={exclude}
            onChange={(e) => setExclude(e.target.value)}
            placeholder="e.g. intros, sponsors"
          />
        </Field>

        <Button variant="secondary" onClick={openCamPicker}>
          {camBox ? "✓ Cam box set (click to adjust)" : "▦ Fix cam box (wrong facecam? draw it)"}
        </Button>
        {camOpen && camFrameUrl && (
          <div>
            <div
              ref={camImgRef}
              onMouseDown={camDown}
              onMouseMove={camMove}
              onMouseUp={camUp}
              onMouseLeave={camUp}
              onTouchStart={camDown}
              onTouchMove={camMove}
              onTouchEnd={camUp}
              style={{
                position: "relative",
                cursor: "crosshair",
                userSelect: "none",
                touchAction: "none",
                backgroundImage: `url(${camFrameUrl})`,
                backgroundSize: "cover",
                width: "100%",
                aspectRatio: "16/9",
                border: "var(--border-w) solid var(--card-border-color)",
                borderRadius: "var(--radius-md)",
                overflow: "hidden",
              }}
            >
              {camBox && camBox.w > 0 && (
                <div
                  style={{
                    position: "absolute",
                    left: `${camBox.x * 100}%`,
                    top: `${camBox.y * 100}%`,
                    width: `${camBox.w * 100}%`,
                    height: `${camBox.h * 100}%`,
                    border: "2px solid #2BFF00",
                    background: "#2BFF0022",
                    pointerEvents: "none",
                  }}
                />
              )}
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginTop: 6,
              }}
            >
              <span className="t-sm">Drag a box around the facecam</span>
              {camBox && (
                <Button size="sm" variant="ghost" onClick={() => setCamBox(null)}>
                  Clear
                </Button>
              )}
            </div>
          </div>
        )}

        {err && <Banner tone="danger">{err}</Banner>}
      </div>
    </Modal>
  );
}

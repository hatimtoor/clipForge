import { useNavigate } from "react-router-dom";
import { Modal, Button, Field, OptionGrid, SegmentedControl } from "../../../components/kit";
import { LAYOUTS, FORMATS, VERTICAL_ONLY_LAYOUTS, CAM_BOX_LAYOUTS } from "../constants";

/* Mini layout diagrams: a 9:16 frame with the layout's regions sketched in. */
function LayoutPreview({ id }) {
  const frame = {
    width: 30,
    height: 52,
    borderRadius: 4,
    border: "1.5px solid var(--text-3)",
    background: "var(--surface-2)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  };
  const fill = { background: "var(--text-3)", opacity: 0.55 };
  const inner = (children) => <span style={frame}>{children}</span>;
  switch (id) {
    case "auto":
      return inner(
        <span style={{ margin: "auto", fontSize: 13, lineHeight: 1 }}>✨</span>
      );
    case "reframe":
      return inner(<span style={{ ...fill, flex: 1, margin: 3, borderRadius: 2 }} />);
    case "fit":
      return inner(
        <span style={{ ...fill, height: 14, margin: "auto 2px", borderRadius: 2 }} />
      );
    case "blur_bg":
      return inner(
        <>
          <span style={{ ...fill, opacity: 0.2, flex: 1 }} />
          <span style={{ ...fill, height: 16, margin: "0 2px", borderRadius: 2 }} />
          <span style={{ ...fill, opacity: 0.2, flex: 1 }} />
        </>
      );
    case "split":
      return inner(
        <>
          <span style={{ ...fill, flex: 1, margin: "3px 3px 1.5px", borderRadius: 2 }} />
          <span style={{ ...fill, flex: 1, margin: "1.5px 3px 3px", borderRadius: 2 }} />
        </>
      );
    case "screenshare":
      return inner(
        <>
          <span style={{ ...fill, flex: 1.4, margin: "3px 3px 1.5px", borderRadius: 2 }} />
          <span style={{ ...fill, flex: 1, margin: "1.5px 3px 3px", borderRadius: 2, opacity: 0.35 }} />
        </>
      );
    case "facecam":
      return inner(
        <>
          <span style={{ ...fill, flex: 0.6, margin: "3px 3px 1.5px", borderRadius: 2, opacity: 0.35 }} />
          <span style={{ ...fill, flex: 1.4, margin: "1.5px 3px 3px", borderRadius: 2 }} />
        </>
      );
    default:
      return inner(null);
  }
}

export default function LayoutFormatModal({ form, setLayout, set, isPro, onMarkCam, onClose }) {
  const navigate = useNavigate();
  const verticalOnly = VERTICAL_ONLY_LAYOUTS.includes(form.clipStyle);
  const showCamRow = CAM_BOX_LAYOUTS.includes(form.clipStyle);

  return (
    <Modal
      title="Layout & format"
      icon="▦"
      size="lg"
      onClose={onClose}
      footer={<Button onClick={onClose}>Done</Button>}
    >
      <div style={{ display: "grid", gap: 20 }}>
        <Field label="Layout" hint="How each clip is framed for vertical viewing.">
          <OptionGrid
            value={form.clipStyle}
            onChange={setLayout}
            onProClick={isPro ? null : () => navigate("/upgrade")}
            options={LAYOUTS.map((l) => ({
              id: l.id,
              label: l.label,
              description: l.hint,
              pro: l.pro && !isPro,
              preview: <LayoutPreview id={l.id} />,
            }))}
          />
        </Field>

        {showCamRow && (
          <Button variant="secondary" onClick={onMarkCam}>
            {form.facecamBox ? "✓ Cam box set — adjust" : "▦ Mark the facecam (optional — auto-detect otherwise)"}
          </Button>
        )}

        <Field
          label="Format"
          hint={
            verticalOnly
              ? "This layout renders vertical-only (9:16)."
              : "9:16 for Shorts & TikTok, 1:1 for feeds, 16:9 for YouTube."
          }
        >
          <SegmentedControl
            value={verticalOnly ? "9:16" : form.aspectRatio}
            onChange={(id) => {
              if (id !== "9:16" && !isPro) return navigate("/upgrade");
              set({ aspectRatio: id });
            }}
            options={FORMATS.map((f) => ({
              id: f.id,
              label: f.label,
              disabled: verticalOnly && f.id !== "9:16",
              pro: f.id !== "9:16" && !isPro,
            }))}
          />
        </Field>
      </div>
    </Modal>
  );
}

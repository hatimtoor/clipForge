import { Modal, Button, Field } from "../../../components/kit";
import { useMobile } from "../../../hooks/useMobile";
import { FILTERS } from "../constants";

/* Color-grade picker. Each filter is a row showing the look applied to three
   real clip frames (mirrors the standalone comparison), pre-baked with the exact
   FFmpeg grade the renderer uses (/public/filters/<id>_<1..3>.jpg) — WYSIWYG. */
export default function FilterModal({ form, set, onClose }) {
  const current = form.filter || "none";
  const isMobile = useMobile();
  const imgH = isMobile ? 128 : 188;
  return (
    <Modal
      title="Filter"
      icon="🎨"
      size="lg"
      onClose={onClose}
      footer={<Button onClick={onClose}>Done</Button>}
    >
      <Field
        label="Look"
        hint="A color grade baked into every clip — same three clips per row so you can compare. Captions stay crisp; the grade sits underneath them."
      >
        <div style={{ display: "grid", gap: 8 }}>
          {FILTERS.map((flt) => {
            const active = current === flt.id;
            return (
              <button
                key={flt.id}
                type="button"
                onClick={() => set({ filter: flt.id })}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  alignItems: "center",
                  gap: 12,
                  width: "100%",
                  padding: "10px 12px",
                  background: active ? "var(--surface-2)" : "transparent",
                  border: active ? "2px solid var(--accent)" : "2px solid var(--line)",
                  borderRadius: "var(--radius-md)",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <div style={{ display: "grid", gap: 3, minWidth: 0 }}>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      fontFamily: "var(--font-ui)",
                      fontSize: "var(--fs-body)",
                      fontWeight: 700,
                      color: active ? "var(--accent-strong)" : "var(--text-1)",
                    }}
                  >
                    {active && (
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: "var(--accent)",
                          flex: "none",
                        }}
                      />
                    )}
                    {flt.label}
                  </span>
                  <span style={{ fontSize: "var(--fs-sm)", color: "var(--text-3)", lineHeight: 1.35 }}>
                    {flt.desc}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 6, flex: "none" }}>
                  {[1, 2, 3].map((n) => (
                    <img
                      key={n}
                      src={`/filters/${flt.id}_${n}.jpg`}
                      alt={`${flt.label} sample ${n}`}
                      loading="lazy"
                      style={{
                        height: imgH,
                        aspectRatio: "9 / 16",
                        objectFit: "cover",
                        borderRadius: "var(--radius-sm)",
                        display: "block",
                        background: "#000",
                      }}
                    />
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </Field>
    </Modal>
  );
}

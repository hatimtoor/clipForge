import {
  Modal,
  Button,
  Field,
  Select,
  SegmentedControl,
  StepperInput,
  SwitchRow,
} from "../../../components/kit";
import { CaptionStyleGrid } from "../../../components/CaptionPreviews";
import { useMobile } from "../../../hooks/useMobile";
import { CAPTION_LANGUAGES, CAPTION_POSITIONS, HIGHLIGHT_SWATCHES } from "../constants";

export default function CaptionsModal({
  form,
  set,
  setCaptionStyle,
  captionCustomizable,
  effectiveFontSize,
  onClose,
}) {
  const isMobile = useMobile();
  return (
    <Modal
      title="Captions"
      icon="Aa"
      size="lg"
      onClose={onClose}
      footer={<Button onClick={onClose}>Done</Button>}
    >
      <div style={{ display: "grid", gap: 20 }}>
        <Field label="Style" hint="Live previews — the highlight moves exactly like the burned-in captions.">
          <CaptionStyleGrid
            value={form.captionStyle}
            onChange={setCaptionStyle}
            highlightColor={form.highlightColor}
            isMobile={isMobile}
          />
        </Field>

        <Field label="Position">
          <SegmentedControl
            value={form.captionPosition}
            onChange={(id) => set({ captionPosition: id })}
            options={CAPTION_POSITIONS}
          />
        </Field>

        <div style={{ display: "grid", gap: 8 }}>
          <SwitchRow
            label="AI keywords"
            hint="Color the words that carry the clip"
            on={form.captionKeywords}
            onChange={(v) => set({ captionKeywords: v })}
          />
          <SwitchRow
            label="AI emoji"
            hint="Drop a fitting emoji on big moments"
            on={form.captionEmoji}
            onChange={(v) => set({ captionEmoji: v })}
          />
        </div>

        <Field label="Language">
          <Select
            value={form.captionLanguage}
            onChange={(e) => set({ captionLanguage: e.target.value })}
          >
            {CAPTION_LANGUAGES.map(({ code, label }) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </Select>
        </Field>

        {captionCustomizable && (
          <>
            <Field label="Font size">
              <div style={{ display: "flex", gap: 10, alignItems: "stretch" }}>
                <div style={{ flex: 1 }}>
                  <StepperInput
                    value={effectiveFontSize}
                    onChange={(v) => set({ fontSizeOverride: v })}
                    min={40}
                    max={120}
                    step={4}
                  />
                </div>
                <Button
                  variant={form.fontSizeOverride === null ? "primary" : "secondary"}
                  onClick={() => set({ fontSizeOverride: null })}
                >
                  Auto
                </Button>
              </div>
            </Field>
            <Field label="Highlight color">
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {HIGHLIGHT_SWATCHES.map(({ color, label, bg, fg }) => {
                  const active = form.highlightColor === color;
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() => set({ highlightColor: color })}
                      style={{
                        padding: "8px 13px",
                        background: bg,
                        color: fg,
                        fontFamily: "var(--font-ui)",
                        fontSize: "var(--fs-tag)",
                        fontWeight: 700,
                        textTransform: "var(--tt-label)",
                        border: active
                          ? "2px solid var(--text-1)"
                          : "2px solid var(--line)",
                        borderRadius: "var(--radius-sm)",
                        boxShadow: active ? "var(--shadow-btn)" : "none",
                        cursor: "pointer",
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </Field>
          </>
        )}
      </div>
    </Modal>
  );
}

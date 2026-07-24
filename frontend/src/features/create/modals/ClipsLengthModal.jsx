import { Modal, Button, Field, StepperInput } from "../../../components/kit";
import { DURATION_BUCKETS } from "../constants";

export default function ClipsLengthModal({ form, set, onClose, minDurMax = 90 }) {
  return (
    <Modal
      title="Clips & length"
      icon="🎬"
      onClose={onClose}
      footer={<Button onClick={onClose}>Done</Button>}
    >
      <div style={{ display: "grid", gap: 18 }}>
        <Field label="Max clips" hint="Up to 10 clips per job — the AI stops when quality drops.">
          <StepperInput
            value={form.maxClips}
            onChange={(v) => set({ maxClips: v })}
            min={1}
            max={10}
            tint="lavender"
          />
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
          <Field label="Min duration">
            <StepperInput
              value={form.minDur}
              onChange={(v) => set({ minDur: v })}
              min={15}
              max={minDurMax}
              step={5}
              suffix="s"
              tint="peach"
            />
          </Field>
          <Field label="Max duration">
            <StepperInput
              value={form.maxDur}
              onChange={(v) => set({ maxDur: v })}
              min={30}
              max={180}
              step={10}
              suffix="s"
              tint="amber"
            />
          </Field>
        </div>
        <Field label="Quick presets">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {DURATION_BUCKETS.map(({ label, min, max }) => {
              const active = form.minDur === min && form.maxDur === max;
              return (
                <Button
                  key={label}
                  size="sm"
                  variant={active ? "primary" : "secondary"}
                  onClick={() => set({ minDur: min, maxDur: max })}
                >
                  {label}
                </Button>
              );
            })}
          </div>
        </Field>
      </div>
    </Modal>
  );
}

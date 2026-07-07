import { useNavigate } from "react-router-dom";
import { Modal, Button, SwitchRow } from "../../../components/kit";

/* showReframe=false for channel settings (Watchlist/Digest) — those jobs have
   no per-job reframe flag; tracking comes from the layout choice alone. */
export default function EnhanceModal({ form, set, setReframe, isPro, showReframe = true, onClose }) {
  const navigate = useNavigate();
  const toUpgrade = () => navigate("/upgrade");
  return (
    <Modal
      title="Enhancements"
      icon="✨"
      onClose={onClose}
      footer={<Button onClick={onClose}>Done</Button>}
    >
      <div style={{ display: "grid", gap: 8 }}>
        <SwitchRow label="Hooks" hint="Find the line that travels" fixed />
        <SwitchRow label="Captions" hint="Burn word-by-word subs" fixed />
        {showReframe && (
          <SwitchRow
            label="Reframe"
            hint="AI speaker tracking → 9:16 portrait"
            on={form.reframe && form.clipStyle === "reframe"}
            onChange={setReframe}
            locked={!isPro}
            onLockedClick={toUpgrade}
          />
        )}
        <SwitchRow
          label="Trim silence"
          hint="Cut out pauses & dead air"
          on={form.trimSilence}
          onChange={(v) => set({ trimSilence: v })}
          locked={!isPro}
          onLockedClick={toUpgrade}
        />
        <SwitchRow
          label="Remove fillers"
          hint="Cut um, uh & co out of clips"
          on={form.removeFillers}
          onChange={(v) => set({ removeFillers: v })}
        />
      </div>
    </Modal>
  );
}

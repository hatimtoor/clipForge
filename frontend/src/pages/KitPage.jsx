import { useState } from "react";
import { CaptionStyleGrid } from "../components/CaptionPreviews";
import FacecamBoxModal from "../components/FacecamBoxModal";
import EditClipModal from "../components/EditClipModal";
import {
  useChannelSettingsForm,
  ChannelSettingsChips,
  PromptsAndMusic,
} from "../features/create/ChannelClipSettings";
import {
  Button,
  Card,
  Tag,
  ProBadge,
  Banner,
  EmptyState,
  Field,
  TextInput,
  TextArea,
  Select,
  StepperInput,
  SwitchRow,
  SegmentedControl,
  Modal,
  MenuButton,
  SettingsChip,
  CollapsibleSection,
  OptionGrid,
  ScoreRing,
  ScoreBars,
  ProgressBar,
  PhaseProgress,
} from "../components/kit";

/* Channel-settings chip strip demo — same modals as HelloPage, PATCHes logged. */
function ChannelChipsDemo() {
  const settings = useChannelSettingsForm({}, (fields) => console.log("PATCH", fields));
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <ChannelSettingsChips settings={settings} minDurMax={120} />
      <PromptsAndMusic source={{}} patch={(f) => console.log("PATCH", f)} />
    </div>
  );
}

/* Dev-only kit gallery (/kit, registered only when import.meta.env.DEV).
   Eyeball every component under both themes via the Go Retro FAB. */
export default function KitPage() {
  const [n, setN] = useState(5);
  const [on, setOn] = useState(true);
  const [seg, setSeg] = useState("9:16");
  const [opt, setOpt] = useState("fill");
  const [modal, setModal] = useState(false);
  const [capStyle, setCapStyle] = useState("bold_bottom");
  const [camOpen, setCamOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  return (
    <div style={{ display: "grid", gap: 24, maxWidth: 860 }}>
      <div className="page-head">
        <div className="page-head__title">Kit gallery</div>
        <div className="page-head__sub">Toggle the theme with the FAB to verify both skins.</div>
      </div>

      <Card>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="yt">YouTube</Button>
          <Button variant="tt">TikTok</Button>
          <Button size="sm">Small</Button>
          <Button size="lg">Large</Button>
          <Button disabled>Disabled</Button>
        </div>
      </Card>

      <Card>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <Tag>Neutral</Tag>
          <Tag tone="accent">Accent</Tag>
          <Tag tone="success">Success</Tag>
          <ProBadge />
          <SettingsChip icon="🎬" label="Clips" value="5 · 30–90s" onClick={() => setModal(true)} />
          <MenuButton
            trigger={(t) => (
              <Button variant="secondary" size="sm" onClick={t}>
                Menu ▾
              </Button>
            )}
            items={[
              { label: "Download MP4", onClick: () => {} },
              { label: "Premiere XML", pro: true, onClick: () => {} },
            ]}
          />
        </div>
      </Card>

      <Card>
        <div style={{ display: "grid", gap: 14 }}>
          <Field label="YouTube URL" hint="Paste any youtube.com or youtu.be link">
            <TextInput placeholder="https://youtube.com/watch?v=…" valid />
          </Field>
          <Field label="Find">
            <TextArea placeholder="e.g. every moment about pricing" rows={2} />
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
            <Field label="Max clips">
              <StepperInput value={n} onChange={setN} min={1} max={10} />
            </Field>
            <Field label="Language">
              <Select defaultValue="en">
                <option value="en">English</option>
                <option value="es">Spanish</option>
              </Select>
            </Field>
            <Field label="Format">
              <SegmentedControl
                options={[
                  { id: "9:16", label: "9:16" },
                  { id: "1:1", label: "1:1", pro: true },
                  { id: "16:9", label: "16:9" },
                ]}
                value={seg}
                onChange={setSeg}
              />
            </Field>
          </div>
          <SwitchRow label="Trim silence" hint="Cut dead air automatically" on={on} onChange={setOn} />
          <SwitchRow label="Captions" hint="Burned-in animated captions" fixed />
          <SwitchRow label="Reframe" hint="AI keeps the speaker centered" locked onLockedClick={() => {}} />
        </div>
      </Card>

      <Card>
        <OptionGrid
          value={opt}
          onChange={setOpt}
          options={[
            { id: "fill", label: "Fill", description: "Crop to fill the frame" },
            { id: "fit", label: "Fit", description: "Letterboxed" },
            { id: "blur", label: "Blur BG", description: "Blurred backdrop", pro: true },
            { id: "split", label: "Split", description: "Face + content", pro: true },
          ]}
        />
      </Card>

      <Card>
        <div style={{ display: "grid", gap: 18 }}>
          <ProgressBar progress={62} stripes />
          <PhaseProgress displayProgress={58} status="transcribing" />
          <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
            <ScoreRing score={87} />
            <ScoreRing score={42} size={56} />
            <div style={{ flex: 1 }}>
              <ScoreBars scores={{ hook: 22, flow: 17, value: 24, trend: 12 }} />
            </div>
          </div>
        </div>
      </Card>

      <Banner tone="success" title="7 clips ready">
        Delivered and ready to ship.
      </Banner>
      <Banner tone="warning" title="Retention">
        Clips auto-delete after 7 days.
      </Banner>

      <CollapsibleSection title="AI direction" hint="Optional — tell the AI what to find">
        <Field label="Find">
          <TextInput placeholder="every moment about pricing" />
        </Field>
      </CollapsibleSection>

      <Card>
        <div className="t-label" style={{ marginBottom: 12 }}>Channel settings chips (Watchlist/Digest)</div>
        <ChannelChipsDemo />
      </Card>

      <Card>
        <div className="t-label" style={{ marginBottom: 12 }}>Caption style grid</div>
        <CaptionStyleGrid value={capStyle} onChange={setCapStyle} highlightColor={null} isMobile={false} />
        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <Button variant="secondary" onClick={() => setCamOpen(true)}>▦ Facecam picker</Button>
          <Button variant="secondary" onClick={() => setEditOpen(true)}>✂ Edit modal</Button>
        </div>
      </Card>
      {camOpen && (
        <FacecamBoxModal videoId={null} value={null} onSave={() => {}} onClose={() => setCamOpen(false)} />
      )}
      {editOpen && (
        <EditClipModal jobId="demo" clipIndex={null} onClose={() => setEditOpen(false)} onRendered={() => {}} />
      )}

      <Card flush>
        <EmptyState
          icon="🔥"
          title="The forge is cold"
          description="Start a new clip to fire it up."
          action={<Button>Create clips</Button>}
        />
      </Card>

      {modal && (
        <Modal
          title="Clips & length"
          icon="🎬"
          onClose={() => setModal(false)}
          footer={<Button onClick={() => setModal(false)}>Done</Button>}
        >
          <Field label="Max clips">
            <StepperInput value={n} onChange={setN} min={1} max={10} />
          </Field>
        </Modal>
      )}
    </div>
  );
}

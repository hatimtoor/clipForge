import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useApp } from "../context/AppContext";
import {
  Button,
  Card,
  Banner,
  Field,
  TextInput,
  StepperInput,
  SwitchRow,
  SegmentedControl,
  SettingsChip,
  CollapsibleSection,
  Tour,
} from "../components/kit";
import { CAPTION_TEMPLATE_PREVIEWS } from "../components/CaptionPreviews";
import FacecamBoxModal, { youtubeId } from "../components/FacecamBoxModal";
import { useCreateJobForm } from "../features/create/useCreateJobForm";
import {
  PRESETS,
  MUSIC_VOLUMES,
  VERTICAL_ONLY_LAYOUTS,
  layoutLabel,
} from "../features/create/constants";
import ClipsLengthModal from "../features/create/modals/ClipsLengthModal";
import LayoutFormatModal from "../features/create/modals/LayoutFormatModal";
import CaptionsModal from "../features/create/modals/CaptionsModal";
import EnhanceModal from "../features/create/modals/EnhanceModal";

const TOUR_STEPS = [
  {
    target: "#tour-url",
    title: "Start with a link",
    text: "Paste any YouTube URL — podcast, stream, lecture. Hit Generate and the defaults do the rest.",
  },
  {
    target: "#tour-chips",
    title: "Every setting lives here",
    text: "Clip count, layout, captions, enhancements — each chip shows its current value and opens the full picker.",
  },
  {
    target: "#tour-find",
    title: "Tell the AI what to clip",
    text: "Optional but powerful: “every moment about pricing”, “the funniest reactions”. Exclude keeps intros and sponsor reads out.",
  },
  {
    target: "#tour-submit",
    title: "Generate!",
    text: "Clips arrive in a few minutes — watch progress on Work, revisit them anytime in Archive.",
  },
];

export default function HelloPage() {
  const [searchParams] = useSearchParams();
  const { isPro, refreshProfile } = useApp();
  const f = useCreateJobForm();
  const { form, set } = f;

  // Returning from a Lemon Squeezy checkout: the webhook grants Pro server-side,
  // but may land a moment after the redirect — poll the profile a few times so
  // the UI flips to Pro without a manual refresh.
  useEffect(() => {
    if (searchParams.get("upgraded") !== "1") return;
    let n = 0;
    const id = setInterval(() => {
      refreshProfile?.();
      if (++n >= 5) clearInterval(id);
    }, 2000);
    window.history.replaceState({}, "", "/hello"); // drop the ?upgraded flag
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [openModal, setOpenModal] = useState(null); // clips | layout | captions | enhance
  const [camOpen, setCamOpen] = useState(false);
  // RETRY deep-links pre-fill these — auto-expand so restored values are visible.
  const [aiOpen, setAiOpen] = useState(!!(form.stylePrompt || form.excludePrompt));
  const [advOpen, setAdvOpen] = useState(form.tfStart > 0 || form.tfEnd > 0);

  const captionName =
    CAPTION_TEMPLATE_PREVIEWS.find((t) => t.id === form.captionStyle)?.name || form.captionStyle;
  const langShort =
    form.captionLanguage === "source" ? "Auto" : form.captionLanguage.toUpperCase();
  const formatShown = VERTICAL_ONLY_LAYOUTS.includes(form.clipStyle) ? "9:16" : form.aspectRatio;
  const enhanceCount =
    2 +
    (form.reframe && form.clipStyle === "reframe" ? 1 : 0) +
    (form.trimSilence ? 1 : 0) +
    (form.removeFillers ? 1 : 0);

  const applyPreset = (p) => {
    set(p.apply);
    if (p.id === "exact") setAdvOpen(true);
  };

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", display: "grid", gap: 20 }}>
      <div className="page-head" style={{ textAlign: "center", marginTop: 12 }}>
        <h1 className="t-display" style={{ margin: 0 }}>
          Turn one long video into
          <br />
          clips that travel
        </h1>
        <p className="page-head__sub" style={{ marginTop: 10 }}>
          Paste a link. The AI finds the moments, burns the captions, and scores every hook.
        </p>
      </div>

      <Card>
        <Field label="YouTube link" id="tour-url">
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 280px", position: "relative" }}>
              <TextInput
                value={form.url}
                valid={f.valid && !!form.url}
                onChange={(e) => set({ url: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && f.valid && f.submit()}
                placeholder="https://youtube.com/watch?v=…"
              />
              {f.valid && (
                <span
                  style={{
                    position: "absolute",
                    right: 12,
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: "var(--success)",
                    fontWeight: 700,
                    fontSize: 14,
                    pointerEvents: "none",
                  }}
                >
                  ✓
                </span>
              )}
            </div>
            <Button
              id="tour-submit"
              size="lg"
              disabled={!f.valid || f.loading}
              onClick={f.submit}
              style={{ flex: "0 1 auto" }}
            >
              {f.loading ? "Starting…" : "⚡ Generate clips"}
            </Button>
          </div>
        </Field>
        <div className="t-sm" style={{ marginTop: 10, color: "var(--text-3)" }}>
          Takes 2–4 minutes · your job keeps running even if you close the tab
        </div>
      </Card>

      {f.error && (
        <Banner tone="danger" title="Couldn't start the job">
          {f.error}
        </Banner>
      )}

      <div>
        <div className="t-label" style={{ marginBottom: 10 }}>
          Settings
        </div>
        <div id="tour-chips" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <SettingsChip
            icon="🎬"
            value={`${form.maxClips} clips · ${form.minDur}–${form.maxDur}s`}
            onClick={() => setOpenModal("clips")}
          />
          <SettingsChip
            icon="▭"
            value={`${formatShown} · ${layoutLabel(form.clipStyle)}`}
            onClick={() => setOpenModal("layout")}
          />
          <SettingsChip
            icon="Aa"
            value={`${captionName} · ${langShort}`}
            onClick={() => setOpenModal("captions")}
          />
          <SettingsChip
            icon="✨"
            label="Enhance"
            value={`${enhanceCount} active`}
            onClick={() => setOpenModal("enhance")}
          />
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          {PRESETS.map((p) => (
            <Button key={p.id} size="sm" variant="ghost" onClick={() => applyPreset(p)}>
              {p.label}
            </Button>
          ))}
        </div>
      </div>

      <CollapsibleSection
        id="tour-find"
        title="AI direction"
        hint="Optional — tell the AI what to find and what to skip"
        open={aiOpen}
        onToggle={setAiOpen}
      >
        <div style={{ display: "grid", gap: 14 }}>
          <Field label="Find" hint="What should the AI clip?">
            <TextInput
              value={form.stylePrompt}
              onChange={(e) => set({ stylePrompt: e.target.value })}
              placeholder="e.g. every moment about pricing, the funniest reactions"
            />
          </Field>
          <Field label="Exclude" hint="Topics to never clip">
            <TextInput
              value={form.excludePrompt}
              onChange={(e) => set({ excludePrompt: e.target.value })}
              placeholder="e.g. intros, sponsor reads, audio checks"
            />
          </Field>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Advanced"
        hint="Timeframe, exact cut, background music"
        open={advOpen}
        onToggle={setAdvOpen}
      >
        <div style={{ display: "grid", gap: 18 }}>
          {!form.exactOn && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Clip from" hint="Minutes into the video (0 = start)">
                <StepperInput
                  value={form.tfStart}
                  onChange={(v) => set({ tfStart: v })}
                  min={0}
                  max={600}
                  suffix=" min"
                />
              </Field>
              <Field label="Clip until" hint="0 = end of video">
                <StepperInput
                  value={form.tfEnd}
                  onChange={(v) => set({ tfEnd: v })}
                  min={0}
                  max={600}
                  suffix=" min"
                />
              </Field>
            </div>
          )}

          <SwitchRow
            label="Exact clip"
            hint={
              form.exactOn
                ? "Cutting exactly this range as one clip — AI selection off"
                : "Know the moment? Cut an exact start–end range"
            }
            on={form.exactOn}
            onChange={(v) => set({ exactOn: v })}
          />
          {form.exactOn && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Field label="Start at">
                  <TextInput
                    value={form.exactStart}
                    onChange={(e) => set({ exactStart: e.target.value })}
                    placeholder="14:20"
                  />
                </Field>
                <Field label="End at">
                  <TextInput
                    value={form.exactEnd}
                    onChange={(e) => set({ exactEnd: e.target.value })}
                    placeholder="15:05"
                  />
                </Field>
              </div>
              <div
                className="t-sm"
                style={{ color: f.exactValid ? "var(--text-2)" : "var(--danger)" }}
              >
                {f.exactSpan != null && f.exactValid
                  ? `Clip length: ${Math.round(f.exactSpan)}s — fine-tune it with ✂ Edit after it renders`
                  : "Times as mm:ss (or h:mm:ss) · 3s to 3min · one clip, rendered exactly"}
              </div>
            </>
          )}

          <Field label="Background music" hint="Optional — a YouTube music URL, ducked under the voice">
            <TextInput
              value={form.bgMusicUrl}
              onChange={(e) => set({ bgMusicUrl: e.target.value })}
              placeholder="paste a YouTube music URL"
            />
          </Field>
          {form.bgMusicUrl.trim() && (
            <Field label="Music volume">
              <SegmentedControl
                value={form.bgMusicVolume}
                onChange={(id) => set({ bgMusicVolume: id })}
                options={MUSIC_VOLUMES}
              />
            </Field>
          )}
        </div>
      </CollapsibleSection>

      <div className="t-sm" style={{ textAlign: "center", color: "var(--text-3)" }}>
        We look for tension shifts, numbers & names, contrarian takes, and confessions —
        the moments that make people stop scrolling.
      </div>

      {openModal === "clips" && (
        <ClipsLengthModal form={form} set={set} onClose={() => setOpenModal(null)} />
      )}
      {openModal === "layout" && (
        <LayoutFormatModal
          form={form}
          set={set}
          setLayout={f.setLayout}
          isPro={isPro}
          onMarkCam={() => {
            setOpenModal(null);
            setCamOpen(true);
          }}
          onClose={() => setOpenModal(null)}
        />
      )}
      {openModal === "captions" && (
        <CaptionsModal
          form={form}
          set={set}
          setCaptionStyle={f.setCaptionStyle}
          captionCustomizable={f.captionCustomizable}
          effectiveFontSize={f.effectiveFontSize}
          onClose={() => setOpenModal(null)}
        />
      )}
      {openModal === "enhance" && (
        <EnhanceModal
          form={form}
          set={set}
          setReframe={f.setReframe}
          isPro={isPro}
          onClose={() => setOpenModal(null)}
        />
      )}

      {camOpen && (
        <FacecamBoxModal
          videoId={youtubeId(form.url)}
          value={
            form.facecamBox
              ? {
                  x: form.facecamBox[0],
                  y: form.facecamBox[1],
                  w: form.facecamBox[2],
                  h: form.facecamBox[3],
                }
              : null
          }
          onSave={(box) => set({ facecamBox: box })}
          onClose={() => setCamOpen(false)}
        />
      )}

      <Tour steps={TOUR_STEPS} storageKey="cf_tour_v2" />
    </div>
  );
}

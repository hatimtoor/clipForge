import { useState } from "react";
import { SettingsChip, Field, TextInput, SegmentedControl } from "../../components/kit";
import { CAPTION_TEMPLATE_PREVIEWS, CUSTOMIZABLE_CAPTION_STYLES } from "../../components/CaptionPreviews";
import FacecamBoxModal from "../../components/FacecamBoxModal";
import { STYLE_FONT_DEFAULTS, VERTICAL_ONLY_LAYOUTS, MUSIC_VOLUMES, layoutLabel } from "./constants";
import ClipsLengthModal from "./modals/ClipsLengthModal";
import LayoutFormatModal from "./modals/LayoutFormatModal";
import CaptionsModal from "./modals/CaptionsModal";
import EnhanceModal from "./modals/EnhanceModal";

/* Channel/backfill clip settings in the SAME chip-strip + modal format as the
   create (Hello) page, reusing the very same modal components.

   The hook adapts between the modals' form shape (camelCase, HelloPage
   conventions) and the backend PATCH contract used by /api/channels/:id and
   /api/backfill/:id (snake_case, some fields nested under .options in the GET
   response). Every set() both updates local state and PATCHes immediately —
   matching the previous inline-settings behavior. */

const FORM_TO_PATCH = {
  maxClips: (v) => ({ max_clips: v }),
  minDur: (v) => ({ min_duration: v }),
  maxDur: (v) => ({ max_duration: v }),
  clipStyle: (v) => ({ clip_style: v }),
  aspectRatio: (v) => ({ aspect_ratio: v }),
  facecamBox: (v) => ({ facecam_box: v }),
  trimSilence: (v) => ({ trim_silence: v }),
  removeFillers: (v) => ({ remove_fillers: v }),
  captionStyle: (v) => ({ caption_style: v }),
  fontSizeOverride: (v) => ({ caption_font_size: v }),
  highlightColor: (v) => ({ caption_highlight_color: v }),
  captionLanguage: (v) => ({ caption_language: v }),
  captionPosition: (v) => ({ caption_position: v === "default" ? null : v }),
  captionKeywords: (v) => ({ caption_keywords: v }),
  captionEmoji: (v) => ({ caption_emoji: v }),
  bgMusicUrl: (v) => ({ bg_music_url: String(v).trim() || null }),
  bgMusicVolume: (v) => ({ bg_music_volume: v }),
};

export function useChannelSettingsForm(source, patchFn) {
  const opt = source.options || {};
  const [form, setForm] = useState(() => ({
    maxClips: source.max_clips ?? 3,
    minDur: source.min_duration ?? 30,
    maxDur: source.max_duration ?? 90,
    clipStyle: source.clip_style ?? "reframe",
    aspectRatio: opt.aspect_ratio ?? "9:16",
    facecamBox: opt.facecam_box ?? null,
    trimSilence: source.trim_silence ?? false,
    removeFillers: opt.remove_fillers ?? false,
    captionStyle: source.caption_style ?? "bold_bottom",
    fontSizeOverride: source.caption_font_size ?? null,
    highlightColor: source.caption_highlight_color ?? null,
    captionLanguage: source.caption_language ?? "source",
    captionPosition: opt.caption_position ?? "default",
    captionKeywords: opt.caption_keywords !== false,
    captionEmoji: opt.caption_emoji !== false,
    bgMusicUrl: source.bg_music_url ?? "",
    bgMusicVolume: source.bg_music_volume ?? 0.15,
    reframe: false, // channels have no per-job reframe flag
  }));

  const set = (patch) => {
    setForm((f) => ({ ...f, ...patch }));
    const fields = {};
    for (const [k, v] of Object.entries(patch)) {
      const translate = FORM_TO_PATCH[k];
      if (translate) Object.assign(fields, translate(v));
    }
    if (Object.keys(fields).length) patchFn(fields);
  };

  const setCaptionStyle = (id) => {
    const patch = { captionStyle: id };
    if (form.fontSizeOverride !== null) patch.fontSizeOverride = null;
    if (!CUSTOMIZABLE_CAPTION_STYLES.includes(id) && form.highlightColor) patch.highlightColor = null;
    set(patch);
  };

  const setLayout = (id) => set({ clipStyle: id });

  const captionCustomizable = CUSTOMIZABLE_CAPTION_STYLES.includes(form.captionStyle);
  const effectiveFontSize = form.fontSizeOverride ?? STYLE_FONT_DEFAULTS[form.captionStyle] ?? 72;

  return { form, set, setCaptionStyle, setLayout, captionCustomizable, effectiveFontSize };
}

/* Find/Exclude prompts + background music: free-text fields that PATCH on
   blur — kept outside the modals, matching the Hello page where AI direction
   is also its own section. Shared by Watchlist and Digest cards. */
export function PromptsAndMusic({ source, patch }) {
  const opt = source.options || {};
  const [findPrompt, setFindPrompt] = useState(opt.style_prompt ?? "");
  const [excludePrompt, setExcludePrompt] = useState(opt.exclude_prompt ?? "");
  const [bgMusicUrl, setBgMusicUrl] = useState(source.bg_music_url ?? "");
  const [bgMusicVolume, setBgMusicVolume] = useState(source.bg_music_volume ?? 0.15);

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Field label="Find" hint="Optional — what should the AI clip?">
        <TextInput
          value={findPrompt}
          onChange={(e) => setFindPrompt(e.target.value)}
          onBlur={() => patch({ style_prompt: findPrompt.trim() || null })}
          placeholder="e.g. every moment about pricing"
        />
      </Field>
      <Field label="Exclude" hint="Topics to never clip">
        <TextInput
          value={excludePrompt}
          onChange={(e) => setExcludePrompt(e.target.value)}
          onBlur={() => patch({ exclude_prompt: excludePrompt.trim() || null })}
          placeholder="e.g. intros, sponsor reads"
        />
      </Field>
      <Field label="Background music" hint="Optional — a YouTube music URL, ducked under the voice">
        <TextInput
          value={bgMusicUrl}
          onChange={(e) => setBgMusicUrl(e.target.value)}
          onBlur={() => patch({ bg_music_url: bgMusicUrl.trim() || null })}
          placeholder="paste a YouTube music URL"
        />
      </Field>
      {bgMusicUrl.trim() && (
        <Field label="Music volume">
          <SegmentedControl
            value={bgMusicVolume}
            options={MUSIC_VOLUMES}
            onChange={(id) => {
              setBgMusicVolume(id);
              patch({ bg_music_volume: id });
            }}
          />
        </Field>
      )}
    </div>
  );
}

/* The chip strip + modals. `videoId` feeds the facecam frame preview
   (channel's last seen video); `minDurMax` mirrors each page's old range. */
export function ChannelSettingsChips({ settings, videoId, minDurMax = 120, idPrefix = "" }) {
  const { form, set, setCaptionStyle, setLayout, captionCustomizable, effectiveFontSize } = settings;
  const [openModal, setOpenModal] = useState(null); // clips | layout | captions | enhance
  const [camOpen, setCamOpen] = useState(false);

  const captionName =
    CAPTION_TEMPLATE_PREVIEWS.find((t) => t.id === form.captionStyle)?.name || form.captionStyle;
  const langShort = form.captionLanguage === "source" ? "Auto" : form.captionLanguage.toUpperCase();
  const formatShown = VERTICAL_ONLY_LAYOUTS.includes(form.clipStyle) ? "9:16" : form.aspectRatio;
  const enhanceCount = 2 + (form.trimSilence ? 1 : 0) + (form.removeFillers ? 1 : 0);

  return (
    <>
      <div id={idPrefix ? `${idPrefix}-chips` : undefined} className="chip-strip">
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

      {openModal === "clips" && (
        <ClipsLengthModal form={form} set={set} minDurMax={minDurMax} onClose={() => setOpenModal(null)} />
      )}
      {openModal === "layout" && (
        <LayoutFormatModal
          form={form}
          set={set}
          setLayout={setLayout}
          isPro // Watchlist/Digest are Pro-gated pages — every layout is available
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
          setCaptionStyle={setCaptionStyle}
          captionCustomizable={captionCustomizable}
          effectiveFontSize={effectiveFontSize}
          onClose={() => setOpenModal(null)}
        />
      )}
      {openModal === "enhance" && (
        <EnhanceModal form={form} set={set} isPro showReframe={false} onClose={() => setOpenModal(null)} />
      )}

      {camOpen && (
        <FacecamBoxModal
          videoId={videoId || null}
          value={
            form.facecamBox
              ? { x: form.facecamBox[0], y: form.facecamBox[1], w: form.facecamBox[2], h: form.facecamBox[3] }
              : null
          }
          onSave={(b) => set({ facecamBox: b })}
          onClose={() => setCamOpen(false)}
        />
      )}
    </>
  );
}

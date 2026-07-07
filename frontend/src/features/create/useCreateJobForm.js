import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { authFetch } from "../../lib/supabase";
import { useApp } from "../../context/AppContext";
import { CUSTOMIZABLE_CAPTION_STYLES } from "../../components/CaptionPreviews";
import { STYLE_FONT_DEFAULTS, VERTICAL_ONLY_LAYOUTS } from "./constants";

/* All create-job state, lifted out of the page so settings modals edit the
   same object. Query-param names and the /api/clip POST body are the contract
   shared with Archive's RETRY deep-links and the backend — byte-identical to
   the pre-redesign HelloPage. */

// "1:23", "01:02:03", or plain seconds → seconds (null = unparseable)
export const parseTime = (s) => {
  const t = String(s || "").trim();
  if (!t) return null;
  if (/^\d+(\.\d+)?$/.test(t)) return parseFloat(t);
  const parts = t.split(":").map(Number);
  if (parts.some(isNaN) || parts.length > 3) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
};

export function useCreateJobForm() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { setJobActive } = useApp();

  const [form, setForm] = useState(() => ({
    url: searchParams.get("url") || "",
    maxClips: Number(searchParams.get("max_clips")) || 5,
    minDur: Number(searchParams.get("min_dur")) || 30,
    maxDur: Number(searchParams.get("max_dur")) || 90,
    reframe: searchParams.get("reframe") === "1",
    clipStyle: searchParams.get("clip_style") || "reframe",
    aspectRatio: searchParams.get("aspect_ratio") || "9:16",
    facecamBox: null,
    trimSilence: searchParams.get("trim_silence") === "1",
    removeFillers: searchParams.get("remove_fillers") === "1",
    stylePrompt: searchParams.get("style_prompt") || "",
    excludePrompt: searchParams.get("exclude_prompt") || "",
    tfStart: Number(searchParams.get("tf_start")) || 0,
    tfEnd: Number(searchParams.get("tf_end")) || 0,
    exactOn: false,
    exactStart: "",
    exactEnd: "",
    captionStyle: searchParams.get("caption_style") || "bold_bottom",
    fontSizeOverride: searchParams.get("font_size") ? Number(searchParams.get("font_size")) : null,
    highlightColor: searchParams.get("highlight_color") || null,
    captionLanguage: searchParams.get("caption_language") || "source",
    captionPosition: searchParams.get("caption_position") || "default",
    captionKeywords: searchParams.get("caption_keywords") !== "0",
    captionEmoji: searchParams.get("caption_emoji") !== "0",
    bgMusicUrl: "",
    bgMusicVolume: 0.15,
  }));

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  /* derived */
  const valid = /youtu\.?be/.test(form.url);
  const exactS = parseTime(form.exactStart);
  const exactE = parseTime(form.exactEnd);
  const exactSpan = exactS != null && exactE != null ? exactE - exactS : null;
  const exactValid = !form.exactOn || (exactSpan != null && exactSpan >= 3 && exactSpan <= 180);
  const captionCustomizable = CUSTOMIZABLE_CAPTION_STYLES.includes(form.captionStyle);
  const effectiveFontSize =
    form.fontSizeOverride ?? STYLE_FONT_DEFAULTS[form.captionStyle] ?? 72;

  /* coupled setters — keep the option-combination rules in one place */
  const setCaptionStyle = (id) => {
    const patch = { captionStyle: id };
    if (form.fontSizeOverride !== null) patch.fontSizeOverride = null;
    // Designed templates keep their identity — size/colour tweaks only apply
    // to the plain styles, so clear a stale pick when switching away.
    if (!CUSTOMIZABLE_CAPTION_STYLES.includes(id) && form.highlightColor)
      patch.highlightColor = null;
    set(patch);
  };

  const setLayout = (id) => {
    const patch = { clipStyle: id };
    if (id !== "reframe") patch.reframe = false;
    set(patch);
  };

  const setReframe = (v) => {
    const patch = { reframe: v };
    if (v) patch.clipStyle = "reframe";
    set(patch);
  };

  const submit = async () => {
    if (!form.url.trim()) {
      setError("Paste a YouTube URL first.");
      return;
    }
    if (form.exactOn && !exactValid) {
      setError(
        exactSpan == null
          ? "Exact clip needs a start and end time (like 14:20)."
          : exactSpan < 3
          ? "Exact clip must be at least 3 seconds."
          : "Exact clip can be at most 3 minutes."
      );
      return;
    }
    setError("");
    setLoading(true);
    try {
      const res = await authFetch("/api/clip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: form.url,
          max_clips: form.maxClips,
          min_duration: form.minDur,
          max_duration: form.maxDur,
          reframe: form.clipStyle === "reframe" && form.reframe,
          clip_style: form.clipStyle,
          aspect_ratio: VERTICAL_ONLY_LAYOUTS.includes(form.clipStyle) ? "9:16" : form.aspectRatio,
          facecam_box: form.facecamBox || undefined,
          trim_silence: form.trimSilence,
          remove_fillers: form.removeFillers,
          style_prompt: form.stylePrompt.trim() || undefined,
          exclude_prompt: form.excludePrompt.trim() || undefined,
          timeframe_start_min: !form.exactOn && form.tfStart > 0 ? form.tfStart : undefined,
          timeframe_end_min: !form.exactOn && form.tfEnd > 0 ? form.tfEnd : undefined,
          exact_start_s: form.exactOn ? exactS : undefined,
          exact_end_s: form.exactOn ? exactE : undefined,
          caption_style: form.captionStyle,
          caption_font_size: (captionCustomizable && form.fontSizeOverride) || undefined,
          caption_highlight_color: (captionCustomizable && form.highlightColor) || undefined,
          caption_position: form.captionPosition !== "default" ? form.captionPosition : undefined,
          caption_keywords: form.captionKeywords,
          caption_emoji: form.captionEmoji,
          caption_language: form.captionLanguage || "source",
          bg_music_url: form.bgMusicUrl.trim() || undefined,
          bg_music_volume: form.bgMusicVolume,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail || "Failed to start job.");
        setLoading(false);
        return;
      }
      setJobActive(data.job_id);
      navigate(`/work?job=${data.job_id}`);
    } catch {
      setError("Failed to start job. Is the server running?");
      setLoading(false);
    }
  };

  return {
    form,
    set,
    setCaptionStyle,
    setLayout,
    setReframe,
    submit,
    error,
    setError,
    loading,
    valid,
    exactS,
    exactE,
    exactSpan,
    exactValid,
    captionCustomizable,
    effectiveFontSize,
  };
}

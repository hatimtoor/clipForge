import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { authFetch } from "../lib/supabase";
import { useMobile } from "../hooks/useMobile";
import {
  Button, Card, Tag, ProBadge, Banner, EmptyState,
  Field, TextInput, Select, StepperInput, SwitchRow, SegmentedControl,
  CollapsibleSection, ProgressBar, Tour,
} from "../components/kit";
import { CaptionStyleGrid, CUSTOMIZABLE_CAPTION_STYLES } from "../components/CaptionPreviews";
import FacecamBoxModal from "../components/FacecamBoxModal";
import {
  LAYOUTS, FORMATS, VERTICAL_ONLY_LAYOUTS, CAM_BOX_LAYOUTS,
  CAPTION_POSITIONS, HIGHLIGHT_SWATCHES, MUSIC_VOLUMES,
} from "../features/create/constants";

const DAY_OPTIONS = [
  { value: 30, label: "30 days back" },
  { value: 60, label: "60 days back" },
  { value: 90, label: "90 days back" },
  { value: 180, label: "6 months back" },
  { value: 365, label: "1 year back" },
];
const VPD_OPTIONS = [1, 2, 3, 5].map((n) => ({ id: n, label: String(n) }));
const CAPTION_FONT_DEFAULTS = { bold_bottom: 72, center_pop: 88, minimal: 56, simple: 56 };
const CAPTION_LANGUAGES = [
  { code: "source", label: "Source (no translation)" },
  { code: "en", label: "English" }, { code: "es", label: "Spanish" },
  { code: "fr", label: "French" }, { code: "de", label: "German" },
  { code: "pt", label: "Portuguese" }, { code: "it", label: "Italian" },
  { code: "hi", label: "Hindi" }, { code: "ar", label: "Arabic" },
  { code: "zh", label: "Chinese" }, { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" }, { code: "ru", label: "Russian" },
];

const TOUR_STEPS = [
  {
    target: "#tour-dg-add",
    title: "Clip the back-catalog",
    text: "Digest works through a channel's whole history, a few videos per day, hands-free. Add a channel, pick how far back to look and the daily pace on its card.",
  },
];

/* Per-card caption / layout / prompt settings — the same fields the create
   flow exposes, persisted per digest channel via PATCH. */
function DigestSettings({ bf, patch }) {
  const isMobile = useMobile();
  const bfOpt = bf.options || {};
  const [captionStyle, setCaptionStyle] = useState(bf.caption_style ?? "bold_bottom");
  const [fontSize, setFontSize] = useState(bf.caption_font_size ?? null);
  const [highlightColor, setHighlightColor] = useState(bf.caption_highlight_color ?? null);
  const [captionLang, setCaptionLang] = useState(bf.caption_language ?? "source");
  const [bgMusicUrl, setBgMusicUrl] = useState(bf.bg_music_url ?? "");
  const [bgMusicVolume, setBgMusicVolume] = useState(bf.bg_music_volume ?? 0.15);
  const [trimSilence, setTrimSilence] = useState(bf.trim_silence ?? false);
  const [clipStyle, setClipStyle] = useState(bf.clip_style ?? "reframe");
  const [removeFillers, setRemoveFillers] = useState(bfOpt.remove_fillers ?? false);
  const [aspectRatio, setAspectRatio] = useState(bfOpt.aspect_ratio ?? "9:16");
  const [captionPosition, setCaptionPosition] = useState(bfOpt.caption_position ?? "default");
  const [captionKeywords, setCaptionKeywords] = useState(bfOpt.caption_keywords !== false);
  const [captionEmoji, setCaptionEmoji] = useState(bfOpt.caption_emoji !== false);
  const [findPrompt, setFindPrompt] = useState(bfOpt.style_prompt ?? "");
  const [excludePrompt, setExcludePrompt] = useState(bfOpt.exclude_prompt ?? "");
  const [facecamBox, setFacecamBox] = useState(bfOpt.facecam_box ?? null);
  const [camModalOpen, setCamModalOpen] = useState(false);

  const effectiveFontSize = fontSize ?? CAPTION_FONT_DEFAULTS[captionStyle] ?? 72;
  const captionCustomizable = CUSTOMIZABLE_CAPTION_STYLES.includes(captionStyle);
  const verticalOnly = VERTICAL_ONLY_LAYOUTS.includes(clipStyle);

  return (
    <CollapsibleSection title="Caption settings" hint="Style, language, layout, prompts">
      <div style={{ display: "grid", gap: 18 }}>
        <Field label="Style">
          <CaptionStyleGrid
            value={captionStyle}
            onChange={(id) => {
              setCaptionStyle(id);
              const fields = { caption_style: id };
              if (!CUSTOMIZABLE_CAPTION_STYLES.includes(id)) {
                setFontSize(null); setHighlightColor(null);
                fields.caption_font_size = null; fields.caption_highlight_color = null;
              }
              patch(fields);
            }}
            highlightColor={highlightColor}
            isMobile={isMobile}
          />
        </Field>

        <div style={{ display: "grid", gap: 8 }}>
          <SwitchRow label="AI keywords" hint="Color the words that carry the clip"
            on={captionKeywords}
            onChange={(v) => { setCaptionKeywords(v); patch({ caption_keywords: v }); }} />
          <SwitchRow label="AI emoji" hint="Drop a fitting emoji on big moments"
            on={captionEmoji}
            onChange={(v) => { setCaptionEmoji(v); patch({ caption_emoji: v }); }} />
        </div>

        <Field label="Position">
          <SegmentedControl value={captionPosition} options={CAPTION_POSITIONS}
            onChange={(id) => { setCaptionPosition(id); patch({ caption_position: id === "default" ? null : id }); }} />
        </Field>

        <Field label="Language">
          <Select value={captionLang}
            onChange={(e) => { setCaptionLang(e.target.value); patch({ caption_language: e.target.value }); }}>
            {CAPTION_LANGUAGES.map(({ code, label }) => (
              <option key={code} value={code}>{label}</option>
            ))}
          </Select>
        </Field>

        {captionCustomizable && (
          <>
            <Field label="Font size">
              <div style={{ display: "flex", gap: 10, alignItems: "stretch" }}>
                <div style={{ flex: 1 }}>
                  <StepperInput value={effectiveFontSize} min={40} max={120} step={4} suffix="px"
                    onChange={(v) => { setFontSize(v); patch({ caption_font_size: v }); }} />
                </div>
                <Button variant={fontSize === null ? "primary" : "secondary"}
                  onClick={() => { setFontSize(null); patch({ caption_font_size: null }); }}>
                  Auto
                </Button>
              </div>
            </Field>
            <Field label="Highlight color">
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {HIGHLIGHT_SWATCHES.map(({ color, label, bg, fg }) => {
                  const active = highlightColor === color;
                  return (
                    <button key={label} type="button"
                      onClick={() => { setHighlightColor(color); patch({ caption_highlight_color: color }); }}
                      style={{
                        padding: "8px 13px", background: bg, color: fg,
                        fontFamily: "var(--font-ui)", fontSize: "var(--fs-tag)",
                        fontWeight: 700, textTransform: "var(--tt-label)",
                        border: active ? "2px solid var(--text-1)" : "2px solid var(--line)",
                        borderRadius: "var(--radius-sm)",
                        boxShadow: active ? "var(--shadow-btn)" : "none",
                        cursor: "pointer",
                      }}>
                      {label}
                    </button>
                  );
                })}
              </div>
            </Field>
          </>
        )}

        <Field label="Background music" hint="Optional — a YouTube music URL, ducked under the voice">
          <TextInput value={bgMusicUrl} placeholder="paste a YouTube music URL"
            onChange={(e) => setBgMusicUrl(e.target.value)}
            onBlur={() => patch({ bg_music_url: bgMusicUrl.trim() || null })} />
        </Field>
        {bgMusicUrl.trim() && (
          <Field label="Music volume">
            <SegmentedControl value={bgMusicVolume} options={MUSIC_VOLUMES}
              onChange={(id) => { setBgMusicVolume(id); patch({ bg_music_volume: id }); }} />
          </Field>
        )}

        <Field label="Layout" hint="How each clip is framed for vertical viewing">
          <SegmentedControl value={clipStyle}
            options={LAYOUTS.map((l) => ({ id: l.id, label: l.label }))}
            onChange={(id) => { setClipStyle(id); patch({ clip_style: id }); }} />
        </Field>

        {CAM_BOX_LAYOUTS.includes(clipStyle) && (
          <Button variant="secondary" onClick={() => setCamModalOpen(true)}>
            {facecamBox ? "✓ Cam box set — click to adjust" : "▦ Mark the facecam (optional)"}
          </Button>
        )}
        {camModalOpen && (
          <FacecamBoxModal
            videoId={(bf.processed_video_ids || [])[0] || null}
            value={facecamBox ? { x: facecamBox[0], y: facecamBox[1], w: facecamBox[2], h: facecamBox[3] } : null}
            onSave={(b) => { setFacecamBox(b); patch({ facecam_box: b }); }}
            onClose={() => setCamModalOpen(false)}
          />
        )}

        <Field label="Format" hint={verticalOnly ? "This layout renders vertical-only (9:16)." : undefined}>
          <SegmentedControl value={verticalOnly ? "9:16" : aspectRatio}
            options={FORMATS.map((f) => ({
              id: f.id, label: f.label, disabled: verticalOnly && f.id !== "9:16",
            }))}
            onChange={(id) => { setAspectRatio(id); patch({ aspect_ratio: id }); }} />
        </Field>

        <Field label="Find" hint="Optional — what should the AI clip?">
          <TextInput value={findPrompt} placeholder="e.g. every moment about pricing"
            onChange={(e) => setFindPrompt(e.target.value)}
            onBlur={() => patch({ style_prompt: findPrompt.trim() || null })} />
        </Field>
        <Field label="Exclude" hint="Optional — topics to never clip">
          <TextInput value={excludePrompt} placeholder="e.g. intros, sponsor reads"
            onChange={(e) => setExcludePrompt(e.target.value)}
            onBlur={() => patch({ exclude_prompt: excludePrompt.trim() || null })} />
        </Field>

        <div style={{ display: "grid", gap: 8 }}>
          <SwitchRow label="✂ Trim silence" hint="Cut dead air inside clips"
            on={trimSilence}
            onChange={(v) => { setTrimSilence(v); patch({ trim_silence: v }); }} />
          <SwitchRow label="⌫ Cut fillers (um, uh)" hint="Remove filler words from the cut"
            on={removeFillers}
            onChange={(v) => { setRemoveFillers(v); patch({ remove_fillers: v }); }} />
        </div>
      </div>
    </CollapsibleSection>
  );
}

function DigestCard({ bf, ytStatus, ttStatus, onRemove, onRunNow, onPatch }) {
  const isMobile = useMobile();
  const isCompleted = bf.status === "completed";
  const processed = (bf.processed_video_ids || []).length;
  const total = bf.total_videos || 0;
  const progressMax = total || processed + 1;

  const [daysBack, setDaysBack] = useState(bf.days_back ?? 30);
  const [videosPerDay, setVideosPerDay] = useState(bf.videos_per_day ?? 2);
  const [ytChannelId, setYtChannelId] = useState(bf.yt_upload_channel_id ?? "");
  const [ttAccountId, setTtAccountId] = useState(bf.tt_open_id ?? "");
  const [autoUpload, setAutoUpload] = useState(bf.auto_upload ?? false);
  const [maxClips, setMaxClips] = useState(bf.max_clips ?? 3);
  const [minDur, setMinDur] = useState(bf.min_duration ?? 30);
  const [maxDur, setMaxDur] = useState(bf.max_duration ?? 90);

  const ytChannels = ytStatus?.channels || [];
  const ttAccounts = ttStatus?.accounts || [];
  const patch = (fields) => onPatch(bf.id, fields);

  return (
    <Card flush>
      <div style={{
        display: "grid", alignItems: "stretch",
        gridTemplateColumns: isMobile ? "minmax(0,1fr)" : "minmax(0,1fr) 240px",
      }}>
        {/* Left: channel info, progress, per-video settings */}
        <div style={{
          padding: isMobile ? 16 : 20, minWidth: 0,
          borderRight: isMobile ? "none" : "var(--border-w-sm) solid var(--line)",
          borderBottom: isMobile ? "var(--border-w-sm) solid var(--line)" : "none",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", minWidth: 0 }}>
            <span style={{
              fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis",
              whiteSpace: "nowrap", maxWidth: isMobile ? "60vw" : "none",
            }}>
              {bf.channel_name || bf.channel_url}
            </span>
            {isCompleted && <Tag tone="success">✓ Done</Tag>}
          </div>
          <div className="t-sm" style={{ color: "var(--text-3)", marginTop: 2, marginBottom: 14, wordBreak: "break-all" }}>
            {bf.channel_url}
          </div>

          {isCompleted ? (
            <Banner tone="success">
              All {total} videos from the {bf.days_back}-day window have been clipped and posted!
            </Banner>
          ) : (
            <div style={{ display: "grid", gap: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <ProgressBar progress={progressMax > 0 ? Math.min(100, Math.round((processed / progressMax) * 100)) : 0} />
                </div>
                <span className="t-sm" style={{ color: "var(--text-3)", flexShrink: 0 }}>
                  {processed}/{progressMax}
                </span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: isMobile ? 8 : 10 }}>
                <Field label="Max clips">
                  <StepperInput value={maxClips} min={1} max={10} step={1}
                    onChange={(v) => { setMaxClips(v); patch({ max_clips: v }); }} />
                </Field>
                <Field label="Min dur">
                  <StepperInput value={minDur} min={15} max={120} step={5} suffix="s"
                    onChange={(v) => { setMinDur(v); patch({ min_duration: v }); }} />
                </Field>
                <Field label="Max dur">
                  <StepperInput value={maxDur} min={30} max={180} step={10} suffix="s"
                    onChange={(v) => { setMaxDur(v); patch({ max_duration: v }); }} />
                </Field>
              </div>

              <DigestSettings bf={bf} patch={patch} />
            </div>
          )}
        </div>

        {/* Right: pace, destinations, actions */}
        <div style={{ padding: isMobile ? 16 : 20, display: "grid", gap: 12, alignContent: "start" }}>
          <SwitchRow label="🎉 Auto-upload" hint="Post finished clips automatically"
            on={autoUpload}
            onChange={(v) => { setAutoUpload(v); patch({ auto_upload: v }); }} />

          <Field label="Look back">
            <Select value={daysBack}
              onChange={(e) => { setDaysBack(Number(e.target.value)); patch({ days_back: Number(e.target.value) }); }}>
              {DAY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </Select>
          </Field>

          <Field label="Videos / day">
            <SegmentedControl value={videosPerDay} options={VPD_OPTIONS}
              onChange={(id) => { setVideosPerDay(id); patch({ videos_per_day: id }); }} />
          </Field>

          {ytChannels.length > 0 && (
            <Field label={<span style={{ color: "var(--yt)" }}>▶ YouTube</span>}>
              {ytChannels.length === 1 ? (
                <Tag>{ytChannels[0].yt_channel_name || "YouTube"}</Tag>
              ) : (
                <Select value={ytChannelId}
                  onChange={(e) => { setYtChannelId(e.target.value); patch({ yt_upload_channel_id: e.target.value }); }}>
                  {ytChannels.map((c) => (
                    <option key={c.yt_channel_id} value={c.yt_channel_id}>
                      {c.yt_channel_name || c.yt_channel_id}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}

          {ttAccounts.length > 0 && (
            <Field label="♪ TikTok">
              <Select value={ttAccountId}
                onChange={(e) => { setTtAccountId(e.target.value); patch({ tt_open_id: e.target.value || null }); }}>
                <option value="">— off —</option>
                {ttAccounts.map((a) => (
                  <option key={a.tt_open_id} value={a.tt_open_id}>
                    {a.tt_display_name || a.tt_open_id}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          {!isCompleted && (
            <Button size="sm" variant="secondary" onClick={() => onRunNow(bf.id)}>
              ▶ Run now
            </Button>
          )}
          <Button size="sm" variant="danger" onClick={() => onRemove(bf.id)}>
            Remove
          </Button>
        </div>
      </div>
    </Card>
  );
}

export default function DigestPage() {
  const { ytStatus, ttStatus, isPro } = useApp();
  const navigate = useNavigate();
  const [backfills, setBackfills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");
  const [urlInput, setUrlInput] = useState("");

  const fetchBackfills = async () => {
    try {
      const res = await authFetch("/api/backfill");
      const data = await res.json();
      setBackfills(Array.isArray(data) ? data : []);
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => {
    fetchBackfills();
    const i = setInterval(fetchBackfills, 15000);
    return () => clearInterval(i);
  }, []);

  const handleAdd = async () => {
    if (!urlInput.trim()) return;
    setAdding(true); setAddError("");
    try {
      const res = await authFetch("/api/backfill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel_url: urlInput.trim() }),
      });
      if (!res.ok) { const d = await res.json(); setAddError(d.detail || "Failed to add channel"); }
      else { setUrlInput(""); fetchBackfills(); }
    } catch { setAddError("Cannot reach server."); }
    setAdding(false);
  };

  const handleRemove = async (id) => {
    if (!window.confirm("Remove this digest channel?")) return;
    await authFetch(`/api/backfill/${id}`, { method: "DELETE" });
    fetchBackfills();
  };

  const handleRunNow = async (id) => {
    await authFetch(`/api/backfill/${id}/run`, { method: "POST" });
    fetchBackfills();
  };

  const handlePatch = async (id, updates) => {
    await authFetch(`/api/backfill/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
  };

  if (!isPro) {
    return (
      <div style={{ maxWidth: 1000, margin: "0 auto", display: "grid", gap: 20 }}>
        <div className="page-head">
          <div className="page-head__title">Digest</div>
          <div className="page-head__sub">
            Add a channel — ClipForge works through its backlog a few videos per day.
          </div>
        </div>
        <Banner tone="info" title="Channel Digest is a Pro feature" action={<ProBadge />}>
          Backfill a channel's entire history — turn every past video into clips, fully hands-free.
        </Banner>
        <Card flush>
          <EmptyState
            icon="📼"
            title="The back-catalog is waiting"
            description="Upgrade to Pro and the forge will chew through years of uploads, a few videos a day."
            action={<Button onClick={() => navigate("/upgrade")}>⚡ Upgrade to Pro</Button>}
          />
        </Card>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", display: "grid", gap: 20 }}>
      <div className="page-head">
        <div className="page-head__title">Digest</div>
        <div className="page-head__sub">
          Add a channel — ClipForge works through its backlog a few videos per day.
        </div>
      </div>

      <Card id="tour-dg-add">
        <Field label="Add channel">
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 260px" }}>
              <TextInput value={urlInput}
                placeholder="https://youtube.com/@channel or /channel/UCxxx"
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAdd()} />
            </div>
            <Button onClick={handleAdd} disabled={adding || !urlInput.trim()}>
              {adding ? "Resolving…" : "＋ Add"}
            </Button>
          </div>
        </Field>
        {addError && (
          <div style={{ marginTop: 12 }}>
            <Banner tone="danger" title="Couldn't add the channel">
              {addError}
            </Banner>
          </div>
        )}
      </Card>

      {loading ? (
        <div className="t-sm" style={{ color: "var(--text-3)" }}>Loading…</div>
      ) : backfills.length === 0 ? (
        <Card flush>
          <EmptyState
            icon="📼"
            title="No channels digesting"
            description="Add a YouTube channel URL above and the forge starts working through its backlog."
          />
        </Card>
      ) : (
        <div style={{ display: "grid", gap: 14 }}>
          {backfills.map((bf) => (
            <DigestCard key={bf.id} bf={bf} ytStatus={ytStatus} ttStatus={ttStatus}
              onRemove={handleRemove} onRunNow={handleRunNow} onPatch={handlePatch} />
          ))}
        </div>
      )}

      <Card sub>
        <div className="t-label" style={{ marginBottom: 8 }}>How it works</div>
        <div className="t-sm" style={{ lineHeight: 1.6 }}>
          ClipForge processes a few videos per day from a channel's backlog until all are done.
          <br />
          Set <strong>Look back</strong> to control how far back in the channel's history to go.
          <br />
          <strong>Videos / day</strong> controls the daily pace. Clips are auto-uploaded if a
          YouTube channel is selected.
        </div>
      </Card>

      <Tour steps={TOUR_STEPS} storageKey="cf_tour_digest_v1" />
    </div>
  );
}

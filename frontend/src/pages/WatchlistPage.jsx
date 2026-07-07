import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { authFetch } from "../lib/supabase";
import { useMobile } from "../hooks/useMobile";
import {
  Button, Card, Tag, ProBadge, Banner, EmptyState, Field, TextInput, Select,
  StepperInput, SwitchRow, SegmentedControl, OptionGrid, CollapsibleSection, Tour,
} from "../components/kit";
import { CaptionStyleGrid, CUSTOMIZABLE_CAPTION_STYLES } from "../components/CaptionPreviews";
import FacecamBoxModal from "../components/FacecamBoxModal";
import {
  LAYOUTS, VERTICAL_ONLY_LAYOUTS, CAM_BOX_LAYOUTS, FORMATS,
  CAPTION_LANGUAGES, CAPTION_POSITIONS, HIGHLIGHT_SWATCHES, MUSIC_VOLUMES,
} from "../features/create/constants";

const CAPTION_FONT_DEFAULTS = { bold_bottom: 72, center_pop: 88, minimal: 56, simple: 56 };

const TOUR_STEPS = [
  {
    target: "#tour-wl-head",
    title: "Your auto-clip radar",
    text: "Every channel you add here is checked every 30 minutes. New uploads get clipped automatically with that channel's saved settings.",
  },
  {
    target: "#tour-wl-add",
    title: "Add a channel",
    text: "Paste a channel URL, then open Clip settings on its card to pick layout, captions, prompts, and auto-upload targets.",
  },
];

const timeAgoShort = (iso) => {
  if (!iso) return "never";
  const d = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
};

function StatusTag({ status }) {
  const s = (status || "watching").toLowerCase();
  if (s === "error")
    return (
      <span className="tag" style={{ color: "var(--danger)", borderColor: "var(--danger)", background: "var(--danger-soft)" }}>
        Error
      </span>
    );
  if (s === "watching") return <Tag tone="success">Watching</Tag>;
  return <Tag>{s}</Tag>;
}

function UpgradeGate() {
  const navigate = useNavigate();
  return (
    <Card flush>
      <EmptyState
        icon="📡"
        title={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            Channel Watchlist <ProBadge />
          </span>
        }
        description="Monitor YouTube channels and auto-clip new videos the moment they drop."
        action={<Button onClick={() => navigate("/upgrade")}>Upgrade to Pro</Button>}
      />
    </Card>
  );
}

/* Per-channel clip settings — same fields the create flow offers, PATCHed to
   /api/channels/:id as they change (backend field names are the contract). */
function ChannelSettings({ ch, patch }) {
  const isMobile = useMobile();
  const [captionStyle, setCaptionStyle] = useState(ch.caption_style ?? "bold_bottom");
  const [fontSize, setFontSize] = useState(ch.caption_font_size ?? null);
  const [highlightColor, setHighlightColor] = useState(ch.caption_highlight_color ?? null);
  const [captionLang, setCaptionLang] = useState(ch.caption_language ?? "source");
  const [bgMusicUrl, setBgMusicUrl] = useState(ch.bg_music_url ?? "");
  const [bgMusicVolume, setBgMusicVolume] = useState(ch.bg_music_volume ?? 0.15);
  const [trimSilence, setTrimSilence] = useState(ch.trim_silence ?? false);
  const [clipStyle, setClipStyle] = useState(ch.clip_style ?? "reframe");
  const chOpt = ch.options || {};
  const [removeFillers, setRemoveFillers] = useState(chOpt.remove_fillers ?? false);
  const [aspectRatio, setAspectRatio] = useState(chOpt.aspect_ratio ?? "9:16");
  const [captionPosition, setCaptionPosition] = useState(chOpt.caption_position ?? "default");
  const [captionKeywords, setCaptionKeywords] = useState(chOpt.caption_keywords !== false);
  const [captionEmoji, setCaptionEmoji] = useState(chOpt.caption_emoji !== false);
  const [findPrompt, setFindPrompt] = useState(chOpt.style_prompt ?? "");
  const [excludePrompt, setExcludePrompt] = useState(chOpt.exclude_prompt ?? "");
  const [facecamBox, setFacecamBox] = useState(chOpt.facecam_box ?? null);
  const [camModalOpen, setCamModalOpen] = useState(false);

  const effectiveFontSize = fontSize ?? CAPTION_FONT_DEFAULTS[captionStyle] ?? 72;
  const captionCustomizable = CUSTOMIZABLE_CAPTION_STYLES.includes(captionStyle);
  const verticalOnly = VERTICAL_ONLY_LAYOUTS.includes(clipStyle);

  const handleCaptionStyle = (id) => {
    setCaptionStyle(id);
    const fields = { caption_style: id };
    if (!CUSTOMIZABLE_CAPTION_STYLES.includes(id)) {
      setFontSize(null); setHighlightColor(null);
      fields.caption_font_size = null; fields.caption_highlight_color = null;
    }
    patch(fields);
  };

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <Field label="Caption style">
        <CaptionStyleGrid value={captionStyle} onChange={handleCaptionStyle} highlightColor={highlightColor} isMobile={isMobile} />
      </Field>

      <div style={{ display: "grid", gap: 8 }}>
        <SwitchRow label="AI keywords" hint="Color the words that carry the clip" on={captionKeywords}
          onChange={(v) => { setCaptionKeywords(v); patch({ caption_keywords: v }); }} />
        <SwitchRow label="AI emoji" hint="Drop a fitting emoji on big moments" on={captionEmoji}
          onChange={(v) => { setCaptionEmoji(v); patch({ caption_emoji: v }); }} />
      </div>

      <Field label="Caption position">
        <SegmentedControl value={captionPosition} options={CAPTION_POSITIONS}
          onChange={(id) => { setCaptionPosition(id); patch({ caption_position: id === "default" ? null : id }); }} />
      </Field>

      <Field label="Language">
        <Select value={captionLang} onChange={(e) => { setCaptionLang(e.target.value); patch({ caption_language: e.target.value }); }}>
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
                <StepperInput value={effectiveFontSize} min={40} max={120} step={4}
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
                      fontFamily: "var(--font-ui)", fontSize: "var(--fs-tag)", fontWeight: 700,
                      textTransform: "var(--tt-label)",
                      border: active ? "2px solid var(--text-1)" : "2px solid var(--line)",
                      borderRadius: "var(--radius-sm)",
                      boxShadow: active ? "var(--shadow-btn)" : "none", cursor: "pointer",
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
        <TextInput value={bgMusicUrl} onChange={(e) => setBgMusicUrl(e.target.value)}
          onBlur={() => patch({ bg_music_url: bgMusicUrl.trim() || null })}
          placeholder="paste a YouTube music URL" />
      </Field>
      {bgMusicUrl.trim() && (
        <Field label="Music volume">
          <SegmentedControl value={bgMusicVolume} options={MUSIC_VOLUMES}
            onChange={(id) => { setBgMusicVolume(id); patch({ bg_music_volume: id }); }} />
        </Field>
      )}

      <Field label="Layout" hint="How each new video is framed when it's clipped.">
        <OptionGrid value={clipStyle}
          onChange={(id) => { setClipStyle(id); patch({ clip_style: id }); }}
          options={LAYOUTS.map((l) => ({ id: l.id, label: l.label, description: l.hint }))} />
      </Field>

      {CAM_BOX_LAYOUTS.includes(clipStyle) && (
        <Button variant="secondary" onClick={() => setCamModalOpen(true)}>
          {facecamBox ? "✓ Cam box set — adjust" : "▦ Mark the facecam (optional)"}
        </Button>
      )}
      {camModalOpen && (
        <FacecamBoxModal
          videoId={ch.last_video_id || null}
          value={facecamBox ? { x: facecamBox[0], y: facecamBox[1], w: facecamBox[2], h: facecamBox[3] } : null}
          onSave={(b) => { setFacecamBox(b); patch({ facecam_box: b }); }}
          onClose={() => setCamModalOpen(false)}
        />
      )}

      <Field label="Format" hint={verticalOnly ? "This layout renders vertical-only (9:16)." : undefined}>
        <SegmentedControl value={aspectRatio}
          onChange={(id) => { setAspectRatio(id); patch({ aspect_ratio: id }); }}
          options={FORMATS.map((f) => ({ id: f.id, label: f.label, disabled: verticalOnly && f.id !== "9:16" }))} />
      </Field>

      <Field label="Find" hint="Optional — what should the AI clip?">
        <TextInput value={findPrompt} onChange={(e) => setFindPrompt(e.target.value)}
          onBlur={() => patch({ style_prompt: findPrompt.trim() || null })}
          placeholder="e.g. every moment about pricing" />
      </Field>
      <Field label="Exclude" hint="Topics to never clip">
        <TextInput value={excludePrompt} onChange={(e) => setExcludePrompt(e.target.value)}
          onBlur={() => patch({ exclude_prompt: excludePrompt.trim() || null })}
          placeholder="e.g. intros, sponsor reads" />
      </Field>

      <div style={{ display: "grid", gap: 8 }}>
        <SwitchRow label="✂ Trim silence" hint="Cut dead air inside each clip" on={trimSilence}
          onChange={(v) => { setTrimSilence(v); patch({ trim_silence: v }); }} />
        <SwitchRow label="⌫ Cut fillers (um/uh)" hint="Remove filler words from the cut" on={removeFillers}
          onChange={(v) => { setRemoveFillers(v); patch({ remove_fillers: v }); }} />
      </div>
    </div>
  );
}

function ChannelRow({ ch, onRemove, onToggleAutoUpload, onCheckNow, checking, onSetUploadChannel, onSetTtAccount }) {
  const { ytStatus, ttStatus } = useApp();
  const [maxClips, setMaxClips] = useState(ch.max_clips ?? 3);
  const [minDur, setMinDur] = useState(ch.min_duration ?? 30);
  const [maxDur, setMaxDur] = useState(ch.max_duration ?? 90);
  const [selectedYtChannel, setSelectedYtChannel] = useState(ch.yt_channel_id ?? "");
  const [selectedTtAccount, setSelectedTtAccount] = useState(ch.tt_open_id ?? "");

  const patch = async (fields) => {
    await authFetch(`/api/channels/${ch.channel_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
  };

  const ellipsis = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

  return (
    <Card flush>
      <div style={{ padding: "16px 20px", display: "grid", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", minWidth: 0 }}>
          <span style={{ fontWeight: 700, maxWidth: "100%", ...ellipsis }}>{ch.name}</span>
          <StatusTag status={ch.status} />
        </div>
        <div className="t-sm" style={{ color: "var(--text-3)", wordBreak: "break-all" }}>{ch.url}</div>
        <div className="t-sm" style={{ display: "flex", gap: 16, flexWrap: "wrap", color: "var(--text-2)" }}>
          <span>Checked {timeAgoShort(ch.last_checked)}</span>
          {ch.last_video_title && (
            <span style={{ minWidth: 0, maxWidth: 360, ...ellipsis }}>Last video: {ch.last_video_title}</span>
          )}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
          <Field label="Max clips">
            <StepperInput value={maxClips} min={1} max={10}
              onChange={(v) => { setMaxClips(v); patch({ max_clips: v }); }} />
          </Field>
          <Field label="Min duration">
            <StepperInput value={minDur} min={15} max={120} step={5} suffix="s"
              onChange={(v) => { setMinDur(v); patch({ min_duration: v }); }} />
          </Field>
          <Field label="Max duration">
            <StepperInput value={maxDur} min={30} max={180} step={10} suffix="s"
              onChange={(v) => { setMaxDur(v); patch({ max_duration: v }); }} />
          </Field>
        </div>
      </div>

      <div style={{ borderTop: "1px solid var(--line)", padding: "6px 20px" }}>
        <CollapsibleSection title="Clip settings" hint="Captions, layout, prompts, enhancements">
          <ChannelSettings ch={ch} patch={patch} />
        </CollapsibleSection>
      </div>

      <div style={{ borderTop: "1px solid var(--line)", padding: "14px 20px", display: "grid", gap: 12 }}>
        <SwitchRow
          label="🎉 Auto-upload"
          hint={ch.auto_upload ? "New clips upload automatically" : "Clips wait in Archive so you can review first"}
          on={!!ch.auto_upload}
          onChange={() => onToggleAutoUpload(ch)}
        />
        {ch.auto_upload && ytStatus?.connected && (ytStatus.channels || []).length > 0 && (
          <Field label="▶ YouTube channel">
            <div style={{ display: "flex", gap: 8 }}>
              <Select value={selectedYtChannel} onChange={(e) => setSelectedYtChannel(e.target.value)}
                style={{ flex: 1, minWidth: 0 }}>
                {ytStatus.channels.map((c) => (
                  <option key={c.yt_channel_id} value={c.yt_channel_id}>{c.yt_channel_name || c.yt_channel_id}</option>
                ))}
              </Select>
              <Button size="sm" variant="yt" onClick={() => onSetUploadChannel(ch, selectedYtChannel)}>Save</Button>
            </div>
          </Field>
        )}
        {ch.auto_upload && ttStatus?.connected && (ttStatus.accounts || []).length > 0 && (
          <Field label="♪ TikTok account">
            <div style={{ display: "flex", gap: 8 }}>
              <Select value={selectedTtAccount} onChange={(e) => setSelectedTtAccount(e.target.value)}
                style={{ flex: 1, minWidth: 0 }}>
                <option value="">— off —</option>
                {ttStatus.accounts.map((a) => (
                  <option key={a.tt_open_id} value={a.tt_open_id}>{a.tt_display_name || a.tt_open_id}</option>
                ))}
              </Select>
              <Button size="sm" variant="tt" onClick={() => onSetTtAccount(ch, selectedTtAccount)}>Save</Button>
            </div>
          </Field>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button size="sm" variant="secondary" disabled={checking} onClick={() => onCheckNow(ch.channel_id)}>
            {checking ? "Checking…" : "⟳ Check now"}
          </Button>
          <Button size="sm" variant="danger" onClick={() => onRemove(ch.channel_id)}>Remove</Button>
        </div>
      </div>
    </Card>
  );
}

function WatchlistContent() {
  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [urlInput, setUrlInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");
  const [checkingId, setCheckingId] = useState(null);
  const { ytStatus } = useApp();

  const fetchChannels = async () => {
    try {
      const res = await authFetch("/api/channels");
      const data = await res.json();
      setChannels(data);
    } catch {} finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchChannels();
    const i = setInterval(fetchChannels, 15000);
    return () => clearInterval(i);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAdd = async () => {
    if (!urlInput.trim()) return;
    setAdding(true);
    setAddError("");
    try {
      const res = await authFetch("/api/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: urlInput.trim(), auto_upload: false, max_clips: 3, min_duration: 30, max_duration: 90 }),
      });
      if (!res.ok) {
        const d = await res.json();
        setAddError(d.detail || "Failed to add channel");
      } else {
        setUrlInput("");
        fetchChannels();
      }
    } catch {
      setAddError("Cannot reach server.");
    }
    setAdding(false);
  };

  const handleRemove = async (id) => {
    await authFetch(`/api/channels/${id}`, { method: "DELETE" });
    fetchChannels();
  };

  const handleToggleAutoUpload = async (ch) => {
    const turningOn = !ch.auto_upload;
    const ytChannels = ytStatus?.channels || [];
    const patch = { auto_upload: turningOn };
    // Auto-select the only connected channel so user doesn't need a separate save step
    if (turningOn && ytChannels.length === 1) {
      patch.yt_channel_id = ytChannels[0].yt_channel_id;
    }
    await authFetch(`/api/channels/${ch.channel_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    fetchChannels();
  };

  const handleSetUploadChannel = async (ch, yt_channel_id) => {
    await authFetch(`/api/channels/${ch.channel_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ yt_channel_id }),
    });
    fetchChannels();
  };

  const handleSetTtAccount = async (ch, tt_open_id) => {
    await authFetch(`/api/channels/${ch.channel_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tt_open_id: tt_open_id || null }),
    });
    fetchChannels();
  };

  const handleCheckNow = async (id) => {
    setCheckingId(id);
    await authFetch(`/api/channels/${id}/check`, { method: "POST" });
    await fetchChannels();
    setCheckingId(null);
  };

  return (
    <>
      <Card id="tour-wl-add">
        <Field label="Add channel">
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <TextInput
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              placeholder="https://youtube.com/@channel or /channel/UCxxx"
              style={{ flex: "1 1 280px" }}
            />
            <Button disabled={adding || !urlInput.trim()} onClick={handleAdd}>
              {adding ? "Resolving…" : "＋ Add channel"}
            </Button>
          </div>
        </Field>
        {addError && (
          <div style={{ marginTop: 12 }}>
            <Banner tone="danger" title="Couldn't add channel">{addError}</Banner>
          </div>
        )}
      </Card>

      {loading ? (
        <Card>
          <div className="t-sm" style={{ textAlign: "center", color: "var(--text-3)" }}>Loading…</div>
        </Card>
      ) : channels.length === 0 ? (
        <Card flush>
          <EmptyState
            icon="🛰️"
            title="No channels on the radar"
            description="Add a YouTube channel URL above — new uploads get clipped automatically."
          />
        </Card>
      ) : (
        <div style={{ display: "grid", gap: 14 }}>
          {channels.map((ch) => (
            <ChannelRow
              key={ch.channel_id}
              ch={ch}
              onRemove={handleRemove}
              onToggleAutoUpload={handleToggleAutoUpload}
              onCheckNow={handleCheckNow}
              checking={checkingId === ch.channel_id}
              onSetUploadChannel={handleSetUploadChannel}
              onSetTtAccount={handleSetTtAccount}
            />
          ))}
        </div>
      )}

      <Banner tone="info" title="How it works">
        Every 30 minutes ClipForge checks each channel for new videos.
        <br />
        <strong>Auto-upload on</strong> clips + uploads to YouTube automatically.
        <br />
        <strong>Auto-upload off</strong> clips only — find them in Archive to review first.
      </Banner>

      <Tour steps={TOUR_STEPS} storageKey="cf_tour_watchlist_v1" />
    </>
  );
}

export default function WatchlistPage() {
  const { isPro } = useApp();
  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", display: "grid", gap: 20 }}>
      <div className="page-head" id="tour-wl-head">
        <div className="page-head__title">Watchlist</div>
        <div className="page-head__sub">
          Add channels — ClipForge checks every 30 min and clips new videos automatically.
        </div>
      </div>
      {isPro ? <WatchlistContent /> : <UpgradeGate />}
    </div>
  );
}

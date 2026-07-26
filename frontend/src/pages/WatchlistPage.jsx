import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { authFetch } from "../lib/supabase";
import {
  Button, Card, Tag, ProBadge, Banner, EmptyState, Field, TextInput, Select,
  SwitchRow, CollapsibleSection, Tour,
} from "../components/kit";
import {
  useChannelSettingsForm,
  ChannelSettingsChips,
  PromptsAndMusic,
} from "../features/create/ChannelClipSettings";

const TOUR_STEPS = [
  {
    target: "#tour-wl-head",
    title: "Your auto-clip radar",
    text: "Every channel you add here is checked every 30 minutes. New uploads get clipped automatically with that channel's saved settings.",
  },
  {
    target: "#tour-wl-add",
    title: "Add a channel",
    text: "Paste a channel URL, then use the settings chips on its card to pick layout, captions, enhancements, and auto-upload targets.",
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


function ChannelRow({ ch, onRemove, onToggleAutoUpload, onCheckNow, checking, onSetUploadChannel, onSetTtAccount, onSetIgAccount }) {
  const { ytStatus, ttStatus, igStatus } = useApp();
  const [selectedYtChannel, setSelectedYtChannel] = useState(ch.yt_channel_id ?? "");
  const [selectedTtAccount, setSelectedTtAccount] = useState(ch.tt_open_id ?? "");
  const [selectedIgAccount, setSelectedIgAccount] = useState(ch.ig_user_id ?? "");

  const patch = async (fields) => {
    await authFetch(`/api/channels/${ch.channel_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
  };

  // Same chip-strip + modals as the create page, PATCHing this channel.
  const settings = useChannelSettingsForm(ch, patch);

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
        <ChannelSettingsChips settings={settings} videoId={ch.last_video_id} minDurMax={120} />
      </div>

      <div style={{ borderTop: "1px solid var(--line)", padding: "6px 20px" }}>
        <CollapsibleSection title="AI direction & music" hint="Find/exclude prompts, background music">
          <PromptsAndMusic source={ch} patch={patch} />
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
        {ch.auto_upload && igStatus?.connected && (igStatus.accounts || []).length > 0 && (
          <Field label="◉ Instagram account">
            <div style={{ display: "flex", gap: 8 }}>
              <Select value={selectedIgAccount} onChange={(e) => setSelectedIgAccount(e.target.value)}
                style={{ flex: 1, minWidth: 0 }}>
                <option value="">— off —</option>
                {igStatus.accounts.map((a) => (
                  <option key={a.ig_user_id} value={a.ig_user_id}>{a.ig_username ? `@${a.ig_username}` : a.ig_user_id}</option>
                ))}
              </Select>
              <Button size="sm" variant="ig" onClick={() => onSetIgAccount(ch, selectedIgAccount)}>Save</Button>
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

  const handleSetIgAccount = async (ch, ig_user_id) => {
    await authFetch(`/api/channels/${ch.channel_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ig_user_id: ig_user_id || null }),
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
              onSetIgAccount={handleSetIgAccount}
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

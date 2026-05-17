import { useState, useEffect } from "react";
import { C, BORDER, BORDER_SM, SHADOW, SHADOW_SM, KEYFRAMES } from "../lib/theme";
import { PixelBtn, PixelCard, Tag } from "../components/ui";
import Header from "../components/Header";
import { useApp } from "../context/AppContext";
import { authFetch } from "../lib/supabase";
import { useMobile } from "../hooks/useMobile";

function UpgradeGate() {
  return (
    <div className="fade" style={{ padding: "64px 32px", maxWidth: 760, margin: "0 auto" }}>
      <PixelCard color={C.amber} padding={40} style={{ textAlign: "center" }}>
        <div className="pixel" style={{ fontSize: 9, color: C.ink, marginBottom: 12 }}>PRO FEATURE</div>
        <h2 className="pixel" style={{ fontSize: 22, color: C.ink, lineHeight: 1.4, marginBottom: 14 }}>Channel Watchlist</h2>
        <p className="vt" style={{ fontSize: 20, color: C.ink, lineHeight: 1.5, marginBottom: 24, maxWidth: 520, margin: "0 auto 24px" }}>
          Monitor YouTube channels and auto-clip new videos the moment they drop.
        </p>
        <div className="pixel" style={{ fontSize: 9, color: C.dim2, marginTop: 8 }}>
          Upgrade to Pro to unlock this feature.
        </div>
      </PixelCard>
    </div>
  );
}

function ChannelCard({ ch, onRemove, onToggleAutoUpload, onCheckNow, checking }) {
  const [maxClips, setMaxClips] = useState(ch.max_clips ?? 3);
  const [minDur,   setMinDur]   = useState(ch.min_duration ?? 30);
  const [maxDur,   setMaxDur]   = useState(ch.max_duration ?? 90);
  const isMobile = useMobile();

  const patch = async (fields) => {
    await authFetch(`/api/channels/${ch.channel_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
  };

  const adj = (val, setVal, min, max, delta, field) => {
    const next = Math.min(max, Math.max(min, val + delta));
    setVal(next);
    patch({ [field]: next });
  };

  const statusColor = (s) => s === "error" ? C.hot : s === "watching" ? C.signal : C.amber;
  const timeAgoShort = (iso) => {
    if (!iso) return "never";
    const d = Math.floor((Date.now() - new Date(iso)) / 1000);
    if (d < 60) return `${d}s ago`;
    if (d < 3600) return `${Math.floor(d / 60)}m ago`;
    if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
    return `${Math.floor(d / 86400)}d ago`;
  };

  const Stepper = ({ label, val, setVal, min, max, step, field, suffix = "" }) => (
    <div>
      <div className="pixel" style={{ fontSize: 7, color: C.dim2, marginBottom: 5 }}>{label}</div>
      <div style={{ display: "flex", border: BORDER_SM, boxShadow: `2px 2px 0 ${C.ink}`, background: C.paper }}>
        <button onClick={() => adj(val, setVal, min, max, -step, field)} className="pixel"
          style={{ width: 26, padding: "6px 0", background: "transparent", borderRight: `2px solid ${C.ink}`, fontSize: 12, cursor: val > min ? "pointer" : "not-allowed", color: val > min ? C.ink : C.dim }}>-</button>
        <div className="pixel" style={{ flex: 1, textAlign: "center", padding: "6px 4px", fontSize: 10, color: C.ink, minWidth: 36 }}>{val}{suffix}</div>
        <button onClick={() => adj(val, setVal, min, max, +step, field)} className="pixel"
          style={{ width: 26, padding: "6px 0", background: "transparent", borderLeft: `2px solid ${C.ink}`, fontSize: 12, cursor: val < max ? "pointer" : "not-allowed", color: val < max ? C.ink : C.dim }}>+</button>
      </div>
    </div>
  );

  return (
    <PixelCard color={C.cream} padding={0}>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0,1fr) auto", alignItems: "stretch" }}>
        <div style={{ padding: isMobile ? "16px" : "20px 22px", borderRight: isMobile ? "none" : BORDER, borderBottom: isMobile ? BORDER : "none" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
            <span className="pixel" style={{ fontSize: 12, color: C.ink }}>{ch.name}</span>
            <Tag bg={statusColor(ch.status || "watching")} color={C.ink}>{(ch.status || "WATCHING").toUpperCase()}</Tag>
          </div>
          <div className="mono" style={{ fontSize: 12, color: C.dim2, marginBottom: 10, wordBreak: "break-all" }}>{ch.url}</div>
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginBottom: 16 }}>
            <div>
              <span className="pixel" style={{ fontSize: 7, color: C.dim2 }}>LAST CHECKED </span>
              <span className="vt" style={{ fontSize: 16, color: C.ink }}>{timeAgoShort(ch.last_checked)}</span>
            </div>
            {ch.last_video_title && (
              <div style={{ minWidth: 0 }}>
                <span className="pixel" style={{ fontSize: 7, color: C.dim2 }}>LAST VIDEO </span>
                <span className="vt" style={{ fontSize: 16, color: C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "inline-block", maxWidth: isMobile ? "100%" : 340 }}>{ch.last_video_title}</span>
              </div>
            )}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
            <Stepper label="MAX CLIPS" val={maxClips} setVal={setMaxClips} min={1} max={10} step={1} field="max_clips" />
            <Stepper label="MIN DUR"   val={minDur}   setVal={setMinDur}   min={15} max={120} step={5}  field="min_duration" suffix="s" />
            <Stepper label="MAX DUR"   val={maxDur}   setVal={setMaxDur}   min={30} max={180} step={10} field="max_duration" suffix="s" />
          </div>
        </div>

        <div style={{ padding: isMobile ? "12px 16px" : "20px 18px", display: "flex", flexDirection: "column", gap: 8, justifyContent: "center", minWidth: isMobile ? "auto" : 170 }}>
          <button onClick={() => onToggleAutoUpload(ch)} className="pixel" style={{
            padding: "10px 12px", fontSize: 8, textAlign: "center",
            background: ch.auto_upload ? C.signal : C.cream2,
            color: C.ink, border: BORDER,
            boxShadow: ch.auto_upload ? `2px 2px 0 ${C.ink}` : SHADOW_SM,
            transform: ch.auto_upload ? "translate(2px,2px)" : "none",
            cursor: "pointer", transition: "all .1s",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          }}>
            <span style={{ fontSize: 14, fontFamily: "sans-serif" }}>🎉</span>
            {ch.auto_upload ? "AUTO-UPLOAD ON" : "AUTO-UPLOAD OFF"}
          </button>
          <PixelBtn color="amber" size="sm" onClick={() => onCheckNow(ch.channel_id)} disabled={checking}>
            {checking ? "CHECKING..." : "CHECK NOW"}
          </PixelBtn>
          <PixelBtn color="danger" size="sm" onClick={() => onRemove(ch.channel_id)}>REMOVE</PixelBtn>
        </div>
      </div>
    </PixelCard>
  );
}

function WatchlistContent() {
  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [urlInput, setUrlInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");
  const [checkingId, setCheckingId] = useState(null);
  const isMobile = useMobile();

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
  }, []);

  const handleAdd = async () => {
    if (!urlInput.trim()) return;
    setAdding(true); setAddError("");
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
    } catch { setAddError("Cannot reach server."); }
    setAdding(false);
  };

  const handleRemove = async (id) => {
    await authFetch(`/api/channels/${id}`, { method: "DELETE" });
    fetchChannels();
  };

  const handleToggleAutoUpload = async (ch) => {
    await authFetch(`/api/channels/${ch.channel_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ auto_upload: !ch.auto_upload }),
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
    <div className="fade" style={{ padding: isMobile ? "16px 12px 48px" : "32px 32px 64px", maxWidth: 1320, margin: "0 auto" }}>
      <div style={{ marginBottom: 24 }}>
        <div className="pixel" style={{ fontSize: 10, color: C.dim2, marginBottom: 10 }}>WATCHLIST</div>
        <h1 className="pixel" style={{ fontSize: 26, color: C.ink }}>Channel monitor.</h1>
        <p className="vt" style={{ fontSize: 18, color: C.dim2, marginTop: 6 }}>
          Add channels — ClipForge checks every 30 min and clips new videos automatically.
        </p>
      </div>

      <PixelCard color={C.cream} padding={22} style={{ marginBottom: 24 }}>
        <div className="pixel" style={{ fontSize: 9, color: C.dim2, marginBottom: 12 }}>ADD CHANNEL</div>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: isMobile ? 0 : 260, display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", background: C.paper, border: BORDER, boxShadow: SHADOW_SM }}>
            <span className="pixel" style={{ fontSize: 12, color: C.dim }}>{`>`}</span>
            <input value={urlInput} onChange={e => setUrlInput(e.target.value)} onKeyDown={e => e.key === "Enter" && handleAdd()}
              placeholder="https://youtube.com/@channel or /channel/UCxxx"
              className="mono" style={{ flex: 1, background: "transparent", color: C.ink, fontSize: 13, fontWeight: 500, minWidth: 0 }} />
          </div>
          <PixelBtn color="hot" onClick={handleAdd} disabled={adding || !urlInput.trim()}>
            {adding ? "RESOLVING..." : "+ ADD"}
          </PixelBtn>
        </div>
        {addError && (
          <div className="pixel" style={{ fontSize: 9, color: C.hotDeep, marginTop: 10, padding: "8px 10px", background: `${C.hot}44`, border: `2px solid ${C.hotDeep}` }}>
            ! {addError}
          </div>
        )}
      </PixelCard>

      {loading ? (
        <PixelCard color={C.paper} padding={48} style={{ textAlign: "center" }}>
          <p className="vt" style={{ fontSize: 20, color: C.dim2 }}>Loading...</p>
        </PixelCard>
      ) : channels.length === 0 ? (
        <PixelCard color={C.paper} padding={48} style={{ textAlign: "center" }}>
          <div className="pixel" style={{ fontSize: 11, color: C.dim2, marginBottom: 10 }}>NO CHANNELS</div>
          <p className="vt" style={{ fontSize: 20, color: C.dim2 }}>Add a YouTube channel URL above to start monitoring.</p>
        </PixelCard>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {channels.map(ch => (
            <ChannelCard key={ch.channel_id} ch={ch}
              onRemove={handleRemove}
              onToggleAutoUpload={handleToggleAutoUpload}
              onCheckNow={handleCheckNow}
              checking={checkingId === ch.channel_id}
            />
          ))}
        </div>
      )}

      <PixelCard color={C.lavender} padding={18} style={{ marginTop: 24 }}>
        <div className="pixel" style={{ fontSize: 9, color: C.ink, marginBottom: 8 }}>HOW IT WORKS</div>
        <div className="vt" style={{ fontSize: 17, color: C.ink, lineHeight: 1.5 }}>
          Every 30 minutes ClipForge checks each channel for new videos.<br />
          <strong>AUTO-UPLOAD ON</strong> clips + uploads to YouTube automatically.<br />
          <strong>AUTO-UPLOAD OFF</strong> clips only, find them in ARCHIVE to review first.
        </div>
      </PixelCard>
    </div>
  );
}

export default function WatchlistPage() {
  const { isPro } = useApp();
  return (
    <div style={{ minHeight: "100vh" }}>
      <style>{KEYFRAMES}</style>
      <Header />
      {isPro ? <WatchlistContent /> : <UpgradeGate />}
    </div>
  );
}

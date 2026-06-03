import { useState, useEffect } from "react";
import { C, BORDER, SHADOW_SM, KEYFRAMES, timeAgo } from "../lib/theme";
import { PixelBtn, PixelCard } from "../components/ui";
import Header from "../components/Header";
import { authFetch } from "../lib/supabase";
import { useApp } from "../context/AppContext";
import { useMobile } from "../hooks/useMobile";

const DAY_OPTIONS = [
  { value: 30,  label: "30 days back" },
  { value: 60,  label: "60 days back" },
  { value: 90,  label: "90 days back" },
  { value: 180, label: "6 months back" },
  { value: 365, label: "1 year back" },
];

const VPD_OPTIONS = [
  { value: 1, color: C.signal },
  { value: 2, color: C.amber },
  { value: 3, color: C.peach },
  { value: 5, color: C.hot },
];

function ProgressBar({ value, max }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ flex: 1, height: 10, background: C.cream2, border: BORDER, position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${pct}%`, background: C.signal, transition: "width .4s" }} />
      </div>
      <span className="pixel" style={{ fontSize: 8, color: C.dim2, flexShrink: 0 }}>{value}/{max}</span>
    </div>
  );
}

function DigestCard({ bf, ytStatus, onRemove, onRunNow, isMobile }) {
  const isCompleted = bf.status === "completed";
  const processed = (bf.processed_video_ids || []).length;
  const total = bf.total_videos || 0;
  const ytChannel = (ytStatus?.channels || []).find(c => c.yt_channel_id === bf.yt_upload_channel_id);

  return (
    <PixelCard color={isCompleted ? C.signal : C.cream} padding={0} style={{ overflow: "hidden" }}>
      {/* Main info */}
      <div style={{ padding: isMobile ? "14px 14px 10px" : "18px 20px 14px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
          <span className="pixel" style={{ fontSize: isMobile ? 9 : 11, color: C.ink, wordBreak: "break-word", flex: 1 }}>
            * {bf.channel_name || bf.channel_url}
          </span>
          {isCompleted && (
            <span className="pixel" style={{ fontSize: 7, background: C.signalDeep, color: C.cream, padding: "3px 7px", border: BORDER, flexShrink: 0 }}>
              DONE
            </span>
          )}
        </div>

        <div className="mono" style={{ fontSize: 10, color: C.dim2, marginBottom: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {bf.channel_url}
        </div>

        <div className="pixel" style={{ fontSize: 7, color: C.dim, marginBottom: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <span>{DAY_OPTIONS.find(d => d.value === bf.days_back)?.label || `${bf.days_back}d back`}</span>
          <span>• {bf.videos_per_day}/day</span>
          {ytChannel && <span>→ {ytChannel.yt_channel_name}</span>}
          {bf.last_run_at && <span>• ran {timeAgo(bf.last_run_at)}</span>}
        </div>

        {isCompleted ? (
          <div className="vt" style={{ fontSize: isMobile ? 14 : 16, color: C.signalDeep }}>
            All {total} videos clipped and posted!
          </div>
        ) : (
          <ProgressBar value={processed} max={total || processed + 1} />
        )}
      </div>

      {/* Actions — always a bottom row on mobile, right column on desktop */}
      <div style={{
        display: "flex", gap: 8, padding: isMobile ? "10px 14px" : "10px 16px",
        borderTop: `2px solid ${C.ink}22`, justifyContent: "flex-end",
      }}>
        {!isCompleted && (
          <PixelBtn color="amber" size="sm" onClick={() => onRunNow(bf.id)}>RUN NOW</PixelBtn>
        )}
        <PixelBtn color="hot" size="sm" onClick={() => onRemove(bf.id)}>REMOVE</PixelBtn>
      </div>
    </PixelCard>
  );
}

export default function DigestPage() {
  const { ytStatus, isPro } = useApp();
  const isMobile = useMobile();
  const [backfills, setBackfills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");

  const [urlInput, setUrlInput] = useState("");
  const [daysBack, setDaysBack] = useState(30);
  const [videosPerDay, setVideosPerDay] = useState(2);
  const [ytChannelId, setYtChannelId] = useState(ytStatus?.channels?.[0]?.yt_channel_id || "");

  const ytChannels = ytStatus?.channels || [];

  useEffect(() => {
    if (ytChannels.length > 0 && !ytChannelId) {
      setYtChannelId(ytChannels[0].yt_channel_id);
    }
  }, [ytStatus]);

  const fetchBackfills = async () => {
    try {
      const res = await authFetch("/api/backfill");
      const data = await res.json();
      setBackfills(Array.isArray(data) ? data : []);
    } catch {} finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBackfills();
    const i = setInterval(fetchBackfills, 15000);
    return () => clearInterval(i);
  }, []);

  const handleAdd = async () => {
    if (!urlInput.trim()) return;
    setAdding(true);
    setAddError("");
    try {
      const res = await authFetch("/api/backfill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel_url: urlInput.trim(),
          days_back: daysBack,
          videos_per_day: videosPerDay,
          yt_upload_channel_id: ytChannelId,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        setAddError(d.detail || "Failed to add channel");
      } else {
        setUrlInput("");
        fetchBackfills();
      }
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

  if (!isPro) {
    return (
      <div style={{ minHeight: "100vh" }}>
        <style>{KEYFRAMES}</style>
        <Header />
        <div className="fade" style={{ padding: isMobile ? "16px 12px" : "64px 32px", maxWidth: 1320, margin: "0 auto", textAlign: "center" }}>
          <div className="pixel" style={{ fontSize: 11, color: C.dim2, marginBottom: 16 }}>PRO ONLY</div>
          <p className="vt" style={{ fontSize: 20, color: C.dim2 }}>Upgrade to Pro to use Channel Digest.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh" }}>
      <style>{KEYFRAMES}</style>
      <Header />
      <div className="fade" style={{ padding: isMobile ? "16px 12px 48px" : "32px 32px 64px", maxWidth: 1320, margin: "0 auto" }}>

        <div style={{ marginBottom: 20 }}>
          <div className="pixel" style={{ fontSize: 10, color: C.dim2, marginBottom: 8 }}>DIGEST</div>
          <h1 className="pixel" style={{ fontSize: isMobile ? 20 : 26, color: C.ink }}>Channel digest.</h1>
          {!isMobile && (
            <p className="vt" style={{ fontSize: 18, color: C.dim2, marginTop: 6 }}>
              Pick a channel and a time window — ClipForge clips and posts a few videos per day until the backlog is done.
            </p>
          )}
        </div>

        {/* Add form */}
        <PixelCard color={C.cream} padding={isMobile ? 14 : 22} style={{ marginBottom: 20 }}>
          <div className="pixel" style={{ fontSize: 9, color: C.dim2, marginBottom: 12 }}>ADD DIGEST CHANNEL</div>

          {/* URL input */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: isMobile ? "10px 12px" : "12px 14px", background: C.paper, border: BORDER, boxShadow: SHADOW_SM, marginBottom: 14 }}>
            <span className="pixel" style={{ fontSize: 10, color: C.dim, flexShrink: 0 }}>{`>`}</span>
            <input
              value={urlInput}
              onChange={e => setUrlInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleAdd()}
              placeholder={isMobile ? "youtube.com/@channel" : "https://youtube.com/@channel or /channel/UCxxx"}
              className="mono"
              style={{ flex: 1, background: "transparent", color: C.ink, fontSize: isMobile ? 12 : 13, fontWeight: 500, minWidth: 0, width: "100%" }}
            />
          </div>

          {/* Controls — stack vertically on mobile */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 14 }}>

            {/* Look back + Videos per day — side by side even on mobile */}
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              <div style={{ flex: isMobile ? "1 1 140px" : "0 0 auto" }}>
                <div className="pixel" style={{ fontSize: 7, color: C.dim2, marginBottom: 8 }}>LOOK BACK</div>
                <select value={daysBack} onChange={e => setDaysBack(Number(e.target.value))} className="pixel"
                  style={{ width: "100%", padding: "9px 10px", background: C.paper, color: C.ink, border: BORDER, fontSize: 8 }}>
                  {DAY_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div style={{ flex: isMobile ? "1 1 140px" : "0 0 auto" }}>
                <div className="pixel" style={{ fontSize: 7, color: C.dim2, marginBottom: 8 }}>VIDEOS / DAY</div>
                <div style={{ display: "flex", gap: 5 }}>
                  {VPD_OPTIONS.map(opt => (
                    <button key={opt.value} onClick={() => setVideosPerDay(opt.value)} className="pixel" style={{
                      flex: isMobile ? 1 : "0 0 auto",
                      padding: "8px 10px", fontSize: 8,
                      background: videosPerDay === opt.value ? opt.color : C.cream2,
                      color: C.ink, border: BORDER,
                      boxShadow: videosPerDay === opt.value ? "2px 2px 0 " + C.ink : SHADOW_SM,
                      transform: videosPerDay === opt.value ? "translate(2px,2px)" : "none",
                      cursor: "pointer",
                    }}>{opt.value}</button>
                  ))}
                </div>
              </div>
            </div>

            {/* YT channel selector */}
            {ytChannels.length > 0 && (
              <div>
                <div className="pixel" style={{ fontSize: 7, color: C.dim2, marginBottom: 8 }}>UPLOAD TO</div>
                {ytChannels.length === 1 ? (
                  <div className="pixel" style={{ fontSize: 9, padding: "9px 12px", background: C.yt, border: BORDER, color: C.ink, display: "inline-block" }}>
                    * {ytChannels[0].yt_channel_name || "YouTube"}
                  </div>
                ) : (
                  <select value={ytChannelId} onChange={e => setYtChannelId(e.target.value)} className="pixel"
                    style={{ width: isMobile ? "100%" : "auto", padding: "9px 10px", background: C.paper, color: C.ink, border: BORDER, fontSize: 8 }}>
                    {ytChannels.map(c => (
                      <option key={c.yt_channel_id} value={c.yt_channel_id}>{c.yt_channel_name || c.yt_channel_id}</option>
                    ))}
                  </select>
                )}
              </div>
            )}
          </div>

          <PixelBtn color="hot" onClick={handleAdd} disabled={adding || !urlInput.trim()}
            style={isMobile ? { width: "100%", textAlign: "center", justifyContent: "center" } : {}}>
            {adding ? "RESOLVING..." : "+ ADD CHANNEL"}
          </PixelBtn>

          {addError && (
            <div className="pixel" style={{ fontSize: 9, color: C.hotDeep, marginTop: 10, padding: "8px 10px", background: `${C.hot}44`, border: `2px solid ${C.hotDeep}` }}>
              ! {addError}
            </div>
          )}
        </PixelCard>

        {/* List */}
        {loading ? (
          <PixelCard color={C.cream} padding={48} style={{ textAlign: "center" }}>
            <p className="vt" style={{ fontSize: 20, color: C.dim2 }}>Loading...</p>
          </PixelCard>
        ) : backfills.length === 0 ? (
          <PixelCard color={C.paper} padding={isMobile ? 24 : 48} style={{ textAlign: "center" }}>
            <div className="pixel" style={{ fontSize: 10, color: C.dim2, marginBottom: 8 }}>NO DIGEST CHANNELS</div>
            <p className="vt" style={{ fontSize: 16, color: C.dim2 }}>Add a channel above to start digesting its backlog.</p>
          </PixelCard>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {backfills.map(bf => (
              <DigestCard
                key={bf.id}
                bf={bf}
                ytStatus={ytStatus}
                onRemove={handleRemove}
                onRunNow={handleRunNow}
                isMobile={isMobile}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

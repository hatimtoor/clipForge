import { useState, useEffect } from "react";
import { C, BORDER, SHADOW_SM, KEYFRAMES } from "../lib/theme";
import { PixelBtn, PixelCard, Tag } from "../components/ui";
import Header from "../components/Header";
import { useApp } from "../context/AppContext";
import { authFetch } from "../lib/supabase";
import { useMobile } from "../hooks/useMobile";

const STATUS_COLORS = { scheduled: C.amber, publishing: C.signal, done: C.signal, error: C.hot, cancelled: C.cream2 };

const dayLabel = (iso) => {
  const d = new Date(iso);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const that = new Date(d); that.setHours(0, 0, 0, 0);
  const diff = Math.round((that - today) / 86400000);
  if (diff === 0) return "TODAY";
  if (diff === 1) return "TOMORROW";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }).toUpperCase();
};

export default function CalendarPage() {
  const { isPro } = useApp();
  const isMobile = useMobile();
  const [posts, setPosts] = useState(null);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const res = await authFetch("/api/schedule");
      const d = await res.json();
      if (!res.ok) { setError(d.detail || "Could not load schedule"); return; }
      setPosts(d.posts || []);
    } catch { setError("Could not load schedule"); }
  };
  useEffect(() => { load(); }, []);

  const cancel = async (id) => {
    if (!window.confirm("Cancel this scheduled post?")) return;
    try {
      await authFetch(`/api/schedule/${id}`, { method: "DELETE" });
      load();
    } catch { /* reload shows truth */ }
  };

  // Group by calendar day, upcoming first; past/settled posts sink below.
  const upcoming = (posts || []).filter(p => ["scheduled", "publishing"].includes(p.status));
  const settled = (posts || []).filter(p => !["scheduled", "publishing"].includes(p.status)).reverse();
  const groups = upcoming.reduce((acc, p) => {
    const k = dayLabel(p.publish_at);
    (acc[acc.length - 1]?.[0] === k ? acc[acc.length - 1][1] : acc[acc.push([k, []]) - 1][1]).push(p);
    return acc;
  }, []);

  const Row = ({ p, showCancel }) => (
    <div style={{ display: "flex", alignItems: "stretch", border: BORDER, boxShadow: SHADOW_SM, background: C.paper, marginBottom: 8 }}>
      {p.thumbnail_url && (
        <img src={p.thumbnail_url} alt="" style={{ width: 54, objectFit: "cover", borderRight: BORDER }} />
      )}
      <div style={{ flex: 1, padding: "10px 12px", minWidth: 0 }}>
        <div className="pixel" style={{ fontSize: 9, color: C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {p.platform === "youtube" ? "▶" : "♪"} {p.clip_title}
        </div>
        <div className="vt" style={{ fontSize: 14, color: C.dim2, marginTop: 2 }}>
          {new Date(p.publish_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
          {" · "}{p.platform}
          {p.error ? ` · ${p.error.slice(0, 80)}` : ""}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 12px", flexShrink: 0 }}>
        <Tag bg={STATUS_COLORS[p.status] || C.cream2}>{p.status.toUpperCase()}</Tag>
        {showCancel && (
          <button onClick={() => cancel(p.id)} className="pixel" title="Cancel"
            style={{ padding: "4px 10px", background: "transparent", color: C.ink, border: BORDER, fontSize: 10, cursor: "pointer" }}>×</button>
        )}
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh" }}>
      <style>{KEYFRAMES}</style>
      <Header />
      <div className="fade" style={{ padding: isMobile ? "16px 12px 48px" : "32px 32px 64px", maxWidth: 900, margin: "0 auto" }}>
        <div style={{ marginBottom: 24 }}>
          <div className="pixel" style={{ fontSize: 10, color: C.dim2, marginBottom: 10 }}>CALENDAR</div>
          <h1 className="pixel" style={{ fontSize: isMobile ? 18 : 26, color: C.ink }}>Scheduled posts.</h1>
          <p className="vt" style={{ fontSize: 18, color: C.dim2, marginTop: 6 }}>
            Queue clips from any job's ▾ MORE menu — they publish automatically at the time you pick.
          </p>
        </div>

        {error && <div className="pixel" style={{ fontSize: 9, color: C.hotDeep, marginBottom: 16 }}>! {error}</div>}
        {!isPro && (
          <PixelCard color={C.cream} padding={20} style={{ marginBottom: 16 }}>
            <span className="vt" style={{ fontSize: 17, color: C.dim2 }}>Scheduling is a Pro feature. </span>
            <Tag bg={C.amber}>PRO</Tag>
          </PixelCard>
        )}

        {posts === null && !error && <p className="vt" style={{ fontSize: 16, color: C.dim2 }}>loading…</p>}
        {posts !== null && upcoming.length === 0 && (
          <PixelCard color={C.cream} padding={26} style={{ textAlign: "center", marginBottom: 18 }}>
            <p className="vt" style={{ fontSize: 18, color: C.dim2 }}>Nothing scheduled. Open a clip's ▾ MORE menu → ⏰ SCHEDULE.</p>
          </PixelCard>
        )}

        {groups.map(([label, items]) => (
          <div key={label} style={{ marginBottom: 18 }}>
            <div className="pixel" style={{ fontSize: 9, color: C.hotDeep, marginBottom: 8 }}>{label}</div>
            {items.map(p => <Row key={p.id} p={p} showCancel />)}
          </div>
        ))}

        {settled.length > 0 && (
          <div style={{ marginTop: 26 }}>
            <div className="pixel" style={{ fontSize: 9, color: C.dim2, marginBottom: 8 }}>HISTORY</div>
            {settled.slice(0, 20).map(p => <Row key={p.id} p={p} showCancel={p.status === "error"} />)}
          </div>
        )}
      </div>
    </div>
  );
}

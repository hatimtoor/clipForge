import { useState, useEffect } from "react";
import { Button, Card, ProBadge, Banner, EmptyState } from "../components/kit";
import { useApp } from "../context/AppContext";
import { authFetch } from "../lib/supabase";

/* Status → tag tint (CSS vars so both themes work automatically). */
const STATUS_TINTS = {
  scheduled: { background: "var(--warning-soft)", color: "var(--warning)", borderColor: "transparent" },
  publishing: { background: "var(--accent-soft)", color: "var(--accent-strong)", borderColor: "transparent" },
  done: { background: "var(--success-soft)", color: "var(--success)", borderColor: "transparent" },
  error: { background: "var(--danger-soft)", color: "var(--danger)", borderColor: "transparent" },
};

const PLATFORM_TINTS = {
  youtube: { background: "var(--yt-soft)", color: "var(--yt)", borderColor: "transparent" },
  tiktok: { background: "var(--tt-soft)", color: "var(--tt)", borderColor: "transparent" },
};

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
  // Group by day label — order-independent (don't assume the API sorted),
  // then order the day groups by their earliest post.
  const groups = Object.entries(
    upcoming.reduce((acc, p) => { (acc[dayLabel(p.publish_at)] ??= []).push(p); return acc; }, {})
  ).sort((a, b) => new Date(a[1][0].publish_at) - new Date(b[1][0].publish_at));

  const Row = ({ p, showCancel, first }) => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 14px",
        borderTop: first ? "none" : "1px solid var(--line)",
      }}
    >
      {p.thumbnail_url && (
        <img
          src={p.thumbnail_url}
          alt=""
          style={{
            width: 44,
            height: 58,
            objectFit: "cover",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--line)",
            flexShrink: 0,
          }}
        />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            color: "var(--text-1)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          <span className="show-sm">{p.platform === "youtube" ? "▶ " : "♪ "}</span>
          {p.clip_title}
        </div>
        <div className="t-sm" style={{ color: "var(--text-3)", marginTop: 2 }}>
          {new Date(p.publish_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
          {p.error ? ` · ${p.error.slice(0, 80)}` : ""}
        </div>
      </div>
      <span className="tag hide-sm" style={PLATFORM_TINTS[p.platform] || undefined}>
        {p.platform === "youtube" ? "▶ YouTube" : p.platform === "tiktok" ? "♪ TikTok" : p.platform}
      </span>
      <span className="tag" style={STATUS_TINTS[p.status] || undefined}>
        {p.status}
      </span>
      {showCancel && (
        <Button size="sm" variant="ghost" title="Cancel" onClick={() => cancel(p.id)}>
          ✕
        </Button>
      )}
    </div>
  );

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", display: "grid", gap: 20 }}>
      <div className="page-head">
        <div className="page-head__title">Calendar</div>
        <div className="page-head__sub">
          Queue clips from any results page — they publish automatically at the time you pick.
        </div>
      </div>

      {error && (
        <Banner tone="danger" title="Couldn't load the schedule">
          {error}
        </Banner>
      )}

      {!isPro && (
        <Banner tone="info" title="Scheduling is a Pro feature" action={<ProBadge />}>
          Upgrade to queue clips and let them publish themselves.
        </Banner>
      )}

      {posts === null && !error && (
        <div className="t-sm" style={{ color: "var(--text-3)" }}>Loading…</div>
      )}

      {posts !== null && upcoming.length === 0 && (
        <Card flush>
          <EmptyState
            icon="🗓"
            title="Nothing scheduled"
            description="Schedule a clip from any results page — pick a time and it posts itself."
          />
        </Card>
      )}

      {groups.map(([label, items]) => (
        <div key={label}>
          <div className="t-label" style={{ marginBottom: 8 }}>{label}</div>
          <Card flush>
            {items.map((p, i) => (
              <Row key={p.id} p={p} showCancel first={i === 0} />
            ))}
          </Card>
        </div>
      ))}

      {settled.length > 0 && (
        <div>
          <div className="t-label" style={{ marginBottom: 8 }}>History</div>
          <Card flush>
            {settled.slice(0, 20).map((p, i) => (
              <Row key={p.id} p={p} showCancel={p.status === "error"} first={i === 0} />
            ))}
          </Card>
        </div>
      )}
    </div>
  );
}

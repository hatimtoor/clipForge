import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { timeAgo } from "../lib/theme";
import { authFetch } from "../lib/supabase";
import { useMobile } from "../hooks/useMobile";
import {
  Button,
  Card,
  Tag,
  EmptyState,
  SegmentedControl,
  Tour,
} from "../components/kit";

const PAGE_SIZE = 20;

const FILTERS = [
  { id: "all", label: "All" },
  { id: "done", label: "Done" },
  { id: "error", label: "Failed" },
];

const TOUR_STEPS = [
  {
    target: "#tour-ar-head",
    title: "Every job lives here",
    text: "Reopen any job to watch and download its clips again, or hit Retry to re-run it with the exact same settings. Clip files expire after 7 days — your settings and history never do.",
  },
];

const GRID_COLS = "minmax(0, 1fr) 110px 90px 110px 230px";

function statusLabel(status) {
  if (status === "done") return "Done";
  if (status === "error") return "Failed";
  if (status === "cancelled") return "Cancelled";
  return status || "—";
}

function StatusTag({ status }) {
  if (status === "done") return <Tag tone="success">✓ Done</Tag>;
  if (status === "error")
    return (
      <Tag>
        <span style={{ color: "var(--danger)" }}>✕ Failed</span>
      </Tag>
    );
  return <Tag>{statusLabel(status)}</Tag>;
}

/* Per-row action cluster — identical actions on desktop and mobile. */
function RowActions({ j, isDone, isErr, isProc, navigate, retryHref, onCancel, onDelete }) {
  return (
    <>
      {isDone && (
        <Button
          size="sm"
          variant="secondary"
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/work?job=${j.job_id}`);
          }}
        >
          Open →
        </Button>
      )}
      {isErr && (
        <Button
          size="sm"
          variant="secondary"
          onClick={(e) => {
            e.stopPropagation();
            navigate(retryHref(j));
          }}
        >
          ↻ Retry
        </Button>
      )}
      {isProc && (
        <Button
          size="sm"
          variant="secondary"
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/work?job=${j.job_id}`);
          }}
        >
          ● Live →
        </Button>
      )}
      {isProc && (
        <Button
          size="sm"
          variant="danger"
          onClick={(e) => {
            e.stopPropagation();
            onCancel(j.job_id);
          }}
        >
          Cancel
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        title="Delete job"
        onClick={(e) => {
          e.stopPropagation();
          onDelete(j.job_id);
        }}
      >
        ✕
      </Button>
    </>
  );
}

export default function ArchivePage() {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);
  const isMobile = useMobile();

  const retryHref = (j) => {
    const p = new URLSearchParams({ url: j.url });
    if (j.max_clips)    p.set("max_clips",   j.max_clips);
    if (j.min_duration) p.set("min_dur",      j.min_duration);
    if (j.max_duration) p.set("max_dur",      j.max_duration);
    if (j.reframe)      p.set("reframe",      "1");
    if (j.style_prompt)           p.set("style_prompt",      j.style_prompt);
    if (j.caption_style)          p.set("caption_style",     j.caption_style);
    if (j.caption_font_size)       p.set("font_size",         j.caption_font_size);
    if (j.caption_highlight_color) p.set("highlight_color",   j.caption_highlight_color);
    if (j.caption_language)        p.set("caption_language",  j.caption_language);
    const opt = j.options || {};
    if (opt.caption_position)           p.set("caption_position", opt.caption_position);
    if (opt.caption_keywords === false) p.set("caption_keywords", "0");
    if (opt.caption_emoji === false)    p.set("caption_emoji", "0");
    if (opt.exclude_prompt)             p.set("exclude_prompt", opt.exclude_prompt);
    if (opt.timeframe_start_min)        p.set("tf_start", opt.timeframe_start_min);
    if (opt.timeframe_end_min)          p.set("tf_end", opt.timeframe_end_min);
    if (opt.clip_style)                 p.set("clip_style", opt.clip_style);
    if (opt.aspect_ratio && opt.aspect_ratio !== "9:16") p.set("aspect_ratio", opt.aspect_ratio);
    if (opt.filter && opt.filter !== "none") p.set("filter", opt.filter);
    return `/hello?${p}`;
  };

  const fetchInitial = async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/jobs?limit=${PAGE_SIZE}&offset=0`);
      const data = res.ok ? await res.json() : [];
      const arr = Array.isArray(data) ? data : [];
      setJobs(arr);
      setOffset(PAGE_SIZE);
      setHasMore(arr.length === PAGE_SIZE);
    } catch {} finally {
      setLoading(false);
    }
  };

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const res = await authFetch(`/api/jobs?limit=${PAGE_SIZE}&offset=${offset}`);
      const data = res.ok ? await res.json() : [];
      const arr = Array.isArray(data) ? data : [];
      setJobs(prev => [...prev, ...arr]);
      setOffset(prev => prev + PAGE_SIZE);
      setHasMore(arr.length === PAGE_SIZE);
    } catch {} finally {
      setLoadingMore(false);
    }
  };

  const handleCancel = async (jobId) => {
    if (!window.confirm("Cancel this job? It will stop processing.")) return;
    try {
      await authFetch(`/api/jobs/${jobId}/cancel`, { method: "POST" });
      await fetchInitial();
    } catch {}
  };

  const handleDelete = async (jobId) => {
    try {
      await authFetch(`/api/jobs/${jobId}`, { method: "DELETE" });
      setJobs(prev => prev.filter(j => j.job_id !== jobId));
    } catch {}
  };

  useEffect(() => { fetchInitial(); }, []);

  const filtered = (Array.isArray(jobs) ? jobs : []).filter(
    (j) => filter === "all" || j.status === filter
  );

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", display: "grid", gap: 20 }}>
      <div className="page-head" id="tour-ar-head">
        <div className="page-head__title">Archive</div>
        <div className="page-head__sub">
          {jobs.length} {jobs.length === 1 ? "job" : "jobs"} loaded · clip files expire after 7
          days — your settings and history never do
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <SegmentedControl options={FILTERS} value={filter} onChange={setFilter} />
        <Button size="sm" variant="secondary" onClick={fetchInitial}>
          ↻ Refresh
        </Button>
      </div>

      {loading ? (
        <Card>
          <div className="t-sm" style={{ textAlign: "center", color: "var(--text-2)", padding: 24 }}>
            Loading…
          </div>
        </Card>
      ) : filtered.length === 0 ? (
        <Card flush>
          <EmptyState
            icon="🗃️"
            title="No jobs to show"
            description="Forge some clips first."
            action={<Button onClick={() => navigate("/hello")}>⚡ New job</Button>}
          />
        </Card>
      ) : isMobile ? (
        <div style={{ display: "grid", gap: 10 }}>
          {filtered.map((j) => {
            const isDone = j.status === "done";
            const isErr = j.status === "error";
            const isProc = !["done", "error", "cancelled"].includes(j.status);
            return (
              <Card
                key={j.job_id}
                style={{ cursor: isProc ? "pointer" : "default" }}
                onClick={() => isProc && navigate(`/work?job=${j.job_id}`)}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    flexWrap: "wrap",
                    marginBottom: 8,
                  }}
                >
                  <StatusTag status={j.status} />
                  <span className="t-sm" style={{ color: "var(--text-3)" }}>
                    {timeAgo(j.created_at)}
                  </span>
                  {isDone && j.clips?.length > 0 && (
                    <span className="t-sm" style={{ color: "var(--text-2)" }}>
                      {j.clips.length} clips
                    </span>
                  )}
                </div>
                <div
                  className="t-mono"
                  style={{
                    fontSize: "var(--fs-sm)",
                    color: "var(--text-1)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    marginBottom: isErr ? 6 : 10,
                  }}
                >
                  {j.url}
                </div>
                {isErr && (
                  <div
                    className="t-sm"
                    style={{ color: "var(--danger)", marginBottom: 8 }}
                  >
                    {j.error?.split("\n").pop()}
                  </div>
                )}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <RowActions
                    j={j}
                    isDone={isDone}
                    isErr={isErr}
                    isProc={isProc}
                    navigate={navigate}
                    retryHref={retryHref}
                    onCancel={handleCancel}
                    onDelete={handleDelete}
                  />
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card flush>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: GRID_COLS,
              gap: 14,
              padding: "12px 20px",
              background: "var(--surface-2)",
              borderBottom: "var(--border-w-sm) solid var(--line)",
            }}
          >
            {["Source", "Status", "Clips", "Created", ""].map((h, i) => (
              <span key={i} className="t-label">
                {h || "Actions"}
              </span>
            ))}
          </div>
          {filtered.map((j, i) => {
            const isDone = j.status === "done";
            const isErr = j.status === "error";
            const isProc = !["done", "error", "cancelled"].includes(j.status);
            return (
              <div
                key={j.job_id}
                onClick={() => isProc && navigate(`/work?job=${j.job_id}`)}
                style={{
                  display: "grid",
                  gridTemplateColumns: GRID_COLS,
                  gap: 14,
                  alignItems: "center",
                  padding: "14px 20px",
                  borderBottom:
                    i < filtered.length - 1
                      ? "var(--border-w-sm) solid var(--line)"
                      : "none",
                  cursor: isProc ? "pointer" : "default",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    className="t-mono"
                    style={{
                      fontSize: "var(--fs-sm)",
                      color: "var(--text-1)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {j.url}
                  </div>
                  {isErr && (
                    <div className="t-sm" style={{ color: "var(--danger)", marginTop: 2 }}>
                      {j.error?.split("\n").pop()}
                    </div>
                  )}
                </div>
                <div>
                  <StatusTag status={j.status} />
                </div>
                <span
                  className="t-sm"
                  style={{ color: j.clips?.length > 0 ? "var(--text-1)" : "var(--text-3)" }}
                >
                  {j.clips?.length > 0 ? `${j.clips.length} clips` : "—"}
                </span>
                <span className="t-sm" style={{ color: "var(--text-2)" }}>
                  {timeAgo(j.created_at)}
                </span>
                <div
                  style={{
                    display: "flex",
                    gap: 6,
                    justifyContent: "flex-end",
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  <RowActions
                    j={j}
                    isDone={isDone}
                    isErr={isErr}
                    isProc={isProc}
                    navigate={navigate}
                    retryHref={retryHref}
                    onCancel={handleCancel}
                    onDelete={handleDelete}
                  />
                </div>
              </div>
            );
          })}
        </Card>
      )}

      {!loading && hasMore && (
        <div style={{ textAlign: "center" }}>
          <Button variant="secondary" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}

      <Tour steps={TOUR_STEPS} storageKey="cf_tour_archive_v2" />
    </div>
  );
}

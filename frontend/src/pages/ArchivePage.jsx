import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { C, BORDER, SHADOW_SM, timeAgo } from "../lib/theme";
import { PixelBtn, PixelCard, Tag } from "../components/ui";
import Header from "../components/Header";
import { authFetch } from "../lib/supabase";
import { useMobile } from "../hooks/useMobile";
import OnboardingTour from "../components/OnboardingTour";

const PAGE_SIZE = 20;

// Delete (×) button — PixelBtn tactile feel, turns red on hover
function DeleteButton({ onDelete }) {
  const [hover, setHover] = useState(false);
  return (
    <PixelBtn color="cream" size="sm"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={(e) => { e.stopPropagation(); onDelete(); }}
      style={{ background: hover ? C.ytDeep : C.cream2, color: hover ? C.cream : C.ink, padding: "9px 13px", fontSize: 13, lineHeight: 1 }}>
      ×
    </PixelBtn>
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

  const filtered = (Array.isArray(jobs) ? jobs : []).filter(j => filter === "all" || j.status === filter);

  return (
    <div style={{ minHeight: "100vh" }}>
      <Header />
      <div className="fade" style={{ padding: isMobile ? "16px 12px 48px" : "32px 32px 64px", maxWidth: 1320, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 20, gap: 18, flexWrap: "wrap" }}>
          <div>
            <OnboardingTour storageKey="cf_tour_archive_v1" steps={[
          { target: "#tour-ar-head", title: "EVERY JOB LIVES HERE",
            text: "Reopen any job to watch and download its clips again, or hit RETRY to re-run it with the exact same settings. Clip files expire after 7 days — your settings and history never do." },
        ]} />
        <div className="pixel" style={{ fontSize: 10, color: C.dim2, marginBottom: 10 }} id="tour-ar-head">
              ARCHIVE — {jobs.length} JOBS LOADED
            </div>
            <h1 className="pixel" style={{ fontSize: 26, color: C.ink }}>The vault.</h1>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {[["all", "ALL"], ["done", "DONE"], ["error", "FAILED"]].map(([k, l]) => {
              const a = filter === k;
              const col = k === "done" ? "signal" : k === "error" ? "hot" : "cream";
              return <PixelBtn key={k} color={a ? col : "cream"} onClick={() => setFilter(k)} size="md" style={a ? { transform: "translate(3px,3px)", boxShadow: `0 0 0 ${C.ink}` } : {}}>{l}</PixelBtn>;
            })}
            <PixelBtn color="lavender" size="md" onClick={fetchInitial}>Refresh</PixelBtn>
          </div>
        </div>

        {loading ? (
          <PixelCard color={C.cream} padding={48} style={{ textAlign: "center" }}>
            <p className="vt" style={{ fontSize: 20, color: C.dim2 }}>Loading...</p>
          </PixelCard>
        ) : filtered.length === 0 ? (
          <PixelCard color={C.cream} padding={48} style={{ textAlign: "center" }}>
            <p className="vt" style={{ fontSize: 20, color: C.dim2 }}>No jobs to show. Forge some clips first.</p>
          </PixelCard>
        ) : isMobile ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {filtered.map((j) => {
              const isDone      = j.status === "done";
              const isErr       = j.status === "error";
              const isCancelled = j.status === "cancelled";
              const isProc      = !["done", "error", "cancelled"].includes(j.status);
              return (
                <PixelCard key={j.job_id} color={C.cream} padding={16}
                  style={{ cursor: isProc ? "pointer" : "default" }}
                  onClick={() => isProc && navigate(`/work?job=${j.job_id}`)}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                    <Tag bg={isDone ? C.signal : isErr ? C.hot : isCancelled ? C.cream2 : C.amber}>* {j.status?.toUpperCase()}</Tag>
                    <span className="vt" style={{ fontSize: 15, color: C.dim2 }}>{timeAgo(j.created_at)}</span>
                    {isDone && j.clips?.length > 0 && <span className="pixel" style={{ fontSize: 8, color: C.ink }}>{j.clips.length} CLIPS</span>}
                    <span style={{ marginLeft: "auto" }}><DeleteButton onDelete={() => handleDelete(j.job_id)} /></span>
                  </div>
                  <div className="mono" style={{ fontSize: 12, color: C.ink, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: isErr ? 6 : 10 }}>{j.url}</div>
                  {isErr && <div className="vt" style={{ fontSize: 15, color: C.hotDeep, marginBottom: 8 }}>! {j.error?.split("\n").pop()}</div>}
                  <div style={{ display: "flex", gap: 8 }}>
                    {isDone  && <PixelBtn color="lavender" size="sm" onClick={e => { e.stopPropagation(); navigate(`/work?job=${j.job_id}`); }}>OPEN {`>`}</PixelBtn>}
                    {isErr   && <PixelBtn color="amber"    size="sm" onClick={e => { e.stopPropagation(); navigate(retryHref(j)); }}>RETRY</PixelBtn>}
                    {isProc  && <PixelBtn color="hot"      size="sm" onClick={e => { e.stopPropagation(); navigate(`/work?job=${j.job_id}`); }}>LIVE {`>`}</PixelBtn>}
                    {isProc  && <PixelBtn color="danger"   size="sm" onClick={e => { e.stopPropagation(); handleCancel(j.job_id); }}>CANCEL</PixelBtn>}
                  </div>
                </PixelCard>
              );
            })}
          </div>
        ) : (
          <PixelCard color={C.cream} padding={0}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 110px 110px 110px 200px", padding: "12px 20px", borderBottom: `3px solid ${C.ink}`, gap: 14, background: C.cream2 }}>
              {["SOURCE", "STATUS", "CLIPS", "CREATED", "ACTIONS"].map(h => <span key={h} className="pixel" style={{ fontSize: 8, color: C.dim2 }}>{h}</span>)}
            </div>
            {filtered.map((j, i) => {
              const isDone      = j.status === "done";
              const isErr       = j.status === "error";
              const isCancelled = j.status === "cancelled";
              const isProc      = !["done", "error", "cancelled"].includes(j.status);
              return (
                <div key={j.job_id}
                  onClick={() => isProc && navigate(`/work?job=${j.job_id}`)}
                  style={{ display: "grid", gridTemplateColumns: "1fr 110px 110px 110px 200px", padding: "16px 20px", borderBottom: i < filtered.length - 1 ? `2px solid ${C.ink}22` : "none", gap: 14, alignItems: "center", cursor: isProc ? "pointer" : "default" }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="mono" style={{ fontSize: 13, color: C.ink, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{j.url}</div>
                    {isErr && <div className="vt" style={{ fontSize: 16, color: C.hotDeep, marginTop: 2 }}>! {j.error?.split("\n").pop()}</div>}
                  </div>
                  <Tag bg={isDone ? C.signal : isErr ? C.hot : isCancelled ? C.cream2 : C.amber}>* {j.status?.toUpperCase()}</Tag>
                  <span className="pixel" style={{ fontSize: 9, color: isDone ? C.ink : C.dim }}>
                    {j.clips?.length > 0 ? `${j.clips.length} CLIPS` : "--"}
                  </span>
                  <span className="vt" style={{ fontSize: 16, color: C.dim2 }}>{timeAgo(j.created_at)}</span>
                  <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", alignItems: "center", flexWrap: "wrap" }}>
                    {isDone  && <PixelBtn color="lavender" size="sm" onClick={e => { e.stopPropagation(); navigate(`/work?job=${j.job_id}`); }}>OPEN {`>`}</PixelBtn>}
                    {isErr   && <PixelBtn color="amber"    size="sm" onClick={e => { e.stopPropagation(); navigate(retryHref(j)); }}>RETRY</PixelBtn>}
                    {isProc  && <PixelBtn color="hot"      size="sm" onClick={e => { e.stopPropagation(); navigate(`/work?job=${j.job_id}`); }}>LIVE {`>`}</PixelBtn>}
                    {isProc  && <PixelBtn color="danger"   size="sm" onClick={e => { e.stopPropagation(); handleCancel(j.job_id); }}>CANCEL</PixelBtn>}
                    <DeleteButton onDelete={() => handleDelete(j.job_id)} />
                  </div>
                </div>
              );
            })}
          </PixelCard>
        )}

        {!loading && hasMore && (
          <div style={{ textAlign: "center", marginTop: 24 }}>
            <PixelBtn color="lavender" size="md" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? "LOADING..." : "LOAD MORE"}
            </PixelBtn>
          </div>
        )}
      </div>
    </div>
  );
}

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { C, BORDER, SHADOW_SM, KEYFRAMES, timeAgo } from "../lib/theme";
import { PixelBtn, PixelCard, Tag } from "../components/ui";
import Header from "../components/Header";
import { authFetch } from "../lib/supabase";
import { useMobile } from "../hooks/useMobile";

export default function ArchivePage() {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const isMobile = useMobile();

  const fetchJobs = async () => {
    try {
      const res = await authFetch("/api/jobs");
      const data = await res.json();
      setJobs(data.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
    } catch {} finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
    const i = setInterval(fetchJobs, 10000);
    return () => clearInterval(i);
  }, []);

  const filtered = jobs.filter(j => filter === "all" || j.status === filter);

  return (
    <div style={{ minHeight: "100vh" }}>
      <style>{KEYFRAMES}</style>
      <Header />
      <div className="fade" style={{ padding: isMobile ? "16px 12px 48px" : "32px 32px 64px", maxWidth: 1320, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 20, gap: 18, flexWrap: "wrap" }}>
          <div>
            <div className="pixel" style={{ fontSize: 10, color: C.dim2, marginBottom: 10 }}>ARCHIVE - {jobs.length} JOBS</div>
            <h1 className="pixel" style={{ fontSize: 26, color: C.ink }}>The vault.</h1>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {[["all", "ALL"], ["done", "DONE"], ["error", "FAILED"]].map(([k, l]) => {
              const a = filter === k;
              const col = k === "done" ? "signal" : k === "error" ? "hot" : "cream";
              return <PixelBtn key={k} color={a ? col : "cream"} onClick={() => setFilter(k)} size="md" style={a ? { transform: "translate(3px,3px)", boxShadow: `0 0 0 ${C.ink}` } : {}}>{l}</PixelBtn>;
            })}
            <PixelBtn color="lavender" size="md" onClick={fetchJobs}>Refresh</PixelBtn>
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
              const isDone = j.status === "done";
              const isErr  = j.status === "error";
              const isProc = !["done", "error"].includes(j.status);
              return (
                <PixelCard key={j.job_id} color={C.cream} padding={16}
                  style={{ cursor: isProc ? "pointer" : "default" }}
                  onClick={() => isProc && navigate(`/work?job=${j.job_id}`)}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                    <Tag bg={isDone ? C.signal : isErr ? C.hot : C.amber}>* {j.status?.toUpperCase()}</Tag>
                    <span className="vt" style={{ fontSize: 15, color: C.dim2 }}>{timeAgo(j.created_at)}</span>
                    {isDone && j.clips?.length > 0 && <span className="pixel" style={{ fontSize: 8, color: C.ink }}>{j.clips.length} CLIPS</span>}
                  </div>
                  <div className="mono" style={{ fontSize: 12, color: C.ink, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: isErr ? 6 : 10 }}>{j.url}</div>
                  {isErr && <div className="vt" style={{ fontSize: 15, color: C.hotDeep, marginBottom: 8 }}>! {j.error?.split("\n").pop()}</div>}
                  <div style={{ display: "flex", gap: 8 }}>
                    {isDone && <PixelBtn color="lavender" size="sm" onClick={e => { e.stopPropagation(); navigate(`/work?job=${j.job_id}`); }}>OPEN {`>`}</PixelBtn>}
                    {isErr  && <PixelBtn color="amber"    size="sm" onClick={e => { e.stopPropagation(); navigate(`/hello?url=${encodeURIComponent(j.url)}`); }}>RETRY</PixelBtn>}
                    {isProc && <PixelBtn color="hot"      size="sm" onClick={e => { e.stopPropagation(); navigate(`/work?job=${j.job_id}`); }}>LIVE {`>`}</PixelBtn>}
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
              const isDone = j.status === "done";
              const isErr  = j.status === "error";
              const isProc = !["done", "error"].includes(j.status);
              return (
                <div key={j.job_id}
                  onClick={() => isProc && navigate(`/work?job=${j.job_id}`)}
                  style={{ display: "grid", gridTemplateColumns: "1fr 110px 110px 110px 200px", padding: "16px 20px", borderBottom: i < filtered.length - 1 ? `2px solid ${C.ink}22` : "none", gap: 14, alignItems: "center", cursor: isProc ? "pointer" : "default" }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="mono" style={{ fontSize: 13, color: C.ink, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{j.url}</div>
                    {isErr && <div className="vt" style={{ fontSize: 16, color: C.hotDeep, marginTop: 2 }}>! {j.error?.split("\n").pop()}</div>}
                  </div>
                  <Tag bg={isDone ? C.signal : isErr ? C.hot : C.amber}>* {j.status?.toUpperCase()}</Tag>
                  <span className="pixel" style={{ fontSize: 9, color: isDone ? C.ink : C.dim }}>
                    {j.clips?.length > 0 ? `${j.clips.length} CLIPS` : "--"}
                  </span>
                  <span className="vt" style={{ fontSize: 16, color: C.dim2 }}>{timeAgo(j.created_at)}</span>
                  <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                    {isDone && <PixelBtn color="lavender" size="sm" onClick={e => { e.stopPropagation(); navigate(`/work?job=${j.job_id}`); }}>OPEN {`>`}</PixelBtn>}
                    {isErr  && <PixelBtn color="amber"    size="sm" onClick={e => { e.stopPropagation(); navigate(`/hello?url=${encodeURIComponent(j.url)}`); }}>RETRY</PixelBtn>}
                    {isProc && <PixelBtn color="hot"      size="sm" onClick={e => { e.stopPropagation(); navigate(`/work?job=${j.job_id}`); }}>LIVE {`>`}</PixelBtn>}
                  </div>
                </div>
              );
            })}
          </PixelCard>
        )}
      </div>
    </div>
  );
}

import { useState, useEffect, useRef } from "react";

const API = "";
const authFetch = (url, options = {}) => {
  const auth = sessionStorage.getItem("cf_auth");
  return fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), ...(auth ? { Authorization: auth } : {}) },
  });
};

const scoreColor = (s) => {
  if (s >= 8) return "#00ff87";
  if (s >= 6) return "#ffdd57";
  return "#ff6b6b";
};

const formatTime = (s) => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

const timeAgo = (iso) => {
  if (!iso) return "";
  const diff = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
};

function ScoreRing({ score }) {
  const r = 24;
  const circ = 2 * Math.PI * r;
  const fill = (score / 10) * circ;
  const color = scoreColor(score);
  return (
    <svg width="64" height="64" viewBox="0 0 64 64">
      <circle cx="32" cy="32" r={r} fill="none" stroke="#1a1a2e" strokeWidth="5" />
      <circle cx="32" cy="32" r={r} fill="none" stroke={color} strokeWidth="5"
        strokeDasharray={`${fill} ${circ}`} strokeLinecap="round"
        transform="rotate(-90 32 32)" style={{ transition: "stroke-dasharray 1s ease" }} />
      <text x="32" y="37" textAnchor="middle" fill={color}
        style={{ fontSize: "15px", fontFamily: "Space Grotesk, sans-serif", fontWeight: 700 }}>
        {score}
      </text>
    </svg>
  );
}

function StatusBar({ status, progress, message }) {
  const stages = ["downloading", "transcribing", "analyzing", "clipping", "done"];
  const labels = ["Download", "Transcribe", "Analyze", "Clip", "Done"];
  const currentIdx = stages.indexOf(status);
  return (
    <div style={{ margin: "2rem 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
        {stages.map((s, i) => (
          <div key={s} style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1 }}>
            <div style={{
              width: 28, height: 28, borderRadius: "50%",
              background: i < currentIdx ? "#00ff87" : i === currentIdx ? "#7c3aed" : "#1e1e3f",
              border: `2px solid ${i <= currentIdx ? (i < currentIdx ? "#00ff87" : "#a855f7") : "#2d2d5e"}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "11px", color: i < currentIdx ? "#000" : "#fff", fontWeight: 700,
              transition: "all 0.4s ease", boxShadow: i === currentIdx ? "0 0 12px #a855f7" : "none"
            }}>
              {i < currentIdx ? "✓" : i + 1}
            </div>
            <span style={{ fontSize: "10px", color: "#888", marginTop: 4 }}>{labels[i]}</span>
          </div>
        ))}
      </div>
      <div style={{ height: 6, background: "#1e1e3f", borderRadius: 3, overflow: "hidden", margin: "0.5rem 0" }}>
        <div style={{
          height: "100%", width: `${progress}%`,
          background: "linear-gradient(90deg, #7c3aed, #00ff87)",
          borderRadius: 3, transition: "width 0.5s ease"
        }} />
      </div>
      <p style={{ color: "#a0a0c0", fontSize: "0.85rem", margin: 0, textAlign: "center" }}>{message}</p>
    </div>
  );
}

function ClipCard({ clip, idx }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{
      background: "linear-gradient(135deg, #0f0f23 0%, #1a1a3e 100%)",
      border: "1px solid #2d2d5e", borderRadius: 16, padding: "1.25rem", marginBottom: "1rem",
      transition: "border-color 0.2s",
    }}
      onMouseEnter={e => e.currentTarget.style.borderColor = "#7c3aed"}
      onMouseLeave={e => e.currentTarget.style.borderColor = "#2d2d5e"}
    >
      <div style={{ display: "flex", gap: "1rem", alignItems: "flex-start" }}>
        <ScoreRing score={clip.virality_score} />
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <span style={{
                background: "#7c3aed22", color: "#a855f7", border: "1px solid #7c3aed55",
                borderRadius: 6, padding: "2px 8px", fontSize: "11px", fontWeight: 600, marginRight: 8
              }}>CLIP {idx + 1}</span>
              <span style={{ color: "#555", fontSize: "11px" }}>
                {formatTime(clip.start)} → {formatTime(clip.end)} · {clip.duration}s
              </span>
            </div>
            <a href={clip.path} download onClick={e => e.stopPropagation()}
              style={{
                background: "linear-gradient(135deg, #7c3aed, #a855f7)", color: "#fff",
                border: "none", borderRadius: 8, padding: "6px 14px", fontSize: "12px",
                fontWeight: 600, cursor: "pointer", textDecoration: "none",
                display: "flex", alignItems: "center", gap: 4
              }}>
              ↓ Download
            </a>
          </div>
          <h3 style={{ color: "#fff", margin: "0.4rem 0 0.2rem", fontSize: "1rem", fontWeight: 700, lineHeight: 1.3 }}>
            {clip.title}
          </h3>
          <p style={{ color: "#8888aa", margin: 0, fontSize: "0.8rem", lineHeight: 1.5 }}>{clip.reason}</p>
          {clip.tags && (
            <div style={{ display: "flex", gap: 6, marginTop: "0.5rem", flexWrap: "wrap" }}>
              {clip.tags.map(tag => (
                <span key={tag} style={{
                  background: "#00ff8711", color: "#00ff87", border: "1px solid #00ff8733",
                  borderRadius: 6, padding: "2px 8px", fontSize: "11px"
                }}>#{tag}</span>
              ))}
            </div>
          )}
        </div>
      </div>
      <div style={{
        marginTop: "0.75rem", background: "#ffffff08", border: "1px solid #ffffff10",
        borderRadius: 10, padding: "0.6rem 0.8rem"
      }}>
        <span style={{ color: "#7c3aed", fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>
          Hook ›
        </span>
        <p style={{ color: "#ddd", margin: "0.25rem 0 0", fontSize: "0.85rem", fontStyle: "italic" }}>
          "{clip.hook}"
        </p>
      </div>
      <button onClick={() => setExpanded(!expanded)} style={{
        background: "none", border: "1px solid #2d2d5e", borderRadius: 8,
        color: "#8888aa", cursor: "pointer", padding: "6px 12px",
        marginTop: "0.75rem", fontSize: "12px", width: "100%"
      }}>
        {expanded ? "▲ Hide Preview" : "▶ Preview Clip"}
      </button>
      {expanded && (
        <video src={clip.path} controls style={{
          width: "100%", maxHeight: 360, borderRadius: 10, marginTop: "0.75rem", background: "#000"
        }} />
      )}
    </div>
  );
}

function JobHistoryCard({ job, onResume, onViewLive }) {
  const [expanded, setExpanded] = useState(false);
  const isProcessing = !["done", "error"].includes(job.status);
  const statusColor = job.status === "done" ? "#00ff87" : job.status === "error" ? "#ff6b6b" : "#ffdd57";
  const statusBg = job.status === "done" ? "#00ff8715" : job.status === "error" ? "#ff6b6b15" : "#ffdd5715";

  return (
    <div
      onClick={() => isProcessing && onViewLive(job)}
      style={{
        background: "linear-gradient(135deg, #0f0f23 0%, #1a1a3e 100%)",
        border: `1px solid ${isProcessing ? "#ffdd5755" : "#2d2d5e"}`,
        borderRadius: 16, padding: "1.25rem", marginBottom: "0.75rem",
        transition: "border-color 0.2s, transform 0.15s",
        cursor: isProcessing ? "pointer" : "default",
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = isProcessing ? "#ffdd57" : "#7c3aed";
        if (isProcessing) e.currentTarget.style.transform = "translateY(-1px)";
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = isProcessing ? "#ffdd5755" : "#2d2d5e";
        e.currentTarget.style.transform = "none";
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
            <span style={{
              background: statusBg, color: statusColor, border: `1px solid ${statusColor}33`,
              borderRadius: 6, padding: "2px 8px", fontSize: "11px", fontWeight: 700, textTransform: "uppercase"
            }}>{job.status}</span>
            {isProcessing && (
              <span style={{
                background: "#ffdd5722", color: "#ffdd57", border: "1px solid #ffdd5744",
                borderRadius: 6, padding: "2px 8px", fontSize: "11px", fontWeight: 600
              }}>⚡ Click to track</span>
            )}
            {job.clips?.length > 0 && (
              <span style={{ color: "#555", fontSize: "11px" }}>{job.clips.length} clips</span>
            )}
            <span style={{ color: "#444", fontSize: "11px" }}>{timeAgo(job.created_at)}</span>
          </div>
          <p style={{
            color: "#8888aa", margin: 0, fontSize: "0.8rem",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "400px"
          }}>{job.url || job.job_id}</p>
          {isProcessing && (
            <div style={{ marginTop: "0.5rem" }}>
              <div style={{ height: 4, background: "#1e1e3f", borderRadius: 2, overflow: "hidden" }}>
                <div style={{
                  height: "100%", width: `${job.progress}%`,
                  background: "linear-gradient(90deg, #7c3aed, #ffdd57)",
                  borderRadius: 2, transition: "width 0.5s ease"
                }} />
              </div>
              <p style={{ color: "#666", fontSize: "0.75rem", margin: "0.25rem 0 0" }}>{job.message}</p>
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, marginLeft: 12 }} onClick={e => e.stopPropagation()}>
          {job.status === "done" && job.clips?.length > 0 && (
            <button onClick={() => setExpanded(!expanded)} style={{
              background: "linear-gradient(135deg, #7c3aed, #a855f7)", color: "#fff",
              border: "none", borderRadius: 8, padding: "6px 14px",
              fontSize: "12px", fontWeight: 600, cursor: "pointer"
            }}>{expanded ? "Hide" : "View Clips"}</button>
          )}
          {job.status === "error" && (
            <button onClick={() => onResume(job)} style={{
              background: "#1a1a3e", color: "#a855f7", border: "1px solid #7c3aed",
              borderRadius: 8, padding: "6px 14px", fontSize: "12px", cursor: "pointer"
            }}>Retry</button>
          )}
        </div>
      </div>
      {job.status === "error" && job.error && (
        <p style={{
          color: "#ff8888", fontSize: "0.75rem", margin: "0.5rem 0 0",
          background: "#ff000010", borderRadius: 6, padding: "0.4rem 0.6rem"
        }}>{job.error.split("\n").pop() || job.error}</p>
      )}
      {expanded && job.clips && (
        <div style={{ marginTop: "1rem" }} onClick={e => e.stopPropagation()}>
          {[...job.clips].sort((a, b) => b.virality_score - a.virality_score)
            .map((clip, i) => <ClipCard key={i} clip={clip} idx={i} />)}
        </div>
      )}
    </div>
  );
}

// ── Processing Tab ────────────────────────────────────────────────────────────
function ProcessingTab({ job, onDone }) {
  if (!job) return (
    <div style={{
      background: "#0f0f23", border: "1px solid #2d2d5e", borderRadius: 16,
      padding: "3rem", textAlign: "center", color: "#444"
    }}>
      No active job. Start a new clip first.
    </div>
  );

  if (job.status === "done") {
    return (
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
          <div>
            <h2 style={{
              fontFamily: "'Syne', sans-serif", margin: "0 0 0.2rem",
              background: "linear-gradient(135deg, #a855f7, #00ff87)",
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent"
            }}>{job.clips.length} Clips Ready 🎉</h2>
            <p style={{ color: "#7070a0", margin: 0, fontSize: "0.85rem" }}>
              Sorted by virality score · TikTok-style captions burned in
            </p>
          </div>
          <button onClick={onDone} style={{
            background: "#1a1a3e", border: "1px solid #2d2d5e", color: "#a855f7",
            borderRadius: 8, padding: "0.5rem 1rem", cursor: "pointer", fontSize: "0.85rem"
          }}>+ New Video</button>
        </div>
        {[...job.clips].sort((a, b) => b.virality_score - a.virality_score)
          .map((clip, i) => <ClipCard key={i} clip={clip} idx={i} />)}
      </div>
    );
  }

  if (job.status === "error") {
    return (
      <div style={{
        background: "#ff000015", border: "1px solid #ff000040",
        borderRadius: 20, padding: "1.75rem", textAlign: "center"
      }}>
        <p style={{ color: "#ff8888", fontSize: "1rem", marginBottom: "1rem" }}>
          ❌ {job.error?.split("\n").pop() || "Something went wrong."}
        </p>
        <button onClick={onDone} style={{
          background: "#2d2d5e", color: "#fff", border: "none",
          borderRadius: 8, padding: "0.6rem 1.5rem", cursor: "pointer"
        }}>Try Again</button>
      </div>
    );
  }

  return (
    <div style={{
      background: "linear-gradient(135deg, #0f0f23, #1a1a3e)",
      border: "1px solid #2d2d5e", borderRadius: 20, padding: "1.75rem"
    }}>
      <h2 style={{ color: "#a855f7", margin: "0 0 0.1rem", fontFamily: "'Syne', sans-serif" }}>Processing...</h2>
      {job.url && (
        <p style={{
          color: "#555", fontSize: "0.75rem", margin: "0 0 0",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
        }}>{job.url}</p>
      )}
      <StatusBar status={job.status} progress={job.progress} message={job.message} />
      <p style={{ color: "#555", fontSize: "0.8rem", textAlign: "center", margin: 0 }}>
        Transcription may take 5–10 minutes depending on video length.
      </p>
    </div>
  );
}


// ── Login Screen ──────────────────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const attempt = async () => {
    if (!user || !pass) { setErr("Enter username and password."); return; }
    setLoading(true); setErr("");
    const auth = "Basic " + btoa(user + ":" + pass);
    try {
      const res = await fetch("/api/jobs", { headers: { Authorization: auth } });
      if (res.status === 401) { setErr("Invalid username or password."); setLoading(false); return; }
      sessionStorage.setItem("cf_auth", auth);
      onLogin();
    } catch (e) {
      // Network error - store creds anyway and let the app handle it
      sessionStorage.setItem("cf_auth", auth);
      onLogin();
    }
    setLoading(false);
  };
  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "radial-gradient(ellipse at 20% 20%, #1a0533 0%, #07070f 50%, #001a0f 100%)",
      fontFamily: "'Space Grotesk', sans-serif",
    }}>
      <div style={{
        background: "linear-gradient(135deg, #0f0f23, #1a1a3e)",
        border: "1px solid #2d2d5e", borderRadius: 20, padding: "2.5rem",
        width: "100%", maxWidth: 380, textAlign: "center"
      }}>
        <div style={{ fontSize: "2.5rem", marginBottom: "0.5rem" }}>⚡</div>
        <h1 style={{ color: "#fff", margin: "0 0 0.25rem", fontFamily: "'Syne', sans-serif" }}>ClipForge</h1>
        <p style={{ color: "#555", margin: "0 0 2rem", fontSize: "0.85rem" }}>Sign in to continue</p>
        <input value={user} onChange={e => setUser(e.target.value)}
          placeholder="Username" style={{
            width: "100%", background: "#0a0a1a", border: "1px solid #2d2d5e",
            borderRadius: 10, padding: "0.75rem 1rem", color: "#fff",
            fontSize: "0.9rem", marginBottom: "0.75rem", outline: "none", boxSizing: "border-box"
          }} />
        <input value={pass} onChange={e => setPass(e.target.value)} type="password"
          placeholder="Password" onKeyDown={e => e.key === "Enter" && attempt()} style={{
            width: "100%", background: "#0a0a1a", border: "1px solid #2d2d5e",
            borderRadius: 10, padding: "0.75rem 1rem", color: "#fff",
            fontSize: "0.9rem", marginBottom: "1rem", outline: "none", boxSizing: "border-box"
          }} />
        {err && <p style={{ color: "#ff6b6b", fontSize: "0.8rem", margin: "0 0 1rem" }}>{err}</p>}
        <button onClick={attempt} disabled={loading} style={{
          width: "100%", background: "linear-gradient(135deg, #7c3aed, #a855f7)",
          color: "#fff", border: "none", borderRadius: 10, padding: "0.75rem",
          fontSize: "0.95rem", fontWeight: 700, cursor: "pointer"
        }}>{loading ? "Signing in..." : "Sign In"}</button>
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [authed, setAuthed] = useState(!!sessionStorage.getItem("cf_auth"));
  const [tab, setTab] = useState("new");
  const [url, setUrl] = useState("");
  const [maxClips, setMaxClips] = useState(5);
  const [minDur, setMinDur] = useState(30);
  const [maxDur, setMaxDur] = useState(90);
  const [jobId, setJobId] = useState(null);
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pastJobs, setPastJobs] = useState([]);
  const pollRef = useRef(null);

  const isProcessing = loading || (job && !["done", "error"].includes(job?.status));

  const fetchPastJobs = async () => {
    try {
      const res = await authFetch(`${API}/api/jobs`);
      const data = await res.json();
      setPastJobs(data.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
    } catch (e) {}
  };

  useEffect(() => { fetchPastJobs(); }, []);
  useEffect(() => { if (tab === "history") fetchPastJobs(); }, [tab]);

  // Auto-refresh past jobs every 10s
  useEffect(() => {
    const interval = setInterval(fetchPastJobs, 10000);
    return () => clearInterval(interval);
  }, []);

  // Poll active job
  useEffect(() => {
    if (!jobId) return;
    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await authFetch(`${API}/api/status/${jobId}`);
        const data = await res.json();
        setJob(data);
        if (data.status === "done" || data.status === "error") {
          clearInterval(pollRef.current);
          setLoading(false);
          fetchPastJobs();
        }
      } catch (e) {}
    }, 1000);
    return () => clearInterval(pollRef.current);
  }, [jobId]);

  const handleSubmit = async () => {
    if (!url.trim()) { setError("Paste a YouTube URL first."); return; }
    setError("");
    setJob({ status: "downloading", progress: 5, message: "Starting...", clips: [], error: null });
    setLoading(true);
    setTab("processing");
    try {
      const res = await authFetch(`${API}/api/clip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, max_clips: maxClips, min_duration: minDur, max_duration: maxDur }),
      });
      const data = await res.json();
      setJobId(data.job_id);
    } catch (e) {
      setError("Failed to start job. Is the server running?");
      setLoading(false);
      setTab("new");
    }
  };

  const reset = () => {
    setUrl(""); setJob(null); setJobId(null);
    setLoading(false); setError("");
    clearInterval(pollRef.current);
    setTab("new");
  };

  const handleRetry = (j) => { setUrl(j.url || ""); setTab("new"); };

  const handleViewLive = (j) => {
    clearInterval(pollRef.current);
    setJobId(j.job_id);
    setJob(j);
    setLoading(true);
    setTab("processing");
  };

  // Tab definitions — show processing tab indicator when active
  const tabs = [
    ["new", "⚡ New Clip"],
    ["processing", isProcessing ? "⏳ Processing" : job?.status === "done" ? "✅ Results" : "📊 Status"],
    ["history", "📂 Past Projects"],
  ];

  if (!authed) return <LoginScreen onLogin={() => setAuthed(true)} />;
  return (
    <div style={{
      minHeight: "100vh",
      background: "radial-gradient(ellipse at 20% 20%, #1a0533 0%, #07070f 50%, #001a0f 100%)",
      fontFamily: "'Space Grotesk', sans-serif", color: "#fff",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Syne:wght@700;800&display=swap');
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: #0a0a1a; }
        ::-webkit-scrollbar-thumb { background: #7c3aed; border-radius: 3px; }
        input { outline: none; }
        input::placeholder { color: #555; }
      `}</style>

      <div style={{ maxWidth: 720, margin: "0 auto", padding: "2rem 1.5rem" }}>

        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: "2rem" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.75rem", marginBottom: "0.5rem" }}>
            <span style={{ fontSize: "2rem" }}>✂️</span>
            <h1 style={{
              fontFamily: "'Syne', sans-serif", fontSize: "2.5rem", fontWeight: 800, margin: 0,
              background: "linear-gradient(135deg, #a855f7, #00ff87)",
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent"
            }}>ClipForge</h1>
          </div>
          <p style={{ color: "#7070a0", margin: 0, fontSize: "0.95rem" }}>
            Drop a YouTube URL. Get viral-ready short clips with burned captions.
          </p>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, marginBottom: "1.5rem", background: "#0f0f23", borderRadius: 12, padding: 4 }}>
          {tabs.map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)} style={{
              flex: 1, padding: "0.6rem", border: "none", borderRadius: 9, cursor: "pointer",
              fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: "0.85rem",
              background: tab === key
                ? key === "processing" && isProcessing
                  ? "linear-gradient(135deg, #7c3aed, #ffdd57)"
                  : "linear-gradient(135deg, #7c3aed, #a855f7)"
                : "transparent",
              color: tab === key ? "#fff" : "#666",
              transition: "all 0.2s",
              position: "relative"
            }}>
              {label}
              {/* Pulse dot for active processing */}
              {key === "processing" && isProcessing && tab !== "processing" && (
                <span style={{
                  position: "absolute", top: 6, right: 6,
                  width: 7, height: 7, borderRadius: "50%",
                  background: "#00ff87",
                  boxShadow: "0 0 6px #00ff87",
                  animation: "pulse 1.5s infinite"
                }} />
              )}
            </button>
          ))}
        </div>

        <style>{`
          @keyframes pulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.5; transform: scale(1.3); }
          }
        `}</style>

        {/* ── NEW CLIP TAB ── */}
        {tab === "new" && (
          <div style={{
            background: "linear-gradient(135deg, #0f0f23, #1a1a3e)",
            border: "1px solid #2d2d5e", borderRadius: 20, padding: "1.75rem"
          }}>
            <label style={{ color: "#9090c0", fontSize: "0.8rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>
              YouTube URL
            </label>
            <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.4rem", marginBottom: "1.25rem" }}>
              <input value={url} onChange={e => setUrl(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSubmit()}
                placeholder="https://youtube.com/watch?v=..."
                style={{
                  flex: 1, background: "#07070f", border: "1px solid #2d2d5e",
                  borderRadius: 10, padding: "0.75rem 1rem", color: "#fff", fontSize: "0.9rem"
                }}
                onFocus={e => e.target.style.borderColor = "#7c3aed"}
                onBlur={e => e.target.style.borderColor = "#2d2d5e"}
              />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem", marginBottom: "1.5rem" }}>
              {[
                { label: "Max Clips", value: maxClips, set: setMaxClips, min: 1, max: 10 },
                { label: "Min Duration (s)", value: minDur, set: setMinDur, min: 15, max: 60 },
                { label: "Max Duration (s)", value: maxDur, set: setMaxDur, min: 30, max: 180 },
              ].map(({ label, value, set, min, max }) => (
                <div key={label}>
                  <label style={{ color: "#9090c0", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>
                    {label}
                  </label>
                  <input type="number" value={value} onChange={e => set(Number(e.target.value))}
                    min={min} max={max} style={{
                      width: "100%", background: "#07070f", border: "1px solid #2d2d5e",
                      borderRadius: 8, padding: "0.6rem 0.75rem", color: "#fff",
                      fontSize: "0.9rem", marginTop: "0.3rem"
                    }} />
                </div>
              ))}
            </div>
            {error && (
              <div style={{
                background: "#ff000015", border: "1px solid #ff000040", borderRadius: 8,
                padding: "0.6rem 0.9rem", color: "#ff8888", fontSize: "0.85rem", marginBottom: "1rem"
              }}>⚠ {error}</div>
            )}
            <button onClick={handleSubmit} style={{
              width: "100%", background: "linear-gradient(135deg, #7c3aed, #a855f7)",
              color: "#fff", border: "none", borderRadius: 12, padding: "0.9rem",
              fontSize: "1rem", fontWeight: 700, cursor: "pointer", letterSpacing: 0.5,
              boxShadow: "0 4px 24px #7c3aed55"
            }}>⚡ Forge Clips</button>
          </div>
        )}

        {/* ── PROCESSING TAB ── */}
        {tab === "processing" && (
          <ProcessingTab job={job} onDone={reset} />
        )}

        {/* ── HISTORY TAB ── */}
        {tab === "history" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
              <div>
                <h2 style={{
                  fontFamily: "'Syne', sans-serif", margin: "0 0 0.2rem",
                  background: "linear-gradient(135deg, #a855f7, #00ff87)",
                  WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent"
                }}>Past Projects</h2>
                <p style={{ color: "#7070a0", margin: 0, fontSize: "0.85rem" }}>
                  {pastJobs.length} total · Click any processing job to track it live
                </p>
              </div>
              <button onClick={fetchPastJobs} style={{
                background: "#1a1a3e", border: "1px solid #2d2d5e", color: "#a855f7",
                borderRadius: 8, padding: "0.5rem 1rem", cursor: "pointer", fontSize: "0.85rem"
              }}>↻ Refresh</button>
            </div>
            {pastJobs.length === 0 ? (
              <div style={{
                background: "#0f0f23", border: "1px solid #2d2d5e", borderRadius: 16,
                padding: "3rem", textAlign: "center", color: "#444"
              }}>No past jobs yet. Go forge some clips!</div>
            ) : (
              pastJobs.map(j => (
                <JobHistoryCard key={j.job_id} job={j} onResume={handleRetry} onViewLive={handleViewLive} />
              ))
            )}
          </div>
        )}

      </div>
    </div>
  );
}

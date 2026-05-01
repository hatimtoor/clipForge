import { useState, useEffect, useRef } from "react";

const API = "";
const authFetch = (url, options = {}) => {
  const auth = sessionStorage.getItem("cf_auth");
  return fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), ...(auth ? { Authorization: auth } : {}) },
  });
};

const scoreColor = (s) => s >= 8 ? "#00ff87" : s >= 6 ? "#ffdd57" : "#ff6b6b";
const formatTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const timeAgo = (iso) => {
  if (!iso) return "";
  const diff = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
};

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
      sessionStorage.setItem("cf_auth", auth);
      onLogin();
    }
    setLoading(false);
  };
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center",
                  justifyContent: "center", background: "#07070f", fontFamily: "sans-serif" }}>
      <div style={{ background: "#0f0f23", border: "1px solid #2d2d5e", borderRadius: 20,
                    padding: "2.5rem", width: 380, textAlign: "center" }}>
        <h1 style={{ color: "#fff", margin: "0 0 0.25rem" }}>ClipForge</h1>
        <p style={{ color: "#555", margin: "0 0 2rem" }}>Sign in to continue</p>
        <input value={user} onChange={e => setUser(e.target.value)} placeholder="Username"
          style={{ width: "100%", background: "#0a0a1a", border: "1px solid #2d2d5e",
                   borderRadius: 10, padding: "0.75rem 1rem", color: "#fff",
                   marginBottom: "0.75rem", boxSizing: "border-box" }} />
        <input value={pass} onChange={e => setPass(e.target.value)} type="password"
          placeholder="Password" onKeyDown={e => e.key === "Enter" && attempt()}
          style={{ width: "100%", background: "#0a0a1a", border: "1px solid #2d2d5e",
                   borderRadius: 10, padding: "0.75rem 1rem", color: "#fff",
                   marginBottom: "1rem", boxSizing: "border-box" }} />
        {err && <p style={{ color: "#ff6b6b", fontSize: "0.8rem", margin: "0 0 1rem" }}>{err}</p>}
        <button onClick={attempt} disabled={loading}
          style={{ width: "100%", background: "linear-gradient(135deg, #7c3aed, #a855f7)",
                   color: "#fff", border: "none", borderRadius: 10, padding: "0.75rem",
                   fontSize: "0.95rem", fontWeight: 700, cursor: "pointer" }}>
          {loading ? "Signing in..." : "Sign In"}
        </button>
      </div>
    </div>
  );
}

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

  const fetchPastJobs = async () => {
    try {
      const res = await authFetch("/api/jobs");
      const data = await res.json();
      setPastJobs(data.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
    } catch (e) {}
  };

  useEffect(() => { fetchPastJobs(); }, []);

  const handleSubmit = async () => {
    if (!url.trim()) { setError("Paste a YouTube URL first."); return; }
    setError(""); setLoading(true); setTab("processing");
    setJob({ status: "downloading", progress: 5, message: "Starting...", clips: [], error: null });
    try {
      const res = await authFetch("/api/clip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, max_clips: maxClips, min_duration: minDur, max_duration: maxDur }),
      });
      const data = await res.json();
      setJobId(data.job_id);
    } catch (e) {
      setError("Failed to start job. Is the server running?");
      setLoading(false); setTab("new");
    }
  };

  const reset = () => {
    setUrl(""); setJob(null); setJobId(null);
    setLoading(false); setError(""); setTab("new");
    clearInterval(pollRef.current);
  };

  const tabs = [["new", "New Clip"], ["processing", "Processing"], ["history", "Past Projects"]];
  if (!authed) return <LoginScreen onLogin={() => setAuthed(true)} />;

  return (
    <div style={{ minHeight: "100vh", background: "#07070f", color: "#fff", fontFamily: "sans-serif" }}>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "2rem 1.5rem" }}>
        <h1 style={{ textAlign: "center" }}>ClipForge</h1>
        <div style={{ display: "flex", gap: 4, marginBottom: "1.5rem",
                      background: "#0f0f23", borderRadius: 12, padding: 4 }}>
          {tabs.map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              style={{ flex: 1, padding: "0.6rem", border: "none", borderRadius: 9,
                       cursor: "pointer", fontWeight: 600,
                       background: tab === key ? "#7c3aed" : "transparent",
                       color: tab === key ? "#fff" : "#666" }}>
              {label}
            </button>
          ))}
        </div>
        {tab === "new" && (
          <div style={{ background: "#0f0f23", border: "1px solid #2d2d5e",
                        borderRadius: 16, padding: "1.75rem" }}>
            <input value={url} onChange={e => setUrl(e.target.value)}
              placeholder="https://youtube.com/watch?v=..."
              style={{ width: "100%", background: "#07070f", border: "1px solid #2d2d5e",
                       borderRadius: 10, padding: "0.75rem", color: "#fff",
                       marginBottom: "1rem", boxSizing: "border-box" }} />
            {error && <p style={{ color: "#ff8888" }}>{error}</p>}
            <button onClick={handleSubmit}
              style={{ width: "100%", background: "#7c3aed", color: "#fff",
                       border: "none", borderRadius: 12, padding: "0.9rem",
                       fontWeight: 700, cursor: "pointer" }}>
              Forge Clips
            </button>
          </div>
        )}
        {tab === "processing" && (
          <div style={{ background: "#0f0f23", border: "1px solid #2d2d5e",
                        borderRadius: 16, padding: "1.75rem" }}>
            <p style={{ color: "#a855f7" }}>Processing...</p>
            {job && <p style={{ color: "#888" }}>{job.message}</p>}
          </div>
        )}
        {tab === "history" && (
          <div>
            <h2>Past Projects</h2>
            {pastJobs.length === 0
              ? <p style={{ color: "#444" }}>No jobs yet.</p>
              : pastJobs.map(j => (
                <div key={j.job_id} style={{ background: "#0f0f23", border: "1px solid #2d2d5e",
                                              borderRadius: 12, padding: "1rem", marginBottom: "0.75rem" }}>
                  <span style={{ color: "#a855f7", fontWeight: 700 }}>{j.status}</span>
                  <span style={{ color: "#555", marginLeft: 8, fontSize: "0.85rem" }}>
                    {timeAgo(j.created_at)}
                  </span>
                  <p style={{ color: "#888", margin: "0.25rem 0 0", fontSize: "0.8rem" }}>{j.url}</p>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

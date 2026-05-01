import { useState } from "react";

const API = "";

const authFetch = (url, options = {}) => {
  const auth = sessionStorage.getItem("cf_auth");
  return fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), ...(auth ? { Authorization: auth } : {}) },
  });
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
      if (res.status === 401) { setErr("Invalid credentials."); setLoading(false); return; }
      sessionStorage.setItem("cf_auth", auth);
      onLogin();
    } catch (e) {
      sessionStorage.setItem("cf_auth", auth);
      onLogin();
    }
    setLoading(false);
  };

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "#07070f", fontFamily: "sans-serif",
    }}>
      <div style={{ background: "#0f0f23", border: "1px solid #2d2d5e", borderRadius: 16,
                    padding: "2rem", width: 340, textAlign: "center" }}>
        <h1 style={{ color: "#fff", marginBottom: "1.5rem" }}>ClipForge</h1>
        <input value={user} onChange={e => setUser(e.target.value)} placeholder="Username"
          style={{ width: "100%", background: "#07070f", border: "1px solid #2d2d5e",
                   borderRadius: 8, padding: "0.75rem", color: "#fff", marginBottom: "0.75rem",
                   boxSizing: "border-box" }} />
        <input value={pass} onChange={e => setPass(e.target.value)} type="password"
          placeholder="Password" onKeyDown={e => e.key === "Enter" && attempt()}
          style={{ width: "100%", background: "#07070f", border: "1px solid #2d2d5e",
                   borderRadius: 8, padding: "0.75rem", color: "#fff", marginBottom: "1rem",
                   boxSizing: "border-box" }} />
        {err && <p style={{ color: "#ff6b6b", fontSize: "0.85rem", margin: "0 0 1rem" }}>{err}</p>}
        <button onClick={attempt} disabled={loading}
          style={{ width: "100%", background: "#7c3aed", color: "#fff", border: "none",
                   borderRadius: 8, padding: "0.75rem", cursor: "pointer", fontWeight: 700 }}>
          {loading ? "Signing in..." : "Sign In"}
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [authed, setAuthed] = useState(!!sessionStorage.getItem("cf_auth"));
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [jobId, setJobId] = useState(null);

  if (!authed) return <LoginScreen onLogin={() => setAuthed(true)} />;

  const handleSubmit = async () => {
    if (!url.trim()) { setError("Paste a YouTube URL first."); return; }
    setError(""); setLoading(true);
    try {
      const res = await authFetch("/api/clip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      setJobId(data.job_id);
    } catch (e) {
      setError("Failed to start job.");
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#07070f", color: "#fff",
                  fontFamily: "sans-serif", display: "flex", alignItems: "center",
                  justifyContent: "center" }}>
      <div style={{ width: 500 }}>
        <h1 style={{ textAlign: "center", marginBottom: "2rem" }}>ClipForge</h1>
        <input value={url} onChange={e => setUrl(e.target.value)}
          placeholder="https://youtube.com/watch?v=..."
          style={{ width: "100%", background: "#0f0f23", border: "1px solid #2d2d5e",
                   borderRadius: 8, padding: "0.75rem", color: "#fff",
                   marginBottom: "1rem", boxSizing: "border-box" }} />
        {error && <p style={{ color: "#ff6b6b" }}>{error}</p>}
        <button onClick={handleSubmit} disabled={loading}
          style={{ width: "100%", background: "#7c3aed", color: "#fff", border: "none",
                   borderRadius: 8, padding: "0.75rem", cursor: "pointer", fontWeight: 700 }}>
          {loading ? "Processing..." : "Forge Clips"}
        </button>
        {jobId && <p style={{ color: "#00ff87", marginTop: "1rem" }}>Job started: {jobId}</p>}
      </div>
    </div>
  );
}

import { useState, useEffect, useRef } from "react";

const API = "";
const authFetch = (url, options = {}) => {
  const raw = sessionStorage.getItem("cf_auth") ?? "";
  const auth = raw.startsWith("Basic ") ? raw.slice(6) : raw;
  return fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), ...(auth ? { "X-Clip-Auth": auth } : {}) },
  });
};

const scoreColor = (s) => {
  if (s >= 8) return "#16c74a";
  if (s >= 6) return "#f59e0b";
  return "#e53e3e";
};
const scoreTrackColor = (s) => {
  if (s >= 8) return "#16c74a20";
  if (s >= 6) return "#f59e0b20";
  return "#e53e3e20";
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

const KEYFRAMES = `
  @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Outfit:wght@300;400;500;600&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  ::-webkit-scrollbar { width: 6px; }
  ::-webkit-scrollbar-track { background: #000; }
  ::-webkit-scrollbar-thumb { background: #2a2a2a; border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: #3a3a3a; }

  input, button, textarea { outline: none; font-family: 'Outfit', sans-serif; }
  input::placeholder { color: #444; }
  input[type=number]::-webkit-inner-spin-button,
  input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
  input[type=number] { -moz-appearance: textfield; }

  @keyframes shimmer {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(400%); }
  }

  @keyframes pulse-ring {
    0%   { box-shadow: 0 0 0 0 rgba(22, 199, 74, 0.55); }
    70%  { box-shadow: 0 0 0 8px rgba(22, 199, 74, 0); }
    100% { box-shadow: 0 0 0 0 rgba(22, 199, 74, 0); }
  }

  @keyframes fade-up {
    from { opacity: 0; transform: translateY(14px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to   { transform: rotate(360deg); }
  }

  @keyframes slide-in {
    from { opacity: 0; transform: translateY(28px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  @keyframes dot-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50%       { opacity: 0.4; transform: scale(0.7); }
  }

  .clip-card-enter { animation: fade-up 0.4s ease both; }
  .login-card      { animation: slide-in 0.45s cubic-bezier(0.22, 1, 0.36, 1) both; }
`;

// ── Score Ring ────────────────────────────────────────────────────────────────
function ScoreRing({ score }) {
  const r = 24;
  const circ = 2 * Math.PI * r;
  const fill = (score / 10) * circ;
  const color = scoreColor(score);
  const track = scoreTrackColor(score);
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" style={{ flexShrink: 0 }}>
      <circle cx="32" cy="32" r={r} fill="none" stroke={track} strokeWidth="5" />
      <circle cx="32" cy="32" r={r} fill="none" stroke={color} strokeWidth="5"
        strokeDasharray={`${fill} ${circ}`} strokeLinecap="round"
        transform="rotate(-90 32 32)"
        style={{ transition: "stroke-dasharray 1s ease" }} />
      <text x="32" y="37" textAnchor="middle" fill={color}
        style={{ fontSize: "15px", fontFamily: "Space Mono, monospace", fontWeight: 700 }}>
        {score}
      </text>
    </svg>
  );
}

// ── Stage Stepper ─────────────────────────────────────────────────────────────
function StageStepper({ status }) {
  const stages = ["downloading", "transcribing", "analyzing", "clipping", "done"];
  const labels = ["DOWNLOAD", "TRANSCRIBE", "ANALYZE", "CLIP", "DONE"];
  const currentIdx = stages.indexOf(status);
  return (
    <div style={{ display: "flex", alignItems: "center", marginBottom: "1.5rem" }}>
      {stages.map((s, i) => {
        const isDone = i < currentIdx;
        const isActive = i === currentIdx;
        return (
          <div key={s} style={{ display: "flex", alignItems: "center", flex: i < stages.length - 1 ? 1 : "none" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div style={{
                width: 30, height: 30, borderRadius: "50%",
                background: isDone ? "#16c74a" : isActive ? "transparent" : "#111111",
                border: `2px solid ${isDone ? "#16c74a" : isActive ? "#16c74a" : "#2a2a2a"}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "11px", fontFamily: "Space Mono, monospace", fontWeight: 700,
                color: isDone ? "#000" : isActive ? "#16c74a" : "#555",
                transition: "all 0.4s ease",
                animation: isActive ? "pulse-ring 2s ease-out infinite" : "none",
                flexShrink: 0,
              }}>
                {isDone
                  ? <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6l3 3 5-5" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  : i + 1}
              </div>
              <span style={{
                fontSize: "8px", fontFamily: "Space Mono, monospace",
                color: isDone ? "#16c74a" : isActive ? "#fff" : "#444",
                marginTop: 5, letterSpacing: "0.04em",
                transition: "color 0.4s ease",
              }}>{labels[i]}</span>
            </div>
            {i < stages.length - 1 && (
              <div style={{
                flex: 1, height: 2, margin: "0 4px", marginBottom: 14,
                background: "#2a2a2a", position: "relative", overflow: "hidden",
              }}>
                <div style={{
                  position: "absolute", top: 0, left: 0, height: "100%",
                  width: isDone ? "100%" : "0%",
                  background: "#16c74a",
                  transition: "width 0.6s ease",
                }} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Progress Bar ──────────────────────────────────────────────────────────────
function ProgressBar({ progress, inProgress }) {
  return (
    <div style={{
      height: 8, background: "#1a1a1a", borderRadius: 4,
      overflow: "hidden", position: "relative", marginBottom: "0.75rem",
      border: "1px solid #2a2a2a",
    }}>
      <div style={{
        height: "100%", width: `${progress}%`,
        background: "#16c74a",
        borderRadius: 4,
        transition: "width 0.8s cubic-bezier(0.4, 0, 0.2, 1)",
        position: "relative", overflow: "hidden",
      }}>
        {inProgress && (
          <div style={{
            position: "absolute", top: 0, left: 0,
            width: "25%", height: "100%",
            background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.25), transparent)",
            animation: "shimmer 1.8s ease-in-out infinite",
          }} />
        )}
      </div>
    </div>
  );
}

// ── Retro Button (green = primary, red = destructive) ─────────────────────────
function RetroButton({ onClick, children, color = "green", disabled = false, fullWidth = false, small = false }) {
  const [pressed, setPressed] = useState(false);
  const isGreen = color === "green";
  const bg     = disabled ? "#1a1a1a"  : isGreen ? "#16c74a" : "#e53e3e";
  const shadow  = disabled ? "none"    : isGreen ? "3px 3px 0 #0d8a33" : "3px 3px 0 #991b1b";
  const pressShadow             = isGreen ? "1px 1px 0 #0d8a33"  : "1px 1px 0 #991b1b";
  const textColor = isGreen ? "#000" : "#fff";

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseDown={() => !disabled && setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => setPressed(false)}
      style={{
        background: bg,
        color: disabled ? "#555" : textColor,
        border: `2px solid ${disabled ? "#2a2a2a" : bg}`,
        borderRadius: 6,
        padding: small ? "5px 14px" : "0.75rem 1.5rem",
        fontSize: small ? "12px" : "0.95rem",
        fontFamily: "Space Mono, monospace",
        fontWeight: 700,
        letterSpacing: "0.04em",
        cursor: disabled ? "not-allowed" : "pointer",
        width: fullWidth ? "100%" : "auto",
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
        boxShadow: disabled ? "none" : pressed ? pressShadow : shadow,
        transform: pressed ? "translate(2px, 2px)" : "none",
        transition: "transform 0.05s, box-shadow 0.05s, background 0.1s",
        position: "relative", overflow: "hidden",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}

// ── Stepper control (+/- with step) ──────────────────────────────────────────
function Stepper({ label, value, onDecrement, onIncrement, min, max }) {
  const [pressMinus, setPressMinus] = useState(false);
  const [pressPlus, setPressPlus] = useState(false);
  const canDec = value > min;
  const canInc = value < max;

  const btnStyle = (active, color, shadow) => ({
    width: 36, height: 36,
    background: active ? color : "#1a1a1a",
    color: active ? (color === "#16c74a" ? "#000" : "#fff") : "#444",
    border: `2px solid ${active ? color : "#2a2a2a"}`,
    borderRadius: 6,
    fontSize: "1.2rem", fontFamily: "Space Mono, monospace", fontWeight: 700,
    cursor: active ? "pointer" : "not-allowed",
    display: "flex", alignItems: "center", justifyContent: "center",
    flexShrink: 0,
    opacity: active ? 1 : 0.4,
    transition: "transform 0.05s, box-shadow 0.05s",
  });

  return (
    <div>
      <label style={{
        display: "block",
        color: "#666", fontSize: "0.68rem",
        fontFamily: "Space Mono, monospace",
        fontWeight: 700, textTransform: "uppercase",
        letterSpacing: "0.08em", marginBottom: "0.5rem",
      }}>
        {label}
      </label>
      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
        <button
          onClick={() => canDec && onDecrement()}
          disabled={!canDec}
          onMouseDown={() => canDec && setPressMinus(true)}
          onMouseUp={() => setPressMinus(false)}
          onMouseLeave={() => setPressMinus(false)}
          style={{
            ...btnStyle(canDec, "#e53e3e", "#991b1b"),
            boxShadow: canDec ? (pressMinus ? "1px 1px 0 #991b1b" : "3px 3px 0 #991b1b") : "none",
            transform: pressMinus ? "translate(2px, 2px)" : "none",
          }}
        >−</button>

        <div style={{
          flex: 1, textAlign: "center",
          background: "#111111",
          border: "2px solid #2a2a2a",
          borderRadius: 6,
          padding: "0.45rem 0.25rem",
          color: "#fff",
          fontSize: "1.05rem", fontFamily: "Space Mono, monospace", fontWeight: 700,
        }}>
          {value}
        </div>

        <button
          onClick={() => canInc && onIncrement()}
          disabled={!canInc}
          onMouseDown={() => canInc && setPressPlus(true)}
          onMouseUp={() => setPressPlus(false)}
          onMouseLeave={() => setPressPlus(false)}
          style={{
            ...btnStyle(canInc, "#16c74a", "#0d8a33"),
            boxShadow: canInc ? (pressPlus ? "1px 1px 0 #0d8a33" : "3px 3px 0 #0d8a33") : "none",
            transform: pressPlus ? "translate(2px, 2px)" : "none",
          }}
        >+</button>
      </div>
    </div>
  );
}

// ── Download button (outline green) ──────────────────────────────────────────
function DownloadButton({ href, filename }) {
  const [pressed, setPressed] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async (e) => {
    e.stopPropagation();
    if (downloading) return;
    setDownloading(true);
    try {
      const res = await authFetch(href);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || href.split("/").pop();
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch {}
    setDownloading(false);
  };

  return (
    <button
      onClick={handleDownload}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => setPressed(false)}
      disabled={downloading}
      style={{
        background: "transparent",
        color: downloading ? "#555" : "#16c74a",
        border: `2px solid ${downloading ? "#555" : "#16c74a"}`,
        borderRadius: 6, padding: "4px 12px",
        fontSize: "12px", fontFamily: "Space Mono, monospace",
        fontWeight: 700, cursor: downloading ? "wait" : "pointer",
        textDecoration: "none",
        display: "inline-flex", alignItems: "center", gap: 4,
        whiteSpace: "nowrap", flexShrink: 0,
        boxShadow: downloading ? "none" : pressed ? "1px 1px 0 #0d8a33" : "3px 3px 0 #0d8a33",
        transform: pressed && !downloading ? "translate(2px, 2px)" : "none",
        transition: "transform 0.05s, box-shadow 0.05s",
      }}
    >
      {downloading ? "…" : "↓ Download"}
    </button>
  );
}

// ── Preview button (same style as DownloadButton, filled when active) ─────────
function PreviewButton({ isActive, onClick }) {
  const [pressed, setPressed] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => setPressed(false)}
      style={{
        background: isActive ? "#16c74a" : "transparent",
        color: isActive ? "#000" : "#16c74a",
        border: "2px solid #16c74a",
        borderRadius: 6, padding: "4px 12px",
        fontSize: "12px", fontFamily: "Space Mono, monospace",
        fontWeight: 700, cursor: "pointer",
        display: "inline-flex", alignItems: "center", gap: 4,
        whiteSpace: "nowrap", flexShrink: 0,
        boxShadow: isActive ? "none" : pressed ? "1px 1px 0 #0d8a33" : "3px 3px 0 #0d8a33",
        transform: !isActive && pressed ? "translate(2px, 2px)" : "none",
        transition: "transform 0.05s, box-shadow 0.05s, background 0.15s, color 0.15s",
      }}
    >
      {isActive ? "■ Playing" : "▶ Preview"}
    </button>
  );
}

// ── Clip Card ─────────────────────────────────────────────────────────────────
function ClipCard({ clip, idx, onPreview, isActive }) {
  const [hovered, setHovered] = useState(false);
  const num = String(idx + 1).padStart(2, "0");

  return (
    <div
      className="clip-card-enter"
      style={{
        background: "#111111",
        border: `1px solid ${isActive ? "#16c74a50" : hovered ? "#3a3a3a" : "#2a2a2a"}`,
        borderRadius: 10,
        padding: "1.25rem",
        transition: "border-color 0.2s, transform 0.2s, box-shadow 0.2s",
        transform: hovered ? "translateY(-2px)" : "translateY(0)",
        boxShadow: isActive
          ? "0 0 0 1px #16c74a20, 0 4px 14px rgba(22,199,74,0.12)"
          : hovered ? "0 6px 20px rgba(0,0,0,0.5)" : "0 2px 6px rgba(0,0,0,0.4)",
        animationDelay: `${idx * 80}ms`,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{ display: "flex", gap: "1rem", alignItems: "flex-start" }}>
        <ScoreRing score={clip.virality_score} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{
                background: "#16c74a15",
                color: "#16c74a",
                borderRadius: 4, padding: "2px 8px",
                fontSize: "11px", fontFamily: "Space Mono, monospace", fontWeight: 700,
              }}>
                CLIP {num}
              </span>
              <span style={{ color: "#555", fontSize: "11px", fontFamily: "Outfit, sans-serif" }}>
                {formatTime(clip.start)} → {formatTime(clip.end)} · {clip.duration}s
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5, flexShrink: 0 }}>
              <DownloadButton href={clip.path} filename={clip.filename} />
              <PreviewButton isActive={isActive} onClick={() => onPreview?.(clip)} />
            </div>
          </div>

          <h3 style={{
            color: "#fff", margin: "0.4rem 0 0.2rem",
            fontSize: "0.95rem", fontFamily: "Outfit, sans-serif",
            fontWeight: 600, lineHeight: 1.4,
          }}>
            {clip.title}
          </h3>
          <p style={{
            color: "#888", margin: 0,
            fontSize: "0.8rem", fontFamily: "Outfit, sans-serif",
            lineHeight: 1.55,
          }}>
            {clip.reason}
          </p>

          {clip.tags && clip.tags.length > 0 && (
            <div style={{ display: "flex", gap: 5, marginTop: "0.5rem", flexWrap: "wrap" }}>
              {clip.tags.map(tag => (
                <span key={tag} style={{
                  background: "#1a1a1a", color: "#666",
                  borderRadius: 4, padding: "2px 8px",
                  fontSize: "11px", fontFamily: "Outfit, sans-serif",
                  border: "1px solid #2a2a2a",
                }}>#{tag}</span>
              ))}
            </div>
          )}
        </div>
      </div>

      {clip.hook && (
        <div style={{
          marginTop: "0.875rem",
          borderLeft: "3px solid #16c74a",
          paddingLeft: "0.75rem",
        }}>
          <span style={{
            color: "#16c74a", fontSize: "10px",
            fontFamily: "Space Mono, monospace", fontWeight: 700,
            textTransform: "uppercase", letterSpacing: "0.08em",
          }}>Hook</span>
          <p style={{
            color: "#aaa", margin: "0.2rem 0 0",
            fontSize: "0.85rem", fontStyle: "italic",
            fontFamily: "Outfit, sans-serif", lineHeight: 1.5,
          }}>"{clip.hook}"</p>
        </div>
      )}

    </div>
  );
}

// ── Job History Card ──────────────────────────────────────────────────────────
function JobHistoryCard({ job, onResume, onViewLive, onViewClips }) {
  const [hovered, setHovered] = useState(false);
  const isProcessing = !["done", "error"].includes(job.status);

  const statusStyles = {
    done:  { bg: "#16c74a20", color: "#16c74a" },
    error: { bg: "#e53e3e20", color: "#e53e3e" },
  };
  const st = statusStyles[job.status] || { bg: "#f59e0b20", color: "#f59e0b" };

  return (
    <div
      onClick={() => isProcessing && onViewLive(job)}
      style={{
        background: "#111111",
        border: `1px solid ${hovered ? "#3a3a3a" : "#2a2a2a"}`,
        borderRadius: 8, padding: "0.9rem 1rem",
        marginBottom: "0.5rem",
        transition: "border-color 0.2s, transform 0.15s",
        transform: hovered && isProcessing ? "translateY(-1px)" : "translateY(0)",
        cursor: isProcessing ? "pointer" : "default",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4, flexWrap: "wrap" }}>
            <span style={{
              background: st.bg, color: st.color,
              borderRadius: 4, padding: "2px 8px",
              fontSize: "10px", fontFamily: "Space Mono, monospace",
              fontWeight: 700, textTransform: "uppercase",
            }}>{job.status}</span>
            {isProcessing && (
              <span style={{ display: "flex", alignItems: "center", gap: 4, color: "#f59e0b", fontSize: "11px" }}>
                <span style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: "#f59e0b", display: "inline-block",
                  animation: "dot-pulse 1.2s ease-in-out infinite",
                }} />
                Live
              </span>
            )}
            {job.clips?.length > 0 && (
              <span style={{ color: "#444", fontSize: "11px", fontFamily: "Outfit, sans-serif" }}>
                {job.clips.length} clips
              </span>
            )}
            <span style={{ color: "#444", fontSize: "11px", fontFamily: "Outfit, sans-serif" }}>
              {timeAgo(job.created_at)}
            </span>
          </div>
          <p style={{
            color: "#666", margin: 0, fontSize: "0.78rem",
            fontFamily: "Outfit, sans-serif",
            overflow: "hidden", textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>{job.url || job.job_id}</p>
          {isProcessing && (
            <div style={{ marginTop: "0.5rem" }}>
              <ProgressBar progress={job.progress ?? 0} inProgress />
              <p style={{ color: "#444", fontSize: "0.72rem", fontFamily: "Outfit, sans-serif", margin: 0 }}>
                {job.message}
              </p>
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 7, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
          {job.status === "done" && job.clips?.length > 0 && (
            <RetroButton onClick={() => onViewClips(job)} color="green" small>
              View Clips
            </RetroButton>
          )}
          {job.status === "error" && (
            <RetroButton onClick={() => onResume(job)} color="red" small>Retry</RetroButton>
          )}
        </div>
      </div>

      {job.status === "error" && job.error && (
        <p style={{
          color: "#e53e3e", fontSize: "0.72rem", fontFamily: "Outfit, sans-serif",
          margin: "0.5rem 0 0",
          background: "#e53e3e0d", borderRadius: 4, padding: "0.35rem 0.6rem",
        }}>
          {job.error.split("\n").pop() || job.error}
        </p>
      )}
    </div>
  );
}

// ── Processing Tab ────────────────────────────────────────────────────────────
function ProcessingTab({ job, onDone }) {
  const [activeClip, setActiveClip] = useState(null);
  const [blobUrl, setBlobUrl] = useState(null);
  const [closePressed, setClosePressed] = useState(false);
  const splitRef = useRef(null);

  useEffect(() => {
    if (!activeClip) { setBlobUrl(null); return; }
    setBlobUrl(null);
    let cancelled = false;
    authFetch(activeClip.path)
      .then(r => r.blob())
      .then(b => { if (!cancelled) setBlobUrl(URL.createObjectURL(b)); })
      .catch(() => { if (!cancelled) setBlobUrl(activeClip.path); });
    return () => {
      cancelled = true;
      setBlobUrl(prev => { if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev); return null; });
    };
  }, [activeClip]);

  // Auto-scroll the split container into view when a preview opens
  useEffect(() => {
    if (activeClip && splitRef.current) {
      splitRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [activeClip]);

  const handlePreview = (clip) => {
    if (!clip?.path) return;
    setActiveClip(prev => (prev?.path === clip.path ? null : clip));
  };

  if (!job) return (
    <div style={{
      background: "#111111", border: "1px solid #2a2a2a",
      borderRadius: 10, padding: "3rem", textAlign: "center",
    }}>
      <p style={{ color: "#444", fontFamily: "Outfit, sans-serif", margin: 0 }}>
        No active job. Start a new clip first.
      </p>
    </div>
  );

  if (job.status === "done") {
    const sortedClips = [...job.clips].sort((a, b) => b.virality_score - a.virality_score);
    const previewOpen = activeClip !== null;
    return (
      <div>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
          <div>
            <h2 style={{
              fontFamily: "Space Mono, monospace", fontWeight: 700,
              color: "#fff", margin: "0 0 0.2rem", fontSize: "1.2rem",
            }}>
              <span style={{ color: "#16c74a" }}>{job.clips.length}</span> Clips Ready
            </h2>
            <p style={{ color: "#888", margin: 0, fontSize: "0.85rem", fontFamily: "Outfit, sans-serif" }}>
              Sorted by virality score · TikTok-style captions burned in
            </p>
          </div>
          <RetroButton onClick={onDone} color="red" small>+ New Video</RetroButton>
        </div>

        {/* Split container */}
        <div ref={splitRef} style={{ display: "flex", gap: "0.875rem", alignItems: "flex-start" }}>

          {/* Left: Clips grid */}
          <div style={{
            flex: 1, minWidth: 0,
            display: "grid",
            gridTemplateColumns: previewOpen ? "1fr" : "repeat(2, 1fr)",
            gap: "0.875rem",
          }}>
            {sortedClips.map((clip, i) => (
              <ClipCard
                key={clip.path || i}
                clip={clip}
                idx={i}
                onPreview={handlePreview}
                isActive={activeClip?.path === clip.path}
              />
            ))}
          </div>

          {/* Right: Video panel — slides in/out */}
          <div style={{
            width: previewOpen ? "42%" : "0%",
            overflow: "hidden",
            flexShrink: 0,
            opacity: previewOpen ? 1 : 0,
            transition: "width 0.3s ease, opacity 0.25s ease",
            position: "sticky",
            top: "1rem",
            alignSelf: "flex-start",
          }}>
            <div style={{ minWidth: 180 }}>
              {/* Panel header: title + red close button */}
              <div style={{
                display: "flex", justifyContent: "space-between",
                alignItems: "flex-start", marginBottom: "0.6rem", gap: 8,
              }}>
                <p style={{
                  color: "#fff", margin: 0,
                  fontSize: "0.8rem", fontFamily: "Outfit, sans-serif",
                  fontWeight: 600, lineHeight: 1.4,
                  overflow: "hidden",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                }}>
                  {activeClip?.title}
                </p>
                <button
                  onClick={() => setActiveClip(null)}
                  onMouseDown={() => setClosePressed(true)}
                  onMouseUp={() => setClosePressed(false)}
                  onMouseLeave={() => setClosePressed(false)}
                  title="Close preview"
                  style={{
                    background: "transparent",
                    color: "#e53e3e",
                    border: "2px solid #e53e3e",
                    borderRadius: 6,
                    padding: "4px 10px",
                    flexShrink: 0,
                    cursor: "pointer",
                    fontSize: "12px",
                    fontFamily: "Space Mono, monospace",
                    fontWeight: 700,
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    boxShadow: closePressed ? "1px 1px 0 #991b1b" : "3px 3px 0 #991b1b",
                    transform: closePressed ? "translate(2px, 2px)" : "none",
                    transition: "transform 0.05s, box-shadow 0.05s",
                    whiteSpace: "nowrap",
                  }}
                >× Close</button>
              </div>

              {/* 9:16 video */}
              <div style={{
                aspectRatio: "9 / 16",
                background: "#0a0a0a",
                border: "1px solid #2a2a2a",
                borderRadius: 10, overflow: "hidden",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {blobUrl
                  ? <video key={blobUrl} src={blobUrl} controls autoPlay
                      style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                  : <span style={{ color: "#444", fontSize: "12px", fontFamily: "Outfit, sans-serif", letterSpacing: "0.05em" }}>
                      Loading…
                    </span>
                }
              </div>

              {activeClip && (
                <p style={{ color: "#555", fontSize: "11px", fontFamily: "Outfit, sans-serif", margin: "0.4rem 0 0" }}>
                  {formatTime(activeClip.start)} → {formatTime(activeClip.end)} · {activeClip.duration}s
                </p>
              )}
            </div>
          </div>

        </div>
      </div>
    );
  }

  if (job.status === "error") {
    return (
      <div style={{
        background: "#e53e3e0a", border: "1px solid #e53e3e30",
        borderRadius: 10, padding: "1.75rem", textAlign: "center",
      }}>
        <p style={{ color: "#e53e3e", fontSize: "0.95rem", fontFamily: "Outfit, sans-serif", marginBottom: "1.25rem" }}>
          {job.error?.split("\n").pop() || "Something went wrong."}
        </p>
        <RetroButton onClick={onDone} color="green">Try Again</RetroButton>
      </div>
    );
  }

  const inProgress = !["done", "error"].includes(job.status);
  return (
    <div style={{
      background: "#111111", border: "1px solid #2a2a2a",
      borderRadius: 10, padding: "1.75rem",
    }}>
      <h2 style={{
        fontFamily: "Space Mono, monospace", fontWeight: 700,
        color: "#16c74a", margin: "0 0 0.2rem", fontSize: "1rem",
        letterSpacing: "0.04em",
      }}>
        Processing...
      </h2>
      {job.url && (
        <p style={{
          color: "#444", fontSize: "0.75rem", fontFamily: "Outfit, sans-serif",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          margin: "0 0 1.5rem",
        }}>{job.url}</p>
      )}
      <StageStepper status={job.status} />
      <ProgressBar progress={job.progress ?? 0} inProgress={inProgress} />
      <p style={{
        color: "#16c74a", fontSize: "0.8rem", textAlign: "center",
        fontFamily: "Space Mono, monospace",
        margin: "0.5rem 0 1rem", letterSpacing: "0.03em",
      }}>{job.message}</p>
      <p style={{
        color: "#444", fontSize: "0.78rem", fontFamily: "Outfit, sans-serif",
        textAlign: "center", margin: 0,
      }}>
        Transcription may take 5–10 minutes depending on video length.
      </p>
    </div>
  );
}

// ── Login Input ───────────────────────────────────────────────────────────────
function LoginInput({ style = {}, ...props }) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ position: "relative", ...style }}>
      <input
        {...props}
        style={{
          width: "100%", background: "#000",
          border: `2px solid ${focused ? "#16c74a" : "#2a2a2a"}`,
          borderRadius: 6, padding: "0.75rem 1rem",
          color: "#fff", fontSize: "0.9rem",
          fontFamily: "Outfit, sans-serif",
          boxSizing: "border-box",
          transition: "border-color 0.15s",
        }}
        onFocus={e => { setFocused(true); props.onFocus?.(e); }}
        onBlur={e => { setFocused(false); props.onBlur?.(e); }}
      />
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
    const auth = btoa(user + ":" + pass);
    try {
      const res = await fetch("/api/jobs", { headers: { "X-Clip-Auth": auth } });
      if (res.status === 401) { setErr("Invalid username or password."); setLoading(false); return; }
      sessionStorage.setItem("cf_auth", auth);
      onLogin();
    } catch (e) {
      setErr("Cannot reach server."); setLoading(false); return;
    }
    setLoading(false);
  };

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "#000",
      backgroundImage: `
        linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)
      `,
      backgroundSize: "40px 40px",
      fontFamily: "Outfit, sans-serif",
    }}>
      <style>{KEYFRAMES}</style>
      <div className="login-card" style={{
        background: "#111111",
        border: "2px solid #2a2a2a",
        borderRadius: 10,
        padding: "2.5rem 2.25rem",
        width: "100%", maxWidth: 380,
        boxShadow: "6px 6px 0 #1a1a1a",
      }}>
        <div style={{ textAlign: "center", marginBottom: "2rem" }}>
          <div style={{ marginBottom: "0.5rem" }}>
            <span style={{ fontFamily: "Space Mono, monospace", fontWeight: 700, fontSize: "2rem", color: "#16c74a" }}>CLIP</span>
            <span style={{ fontFamily: "Space Mono, monospace", fontWeight: 700, fontSize: "2rem", color: "#fff" }}>FORGE</span>
          </div>
          <p style={{ color: "#555", margin: 0, fontSize: "0.85rem" }}>Sign in to continue</p>
        </div>

        <LoginInput value={user} onChange={e => setUser(e.target.value)}
          placeholder="Username" autoComplete="off" style={{ marginBottom: "0.75rem" }} />
        <LoginInput type="password" value={pass} onChange={e => setPass(e.target.value)}
          placeholder="Password" autoComplete="off"
          onKeyDown={e => e.key === "Enter" && attempt()}
          style={{ marginBottom: "1rem" }} />

        {err && (
          <p style={{ color: "#e53e3e", fontSize: "0.8rem", margin: "0 0 1rem", textAlign: "center" }}>
            {err}
          </p>
        )}

        <RetroButton onClick={attempt} disabled={loading} color="green" fullWidth>
          {loading && (
            <span style={{
              width: 14, height: 14, borderRadius: "50%",
              border: "2px solid rgba(0,0,0,0.2)", borderTopColor: "#000",
              display: "inline-block", animation: "spin 0.7s linear infinite",
            }} />
          )}
          {loading ? "Signing in..." : "Sign In"}
        </RetroButton>
      </div>
    </div>
  );
}

// ── Tab Bar ───────────────────────────────────────────────────────────────────
function TabBar({ tabs, activeTab, onSelect }) {
  return (
    <div style={{
      display: "flex", gap: 4,
      marginBottom: "1.5rem",
      borderBottom: "2px solid #1a1a1a",
    }}>
      {tabs.map(([key, label, dot]) => {
        const isActive = activeTab === key;
        return (
          <button key={key} onClick={() => onSelect(key)} style={{
            flex: 1, padding: "0.65rem 0.5rem",
            border: "none",
            borderBottom: isActive ? "2px solid #16c74a" : "2px solid transparent",
            background: isActive ? "#111111" : "transparent",
            borderRadius: "6px 6px 0 0",
            color: isActive ? "#fff" : "#555",
            fontSize: "0.85rem", fontFamily: "Outfit, sans-serif",
            fontWeight: isActive ? 600 : 400,
            cursor: "pointer",
            transition: "color 0.15s, background 0.15s, border-bottom-color 0.15s",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            marginBottom: "-2px",
          }}
          onMouseEnter={e => { if (!isActive) e.currentTarget.style.color = "#888"; }}
          onMouseLeave={e => { if (!isActive) e.currentTarget.style.color = "#555"; }}
          >
            {label}
            {dot && (
              <span style={{
                width: 6, height: 6, borderRadius: "50%",
                background: "#16c74a", display: "inline-block",
                animation: "dot-pulse 1.2s ease-in-out infinite",
              }} />
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── URL Input ─────────────────────────────────────────────────────────────────
function UrlInput({ value, onChange, onKeyDown }) {
  const [focused, setFocused] = useState(false);
  return (
    <input
      value={value} onChange={onChange} onKeyDown={onKeyDown}
      placeholder="https://youtube.com/watch?v=..."
      style={{
        width: "100%", background: "#000",
        border: `2px solid ${focused ? "#16c74a" : "#2a2a2a"}`,
        borderRadius: 6, padding: "0.9rem 1rem",
        color: "#fff", fontSize: "1rem",
        fontFamily: "Outfit, sans-serif",
        outline: "none", boxSizing: "border-box",
        transition: "border-color 0.15s",
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    />
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

  useEffect(() => { if (authed) fetchPastJobs(); }, [authed]);
  useEffect(() => { if (authed && tab === "history") fetchPastJobs(); }, [tab]);
  useEffect(() => {
    if (!authed) return;
    const interval = setInterval(fetchPastJobs, 10000);
    return () => clearInterval(interval);
  }, [authed]);

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
    setJobId(j.job_id); setJob(j);
    setLoading(true); setTab("processing");
  };
  const handleViewClips = (j) => {
    clearInterval(pollRef.current);
    setJobId(j.job_id);
    setJob(j);
    setLoading(false);
    setTab("processing");
  };

  const tabs = [
    ["new", "New Clip", false],
    ["processing", isProcessing ? "Processing" : job?.status === "done" ? "Results" : "Status", isProcessing],
    ["history", "Past Projects", false],
  ];

  if (!authed) return <LoginScreen onLogin={() => setAuthed(true)} />;

  return (
    <div style={{
      minHeight: "100vh",
      background: "#000",
      backgroundImage: `
        linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)
      `,
      backgroundSize: "48px 48px",
      color: "#fff",
      fontFamily: "Outfit, sans-serif",
    }}>
      <style>{KEYFRAMES}</style>
      <div style={{ maxWidth: 740, margin: "0 auto", padding: "0 1.25rem 3rem" }}>

        {/* Header */}
        <header style={{
          display: "flex", justifyContent: "space-between", alignItems: "flex-start",
          padding: "1.75rem 0 1.5rem",
          borderBottom: "2px solid #1a1a1a",
          marginBottom: "1.75rem",
        }}>
          <div>
            <div style={{ marginBottom: "0.2rem" }}>
              <span style={{ fontFamily: "Space Mono, monospace", fontWeight: 700, fontSize: "1.6rem", color: "#16c74a" }}>CLIP</span>
              <span style={{ fontFamily: "Space Mono, monospace", fontWeight: 700, fontSize: "1.6rem", color: "#fff" }}>FORGE</span>
            </div>
            <p style={{ color: "#444", margin: 0, fontSize: "0.8rem", fontFamily: "Outfit, sans-serif" }}>
              Drop a YouTube URL. Get viral-ready short clips.
            </p>
          </div>
          <button
            title="Sign out"
            onClick={() => { sessionStorage.clear(); window.location.reload(); }}
            style={{
              background: "transparent", border: "2px solid #2a2a2a",
              color: "#555", borderRadius: 6,
              padding: "0.4rem 0.7rem",
              cursor: "pointer", fontSize: "1rem", lineHeight: 1,
              transition: "border-color 0.15s, color 0.15s",
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = "#e53e3e"; e.currentTarget.style.color = "#e53e3e"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = "#2a2a2a"; e.currentTarget.style.color = "#555"; }}
          >⎋</button>
        </header>

        {/* Tabs */}
        <TabBar tabs={tabs} activeTab={tab} onSelect={setTab} />

        {/* ── NEW CLIP ── */}
        {tab === "new" && (
          <div style={{
            background: "#111111", border: "2px solid #2a2a2a",
            borderRadius: 10, padding: "1.75rem",
            boxShadow: "4px 4px 0 #1a1a1a",
          }}>
            <label style={{
              display: "block", color: "#555",
              fontSize: "0.68rem", fontFamily: "Space Mono, monospace",
              fontWeight: 700, textTransform: "uppercase",
              letterSpacing: "0.08em", marginBottom: "0.5rem",
            }}>
              YouTube URL
            </label>
            <div style={{ marginBottom: "1.5rem" }}>
              <UrlInput value={url} onChange={e => setUrl(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSubmit()} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem", marginBottom: "1.5rem" }}>
              <Stepper
                label="Max Clips"
                value={maxClips}
                onDecrement={() => setMaxClips(v => Math.max(1, v - 1))}
                onIncrement={() => setMaxClips(v => Math.min(10, v + 1))}
                min={1} max={10}
              />
              <Stepper
                label="Min Dur (s)"
                value={minDur}
                onDecrement={() => setMinDur(v => Math.max(15, v - 10))}
                onIncrement={() => setMinDur(v => Math.min(60, v + 10))}
                min={15} max={60}
              />
              <Stepper
                label="Max Dur (s)"
                value={maxDur}
                onDecrement={() => setMaxDur(v => Math.max(30, v - 10))}
                onIncrement={() => setMaxDur(v => Math.min(180, v + 10))}
                min={30} max={180}
              />
            </div>

            {error && (
              <div style={{
                background: "#e53e3e0d", border: "1px solid #e53e3e30",
                borderRadius: 6, padding: "0.6rem 0.9rem",
                color: "#e53e3e", fontSize: "0.85rem",
                fontFamily: "Outfit, sans-serif", marginBottom: "1rem",
              }}>
                {error}
              </div>
            )}

            <RetroButton onClick={handleSubmit} color="green" fullWidth>
              FORGE CLIPS
            </RetroButton>
          </div>
        )}

        {/* ── PROCESSING ── */}
        {tab === "processing" && <ProcessingTab job={job} onDone={reset} />}

        {/* ── HISTORY ── */}
        {tab === "history" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
              <div>
                <h2 style={{ fontFamily: "Space Mono, monospace", fontWeight: 700, color: "#fff", margin: "0 0 0.2rem", fontSize: "1.1rem" }}>
                  Past Projects
                </h2>
                <p style={{ color: "#888", margin: 0, fontSize: "0.82rem", fontFamily: "Outfit, sans-serif" }}>
                  {pastJobs.length} total · Click any active job to track live
                </p>
              </div>
              <button title="Refresh" onClick={fetchPastJobs} style={{
                background: "transparent", border: "2px solid #2a2a2a",
                color: "#555", borderRadius: 6,
                padding: "0.4rem 0.65rem",
                cursor: "pointer", fontSize: "1rem", lineHeight: 1,
                transition: "border-color 0.15s, color 0.15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "#16c74a"; e.currentTarget.style.color = "#16c74a"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "#2a2a2a"; e.currentTarget.style.color = "#555"; }}
              >↻</button>
            </div>
            {pastJobs.length === 0 ? (
              <div style={{ textAlign: "center", padding: "4rem 2rem" }}>
                <p style={{ color: "#333", fontFamily: "Outfit, sans-serif", margin: 0 }}>
                  No past jobs yet. Go forge some clips.
                </p>
              </div>
            ) : (
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: "0.75rem",
                justifyContent: "center",
              }}>
                {pastJobs.map(j => (
                  <JobHistoryCard key={j.job_id} job={j} onResume={handleRetry} onViewLive={handleViewLive} onViewClips={handleViewClips} />
                ))}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}

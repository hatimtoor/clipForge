import { useState, useRef, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { C, SHADOW_SM, BORDER } from "../lib/theme";
import { PixelSprite, ANVIL, ANVIL_PAL } from "./ui";
import { useApp } from "../context/AppContext";
import { supabase, authFetch } from "../lib/supabase";
import { useMobile } from "../hooks/useMobile";

export default function Header() {
  const { profile, isPro, ytStatus, refreshYtStatus, jobActive } = useApp();
  const location = useLocation();
  const navigate = useNavigate();
  const [ytError, setYtError] = useState("");
  const [ytDropdownOpen, setYtDropdownOpen] = useState(false);
  const [ytHoverRow, setYtHoverRow] = useState(null);
  const [ytHoverDisconnect, setYtHoverDisconnect] = useState(null);
  const [ytHoverConnect, setYtHoverConnect] = useState(false);
  const ytDropdownRef = useRef(null);
  const isMobile = useMobile();

  const path = location.pathname.replace("/", "") || "hello";
  const ytConnected = ytStatus?.connected;
  const ytChannels = ytStatus?.channels || [];

  useEffect(() => {
    if (!ytDropdownOpen) return;
    const handler = (e) => {
      if (ytDropdownRef.current && !ytDropdownRef.current.contains(e.target)) {
        setYtDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [ytDropdownOpen]);

  const handleDisconnectYouTube = async (yt_channel_id) => {
    const label = yt_channel_id ? "this YouTube channel" : "your YouTube channel";
    if (!window.confirm(`Disconnect ${label}?`)) return;
    try {
      const url = yt_channel_id
        ? `/api/youtube/disconnect?yt_channel_id=${encodeURIComponent(yt_channel_id)}`
        : "/api/youtube/disconnect";
      await authFetch(url, { method: "DELETE" });
      refreshYtStatus();
    } catch { setYtError("Could not disconnect. Try again."); }
  };

  const handleConnectYouTube = async () => {
    setYtError("");
    setYtDropdownOpen(false);
    try {
      const res = await authFetch("/api/youtube/auth");
      const data = await res.json();
      if (!res.ok) { setYtError(data.detail || "YouTube auth failed."); return; }
      if (!data.auth_url) { setYtError("No auth URL returned."); return; }
      window.open(data.auth_url, "youtube_auth", "width=600,height=700,scrollbars=yes,resizable=yes");
      const onMsg = (e) => {
        if (e.data?.type === "youtube_auth_success") {
          window.removeEventListener("message", onMsg);
          refreshYtStatus();
        } else if (e.data?.type === "youtube_auth_error") {
          window.removeEventListener("message", onMsg);
          setYtError(e.data.error || "Auth failed");
        }
      };
      window.addEventListener("message", onMsg);
    } catch { setYtError("Cannot reach server."); }
  };

  const NAV = [
    ["hello",     "HELLO"],
    ["work",      jobActive ? "LIVE" : "WORK"],
    ["watchlist", "WATCHLIST"],
    ["archive",   "ARCHIVE"],
  ];

  return (
    <>
      <header style={{ position: "relative", padding: isMobile ? "14px 16px 0" : "24px 32px 0" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: isMobile ? 12 : 24, maxWidth: 1320, margin: "0 auto", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }} onClick={() => navigate("/hello")}>
            <PixelSprite data={ANVIL} palette={ANVIL_PAL} size={isMobile ? 4 : 5} />
            <div>
              <div className="pixel" style={{ fontSize: isMobile ? 16 : 22, color: C.ink, lineHeight: 1 }}>
                <span style={{ color: C.hotDeep }}>CLIP</span><span>FORGE</span>
              </div>
              {!isMobile && <div className="vt" style={{ fontSize: 18, color: C.dim2, marginTop: 4 }}>{`>`} roll tape to forge</div>}
            </div>
          </div>

          <div style={{ flex: 1 }} />

          <nav style={{ display: "flex", gap: isMobile ? 6 : 10, flexWrap: "wrap", alignItems: "center" }}>
            {NAV.map(([k, l]) => {
              const active = path === k;
              const col = k === "hello" ? C.signal : k === "work" ? C.hot : C.amber;
              return (
                <button key={k} onClick={() => navigate(k === "work" && jobActive ? `/work?job=${jobActive}` : `/${k}`)} className="pixel" style={{
                  background: active ? col : C.cream, color: C.ink,
                  padding: isMobile ? "8px 10px" : "10px 16px",
                  fontSize: isMobile ? 9 : 11, border: BORDER,
                  boxShadow: active ? `0px 0px 0 ${C.ink}` : SHADOW_SM,
                  transform: active ? "translate(3px,3px)" : "translate(0,0)",
                  cursor: "pointer", textTransform: "uppercase", position: "relative",
                }}>
                  {l}
                  {k === "work" && jobActive && <span style={{ display: "inline-block", width: 8, height: 8, background: C.ink, marginLeft: 6, animation: "blink 1s steps(1) infinite" }} />}
                  {k === "watchlist" && !isPro && <span style={{ display: "inline-block", marginLeft: 5, fontSize: 7, color: C.dim }}>PRO</span>}
                </button>
              );
            })}

            {isPro && !isMobile && (
              <div ref={ytDropdownRef} style={{ position: "relative" }}>
                <button
                  onClick={() => setYtDropdownOpen(o => !o)}
                  className="pixel"
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 5,
                    padding: "10px 14px", fontSize: 9,
                    background: ytConnected ? C.yt : C.cream,
                    color: C.ink, border: BORDER, boxShadow: SHADOW_SM,
                    cursor: "pointer", textTransform: "uppercase",
                  }}
                >
                  * YT{ytChannels.length > 0 ? ` (${ytChannels.length})` : ""}
                  <span style={{ fontSize: 7 }}>{ytDropdownOpen ? "▴" : "▾"}</span>
                </button>

                {ytDropdownOpen && (
                  <div className="pixel" style={{
                    position: "absolute", top: "calc(100% + 6px)", right: 0,
                    background: C.cream, border: BORDER, boxShadow: SHADOW_SM,
                    minWidth: 190, zIndex: 200,
                  }}>
                    {ytChannels.map((ch) => (
                      <div key={ch.yt_channel_id} style={{
                        display: "flex", alignItems: "stretch",
                        borderBottom: `2px solid ${C.ink}`,
                      }}>
                        <span
                          onMouseEnter={() => setYtHoverRow(ch.yt_channel_id)}
                          onMouseLeave={() => setYtHoverRow(null)}
                          style={{ flex: 1, padding: "9px 10px", fontSize: 9, color: C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140, cursor: "default", background: ytHoverRow === ch.yt_channel_id ? C.lavender : "transparent", display: "flex", alignItems: "center" }}
                        >
                          * {ch.yt_channel_name || "YT"}
                        </span>
                        <button
                          onClick={() => { handleDisconnectYouTube(ch.yt_channel_id); setYtDropdownOpen(false); }}
                          onMouseEnter={() => setYtHoverDisconnect(ch.yt_channel_id)}
                          onMouseLeave={() => setYtHoverDisconnect(null)}
                          className="pixel"
                          title="Disconnect"
                          style={{
                            padding: "0 10px", borderLeft: `2px solid ${C.ink}`, color: C.ink,
                            fontSize: 9, cursor: "pointer", flexShrink: 0,
                            background: ytHoverDisconnect === ch.yt_channel_id ? C.ytDeep : "transparent",
                          }}
                        >×</button>
                      </div>
                    ))}
                    <button
                      onClick={handleConnectYouTube}
                      onMouseEnter={() => setYtHoverConnect(true)}
                      onMouseLeave={() => setYtHoverConnect(false)}
                      className="pixel"
                      style={{
                        width: "100%", padding: "9px 10px", fontSize: 9,
                        background: ytHoverConnect ? C.signal : "transparent",
                        color: C.ink, textAlign: "left", cursor: "pointer", display: "block",
                      }}
                    >+ connect channel</button>
                  </div>
                )}
              </div>
            )}

            {!isPro && (
              <span className="pixel" style={{ padding: isMobile ? "5px 8px" : "6px 10px", fontSize: 8, background: C.amber, color: C.ink, border: BORDER, boxShadow: SHADOW_SM }}>
                FREE {profile.clips_used}/{profile.clips_limit}
              </span>
            )}

            <button onClick={() => supabase.auth.signOut()} className="pixel" title="Sign out"
              style={{ padding: isMobile ? "8px 10px" : "10px 12px", fontSize: isMobile ? 9 : 11, background: C.cream, color: C.ink, border: BORDER, boxShadow: SHADOW_SM, cursor: "pointer" }}>X</button>
          </nav>
        </div>
      </header>

      {ytError && (
        <div style={{ maxWidth: 1320, margin: "0 auto", padding: isMobile ? "0 16px" : "0 32px" }}>
          <div className="pixel" style={{ padding: "10px 14px", background: `${C.hot}55`, border: `2px solid ${C.hotDeep}`, color: C.hotDeep, fontSize: 9, marginTop: 14 }}>! {ytError}</div>
        </div>
      )}
    </>
  );
}

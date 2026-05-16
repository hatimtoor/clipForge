import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { C, SHADOW_SM, BORDER } from "../lib/theme";
import { PixelSprite, ANVIL, ANVIL_PAL } from "./ui";
import { useApp } from "../context/AppContext";
import { supabase, authFetch } from "../lib/supabase";

export default function Header() {
  const { profile, isPro, ytStatus, refreshYtStatus, jobActive } = useApp();
  const location = useLocation();
  const navigate = useNavigate();
  const [ytError, setYtError] = useState("");

  const path = location.pathname.replace("/", "") || "hello";
  const ytConnected = ytStatus?.connected;

  const handleConnectYouTube = async () => {
    setYtError("");
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
      <header style={{ position: "relative", padding: "24px 32px 0" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 24, maxWidth: 1320, margin: "0 auto", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, cursor: "pointer" }} onClick={() => navigate("/hello")}>
            <PixelSprite data={ANVIL} palette={ANVIL_PAL} size={5} />
            <div>
              <div className="pixel" style={{ fontSize: 22, color: C.ink, lineHeight: 1 }}>
                <span style={{ color: C.hotDeep }}>CLIP</span><span>FORGE</span>
              </div>
              <div className="vt" style={{ fontSize: 18, color: C.dim2, marginTop: 4 }}>{`>`} roll tape to forge</div>
            </div>
          </div>

          <div style={{ flex: 1 }} />

          <nav style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            {NAV.map(([k, l]) => {
              const active = path === k;
              const col = k === "hello" ? C.signal : k === "work" ? C.hot : C.amber;
              return (
                <button key={k} onClick={() => navigate(k === "work" && jobActive ? `/work?job=${jobActive}` : `/${k}`)} className="pixel" style={{
                  background: active ? col : C.cream, color: C.ink,
                  padding: "10px 16px", fontSize: 11, border: BORDER,
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

            {isPro && (ytConnected
              ? <span className="pixel" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "10px 14px", fontSize: 9, background: C.yt, color: C.ink, border: BORDER, boxShadow: SHADOW_SM }}>
                  * {ytStatus.channel_name || "YT"}
                </span>
              : <button onClick={handleConnectYouTube} className="pixel" style={{ padding: "10px 14px", fontSize: 9, background: C.cream, color: C.ink, border: BORDER, boxShadow: SHADOW_SM, cursor: "pointer", textTransform: "uppercase" }}>+ YT</button>
            )}

            {!isPro && (
              <span className="pixel" style={{ padding: "6px 10px", fontSize: 8, background: C.amber, color: C.ink, border: BORDER, boxShadow: SHADOW_SM }}>
                FREE {profile.clips_used}/{profile.clips_limit}
              </span>
            )}

            <button onClick={() => supabase.auth.signOut()} className="pixel" title="Sign out"
              style={{ padding: "10px 12px", fontSize: 11, background: C.cream, color: C.ink, border: BORDER, boxShadow: SHADOW_SM, cursor: "pointer" }}>X</button>
          </nav>
        </div>
      </header>

      {ytError && (
        <div style={{ maxWidth: 1320, margin: "0 auto", padding: "0 32px" }}>
          <div className="pixel" style={{ padding: "10px 14px", background: `${C.hot}55`, border: `2px solid ${C.hotDeep}`, color: C.hotDeep, fontSize: 9, marginTop: 14 }}>! {ytError}</div>
        </div>
      )}
    </>
  );
}

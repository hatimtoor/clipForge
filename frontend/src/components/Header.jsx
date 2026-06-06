import { useLocation, useNavigate } from "react-router-dom";
import { C, SHADOW_SM, BORDER } from "../lib/theme";
import { PixelSprite, ANVIL, ANVIL_PAL } from "./ui";
import { useApp } from "../context/AppContext";
import { supabase } from "../lib/supabase";
import { useMobile } from "../hooks/useMobile";

export default function Header() {
  const { profile, isPro, ytStatus, ttStatus, jobActive } = useApp();
  const location = useLocation();
  const navigate = useNavigate();
  const isMobile = useMobile();

  const path = location.pathname.replace("/", "") || "hello";
  const connectedCount = (ytStatus?.channels?.length || 0) + (ttStatus?.accounts?.length || 0);

  const NAV = [
    ["hello",     "HELLO"],
    ["work",      jobActive ? "LIVE" : "WORK"],
    ["watchlist", "WATCHLIST"],
    ["digest",    "DIGEST"],
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
                  {(k === "watchlist" || k === "digest") && !isPro && <span style={{ display: "inline-block", marginLeft: 5, fontSize: 7, color: C.dim }}>PRO</span>}
                </button>
              );
            })}

            {isPro && (
              <button onClick={() => navigate("/connections")} className="pixel" style={{
                background: path === "connections" ? C.lavender : C.cream, color: C.ink,
                padding: isMobile ? "8px 10px" : "10px 16px",
                fontSize: isMobile ? 9 : 11, border: BORDER,
                boxShadow: path === "connections" ? `0px 0px 0 ${C.ink}` : SHADOW_SM,
                transform: path === "connections" ? "translate(3px,3px)" : "translate(0,0)",
                cursor: "pointer", textTransform: "uppercase",
              }}>
                {isMobile ? "LINKS" : "CONNECTIONS"}
                {connectedCount > 0 && <span style={{ display: "inline-block", marginLeft: 6, fontSize: 8, background: C.signal, color: C.ink, padding: "1px 5px", border: `1px solid ${C.ink}` }}>{connectedCount}</span>}
              </button>
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
    </>
  );
}

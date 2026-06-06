import { useState } from "react";
import { C, BORDER, SHADOW_SM, KEYFRAMES } from "../lib/theme";
import { PixelBtn, PixelCard } from "../components/ui";
import Header from "../components/Header";
import { useApp } from "../context/AppContext";
import { authFetch } from "../lib/supabase";
import { useMobile } from "../hooks/useMobile";

export default function ConnectionsPage() {
  const { isPro, ytStatus, refreshYtStatus, ttStatus, refreshTtStatus } = useApp();
  const isMobile = useMobile();
  const [error, setError] = useState("");

  const ytChannels = ytStatus?.channels || [];
  const ttAccounts = ttStatus?.accounts || [];

  // ── OAuth popup helper ──────────────────────────────────────────────────────
  const connect = async (provider) => {
    setError("");
    const isYt = provider === "youtube";
    try {
      const res = await authFetch(`/api/${provider}/auth`);
      const data = await res.json();
      if (!res.ok) { setError(data.detail || `${provider} auth failed.`); return; }
      if (!data.auth_url) { setError("No auth URL returned."); return; }
      window.open(data.auth_url, `${provider}_auth`, "width=600,height=700,scrollbars=yes,resizable=yes");
      const onMsg = (e) => {
        if (e.data?.type === `${provider}_auth_success`) {
          window.removeEventListener("message", onMsg);
          isYt ? refreshYtStatus() : refreshTtStatus();
        } else if (e.data?.type === `${provider}_auth_error`) {
          window.removeEventListener("message", onMsg);
          setError(e.data.error || "Authorization failed.");
        }
      };
      window.addEventListener("message", onMsg);
    } catch { setError("Cannot reach server."); }
  };

  const disconnectYt = async (id) => {
    if (!window.confirm("Disconnect this YouTube channel?")) return;
    try {
      await authFetch(`/api/youtube/disconnect?yt_channel_id=${encodeURIComponent(id)}`, { method: "DELETE" });
      refreshYtStatus();
    } catch { setError("Could not disconnect. Try again."); }
  };

  const disconnectTt = async (id) => {
    if (!window.confirm("Disconnect this TikTok account?")) return;
    try {
      await authFetch(`/api/tiktok/disconnect?tt_open_id=${encodeURIComponent(id)}`, { method: "DELETE" });
      refreshTtStatus();
    } catch { setError("Could not disconnect. Try again."); }
  };

  if (!isPro) {
    return (
      <div style={{ minHeight: "100vh" }}>
        <style>{KEYFRAMES}</style>
        <Header />
        <div className="fade" style={{ padding: isMobile ? "16px 12px" : "64px 32px", maxWidth: 1320, margin: "0 auto", textAlign: "center" }}>
          <div className="pixel" style={{ fontSize: 11, color: C.dim2, marginBottom: 16 }}>PRO ONLY</div>
          <p className="vt" style={{ fontSize: 20, color: C.dim2 }}>Upgrade to Pro to connect your social accounts.</p>
        </div>
      </div>
    );
  }

  const AccountRow = ({ label, sub, onDisconnect }) => (
    <div style={{ display: "flex", alignItems: "stretch", border: BORDER, boxShadow: SHADOW_SM, background: C.paper, marginBottom: 10 }}>
      <div style={{ flex: 1, padding: "12px 14px", minWidth: 0 }}>
        <div className="pixel" style={{ fontSize: 10, color: C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</div>
        {sub && <div className="vt" style={{ fontSize: 14, color: C.dim2, marginTop: 2 }}>{sub}</div>}
      </div>
      <button onClick={onDisconnect} className="pixel" title="Disconnect"
        style={{ padding: "0 16px", borderLeft: BORDER, background: "transparent", color: C.ink, fontSize: 12, cursor: "pointer", flexShrink: 0 }}>×</button>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh" }}>
      <style>{KEYFRAMES}</style>
      <Header />
      <div className="fade" style={{ padding: isMobile ? "16px 12px 48px" : "32px 32px 64px", maxWidth: 900, margin: "0 auto" }}>
        <div style={{ marginBottom: 24 }}>
          <div className="pixel" style={{ fontSize: 10, color: C.dim2, marginBottom: 10 }}>CONNECTIONS</div>
          <h1 className="pixel" style={{ fontSize: isMobile ? 18 : 26, color: C.ink }}>Linked accounts.</h1>
          <p className="vt" style={{ fontSize: 18, color: C.dim2, marginTop: 6 }}>
            Connect the platforms you want to publish clips to. You can link multiple accounts.
          </p>
        </div>

        {error && (
          <div className="pixel" style={{ fontSize: 9, color: C.hotDeep, marginBottom: 16, padding: "10px 12px", background: `${C.hot}44`, border: `2px solid ${C.hotDeep}` }}>
            ! {error}
          </div>
        )}

        {/* YouTube */}
        <PixelCard color={C.cream} padding={isMobile ? 16 : 22} style={{ marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
            <span className="pixel" style={{ fontSize: 11, background: C.yt, color: C.ink, padding: "8px 12px", border: BORDER }}>▶ YOUTUBE</span>
            <span className="vt" style={{ fontSize: 15, color: C.dim2 }}>{ytChannels.length} channel{ytChannels.length === 1 ? "" : "s"} connected</span>
          </div>
          {ytChannels.map(ch => (
            <AccountRow key={ch.yt_channel_id} label={`* ${ch.yt_channel_name || "YouTube"}`} onDisconnect={() => disconnectYt(ch.yt_channel_id)} />
          ))}
          <PixelBtn color="yt" size="md" onClick={() => connect("youtube")}>+ CONNECT YOUTUBE CHANNEL</PixelBtn>
        </PixelCard>

        {/* TikTok */}
        <PixelCard color={C.cream} padding={isMobile ? 16 : 22}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
            <span className="pixel" style={{ fontSize: 11, background: C.ink, color: C.cream, padding: "8px 12px", border: BORDER }}>♪ TIKTOK</span>
            <span className="vt" style={{ fontSize: 15, color: C.dim2 }}>{ttAccounts.length} account{ttAccounts.length === 1 ? "" : "s"} connected</span>
          </div>
          {ttAccounts.map(acc => (
            <AccountRow key={acc.tt_open_id} label={`♪ ${acc.tt_display_name || "TikTok"}`} onDisconnect={() => disconnectTt(acc.tt_open_id)} />
          ))}
          <PixelBtn color="cream" size="md" onClick={() => connect("tiktok")} style={{ background: C.ink, color: C.cream }}>+ CONNECT TIKTOK ACCOUNT</PixelBtn>
        </PixelCard>

        <PixelCard color={C.lavender} padding={16} style={{ marginTop: 18, boxShadow: isMobile ? "none" : undefined }}>
          <div className="pixel" style={{ fontSize: 9, color: C.ink, marginBottom: 6 }}>HOW IT WORKS</div>
          <div className="vt" style={{ fontSize: 16, color: C.ink, lineHeight: 1.5 }}>
            Once connected, you'll see upload buttons on your clips and can pick which account to post to.
            Watchlist and Digest channels can also auto-upload to a connected account.
          </div>
        </PixelCard>
      </div>
    </div>
  );
}

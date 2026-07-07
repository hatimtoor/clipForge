import { useState, useEffect, useRef } from "react";
import { C, BORDER, SHADOW_SM, KEYFRAMES } from "../lib/theme";
import { PixelBtn, PixelCard } from "../components/ui";
import Header from "../components/Header";
import { useApp } from "../context/AppContext";
import { authFetch } from "../lib/supabase";
import { useMobile } from "../hooks/useMobile";
import OnboardingTour from "../components/OnboardingTour";

// ── Brand kit (Pro): watermark logo + brand color for all rendered clips ─────
function BrandKitCard({ isMobile }) {
  const [brand, setBrand] = useState(null);   // {enabled, position, opacity, size, color, has_logo}
  const [logoUrl, setLogoUrl] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const fileRef = useRef(null);

  const loadLogo = async () => {
    try {
      const res = await authFetch("/api/brand/logo");
      if (!res.ok) { setLogoUrl(null); return; }
      const url = URL.createObjectURL(await res.blob());
      setLogoUrl(prev => { if (prev) URL.revokeObjectURL(prev); return url; });
    } catch { setLogoUrl(null); }
  };

  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch("/api/brand");
        const d = await res.json();
        if (res.ok) { setBrand(d); if (d.has_logo) loadLogo(); }
      } catch { /* card stays hidden */ }
    })();
  }, []);
  // Revoke the last blob URL on unmount (the loader revokes prior ones).
  useEffect(() => () => setLogoUrl(prev => { if (prev) URL.revokeObjectURL(prev); return null; }), []);

  const save = async (patch) => {
    // Functional update so rapid clicks on different settings each read the
    // latest committed state instead of a stale closure (dropped-change race).
    let next;
    setBrand(prev => { next = { ...prev, ...patch }; return next; });
    try {
      const res = await authFetch("/api/brand", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next.enabled, position: next.position,
          opacity: next.opacity, size: next.size, color: next.color || null }),
      });
      if (!res.ok) setMsg((await res.json()).detail || "Save failed — did you run profiles_options.sql?");
      else setMsg("");
    } catch { setMsg("Save failed"); }
  };

  const uploadLogo = async (file) => {
    if (!file) return;
    setBusy(true); setMsg("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await authFetch("/api/brand/logo", { method: "POST", body: fd });
      if (!res.ok) { setMsg((await res.json()).detail || "Upload failed"); }
      else { setBrand(b => ({ ...b, has_logo: true })); loadLogo(); }
    } catch { setMsg("Upload failed"); }
    setBusy(false);
  };

  if (!brand) return null;
  const chip = (on) => ({
    padding: "7px 10px", fontSize: 8, cursor: "pointer",
    background: on ? C.signal : C.cream2, color: C.ink,
    border: on ? `2px solid ${C.ink}` : `2px solid ${C.ink}33`,
    boxShadow: on ? `2px 2px 0 ${C.ink}` : "none",
  });
  const SWATCHES = [null, "#FFD400", "#00FFFF", "#FF4500", "#FF69B4", "#00FF88", "#FFFFFF"];

  return (
    <PixelCard color={C.cream} padding={isMobile ? 16 : 22} style={{ marginTop: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
        <span className="pixel" style={{ fontSize: 11, background: C.peach, color: C.ink, padding: "8px 12px", border: BORDER }}>◆ BRAND KIT</span>
        <button onClick={() => save({ enabled: !brand.enabled })} className="pixel" style={chip(brand.enabled)}>
          {brand.enabled ? "✓ ON — applied to every clip" : "OFF"}
        </button>
      </div>
      <div className="vt" style={{ fontSize: 15, color: C.dim2, marginBottom: 12 }}>
        your logo watermarked on every rendered clip · brand color becomes the default caption highlight
      </div>
      {msg && <div className="vt" style={{ fontSize: 14, color: C.hotDeep, marginBottom: 8 }}>{msg}</div>}

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ width: 120 }}>
          <div onClick={() => fileRef.current?.click()} title="upload PNG logo"
            style={{ width: 120, height: 120, border: BORDER, background: "#ffffff", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
            {logoUrl ? <img src={logoUrl} alt="logo" style={{ maxWidth: "100%", maxHeight: "100%" }} />
              : <span className="pixel" style={{ fontSize: 8, color: C.dim2, textAlign: "center" }}>{busy ? "..." : "+ PNG LOGO"}</span>}
          </div>
          <input ref={fileRef} type="file" accept="image/png" style={{ display: "none" }}
            onChange={e => uploadLogo(e.target.files?.[0])} />
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div className="pixel" style={{ fontSize: 8, color: C.dim2, margin: "0 0 6px" }}>POSITION</div>
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            {[["tl", "↖"], ["tr", "↗"], ["bl", "↙"], ["br", "↘"]].map(([id, icon]) => (
              <button key={id} onClick={() => save({ position: id })} className="pixel" style={chip(brand.position === id)}>{icon}</button>
            ))}
          </div>
          <div className="pixel" style={{ fontSize: 8, color: C.dim2, margin: "0 0 6px" }}>SIZE</div>
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            {[[0.10, "S"], [0.15, "M"], [0.22, "L"]].map(([v, l]) => (
              <button key={l} onClick={() => save({ size: v })} className="pixel" style={chip(Math.abs(brand.size - v) < 0.01)}>{l}</button>
            ))}
          </div>
          <div className="pixel" style={{ fontSize: 8, color: C.dim2, margin: "0 0 6px" }}>OPACITY</div>
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            {[[0.25, "25%"], [0.5, "50%"], [0.85, "85%"]].map(([v, l]) => (
              <button key={l} onClick={() => save({ opacity: v })} className="pixel" style={chip(Math.abs(brand.opacity - v) < 0.01)}>{l}</button>
            ))}
          </div>
          <div className="pixel" style={{ fontSize: 8, color: C.dim2, margin: "0 0 6px" }}>BRAND COLOR (default caption highlight)</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {SWATCHES.map(col => (
              <button key={col || "none"} onClick={() => save({ color: col })} title={col || "none"} className="pixel"
                style={{ ...chip(brand.color === col || (!brand.color && !col)), width: 34, height: 30,
                  background: col || C.cream2 }}>{col ? "" : "–"}</button>
            ))}
          </div>
        </div>
      </div>
    </PixelCard>
  );
}

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

        <OnboardingTour storageKey="cf_tour_connections_v1" steps={[
          { target: "#tour-cn-yt", title: "CONNECT YOUTUBE",
            text: "One click and finished clips can upload straight to your channel — manually from the results page, or automatically from Watchlist and Digest." },
          { target: "#tour-cn-tt", title: "CONNECT TIKTOK",
            text: "Same idea for TikTok: connect once, then post clips directly without downloading and re-uploading." },
        ]} />
        {/* YouTube */}
        <div id="tour-cn-yt">
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
        </div>
        <div id="tour-cn-tt">
        <PixelCard color={C.cream} padding={isMobile ? 16 : 22}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
            <span className="pixel" style={{ fontSize: 11, background: C.tt, color: C.ink, padding: "8px 12px", border: BORDER }}>♪ TIKTOK</span>
            <span className="vt" style={{ fontSize: 15, color: C.dim2 }}>{ttAccounts.length} account{ttAccounts.length === 1 ? "" : "s"} connected</span>
          </div>
          {ttAccounts.map(acc => (
            <AccountRow key={acc.tt_open_id} label={`♪ ${acc.tt_display_name || "TikTok"}`} onDisconnect={() => disconnectTt(acc.tt_open_id)} />
          ))}
          <PixelBtn color="tt" size="md" onClick={() => connect("tiktok")}>+ CONNECT TIKTOK ACCOUNT</PixelBtn>
        </PixelCard>
        </div>

        {/* Brand kit */}
        <BrandKitCard isMobile={isMobile} />

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

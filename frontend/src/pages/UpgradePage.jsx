import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { C, BORDER, SHADOW, SHADOW_SM, KEYFRAMES } from "../lib/theme";
import { PixelBtn, PixelCard, Tag } from "../components/ui";
import Header from "../components/Header";
import { useApp } from "../context/AppContext";
import { authFetch } from "../lib/supabase";
import { useMobile } from "../hooks/useMobile";

// Display prices — must match the prices on your Lemon Squeezy variants.
const PRICE = {
  monthly: { amount: "$29", suffix: "/mo",  note: "billed monthly" },
  annual:  { amount: "$290", suffix: "/yr", note: "2 months free vs monthly" },
};

const PRO_FEATURES = [
  "Unlimited clips",
  "10 clips per job",
  "9:16 auto-reframe (speaker tracking)",
  "Blur background style",
  "Background music",
  "Trim silence",
  "Caption styles, languages & colors",
  "Watchlist automation",
  "Digest (backfill channel history)",
  "YouTube auto-upload",
  "TikTok auto-upload (soon)",
];

export default function UpgradePage() {
  const navigate = useNavigate();
  const isMobile = useMobile();
  const { isPro, profile } = useApp();
  const [cycle, setCycle] = useState("annual");  // "monthly" | "annual"
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const startCheckout = async () => {
    setError(""); setLoading(true);
    try {
      const res = await authFetch(`/api/billing/checkout?plan=${cycle}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.url) { setError(data.detail || "Could not start checkout."); setLoading(false); return; }
      window.location.href = data.url;  // redirect to Lemon Squeezy hosted checkout
    } catch {
      setError("Could not reach the server. Try again.");
      setLoading(false);
    }
  };

  const openPortal = async () => {
    setError(""); setLoading(true);
    try {
      const res = await authFetch("/api/billing/portal");
      const data = await res.json();
      if (!res.ok || !data.url) { setError(data.detail || "Could not open the billing portal."); setLoading(false); return; }
      window.location.href = data.url;
    } catch {
      setError("Could not reach the server. Try again.");
      setLoading(false);
    }
  };

  const p = PRICE[cycle];

  return (
    <div style={{ minHeight: "100vh" }}>
      <style>{KEYFRAMES}</style>
      <Header />
      <div className="fade" style={{ padding: isMobile ? "16px 12px 48px" : "40px 32px 64px", maxWidth: 720, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div className="pixel" style={{ fontSize: 10, color: C.dim2, marginBottom: 10 }}>{`>`} UPGRADE</div>
          <h1 className="pixel" style={{ fontSize: isMobile ? 18 : 26, color: C.ink }}>
            {isPro ? "You're on Pro." : "Go Pro. Unlock everything."}
          </h1>
        </div>

        {!isPro && !profile.billing_enabled ? (
          <PixelCard color={C.cream} padding={isMobile ? 22 : 32} style={{ textAlign: "center" }}>
            <div style={{ marginBottom: 14 }}><Tag bg={C.amber} color={C.ink}>COMING SOON</Tag></div>
            <p className="vt" style={{ fontSize: 18, color: C.dim2 }}>Pro upgrades are launching shortly. Check back soon!</p>
          </PixelCard>
        ) : isPro ? (
          <PixelCard color={C.cream} padding={isMobile ? 22 : 32} style={{ textAlign: "center" }}>
            <div style={{ marginBottom: 16 }}><Tag bg={C.signal} color={C.ink}>ACTIVE</Tag></div>
            <p className="vt" style={{ fontSize: 18, color: C.dim2, marginBottom: 6 }}>
              Your Pro subscription is active{profile.subscription_status ? ` (${profile.subscription_status})` : ""}.
            </p>
            {profile.plan_renews_at && (
              <p className="vt" style={{ fontSize: 16, color: C.dim2, marginBottom: 20 }}>
                Renews {new Date(profile.plan_renews_at).toLocaleDateString()}.
              </p>
            )}
            <PixelBtn color="lavender" size="md" onClick={openPortal} disabled={loading}>
              {loading ? "OPENING..." : "MANAGE SUBSCRIPTION"}
            </PixelBtn>
            {error && <div className="pixel" style={{ fontSize: 9, color: C.hotDeep, marginTop: 16 }}>! {error}</div>}
          </PixelCard>
        ) : (
          <PixelCard color={C.cream} padding={isMobile ? 22 : 32}>
            {/* Billing cycle toggle */}
            <div style={{ display: "flex", gap: 8, marginBottom: 24, justifyContent: "center" }}>
              {[["annual", "ANNUAL"], ["monthly", "MONTHLY"]].map(([key, label]) => (
                <button key={key} onClick={() => setCycle(key)} className="pixel"
                  style={{
                    padding: "10px 18px", fontSize: 10, cursor: "pointer", border: BORDER,
                    background: cycle === key ? C.signal : C.paper, color: C.ink,
                    boxShadow: cycle === key ? `2px 2px 0 ${C.ink}` : SHADOW_SM,
                    transform: cycle === key ? "translate(2px,2px)" : "none",
                  }}>
                  {label}{key === "annual" && <span style={{ marginLeft: 6, fontSize: 8, color: C.hotDeep }}>SAVE 17%</span>}
                </button>
              ))}
            </div>

            <div style={{ textAlign: "center", marginBottom: 24 }}>
              <span className="pixel" style={{ fontSize: isMobile ? 30 : 38, color: C.ink }}>{p.amount}</span>
              <span className="pixel" style={{ fontSize: 14, color: C.dim2 }}>{p.suffix}</span>
              <div className="vt" style={{ fontSize: 16, color: C.dim2, marginTop: 4 }}>{p.note}</div>
            </div>

            <ul style={{ listStyle: "none", padding: 0, margin: "0 0 28px", display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10 }}>
              {PRO_FEATURES.map(f => (
                <li key={f} className="pixel" style={{ fontSize: 8, color: C.ink, display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ color: C.signalDeep }}>✓</span> {f}
                </li>
              ))}
            </ul>

            {error && (
              <div className="pixel" style={{ fontSize: 9, color: C.hotDeep, marginBottom: 14, padding: "10px 12px", background: `${C.hot}44`, border: `2px solid ${C.hotDeep}` }}>
                ! {error}
              </div>
            )}

            <PixelBtn color="hot" size="lg" full onClick={startCheckout} disabled={loading}>
              {loading ? "STARTING..." : `> UPGRADE — ${p.amount}${p.suffix}`}
            </PixelBtn>
            <p className="vt" style={{ fontSize: 14, color: C.dim, textAlign: "center", marginTop: 14 }}>
              Secure checkout via Lemon Squeezy. Cancel anytime.
            </p>
          </PixelCard>
        )}

        <div style={{ textAlign: "center", marginTop: 20 }}>
          <button onClick={() => navigate("/hello")} className="pixel" style={{ background: "transparent", color: C.dim2, fontSize: 9, cursor: "pointer" }}>
            ← BACK
          </button>
        </div>
      </div>
    </div>
  );
}

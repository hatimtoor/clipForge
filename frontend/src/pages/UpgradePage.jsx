import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { C, BORDER, SHADOW, SHADOW_SM } from "../lib/theme";
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
  const [loadingPlan, setLoadingPlan] = useState(null);  // "monthly" | "annual" | null
  const [loading, setLoading] = useState(false);          // portal
  const [error, setError] = useState("");

  const startCheckout = async (plan) => {
    setError(""); setLoadingPlan(plan);
    try {
      const res = await authFetch(`/api/billing/checkout?plan=${plan}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.url) { setError(data.detail || "Could not start checkout."); setLoadingPlan(null); return; }
      window.location.href = data.url;  // redirect to Lemon Squeezy hosted checkout
    } catch {
      setError("Could not reach the server. Try again.");
      setLoadingPlan(null);
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

  const isTrial = isPro && profile.pro_expires_at && !profile.has_subscription;
  const daysLeft = profile.pro_expires_at
    ? Math.max(0, Math.ceil((new Date(profile.pro_expires_at) - Date.now()) / 86400000))
    : 0;

  return (
    <div style={{ minHeight: "100vh" }}>
      <Header />
      <div className="fade" style={{ padding: isMobile ? "16px 12px 48px" : "40px 32px 64px", maxWidth: 720, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div className="pixel" style={{ fontSize: 10, color: C.dim2, marginBottom: 10 }}>{`>`} UPGRADE</div>
          <h1 className="pixel" style={{ fontSize: isMobile ? 18 : 26, color: C.ink }}>
            {isTrial ? "You're on a Pro trial." : isPro ? "You're on Pro." : "Go Pro. Unlock everything."}
          </h1>
        </div>

        {!profile.has_subscription && !profile.billing_enabled ? (
          <PixelCard color={C.cream} padding={isMobile ? 22 : 32} style={{ textAlign: "center" }}>
            <div style={{ marginBottom: 14 }}><Tag bg={C.amber} color={C.ink}>COMING SOON</Tag></div>
            <p className="vt" style={{ fontSize: 18, color: C.dim2 }}>
              {isTrial ? `Your Pro trial is active — ${daysLeft} day${daysLeft === 1 ? "" : "s"} left. Paid plans are launching shortly.` : "Pro upgrades are launching shortly. Check back soon!"}
            </p>
          </PixelCard>
        ) : profile.has_subscription ? (
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
          <PixelCard color={C.cream} padding={isMobile ? 18 : 28}>
            {isTrial && (
              <div className="pixel" style={{ fontSize: 9, color: C.ink, background: C.signal, border: BORDER, padding: "10px 12px", marginBottom: 20, textAlign: "center" }}>
                PRO TRIAL ACTIVE — {daysLeft} DAY{daysLeft === 1 ? "" : "S"} LEFT. Subscribe to keep Pro when it ends.
              </div>
            )}
            {/* Both plans side by side */}
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? 14 : 20, marginBottom: 24 }}>
              {/* Annual */}
              <div style={{ border: BORDER, boxShadow: SHADOW, background: C.paper, padding: "26px 18px 18px", position: "relative", textAlign: "center" }}>
                <div style={{ position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)", background: C.signal, border: BORDER, padding: "3px 10px", whiteSpace: "nowrap" }}>
                  <span className="pixel" style={{ fontSize: 7, color: C.ink }}>BEST VALUE · SAVE 17%</span>
                </div>
                <div className="pixel" style={{ fontSize: 9, color: C.dim2, marginBottom: 10 }}>ANNUAL</div>
                <div>
                  <span className="pixel" style={{ fontSize: isMobile ? 28 : 34, color: C.ink }}>{PRICE.annual.amount}</span>
                  <span className="pixel" style={{ fontSize: 13, color: C.dim2 }}>{PRICE.annual.suffix}</span>
                </div>
                <div className="vt" style={{ fontSize: 15, color: C.dim2, marginTop: 4, marginBottom: 16 }}>{PRICE.annual.note}</div>
                <PixelBtn color="hot" size="md" full onClick={() => startCheckout("annual")} disabled={!!loadingPlan}>
                  {loadingPlan === "annual" ? "STARTING..." : "GET ANNUAL"}
                </PixelBtn>
              </div>

              {/* Monthly */}
              <div style={{ border: BORDER, boxShadow: SHADOW_SM, background: C.paper, padding: "26px 18px 18px", textAlign: "center" }}>
                <div className="pixel" style={{ fontSize: 9, color: C.dim2, marginBottom: 10 }}>MONTHLY</div>
                <div>
                  <span className="pixel" style={{ fontSize: isMobile ? 28 : 34, color: C.ink }}>{PRICE.monthly.amount}</span>
                  <span className="pixel" style={{ fontSize: 13, color: C.dim2 }}>{PRICE.monthly.suffix}</span>
                </div>
                <div className="vt" style={{ fontSize: 15, color: C.dim2, marginTop: 4, marginBottom: 16 }}>{PRICE.monthly.note}</div>
                <PixelBtn color="cream" size="md" full onClick={() => startCheckout("monthly")} disabled={!!loadingPlan}>
                  {loadingPlan === "monthly" ? "STARTING..." : "GET MONTHLY"}
                </PixelBtn>
              </div>
            </div>

            {error && (
              <div className="pixel" style={{ fontSize: 9, color: C.hotDeep, marginBottom: 14, padding: "10px 12px", background: `${C.hot}44`, border: `2px solid ${C.hotDeep}` }}>
                ! {error}
              </div>
            )}

            <div className="pixel" style={{ fontSize: 9, color: C.dim2, margin: "4px 0 12px" }}>EVERYTHING IN PRO</div>
            <ul style={{ listStyle: "none", padding: 0, margin: "0 0 20px", display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10 }}>
              {PRO_FEATURES.map(f => (
                <li key={f} className="pixel" style={{ fontSize: 8, color: C.ink, display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ color: C.signalDeep }}>✓</span> {f}
                </li>
              ))}
            </ul>

            <p className="vt" style={{ fontSize: 14, color: C.dim, textAlign: "center" }}>
              Secure checkout via Lemon Squeezy. Cancel anytime.
            </p>
          </PixelCard>
        )}

        <div style={{ textAlign: "center", marginTop: 20 }}>
          <button onClick={() => navigate("/hello")} className="pixel" style={{ background: "transparent", color: C.dim2, fontSize: 9, cursor: "pointer", padding: "8px 12px" }}>
            ← BACK
          </button>
        </div>
      </div>
    </div>
  );
}

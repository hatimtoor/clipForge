import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { authFetch } from "../lib/supabase";
import { Button, Card, Tag, Banner } from "../components/kit";

// Display prices — must match the prices on your Lemon Squeezy variants.
const PRICE = {
  monthly: { amount: "$29", suffix: "/mo", note: "billed monthly" },
  annual: { amount: "$290", suffix: "/yr", note: "2 months free vs monthly" },
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
  "TikTok posting",
];

function PlanCard({ name, ribbon, price, primary, starting, disabled, onPick }) {
  return (
    <Card style={{ textAlign: "center", position: "relative", paddingTop: 30 }}>
      {ribbon && <span className="lribbon">{ribbon}</span>}
      <div className="t-label" style={{ marginBottom: 8 }}>
        {name}
      </div>
      <div className="lprice__num" style={{ color: "var(--text-1)" }}>
        {price.amount}
        <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text-2)" }}>{price.suffix}</span>
      </div>
      <div className="t-sm" style={{ margin: "4px 0 18px" }}>
        {price.note}
      </div>
      <Button variant={primary ? "primary" : "secondary"} full onClick={onPick} disabled={disabled}>
        {starting ? "Starting…" : `Get ${name.toLowerCase()}`}
      </Button>
    </Card>
  );
}

export default function UpgradePage() {
  const navigate = useNavigate();
  const { isPro, profile } = useApp();
  const [loadingPlan, setLoadingPlan] = useState(null); // "monthly" | "annual" | null
  const [loading, setLoading] = useState(false); // portal
  const [error, setError] = useState("");

  const startCheckout = async (plan) => {
    setError("");
    setLoadingPlan(plan);
    try {
      const res = await authFetch(`/api/billing/checkout?plan=${plan}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.url) {
        setError(data.detail || "Could not start checkout.");
        setLoadingPlan(null);
        return;
      }
      window.location.href = data.url; // redirect to Lemon Squeezy hosted checkout
    } catch {
      setError("Could not reach the server. Try again.");
      setLoadingPlan(null);
    }
  };

  const openPortal = async () => {
    setError("");
    setLoading(true);
    try {
      const res = await authFetch("/api/billing/portal");
      const data = await res.json();
      if (!res.ok || !data.url) {
        setError(data.detail || "Could not open the billing portal.");
        setLoading(false);
        return;
      }
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
    <div style={{ maxWidth: 720, margin: "0 auto", display: "grid", gap: 20 }}>
      <div className="page-head" style={{ textAlign: "center", marginTop: 12 }}>
        <div className="page-head__title">
          {isTrial ? "You're on a Pro trial." : isPro ? "You're on Pro." : "Go Pro. Unlock everything."}
        </div>
      </div>

      {!profile.has_subscription && !profile.billing_enabled ? (
        <Card style={{ textAlign: "center", display: "grid", gap: 12, justifyItems: "center" }}>
          <Tag tone="accent">Coming soon</Tag>
          <p className="t-sm" style={{ margin: 0, maxWidth: 420 }}>
            {isTrial
              ? `Your Pro trial is active — ${daysLeft} day${daysLeft === 1 ? "" : "s"} left. Paid plans are launching shortly.`
              : "Pro upgrades are launching shortly. Check back soon!"}
          </p>
        </Card>
      ) : profile.has_subscription ? (
        <Card style={{ textAlign: "center", display: "grid", gap: 12, justifyItems: "center" }}>
          <Tag tone="success">Active</Tag>
          <p className="t-sm" style={{ margin: 0 }}>
            Your Pro subscription is active
            {profile.subscription_status ? ` (${profile.subscription_status})` : ""}.
          </p>
          {profile.plan_renews_at && (
            <p className="t-sm" style={{ margin: 0 }}>
              Renews {new Date(profile.plan_renews_at).toLocaleDateString()}.
            </p>
          )}
          <Button onClick={openPortal} disabled={loading}>
            {loading ? "Opening…" : "Manage subscription"}
          </Button>
          {error && <Banner tone="danger">{error}</Banner>}
        </Card>
      ) : (
        <>
          {isTrial && (
            <Banner tone="success" title={`Pro trial active — ${daysLeft} day${daysLeft === 1 ? "" : "s"} left`}>
              Subscribe to keep Pro when it ends.
            </Banner>
          )}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              gap: 18,
              marginTop: 8,
            }}
          >
            <PlanCard
              name="Annual"
              ribbon="Best value · save 17%"
              price={PRICE.annual}
              primary
              starting={loadingPlan === "annual"}
              disabled={!!loadingPlan}
              onPick={() => startCheckout("annual")}
            />
            <PlanCard
              name="Monthly"
              price={PRICE.monthly}
              starting={loadingPlan === "monthly"}
              disabled={!!loadingPlan}
              onPick={() => startCheckout("monthly")}
            />
          </div>

          {error && <Banner tone="danger">{error}</Banner>}

          <Card sub>
            <div className="t-label" style={{ marginBottom: 12 }}>
              Everything in Pro
            </div>
            <ul
              style={{
                listStyle: "none",
                padding: 0,
                margin: 0,
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 9,
                fontSize: "var(--fs-sm)",
              }}
            >
              {PRO_FEATURES.map((f) => (
                <li key={f} style={{ display: "flex", gap: 9, alignItems: "baseline" }}>
                  <span style={{ color: "var(--success)", flexShrink: 0 }}>✓</span> {f}
                </li>
              ))}
            </ul>
          </Card>

          <p className="t-sm" style={{ textAlign: "center", margin: 0, color: "var(--text-3)" }}>
            Secure checkout via Lemon Squeezy. Cancel anytime.
          </p>
        </>
      )}

      <div style={{ textAlign: "center" }}>
        <Button variant="ghost" size="sm" onClick={() => navigate("/hello")}>
          ← Back
        </Button>
      </div>
    </div>
  );
}

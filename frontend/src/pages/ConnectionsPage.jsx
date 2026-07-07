import { useState, useEffect, useRef } from "react";
import { useApp } from "../context/AppContext";
import { authFetch } from "../lib/supabase";
import {
  Button,
  Card,
  Banner,
  EmptyState,
  Field,
  SwitchRow,
  SegmentedControl,
  Tour,
} from "../components/kit";

const TOUR_STEPS = [
  {
    target: "#tour-cn-yt",
    title: "Connect YouTube",
    text: "One click and finished clips can upload straight to your channel — manually from the results page, or automatically from Watchlist and Digest.",
  },
  {
    target: "#tour-cn-tt",
    title: "Connect TikTok",
    text: "Same idea for TikTok: connect once, then post clips directly without downloading and re-uploading.",
  },
];

// Watermark sizes / opacities — ids are the exact values sent to the API.
const POSITIONS = [
  { id: "tl", label: "↖", title: "Top left" },
  { id: "tr", label: "↗", title: "Top right" },
  { id: "bl", label: "↙", title: "Bottom left" },
  { id: "br", label: "↘", title: "Bottom right" },
];
const SIZES = [
  { id: 0.1, label: "S" },
  { id: 0.15, label: "M" },
  { id: 0.22, label: "L" },
];
const OPACITIES = [
  { id: 0.25, label: "25%" },
  { id: 0.5, label: "50%" },
  { id: 0.85, label: "85%" },
];
// Brand-color payload values (null = none). These are data sent to the
// renderer, not UI theming — they must stay literal.
const SWATCHES = [null, "#FFD400", "#00FFFF", "#FF4500", "#FF69B4", "#00FF88", "#FFFFFF"];

// ── Brand kit (Pro): watermark logo + brand color for all rendered clips ─────
function BrandKitCard() {
  const [brand, setBrand] = useState(null); // {enabled, position, opacity, size, color, has_logo}
  const [logoUrl, setLogoUrl] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const fileRef = useRef(null);

  const loadLogo = async () => {
    try {
      const res = await authFetch("/api/brand/logo");
      if (!res.ok) {
        setLogoUrl(null);
        return;
      }
      const url = URL.createObjectURL(await res.blob());
      setLogoUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
    } catch {
      setLogoUrl(null);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch("/api/brand");
        const d = await res.json();
        if (res.ok) {
          setBrand(d);
          if (d.has_logo) loadLogo();
        }
      } catch {
        /* card stays hidden */
      }
    })();
  }, []);
  // Revoke the last blob URL on unmount (the loader revokes prior ones).
  useEffect(
    () => () =>
      setLogoUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      }),
    []
  );

  const save = async (patch) => {
    // Functional update so rapid clicks on different settings each read the
    // latest committed state instead of a stale closure (dropped-change race).
    let next;
    setBrand((prev) => {
      next = { ...prev, ...patch };
      return next;
    });
    try {
      const res = await authFetch("/api/brand", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: next.enabled,
          position: next.position,
          opacity: next.opacity,
          size: next.size,
          color: next.color || null,
        }),
      });
      if (!res.ok) setMsg((await res.json()).detail || "Save failed — did you run profiles_options.sql?");
      else setMsg("");
    } catch {
      setMsg("Save failed");
    }
  };

  const uploadLogo = async (file) => {
    if (!file) return;
    setBusy(true);
    setMsg("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await authFetch("/api/brand/logo", { method: "POST", body: fd });
      if (!res.ok) {
        setMsg((await res.json()).detail || "Upload failed");
      } else {
        setBrand((b) => ({ ...b, has_logo: true }));
        loadLogo();
      }
    } catch {
      setMsg("Upload failed");
    }
    setBusy(false);
  };

  if (!brand) return null;
  const sizeVal = SIZES.find((o) => Math.abs(brand.size - o.id) < 0.01)?.id;
  const opacityVal = OPACITIES.find((o) => Math.abs(brand.opacity - o.id) < 0.01)?.id;

  return (
    <Card>
      <div style={{ display: "grid", gap: 14 }}>
        <div>
          <div className="t-h2" style={{ margin: 0 }}>◆ Brand kit</div>
          <div className="t-sm" style={{ color: "var(--text-2)", marginTop: 4 }}>
            Your logo watermarked on every rendered clip · brand color becomes the default caption highlight
          </div>
        </div>

        <SwitchRow
          label="Apply to every clip"
          hint={brand.enabled ? "On — watermark and brand color are applied to every render" : "Off"}
          on={!!brand.enabled}
          onChange={(v) => save({ enabled: v })}
        />

        {msg && <Banner tone="danger">{msg}</Banner>}

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div style={{ width: 120, flexShrink: 0 }}>
            <div
              onClick={() => fileRef.current?.click()}
              title="Upload PNG logo"
              style={{
                width: 120,
                height: 120,
                border: "var(--border-w-sm) solid var(--line-strong)",
                borderRadius: "var(--radius-sm)",
                background: "var(--surface-2)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
              }}
            >
              {logoUrl ? (
                <img src={logoUrl} alt="logo" style={{ maxWidth: "100%", maxHeight: "100%" }} />
              ) : (
                <span className="t-label" style={{ color: "var(--text-3)", textAlign: "center" }}>
                  {busy ? "…" : "+ PNG logo"}
                </span>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/png"
              style={{ display: "none" }}
              onChange={(e) => uploadLogo(e.target.files?.[0])}
            />
          </div>

          <div style={{ flex: 1, minWidth: 220, display: "grid", gap: 12 }}>
            <Field label="Position">
              <SegmentedControl value={brand.position} onChange={(id) => save({ position: id })} options={POSITIONS} />
            </Field>
            <Field label="Size">
              <SegmentedControl value={sizeVal} onChange={(id) => save({ size: id })} options={SIZES} />
            </Field>
            <Field label="Opacity">
              <SegmentedControl value={opacityVal} onChange={(id) => save({ opacity: id })} options={OPACITIES} />
            </Field>
            <Field label="Brand color" hint="Default caption highlight">
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {SWATCHES.map((col) => {
                  const active = brand.color === col || (!brand.color && !col);
                  return (
                    <button
                      key={col || "none"}
                      type="button"
                      onClick={() => save({ color: col })}
                      title={col || "None"}
                      aria-pressed={active}
                      style={{
                        width: 36,
                        height: 30,
                        cursor: "pointer",
                        background: col || "var(--surface-2)",
                        color: "var(--text-2)",
                        border: "var(--border-w-sm) solid var(--line-strong)",
                        borderRadius: "var(--radius-sm)",
                        boxShadow: active ? "var(--focus-ring)" : "none",
                      }}
                    >
                      {col ? "" : "–"}
                    </button>
                  );
                })}
              </div>
            </Field>
          </div>
        </div>
      </div>
    </Card>
  );
}

// ── One card per platform: header, connected account rows, connect CTA ───────
function PlatformCard({ id, variant, icon, title, countLabel, rows, cta, onConnect }) {
  return (
    <Card id={id}>
      <div style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span
            aria-hidden
            style={{
              width: 34,
              height: 34,
              flexShrink: 0,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 16,
              background: `var(--${variant}-soft)`,
              color: `var(--${variant})`,
              border: `var(--border-w-sm) solid var(--${variant})`,
              borderRadius: "var(--radius-sm)",
            }}
          >
            {icon}
          </span>
          <div className="t-h2" style={{ margin: 0 }}>{title}</div>
          <span className="t-sm" style={{ color: "var(--text-2)", marginLeft: "auto" }}>{countLabel}</span>
        </div>

        {rows.length > 0 && (
          <div style={{ display: "grid", gap: 8 }}>
            {rows.map((r) => (
              <div
                key={r.key}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 8px 8px 12px",
                  background: "var(--surface-2)",
                  border: "var(--border-w-sm) solid var(--line)",
                  borderRadius: "var(--radius-sm)",
                }}
              >
                <div
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontWeight: "var(--fw-ui)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {icon} {r.name}
                </div>
                <Button size="sm" variant="ghost" title="Disconnect" onClick={r.onDisconnect}>
                  Disconnect
                </Button>
              </div>
            ))}
          </div>
        )}

        <div>
          <Button variant={variant} onClick={onConnect}>+ {cta}</Button>
        </div>
      </div>
    </Card>
  );
}

export default function ConnectionsPage() {
  const { isPro, ytStatus, refreshYtStatus, ttStatus, refreshTtStatus } = useApp();
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
      if (!res.ok) {
        setError(data.detail || `${provider} auth failed.`);
        return;
      }
      if (!data.auth_url) {
        setError("No auth URL returned.");
        return;
      }
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
    } catch {
      setError("Cannot reach server.");
    }
  };

  const disconnectYt = async (id) => {
    if (!window.confirm("Disconnect this YouTube channel?")) return;
    try {
      await authFetch(`/api/youtube/disconnect?yt_channel_id=${encodeURIComponent(id)}`, { method: "DELETE" });
      refreshYtStatus();
    } catch {
      setError("Could not disconnect. Try again.");
    }
  };

  const disconnectTt = async (id) => {
    if (!window.confirm("Disconnect this TikTok account?")) return;
    try {
      await authFetch(`/api/tiktok/disconnect?tt_open_id=${encodeURIComponent(id)}`, { method: "DELETE" });
      refreshTtStatus();
    } catch {
      setError("Could not disconnect. Try again.");
    }
  };

  if (!isPro) {
    return (
      <div style={{ maxWidth: 900, margin: "0 auto", display: "grid", gap: 20 }}>
        <div className="page-head">
          <div className="page-head__title">Connections</div>
          <div className="page-head__sub">Linked accounts for direct publishing.</div>
        </div>
        <EmptyState
          icon="🔒"
          title="Pro only"
          description="Upgrade to Pro to connect your social accounts."
        />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", display: "grid", gap: 20 }}>
      <div className="page-head">
        <div className="page-head__title">Connections</div>
        <div className="page-head__sub">
          Connect the platforms you want to publish clips to. You can link multiple accounts.
        </div>
      </div>

      {error && <Banner tone="danger">{error}</Banner>}

      <PlatformCard
        id="tour-cn-yt"
        variant="yt"
        icon="▶"
        title="YouTube"
        countLabel={`${ytChannels.length} channel${ytChannels.length === 1 ? "" : "s"} connected`}
        rows={ytChannels.map((ch) => ({
          key: ch.yt_channel_id,
          name: ch.yt_channel_name || "YouTube",
          onDisconnect: () => disconnectYt(ch.yt_channel_id),
        }))}
        cta="Connect YouTube channel"
        onConnect={() => connect("youtube")}
      />

      <PlatformCard
        id="tour-cn-tt"
        variant="tt"
        icon="♪"
        title="TikTok"
        countLabel={`${ttAccounts.length} account${ttAccounts.length === 1 ? "" : "s"} connected`}
        rows={ttAccounts.map((acc) => ({
          key: acc.tt_open_id,
          name: acc.tt_display_name || "TikTok",
          onDisconnect: () => disconnectTt(acc.tt_open_id),
        }))}
        cta="Connect TikTok account"
        onConnect={() => connect("tiktok")}
      />

      <BrandKitCard />

      <Card sub>
        <div className="t-label" style={{ marginBottom: 6 }}>How it works</div>
        <div className="t-sm" style={{ color: "var(--text-2)", lineHeight: "var(--lh-body)" }}>
          Once connected, you'll see upload buttons on your clips and can pick which account to post to.
          Watchlist and Digest channels can also auto-upload to a connected account.
        </div>
      </Card>

      <Tour steps={TOUR_STEPS} storageKey="cf_tour_connections_v1" />
    </div>
  );
}

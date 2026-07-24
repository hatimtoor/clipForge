import { useEffect, useRef, useState } from "react";
import { authFetch } from "../../lib/supabase";
import { useTheme } from "../../hooks/useTheme";
import { Button, Card, Banner, PhaseProgress } from "../../components/kit";
import { PixelSprite, ANVIL, ANVIL_PAL, HAMMER, HAMMER_PAL, PHASE_RANGES } from "../../components/ui";
import { STAGE_LABELS } from "./format";

/* The skin-forked slot: modern shows a molten equalizer band; retro brings
   back the sparking anvil + swinging hammer + drifting clouds. */
function ProcessingVisual() {
  const theme = useTheme();
  if (theme === "retro") {
    return (
      <div className="pviz pviz--retro px-crisp">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              top: 34 + (i % 2) * 8,
              left: `${44 + i * 4}%`,
              width: 6,
              height: 6,
              background: "#f5d76e",
              border: "1px solid var(--ink)",
              animation: `cf-spark .8s ${i * 0.15}s ease-out infinite`,
            }}
          />
        ))}
        <div style={{ position: "absolute", bottom: 14, left: "50%", transform: "translateX(-50%)" }}>
          <PixelSprite data={ANVIL} palette={ANVIL_PAL} size={6} />
        </div>
        <div
          style={{
            position: "absolute",
            bottom: 64,
            left: "calc(50% + 8px)",
            transformOrigin: "bottom center",
            animation: "cf-hammer 0.7s ease-in-out infinite",
          }}
        >
          <PixelSprite data={HAMMER} palette={HAMMER_PAL} size={5} />
        </div>
        <div
          style={{
            position: "absolute",
            top: 8,
            left: 0,
            width: 18,
            height: 8,
            background: "#fff",
            border: "2px solid var(--ink)",
            animation: "cf-drift 18s linear infinite",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 22,
            left: 0,
            width: 14,
            height: 6,
            background: "#fff",
            border: "2px solid var(--ink)",
            animation: "cf-drift 24s 3s linear infinite",
          }}
        />
      </div>
    );
  }
  return (
    <div className="pviz">
      <div className="pviz__band" />
      <div className="pviz__bars">
        {Array.from({ length: 14 }, (_, i) => (
          <span
            key={i}
            className="pviz__bar"
            style={{
              height: `${28 + ((i * 37) % 46)}%`,
              animationDelay: `${(i % 7) * 0.12}s`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

export default function LiveProcessing({ job, onCancel }) {
  const [elapsed, setElapsed] = useState(0);
  const [displayProgress, setDisplayProgress] = useState(job.progress || 0);
  const lastServerProgress = useRef(job.progress || 0);
  const lastServerTime = useRef(Date.now());
  const [cancelling, setCancelling] = useState(false);

  const handleCancel = async () => {
    setCancelling(true);
    try {
      await authFetch(`/api/jobs/${job.job_id}/cancel`, { method: "POST" });
    } catch {}
    onCancel();
  };

  useEffect(() => {
    const i = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    const p = job.progress || 0;
    if (p !== lastServerProgress.current) {
      lastServerProgress.current = p;
      lastServerTime.current = Date.now();
      setDisplayProgress(p);
    }
  }, [job.progress]);

  // Creep toward the phase ceiling between server updates so the bar never
  // looks frozen (same smoothing as the legacy page).
  useEffect(() => {
    const phaseEnd = PHASE_RANGES[job.status]?.[1] ?? 100;
    const ceiling = phaseEnd - 0.5;
    const id = setInterval(() => {
      if (Date.now() - lastServerTime.current > 1500)
        setDisplayProgress((p) => (p < ceiling ? Math.min(p + 0.2, ceiling) : p));
    }, 300);
    return () => clearInterval(id);
  }, [job.status]);

  const elapsedStr = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;
  const [phaseStart, phaseEnd] = PHASE_RANGES[job.status] || [0, 100];
  const phaseProgress = Math.min(
    100,
    Math.max(0, ((displayProgress - phaseStart) / (phaseEnd - phaseStart)) * 100)
  );

  return (
    <div className="live">
      <div style={{ display: "grid", gap: 16, minWidth: 0 }}>
        <Card>
          <div className="live__badge">Live · {elapsedStr}</div>
          <h1 className="live__title">{job.message || "Forging clips"}</h1>
          <div className="live__url">{job.url}</div>
          <ProcessingVisual />
          <PhaseProgress displayProgress={displayProgress} status={job.status} />
        </Card>
        <Banner tone="info" title="Large videos can take 5–10 minutes">
          Each segment fills as that stage runs and locks when it completes. Your job keeps
          running on the server even if you close this tab.
        </Banner>
      </div>

      <Card className="live__side">
        <div className="t-label" style={{ marginBottom: 10 }}>
          Job · {(job.job_id || "--").slice(0, 12)}
        </div>
        <div className="live__pct">
          {Math.round(phaseProgress)}
          <span style={{ fontSize: 18, color: "var(--text-3)" }}>%</span>
        </div>
        <div className="t-sm" style={{ marginBottom: 14 }}>
          this stage
        </div>
        <div className="live__row">
          <b>Stage</b>
          <span className="live__stage">
            {STAGE_LABELS[job.status] || job.status}
          </span>
        </div>
        <div className="live__row">
          <b>Elapsed</b>
          <span>{elapsedStr}</span>
        </div>
        <div className="live__row">
          <b>ETA</b>
          <span>~{Math.max(1, 4 - Math.floor(elapsed / 60))}m</span>
        </div>
        <div style={{ marginTop: 16, display: "grid", gap: 8 }}>
          <Button variant="secondary" full onClick={onCancel}>
            Close / New
          </Button>
          <Button variant="danger" full onClick={handleCancel} disabled={cancelling}>
            {cancelling ? "Cancelling…" : "✕ Cancel job"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

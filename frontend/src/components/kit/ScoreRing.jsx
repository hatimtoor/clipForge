/* Radial virality score (0–99) with optional HOOK/FLOW/VALUE/TREND bars. */

export function ScoreRing({ score = 0, max = 99, size = 76, stroke = 7 }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, score / max));
  const hi = score >= 70;
  return (
    <span className="score-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }} aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--score-track)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={hi ? "var(--score-hi)" : "var(--score-fill)"}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${circ * pct} ${circ}`}
        />
      </svg>
      <span className="score-ring__num" style={{ fontSize: size * 0.32, marginTop: -size * 0.06 }}>
        {score}
      </span>
      <span className="score-ring__of" style={{ marginTop: size * 0.32 }}>
        /{max}
      </span>
    </span>
  );
}

export function ScoreBars({ scores }) {
  if (!scores) return null;
  const rows = [
    ["Hook", scores.hook],
    ["Flow", scores.flow],
    ["Value", scores.value],
    ["Trend", scores.trend],
  ].filter(([, v]) => v != null);
  if (!rows.length) return null;
  return (
    <div className="score-bars">
      {rows.map(([k, v]) => (
        <div key={k} className="score-bars__row">
          <span className="score-bars__k">{k}</span>
          <span className="score-bars__track">
            {/* same scaling as the legacy card: v is on the 0–99 scale */}
            <span
              className="score-bars__fill"
              style={{ width: `${Math.max(0, Math.min(100, (v || 0) / 0.99))}%` }}
            />
          </span>
        </div>
      ))}
    </div>
  );
}

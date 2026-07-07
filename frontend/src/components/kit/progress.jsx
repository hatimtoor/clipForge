import { PHASE_RANGES } from "../ui";

export function ProgressBar({ progress, stripes, color }) {
  return (
    <div className="progress">
      <div
        className={`progress__fill ${stripes ? "progress__fill--stripes" : ""}`}
        style={{ width: `${Math.max(0, Math.min(100, progress))}%`, background: color }}
      />
    </div>
  );
}

/* Merges the legacy SegmentedProgressBar + PhaseSteps into one component:
   a five-segment bar (per-phase fill driven by PHASE_RANGES, exactly the old
   math) with the phase name / % / ✓ underneath each segment. */
const PHASES = [
  { key: "downloading", label: "Download", short: "DL", color: "var(--phase-download)" },
  { key: "merging", label: "Merge", short: "MX", color: "var(--phase-merge)" },
  { key: "transcribing", label: "Transcribe", short: "TX", color: "var(--phase-transcribe)" },
  { key: "analyzing", label: "Analyze", short: "AN", color: "var(--phase-analyze)" },
  { key: "clipping", label: "Clip", short: "CLP", color: "var(--phase-clip)" },
];

export function PhaseProgress({ displayProgress, status }) {
  const isDone = status === "done";
  const currentIdx = PHASES.findIndex((b) => b.key === status);
  return (
    <div className="phasep">
      {PHASES.map((block, i) => {
        const [start, end] = PHASE_RANGES[block.key];
        let fill;
        if (isDone || i < currentIdx) fill = 100;
        else if (i === currentIdx)
          fill = Math.min(100, Math.max(0, ((displayProgress - start) / (end - start)) * 100));
        else fill = 0;
        const isActive = !isDone && i === currentIdx;
        const isComplete = isDone || i < currentIdx;
        return (
          <div key={block.key} className="phasep__seg">
            <div className="phasep__bar">
              <div
                className={`phasep__fill ${isActive ? "phasep__fill--active" : ""}`}
                style={{ width: `${fill}%`, background: block.color }}
              />
            </div>
            <div className={`phasep__meta ${isActive ? "phasep__meta--active" : ""}`}>
              <span className="hide-sm">{block.label}</span>
              <span className="show-sm">{block.short}</span>
              {isComplete && <span className="phasep__check">✓</span>}
              {isActive && <span>{Math.round(fill)}%</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

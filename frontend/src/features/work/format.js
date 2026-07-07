export const STAGE_LABELS = {
  downloading: "Download",
  merging: "Merge",
  transcribing: "Transcribe",
  analyzing: "Analyze",
  clipping: "Clip",
  done: "Done",
};

export const fmtNum = (n) =>
  n == null
    ? "—"
    : n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000
    ? `${(n / 1_000).toFixed(1)}K`
    : String(n);

export const timeAgoShort = (iso) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};

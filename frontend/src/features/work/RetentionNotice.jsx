import { Banner } from "../../components/kit";

const RETENTION_DAYS = 7;

export default function RetentionNotice({ job }) {
  if (job.clips_expired) {
    return (
      <Banner tone="danger" title="⚠ Clips expired">
        These clips were older than {RETENTION_DAYS} days and have been removed from storage.
        Re-run the job to regenerate them.
      </Banner>
    );
  }
  let daysLeft = null;
  if (job.created_at) {
    const elapsed = (Date.now() - new Date(job.created_at).getTime()) / 86400000;
    daysLeft = Math.max(0, Math.ceil(RETENTION_DAYS - elapsed));
  }
  return (
    <Banner tone="warning" title="⏳ Heads up">
      Clips are auto-deleted {RETENTION_DAYS} days after creation
      {daysLeft !== null && (
        <>
          {" "}
          — <strong>{daysLeft === 0 ? "expiring today" : `about ${daysLeft} day${daysLeft === 1 ? "" : "s"} left`}</strong>
        </>
      )}
      . Download anything you want to keep before then.
    </Banner>
  );
}

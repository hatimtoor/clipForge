import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { authFetch } from "../lib/supabase";
import { Button, Card, EmptyState } from "../components/kit";
import LiveProcessing from "../features/work/LiveProcessing";
import Results from "../features/work/Results";
import UploadModalYouTube from "../features/work/UploadModalYouTube";
import UploadModalTikTok from "../features/work/UploadModalTikTok";
import UploadModalInstagram from "../features/work/UploadModalInstagram";

/* Orchestrator only: job polling, jobActive lifecycle, bulk-upload loops, and
   the route-state switch. All rendering lives in features/work/. */
export default function WorkPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const jobId = searchParams.get("job");
  const { isPro, ytStatus, ttStatus, igStatus, setJobActive } = useApp();

  const [job, setJob] = useState(null);
  const [ytModal, setYtModal] = useState(null);
  const [ttModal, setTtModal] = useState(null);
  const [igModal, setIgModal] = useState(null);
  const [loading, setLoading] = useState(!!jobId);
  const [fetchError, setFetchError] = useState(false);
  const [uploadingAll, setUploadingAll] = useState(false);
  const pollRef = useRef(null);
  const uploadAllPollRef = useRef(null);
  const isTerminalRef = useRef(false);

  const isTerminal = (status) => ["done", "error", "cancelled"].includes(status);

  const fetchJob = async (id) => {
    try {
      const res = await authFetch(`/api/status/${id}`);
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        if (import.meta.env.DEV) console.error(`[WorkPage] /api/status/${id} → ${res.status}`, body);
        return null;
      }
      return await res.json();
    } catch (e) {
      if (import.meta.env.DEV) console.error(`[WorkPage] fetchJob network error:`, e);
      return null;
    }
  };

  useEffect(() => {
    if (!jobId) {
      setJobActive(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setFetchError(false);
    setJob(null);
    setUploadingAll(false);
    clearInterval(pollRef.current);

    // fetch immediately
    fetchJob(jobId).then((data) => {
      setLoading(false);
      if (!data) {
        setFetchError(true);
        return;
      }
      setJob(data);
      const terminal = isTerminal(data.status);
      isTerminalRef.current = terminal;
      setJobActive(terminal ? null : jobId);
      if (!terminal) {
        pollRef.current = setInterval(async () => {
          const d = await fetchJob(jobId);
          if (!d) return;
          setJob(d);
          if (isTerminal(d.status)) {
            clearInterval(pollRef.current);
            isTerminalRef.current = true;
            setJobActive(null);
          }
        }, 1000);
      }
    });

    return () => {
      clearInterval(pollRef.current);
      clearInterval(uploadAllPollRef.current);
      if (isTerminalRef.current) setJobActive(null);
    };
  }, [jobId]); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshJob = async () => {
    if (!jobId) return;
    const d = await fetchJob(jobId);
    if (d) setJob(d);
  };

  const handleUploadAll = async (channelId) => {
    if (!job?.clips || uploadingAll) return;
    setUploadingAll(true);
    clearInterval(uploadAllPollRef.current);
    const toUpload = job.clips
      .map((c, i) => ({ clip: c, idx: i }))
      .filter(({ clip }) => !clip.yt_upload || !["done", "uploading", "queued"].includes(clip.yt_upload?.status));
    for (const { clip, idx } of toUpload) {
      const isShort = (clip.duration || 0) <= 60;
      const title = (clip.title || `Clip ${idx + 1}`) + (isShort ? " #Shorts" : "");
      const description = [clip.hook, clip.reason, (clip.tags || []).map((t) => `#${t}`).join(" "), isShort ? "#Shorts" : ""]
        .filter(Boolean)
        .join("\n\n");
      try {
        await authFetch(`/api/youtube/upload/${jobId}/${idx}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            description,
            tags: clip.tags || [],
            privacy_status: "public",
            yt_channel_id: channelId || undefined,
          }),
        });
      } catch {}
      await new Promise((r) => setTimeout(r, 1500));
    }
    uploadAllPollRef.current = setInterval(async () => {
      const d = await fetchJob(jobId);
      if (!d) return;
      setJob(d);
      const allSettled = (d.clips || []).every(
        (c) => !c.yt_upload || ["done", "error"].includes(c.yt_upload?.status)
      );
      if (allSettled) {
        clearInterval(uploadAllPollRef.current);
        setUploadingAll(false);
      }
    }, 2000);
  };

  const handleUploadAllTikTok = async (account) => {
    if (!job?.clips || uploadingAll) return;
    setUploadingAll(true);
    clearInterval(uploadAllPollRef.current);
    const toUpload = job.clips
      .map((c, i) => ({ clip: c, idx: i }))
      .filter(({ clip }) => !clip.tt_upload || !["done", "uploading", "queued"].includes(clip.tt_upload?.status));
    for (const { idx } of toUpload) {
      try {
        await authFetch(`/api/tiktok/upload/${jobId}/${idx}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tt_open_id: account || undefined }),
        });
      } catch {}
      await new Promise((r) => setTimeout(r, 1500));
    }
    uploadAllPollRef.current = setInterval(async () => {
      const d = await fetchJob(jobId);
      if (!d) return;
      setJob(d);
      const allSettled = (d.clips || []).every(
        (c) => !c.tt_upload || ["done", "error"].includes(c.tt_upload?.status)
      );
      if (allSettled) {
        clearInterval(uploadAllPollRef.current);
        setUploadingAll(false);
      }
    }, 2000);
  };

  const goNew = () => navigate("/hello");

  if (loading) {
    return (
      <Card style={{ maxWidth: 720, margin: "48px auto" }}>
        <EmptyState icon="⏳" title="Loading…" />
      </Card>
    );
  }

  if (fetchError) {
    return (
      <Card style={{ maxWidth: 720, margin: "48px auto" }}>
        <EmptyState
          icon="🔎"
          title="Could not load this job"
          description="It may have expired or the server is unreachable."
          action={<Button onClick={goNew}>＋ New clip</Button>}
        />
      </Card>
    );
  }

  if (!jobId || !job) {
    return (
      <Card style={{ maxWidth: 720, margin: "48px auto" }}>
        <EmptyState
          icon="🔥"
          title="The forge is cold"
          description="Start a new clip to fire it up."
          action={<Button onClick={goNew}>＋ New clip</Button>}
        />
      </Card>
    );
  }

  if (job.status === "cancelled") {
    return (
      <Card style={{ maxWidth: 720, margin: "48px auto" }}>
        <EmptyState
          icon="🛑"
          title="Job cancelled"
          description="The job was stopped. Any temp files have been cleaned up."
          action={<Button onClick={goNew}>＋ New job</Button>}
        />
      </Card>
    );
  }

  if (job.status === "error") {
    return (
      <Card style={{ maxWidth: 720, margin: "48px auto" }}>
        <EmptyState
          icon="💥"
          title="Job failed"
          description={(job.error || "Something went wrong.").split("\n").pop()}
          action={<Button onClick={goNew}>↻ Try again</Button>}
        />
      </Card>
    );
  }

  if (job.status === "done") {
    return (
      // key: a reprompt/edit navigates to a new ?job= — remount Results so no
      // stale per-clip state survives (this replaced window.location.reload()).
      <div key={jobId}>
        <Results
          job={job}
          ytStatus={ytStatus}
          ttStatus={ttStatus}
          igStatus={igStatus}
          isPro={isPro}
          onNew={goNew}
          onYTUpload={(clip, clipIndex) => setYtModal({ clip, clipIndex })}
          onTTUpload={(clip, clipIndex) => setTtModal({ clip, clipIndex })}
          onIGUpload={(clip, clipIndex) => setIgModal({ clip, clipIndex })}
          onUploadAll={handleUploadAll}
          onUploadAllTikTok={handleUploadAllTikTok}
          uploadingAll={uploadingAll}
        />
        {ytModal && (
          <UploadModalYouTube
            clip={ytModal.clip}
            clipIndex={ytModal.clipIndex}
            jobId={jobId}
            ytChannels={ytStatus?.channels || []}
            onClose={() => setYtModal(null)}
            onUploaded={refreshJob}
          />
        )}
        {ttModal && (
          <UploadModalTikTok
            clip={ttModal.clip}
            clipIndex={ttModal.clipIndex}
            jobId={jobId}
            ttAccounts={ttStatus?.accounts || []}
            onClose={() => setTtModal(null)}
            onUploaded={refreshJob}
          />
        )}
        {igModal && (
          <UploadModalInstagram
            clip={igModal.clip}
            clipIndex={igModal.clipIndex}
            jobId={jobId}
            igAccounts={igStatus?.accounts || []}
            onClose={() => setIgModal(null)}
            onUploaded={refreshJob}
          />
        )}
      </div>
    );
  }

  return <LiveProcessing job={job} onCancel={goNew} />;
}

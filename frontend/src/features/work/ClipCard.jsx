import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fmtTime } from "../../lib/theme";
import { authFetch } from "../../lib/supabase";
import { useMobile } from "../../hooks/useMobile";
import { Button, Card, Tag, MenuButton, ScoreRing, ScoreBars } from "../../components/kit";
import { TikTokClipButton } from "./UploadModalTikTok";
import ScheduleModal from "./ScheduleModal";
import { fmtNum, timeAgoShort } from "./format";

export default function ClipCard({
  clip,
  idx,
  isActive,
  onPreview,
  onYTUpload,
  onTTUpload,
  onEdit,
  ytConnected,
  ttConnected,
  jobId,
  isPro,
}) {
  const navigate = useNavigate();
  const isMobile = useMobile();
  const [downloading, setDownloading] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduled, setScheduled] = useState(false);
  const [analytics, setAnalytics] = useState(clip.yt_analytics || null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [clipToken, setClipToken] = useState(null);
  const previewRef = useRef(null);

  const hasYtVideo = clip.yt_upload?.status === "done" && clip.yt_upload?.video_id;
  const ytUp = clip.yt_upload;
  // 0-99 score with hook/flow/value/trend breakdown (new jobs); old jobs only
  // have the legacy 1-10 score, which scales up for a consistent display.
  const score99 = clip.score ?? (clip.virality_score ? Math.round(clip.virality_score * 10) : 0);
  const subs = clip.scores || null;

  // Mobile plays inline in the card — fetch a token for local (non-R2) clips.
  useEffect(() => {
    if (!isActive || clip.presigned_url || !clip.filename) return;
    authFetch(`/api/clip-token/${jobId}/${clip.filename}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.token) setClipToken(`/clips/${jobId}/${clip.filename}?t=${data.token}`);
      })
      .catch(() => {});
  }, [isActive, clip.presigned_url, clip.filename, jobId]);

  const videoSrc = clip.presigned_url || clipToken;

  useEffect(() => {
    if (isActive && isMobile && previewRef.current) {
      setTimeout(() => {
        const el = previewRef.current;
        if (!el) return;
        const y = el.getBoundingClientRect().top + window.pageYOffset - 72;
        window.scrollTo({ top: y, behavior: "smooth" });
      }, 120);
    }
  }, [isActive, isMobile]);

  const refreshStats = async () => {
    setStatsLoading(true);
    try {
      const res = await authFetch(`/api/jobs/${jobId}/clips/${idx}/refresh_analytics`, {
        method: "POST",
      });
      if (res.ok) setAnalytics(await res.json());
    } finally {
      setStatsLoading(false);
    }
  };

  const handleDownload = async () => {
    if (clip.presigned_url) {
      const a = document.createElement("a");
      a.href = clip.presigned_url;
      a.download = clip.filename || `clip_${idx + 1}.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      return;
    }
    setDownloading(true);
    try {
      const res = await authFetch(clip.path);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = clip.filename || `clip_${idx + 1}.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  };

  const handleDownloadThumb = () => {
    if (!clip.thumbnail_url) return;
    const a = document.createElement("a");
    a.href = clip.thumbnail_url;
    a.download = `clip_${idx + 1}_thumbnail.jpg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const handleExport = async (fmt) => {
    if (fmt !== "srt" && !isPro) {
      navigate("/upgrade");
      return;
    }
    try {
      const res = await authFetch(`/api/jobs/${jobId}/clips/${idx}/export?fmt=${fmt}`);
      if (!res.ok) return;
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") || "";
      const m = cd.match(/filename="([^"]+)"/);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = m ? m[1] : `clip_${idx + 1}.${fmt === "xml" ? "xml" : fmt}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      /* non-fatal */
    }
  };

  const downloadItems = [
    { label: downloading ? "Downloading…" : "MP4 video", onClick: handleDownload, disabled: downloading },
    ...(clip.thumbnail_url ? [{ label: "Thumbnail JPG", onClick: handleDownloadThumb }] : []),
    { label: "SRT captions", onClick: () => handleExport("srt") },
    { label: "Premiere XML", onClick: () => handleExport("xml"), pro: !isPro },
    { label: "Final Cut XML", onClick: () => handleExport("fcpxml"), pro: !isPro },
  ];

  const moreItems = [
    {
      label: scheduled ? "✓ Scheduled" : "Schedule post",
      pro: !isPro,
      onClick: () => {
        if (!isPro) return navigate("/upgrade");
        setScheduleOpen(true);
      },
    },
  ];

  return (
    <Card flush className={`clipcard ${isActive ? "clipcard--active" : ""}`}>
      <div className="clipcard__main">
        <button type="button" className="clipcard__thumb" onClick={onPreview} title={isActive ? "Hide preview" : "Play"}>
          {clip.thumbnail_url && <img src={clip.thumbnail_url} alt="" loading="lazy" />}
          <span className="clipcard__playbadge">{isActive ? "⏸" : "▶"}</span>
        </button>

        <div className="clipcard__meta">
          <div className="clipcard__tags">
            <Tag>#{String(idx + 1).padStart(2, "0")}</Tag>
            <Tag>
              {fmtTime(clip.start)} → {fmtTime(clip.end)}
            </Tag>
            <Tag>{clip.duration}s</Tag>
          </div>
          <h3 className="clipcard__title">{clip.title || `Clip ${idx + 1}`}</h3>
          {clip.hook && <p className="clipcard__hook">“{clip.hook}”</p>}
          {clip.reason && <p className="clipcard__reason">{clip.reason}</p>}
          {clip.tags?.length > 0 && (
            <div className="clipcard__hashtags">
              {clip.tags.map((t) => (
                <span key={t}>#{t}</span>
              ))}
            </div>
          )}
          {hasYtVideo && (
            <div className="clipcard__stats">
              {analytics ? (
                <>
                  <span>👁 {fmtNum(analytics.views)}</span>
                  <span>👍 {fmtNum(analytics.likes)}</span>
                  <span>💬 {fmtNum(analytics.comments)}</span>
                  <span style={{ marginLeft: "auto", color: "var(--text-3)" }}>
                    {timeAgoShort(analytics.fetched_at)}
                  </span>
                </>
              ) : (
                <span>No stats yet</span>
              )}
              <Button size="sm" variant="ghost" onClick={refreshStats} disabled={statsLoading}>
                {statsLoading ? "…" : "↻ Stats"}
              </Button>
            </div>
          )}
        </div>

        <div className="clipcard__score">
          <ScoreRing score={score99} size={isMobile ? 54 : 72} />
          {subs && (
            <span className="hide-sm" style={{ width: "100%" }}>
              <ScoreBars scores={subs} />
            </span>
          )}
        </div>
      </div>

      <div className="clipcard__actions">
        <Button size="sm" variant="secondary" onClick={onPreview}>
          {isActive ? "⏸ Hide" : "▶ Play"}
        </Button>
        {onEdit && (
          <Button size="sm" variant="secondary" onClick={onEdit}>
            ✂ Edit
          </Button>
        )}
        <MenuButton
          align="left"
          trigger={(toggle) => (
            <Button size="sm" variant="secondary" onClick={toggle}>
              ⬇ Download ▾
            </Button>
          )}
          items={downloadItems}
        />
        {ytConnected &&
          (ytUp?.status === "done" ? (
            <a href={ytUp.url} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
              <Button size="sm" variant="yt">
                ▶ On YouTube ↗
              </Button>
            </a>
          ) : ytUp?.status === "uploading" || ytUp?.status === "queued" ? (
            <Button size="sm" variant="yt" disabled>
              ↑ {ytUp.progress || 0}%
            </Button>
          ) : (
            <Button size="sm" variant="yt" onClick={onYTUpload}>
              ↑ YouTube
            </Button>
          ))}
        {ttConnected && <TikTokClipButton clip={clip} onOpen={onTTUpload} />}
        <span style={{ marginLeft: "auto" }} />
        <MenuButton
          trigger={(toggle) => (
            <Button size="sm" variant="ghost" onClick={toggle} title="More">
              ⋯
            </Button>
          )}
          items={moreItems}
        />
      </div>

      {isActive && isMobile && (
        <div ref={previewRef} className="clipcard__video">
          <video src={videoSrc} poster={clip.thumbnail_url || undefined} controls autoPlay preload="auto" />
        </div>
      )}

      {scheduleOpen && (
        <ScheduleModal
          clip={clip}
          idx={idx}
          jobId={jobId}
          onClose={(ok) => {
            setScheduleOpen(false);
            if (ok) setScheduled(true);
          }}
        />
      )}
    </Card>
  );
}

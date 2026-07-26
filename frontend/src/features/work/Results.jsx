import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMobile } from "../../hooks/useMobile";
import { authFetch } from "../../lib/supabase";
import { Button, Card, Tag, Modal, Field, EmptyState } from "../../components/kit";
import EditClipModal from "../../components/EditClipModal";
import ClipCard from "./ClipCard";
import RepromptModal from "./RepromptModal";
import RetentionNotice from "./RetentionNotice";
import { TikTokDisclosure } from "./UploadModalTikTok";

/* Picker for bulk uploads when more than one channel/account is connected. */
function TargetPickerModal({ title, options, initial, confirmLabel, tone, disclosure, onConfirm, onClose }) {
  const [picked, setPicked] = useState(initial);
  return (
    <Modal
      title={title}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={tone} disabled={!picked} onClick={() => onConfirm(picked)}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div style={{ display: "grid", gap: 10 }}>
        <Field label="Select account">
          <div style={{ display: "grid", gap: 6 }}>
            {options.map((o) => (
              <Button
                key={o.id}
                size="sm"
                variant={picked === o.id ? tone : "secondary"}
                onClick={() => setPicked(o.id)}
                style={{ justifyContent: "flex-start" }}
              >
                {o.label}
              </Button>
            ))}
          </div>
        </Field>
        {disclosure}
      </div>
    </Modal>
  );
}

export default function Results({
  job,
  ytStatus,
  ttStatus,
  igStatus,
  isPro,
  onYTUpload,
  onTTUpload,
  onIGUpload,
  onNew,
  onUploadAll,
  onUploadAllTikTok,
  onUploadAllInstagram,
  uploadingAll,
}) {
  const clips = job.clips || [];
  const isMobile = useMobile();
  const navigate = useNavigate();
  const [active, setActive] = useState(null);
  const [activeToken, setActiveToken] = useState(null);
  const [repromptOpen, setRepromptOpen] = useState(false);
  // Transcript editor: {clipIndex, title} = edit that clip; {clipIndex: null} =
  // create-from-scratch over the whole transcript.
  const [editTarget, setEditTarget] = useState(null);
  const [ytPicker, setYtPicker] = useState(false);
  const [ttPicker, setTtPicker] = useState(false);
  const [igPicker, setIgPicker] = useState(false);
  const previewRef = useRef(null);

  const ytChannels = ytStatus?.channels || [];
  const ttAccounts = ttStatus?.accounts || [];
  const igAccounts = igStatus?.accounts || [];
  const ytConnected = isPro && !!ytStatus?.connected;
  const ttConnected = isPro && !!ttStatus?.connected;
  const igConnected = isPro && !!igStatus?.connected;
  const uploadableCount = clips.filter(
    (c) => !c.yt_upload || !["done", "uploading", "queued"].includes(c.yt_upload?.status)
  ).length;
  const ttUploadableCount = clips.filter(
    (c) => !c.tt_upload || !["done", "uploading", "queued"].includes(c.tt_upload?.status)
  ).length;
  const igUploadableCount = clips.filter(
    (c) => !c.ig_upload || !["done", "uploading", "queued"].includes(c.ig_upload?.status)
  ).length;

  useEffect(() => {
    if (active && previewRef.current)
      previewRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [active]);

  useEffect(() => {
    if (!active || active.presigned_url || !active.filename) {
      setActiveToken(null);
      return;
    }
    authFetch(`/api/clip-token/${job.job_id}/${active.filename}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.token)
          setActiveToken(`/clips/${job.job_id}/${active.filename}?t=${data.token}`);
      })
      .catch(() => {});
  }, [active, job.job_id]);

  const handleUploadAllClick = () => {
    if (ytChannels.length > 1) setYtPicker(true);
    else onUploadAll(ytChannels[0]?.yt_channel_id || "");
  };
  const handleTtAllClick = () => {
    if (ttAccounts.length > 1) setTtPicker(true);
    else onUploadAllTikTok(ttAccounts[0]?.tt_open_id || "");
  };
  const handleIgAllClick = () => {
    if (igAccounts.length > 1) setIgPicker(true);
    else onUploadAllInstagram(igAccounts[0]?.ig_user_id || "");
  };

  return (
    <div className="results">
      <Card flush className="results__bar">
        <div style={{ minWidth: 0 }}>
          <div className="results__count">
            <span style={{ color: "var(--success)" }}>✓</span>
            {clips.length} {clips.length === 1 ? "clip" : "clips"} ready
          </div>
          {job.url && <div className="results__src">{job.url}</div>}
        </div>
        <div className="results__actions">
          {ytConnected && uploadableCount > 0 && (
            <Button size="sm" variant="yt" onClick={handleUploadAllClick} disabled={uploadingAll}>
              {uploadingAll ? "↑ Uploading…" : "↑ Upload all"}
            </Button>
          )}
          {ttConnected && ttUploadableCount > 0 && (
            <Button size="sm" variant="tt" onClick={handleTtAllClick} disabled={uploadingAll}>
              ♪ All to TikTok
            </Button>
          )}
          {igConnected && igUploadableCount > 0 && (
            <Button size="sm" variant="ig" onClick={handleIgAllClick} disabled={uploadingAll}>
              ◉ All to Instagram
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={() => setRepromptOpen(true)}>
            ✦ Find more
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setEditTarget({ clipIndex: null })}>
            ✂ Create clip
          </Button>
          <Button size="sm" onClick={onNew}>
            ＋ New job
          </Button>
        </div>
      </Card>

      {clips.length > 0 && <RetentionNotice job={job} />}

      <div className={`results__grid ${!isMobile && active ? "results__grid--preview" : ""}`}>
        <div className="results__list">
          {clips.map((c, i) => (
            <ClipCard
              key={i}
              clip={c}
              idx={i}
              ytConnected={ytConnected}
              ttConnected={ttConnected}
              igConnected={igConnected}
              isActive={active?.path === c.path}
              onPreview={() => setActive((prev) => (prev?.path === c.path ? null : c))}
              onYTUpload={() => onYTUpload(c, i)}
              onTTUpload={() => onTTUpload(c, i)}
              onIGUpload={() => onIGUpload(c, i)}
              onEdit={() => setEditTarget({ clipIndex: i, title: c.title })}
              jobId={job.job_id}
              isPro={isPro}
            />
          ))}
          {clips.length === 0 && (
            <Card flush>
              <EmptyState
                icon="🫥"
                title="No clips were generated"
                description="Try a different video, or loosen the find/exclude prompts."
                action={<Button onClick={onNew}>＋ New job</Button>}
              />
            </Card>
          )}
        </div>

        {!isMobile && active && (
          <div ref={previewRef} className="preview-panel">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 8,
              }}
            >
              <span className="t-label">Now previewing</span>
              <Button size="sm" variant="ghost" onClick={() => setActive(null)}>
                ✕
              </Button>
            </div>
            <div className="preview-panel__frame">
              <video
                src={active.presigned_url || activeToken}
                poster={active.thumbnail_url || undefined}
                controls
                autoPlay
                preload="auto"
                style={{ width: "100%", height: "100%", display: "block", background: "#000" }}
              />
            </div>
            <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
              <Tag>
                Clip {String(clips.findIndex((c) => c.path === active?.path) + 1).padStart(2, "0")}
              </Tag>
              <div className="t-sm" style={{ lineHeight: 1.4 }}>
                {active.hook || active.title}
              </div>
            </div>
          </div>
        )}
      </div>

      {repromptOpen && <RepromptModal job={job} onClose={() => setRepromptOpen(false)} />}

      {editTarget && (
        <EditClipModal
          jobId={job.job_id}
          clipIndex={editTarget.clipIndex}
          clipTitle={editTarget.title}
          onClose={() => setEditTarget(null)}
          onRendered={(childId) => {
            setEditTarget(null);
            // WorkPage keys Results by job id, so navigation remounts —
            // no full page reload needed.
            navigate(`/work?job=${childId}`);
          }}
        />
      )}

      {ytPicker && (
        <TargetPickerModal
          title="Upload all to YouTube"
          tone="yt"
          confirmLabel="Upload all"
          options={ytChannels.map((ch) => ({
            id: ch.yt_channel_id,
            label: ch.yt_channel_name || ch.yt_channel_id,
          }))}
          initial={ytChannels[0]?.yt_channel_id || ""}
          onClose={() => setYtPicker(false)}
          onConfirm={(id) => {
            setYtPicker(false);
            onUploadAll(id);
          }}
        />
      )}
      {ttPicker && (
        <TargetPickerModal
          title="Send all to TikTok"
          tone="tt"
          confirmLabel="Send all"
          disclosure={<TikTokDisclosure />}
          options={ttAccounts.map((a) => ({
            id: a.tt_open_id,
            label: a.tt_display_name || a.tt_open_id,
          }))}
          initial={ttAccounts[0]?.tt_open_id || ""}
          onClose={() => setTtPicker(false)}
          onConfirm={(id) => {
            setTtPicker(false);
            onUploadAllTikTok(id);
          }}
        />
      )}
      {igPicker && (
        <TargetPickerModal
          title="Post all to Instagram"
          tone="ig"
          confirmLabel="Post all"
          options={igAccounts.map((a) => ({
            id: a.ig_user_id,
            label: a.ig_username ? `@${a.ig_username}` : a.ig_user_id,
          }))}
          initial={igAccounts[0]?.ig_user_id || ""}
          onClose={() => setIgPicker(false)}
          onConfirm={(id) => {
            setIgPicker(false);
            onUploadAllInstagram(id);
          }}
        />
      )}
    </div>
  );
}

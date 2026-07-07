import { useEffect, useRef, useState } from "react";
import { authFetch } from "../../lib/supabase";
import {
  Modal,
  Button,
  Field,
  TextInput,
  TextArea,
  SegmentedControl,
  Banner,
  Tag,
  ProgressBar,
} from "../../components/kit";

/* YouTube upload — same fields, defaults, endpoints, and polling as the
   legacy modal; only the chrome is the v2 kit. */
export default function UploadModalYouTube({ clip, clipIndex, jobId, ytChannels, onClose, onUploaded }) {
  const isShort = (clip.duration || 0) <= 60;
  const [title, setTitle] = useState((clip.title || "") + (isShort ? " #Shorts" : ""));
  const [description, setDescription] = useState(
    [clip.hook, clip.reason, (clip.tags || []).map((t) => `#${t}`).join(" "), isShort ? "#Shorts" : ""]
      .filter(Boolean)
      .join("\n\n")
  );
  const [tags, setTags] = useState((clip.tags || []).join(", "));
  const [privacy, setPrivacy] = useState("public");
  const [selectedChannel, setSelectedChannel] = useState(ytChannels?.[0]?.yt_channel_id || "");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(null);
  const [err, setErr] = useState("");
  const pollRef = useRef(null);
  useEffect(() => () => clearInterval(pollRef.current), []);

  const upload = async () => {
    setUploading(true);
    setErr("");
    try {
      const res = await authFetch(`/api/youtube/upload/${jobId}/${clipIndex}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
          privacy_status: privacy,
          yt_channel_id: selectedChannel || undefined,
        }),
      });
      if (!res.ok) {
        setErr("Failed to start upload.");
        setUploading(false);
        return;
      }
      pollRef.current = setInterval(async () => {
        try {
          const r = await authFetch(`/api/youtube/upload_status/${jobId}/${clipIndex}`);
          const s = await r.json();
          if (s.status === "uploading") setProgress(s.progress || 0);
          if (s.status === "done") {
            clearInterval(pollRef.current);
            setProgress(100);
            setDone(s);
            setUploading(false);
            onUploaded?.();
          }
          if (s.status === "error") {
            clearInterval(pollRef.current);
            setErr(s.error || "Upload failed");
            setUploading(false);
          }
        } catch {}
      }, 2000);
    } catch {
      setErr("Failed to start upload.");
      setUploading(false);
    }
  };

  return (
    <Modal
      title={
        <>
          YouTube upload {isShort && <Tag tone="accent">Short</Tag>}
        </>
      }
      icon="▶"
      onClose={onClose}
      dismissable={!uploading}
      footer={
        !done && !uploading ? (
          <Button variant="yt" full onClick={upload}>
            ↑ Upload to YouTube
          </Button>
        ) : undefined
      }
    >
      {done ? (
        <div style={{ textAlign: "center", display: "grid", gap: 14 }}>
          <div className="t-h2" style={{ color: "var(--success)" }}>
            ✓ Uploaded!
          </div>
          <a
            href={done.url}
            target="_blank"
            rel="noreferrer"
            className="t-mono"
            style={{ color: "var(--yt)", fontSize: 13, wordBreak: "break-all" }}
          >
            {done.url}
          </a>
          <Button onClick={onClose}>Close</Button>
        </div>
      ) : uploading ? (
        <div style={{ display: "grid", gap: 10 }}>
          <div className="t-label">Uploading to YouTube…</div>
          <ProgressBar progress={progress} stripes />
          <div style={{ textAlign: "center", fontWeight: 650 }}>{progress}%</div>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          {ytChannels && ytChannels.length > 1 && (
            <Field label="Upload to">
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {ytChannels.map((ch) => (
                  <Button
                    key={ch.yt_channel_id}
                    size="sm"
                    variant={selectedChannel === ch.yt_channel_id ? "yt" : "secondary"}
                    onClick={() => setSelectedChannel(ch.yt_channel_id)}
                  >
                    {ch.yt_channel_name || "YouTube"}
                  </Button>
                ))}
              </div>
            </Field>
          )}
          <Field label="Title">
            <TextInput value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Description">
            <TextArea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
          </Field>
          <Field label="Tags (comma-separated)">
            <TextInput value={tags} onChange={(e) => setTags(e.target.value)} />
          </Field>
          <Field label="Privacy">
            <SegmentedControl
              value={privacy}
              onChange={setPrivacy}
              options={[
                { id: "public", label: "Public" },
                { id: "unlisted", label: "Unlisted" },
                { id: "private", label: "Private" },
              ]}
            />
          </Field>
          {err && <Banner tone="danger">{err}</Banner>}
        </div>
      )}
    </Modal>
  );
}

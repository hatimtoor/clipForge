import { useEffect, useRef, useState } from "react";
import { authFetch } from "../../lib/supabase";
import {
  Modal,
  Button,
  Field,
  TextArea,
  Banner,
  ProgressBar,
  SwitchRow,
} from "../../components/kit";

export function InstagramClipButton({ clip, onOpen }) {
  const st = clip.ig_upload?.status;
  if (st === "done") {
    const link = clip.ig_upload?.permalink;
    if (link)
      return (
        <a href={link} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
          <Button size="sm" variant="ig">
            ◉ On Instagram ↗
          </Button>
        </a>
      );
    return (
      <Button size="sm" variant="ig" disabled title={clip.ig_upload?.note || "Posted to Instagram"}>
        ◉ Posted
      </Button>
    );
  }
  if (st === "queued" || st === "uploading")
    return (
      <Button size="sm" variant="ig" disabled>
        ◉ Posting…
      </Button>
    );
  return (
    <Button size="sm" variant="ig" onClick={onOpen}>
      ◉ Instagram
    </Button>
  );
}

/* Instagram Reels publish — caption + share-to-feed; Instagram ingests the clip
   server-side from a presigned URL, so the poll can take a minute or two. */
export default function UploadModalInstagram({ clip, clipIndex, jobId, igAccounts, onClose, onUploaded }) {
  const tags = clip.tags || [];
  const defaultCaption = [clip.title || clip.hook || "", tags.map((t) => `#${t}`).join(" ")]
    .filter(Boolean)
    .join(" ");
  const [account, setAccount] = useState(igAccounts?.[0]?.ig_user_id || "");
  const [caption, setCaption] = useState(defaultCaption);
  const [shareToFeed, setShareToFeed] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [done, setDone] = useState(null);
  const [err, setErr] = useState("");
  const pollRef = useRef(null);
  useEffect(() => () => clearInterval(pollRef.current), []);

  const upload = async () => {
    setUploading(true);
    setErr("");
    try {
      const res = await authFetch(`/api/instagram/upload/${jobId}/${clipIndex}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ig_user_id: account || undefined,
          caption,
          share_to_feed: shareToFeed,
        }),
      });
      if (!res.ok) {
        setErr("Failed to start upload.");
        setUploading(false);
        return;
      }
      pollRef.current = setInterval(async () => {
        try {
          const r = await authFetch(`/api/instagram/upload_status/${jobId}/${clipIndex}`);
          const s = await r.json();
          if (s.status === "done") {
            clearInterval(pollRef.current);
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
      }, 3000);
    } catch {
      setErr("Failed to start upload.");
      setUploading(false);
    }
  };

  return (
    <Modal
      title="Post to Instagram"
      icon="◉"
      onClose={onClose}
      dismissable={!uploading}
      footer={
        !done && !uploading ? (
          <Button variant="ig" full onClick={upload}>
            ◉ Post Reel
          </Button>
        ) : undefined
      }
    >
      {done ? (
        <div style={{ textAlign: "center", display: "grid", gap: 12 }}>
          <div className="t-h2" style={{ color: "var(--success)" }}>
            ✓ Posted to Instagram!
          </div>
          <div className="t-sm">{done.note || "Open Instagram to see your Reel."}</div>
          {done.permalink && (
            <a href={done.permalink} target="_blank" rel="noreferrer">
              <Button variant="ig">◉ View on Instagram ↗</Button>
            </a>
          )}
          <Button onClick={onClose}>Close</Button>
        </div>
      ) : uploading ? (
        <div style={{ display: "grid", gap: 10 }}>
          <div className="t-label">Publishing Reel…</div>
          <ProgressBar progress={55} stripes />
          <div className="t-sm" style={{ color: "var(--text-2)" }}>
            Instagram is ingesting the video — this can take a minute or two.
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          {igAccounts && igAccounts.length > 1 && (
            <Field label="Post to">
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {igAccounts.map((acc) => (
                  <Button
                    key={acc.ig_user_id}
                    size="sm"
                    variant={account === acc.ig_user_id ? "ig" : "secondary"}
                    onClick={() => setAccount(acc.ig_user_id)}
                  >
                    ◉ {acc.ig_username || "Instagram"}
                  </Button>
                ))}
              </div>
            </Field>
          )}

          <Field label="Caption">
            <TextArea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={3}
              maxLength={2200}
            />
          </Field>

          <SwitchRow
            label="Also show in feed"
            hint="Off = Reels tab only"
            on={shareToFeed}
            onChange={setShareToFeed}
          />

          <Banner tone="info">
            Posts as a Reel to your connected professional (Business or Creator) account.
          </Banner>

          {err && <Banner tone="danger">{err}</Banner>}
        </div>
      )}
    </Modal>
  );
}

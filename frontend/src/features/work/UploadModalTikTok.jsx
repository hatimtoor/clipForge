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

export const TT_PRIVACY_LABELS = {
  PUBLIC_TO_EVERYONE: "Everyone",
  FOLLOWER_OF_CREATOR: "Followers",
  MUTUAL_FOLLOW_FRIENDS: "Friends only",
  SELF_ONLY: "Only me (private)",
};

/* Compliance disclosure required by TikTok's audit — must appear in every
   posting flow (single + bulk). */
export function TikTokDisclosure() {
  return (
    <Banner tone="info">
      By posting, you agree to TikTok's{" "}
      <a
        href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en"
        target="_blank"
        rel="noreferrer"
        style={{ color: "var(--accent-strong)" }}
      >
        Music Usage Confirmation
      </a>
      . Your video will be posted to your selected TikTok account.
    </Banner>
  );
}

export function TikTokClipButton({ clip, onOpen }) {
  const st = clip.tt_upload?.status;
  if (st === "done")
    return (
      <Button size="sm" variant="tt" disabled title={clip.tt_upload?.note || "Sent to TikTok"}>
        ♪ Sent
      </Button>
    );
  if (st === "queued" || st === "uploading")
    return (
      <Button size="sm" variant="tt" disabled>
        ♪ Sending…
      </Button>
    );
  return (
    <Button size="sm" variant="tt" onClick={onOpen}>
      ♪ TikTok
    </Button>
  );
}

/* TikTok upload — audit-compliant: creator-info fetch, required privacy pick,
   comment/duet/stitch honoring account-level disable flags, music disclosure.
   Endpoints, payload, and polling identical to the legacy modal. */
export default function UploadModalTikTok({ clip, clipIndex, jobId, ttAccounts, onClose, onUploaded }) {
  const tags = clip.tags || [];
  const defaultCaption = [clip.title || clip.hook || "", tags.map((t) => `#${t}`).join(" ")]
    .filter(Boolean)
    .join(" ");
  const [account, setAccount] = useState(ttAccounts?.[0]?.tt_open_id || "");
  const [caption, setCaption] = useState(defaultCaption);
  const [info, setInfo] = useState(null);
  const [loadingInfo, setLoadingInfo] = useState(true);
  const [privacy, setPrivacy] = useState("");
  const [allowComment, setAllowComment] = useState(true);
  const [allowDuet, setAllowDuet] = useState(true);
  const [allowStitch, setAllowStitch] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [done, setDone] = useState(null);
  const [err, setErr] = useState("");
  const pollRef = useRef(null);
  useEffect(() => () => clearInterval(pollRef.current), []);

  useEffect(() => {
    let cancelled = false;
    setLoadingInfo(true);
    setInfo(null);
    setPrivacy("");
    setErr("");
    (async () => {
      try {
        const q = account ? `?tt_open_id=${encodeURIComponent(account)}` : "";
        const r = await authFetch(`/api/tiktok/creator_info${q}`);
        const d = await r.json();
        if (cancelled) return;
        if (!r.ok) {
          setErr(d.detail || "Couldn't load TikTok account info.");
          setLoadingInfo(false);
          return;
        }
        setInfo(d);
        setAllowComment(!d.comment_disabled);
        setAllowDuet(!d.duet_disabled);
        setAllowStitch(!d.stitch_disabled);
        setLoadingInfo(false);
      } catch {
        if (!cancelled) {
          setErr("Couldn't reach server.");
          setLoadingInfo(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [account]);

  const upload = async () => {
    if (!privacy) {
      setErr("Please choose who can view this video.");
      return;
    }
    setUploading(true);
    setErr("");
    try {
      const res = await authFetch(`/api/tiktok/upload/${jobId}/${clipIndex}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tt_open_id: account || undefined,
          title: caption,
          privacy_level: privacy,
          disable_comment: !allowComment,
          disable_duet: !allowDuet,
          disable_stitch: !allowStitch,
        }),
      });
      if (!res.ok) {
        setErr("Failed to start upload.");
        setUploading(false);
        return;
      }
      pollRef.current = setInterval(async () => {
        try {
          const r = await authFetch(`/api/tiktok/upload_status/${jobId}/${clipIndex}`);
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
      }, 2000);
    } catch {
      setErr("Failed to start upload.");
      setUploading(false);
    }
  };

  const privacyOptions = info?.privacy_level_options || [];

  return (
    <Modal
      title="Post to TikTok"
      icon="♪"
      onClose={onClose}
      dismissable={!uploading}
      footer={
        !done && !uploading && !loadingInfo ? (
          <Button variant="tt" full onClick={upload} disabled={!privacy}>
            ♪ Post to TikTok
          </Button>
        ) : undefined
      }
    >
      {done ? (
        <div style={{ textAlign: "center", display: "grid", gap: 12 }}>
          <div className="t-h2" style={{ color: "var(--success)" }}>
            ✓ Sent to TikTok!
          </div>
          <div className="t-sm">{done.note || "Open the TikTok app to see it."}</div>
          <Button onClick={onClose}>Close</Button>
        </div>
      ) : uploading ? (
        <div style={{ display: "grid", gap: 10 }}>
          <div className="t-label">Sending to TikTok…</div>
          <ProgressBar progress={50} stripes />
        </div>
      ) : loadingInfo ? (
        <div className="t-sm" style={{ textAlign: "center", padding: "18px 0" }}>
          Loading your TikTok account…
        </div>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          {ttAccounts && ttAccounts.length > 1 && (
            <Field label="Post to">
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {ttAccounts.map((acc) => (
                  <Button
                    key={acc.tt_open_id}
                    size="sm"
                    variant={account === acc.tt_open_id ? "tt" : "secondary"}
                    onClick={() => setAccount(acc.tt_open_id)}
                  >
                    ♪ {acc.tt_display_name || "TikTok"}
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

          <Field label="Who can view this video">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {privacyOptions.map((o) => (
                <Button
                  key={o}
                  size="sm"
                  variant={privacy === o ? "primary" : "secondary"}
                  onClick={() => setPrivacy(o)}
                >
                  {TT_PRIVACY_LABELS[o] || o}
                </Button>
              ))}
            </div>
          </Field>

          <Field label="Allow">
            <div style={{ display: "grid", gap: 8 }}>
              <SwitchRow
                label="Comments"
                on={allowComment}
                onChange={setAllowComment}
                disabled={info?.comment_disabled}
                hint={info?.comment_disabled ? "Disabled on this account" : undefined}
              />
              <SwitchRow
                label="Duet"
                on={allowDuet}
                onChange={setAllowDuet}
                disabled={info?.duet_disabled}
                hint={info?.duet_disabled ? "Disabled on this account" : undefined}
              />
              <SwitchRow
                label="Stitch"
                on={allowStitch}
                onChange={setAllowStitch}
                disabled={info?.stitch_disabled}
                hint={info?.stitch_disabled ? "Disabled on this account" : undefined}
              />
            </div>
          </Field>

          <TikTokDisclosure />

          {err && <Banner tone="danger">{err}</Banner>}
        </div>
      )}
    </Modal>
  );
}

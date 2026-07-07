import { useState } from "react";
import { useApp } from "../../context/AppContext";
import { authFetch } from "../../lib/supabase";
import { Modal, Button, Field, TextInput, Banner } from "../../components/kit";

/* Schedule-a-post (Pro): pick platform/account + a time; the server publishes
   automatically. Payload identical to the legacy modal. */
export default function ScheduleModal({ clip, idx, jobId, onClose }) {
  const { ytStatus, ttStatus } = useApp();
  const targets = [
    ...(ytStatus?.channels || []).map((c) => ({
      key: `yt:${c.yt_channel_id}`,
      platform: "youtube",
      id: c.yt_channel_id,
      label: `▶ YT: ${c.yt_channel_name || c.yt_channel_id}`,
    })),
    ...(ttStatus?.accounts || []).map((a) => ({
      key: `tt:${a.tt_open_id}`,
      platform: "tiktok",
      id: a.tt_open_id,
      label: `♪ TT: ${a.tt_display_name || a.tt_open_id}`,
    })),
  ];
  const [target, setTarget] = useState(targets[0]?.key || "");
  const [title, setTitle] = useState(clip.title || "");
  const [when, setWhen] = useState(() => {
    const d = new Date(Date.now() + 3600e3);
    d.setMinutes(0, 0, 0);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    const t = targets.find((x) => x.key === target);
    if (!t) {
      setErr("Connect a YouTube/TikTok account first (Connections page)");
      return;
    }
    const dt = new Date(when);
    if (isNaN(dt) || dt <= new Date()) {
      setErr("Pick a future time");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const body = {
        job_id: jobId,
        clip_index: idx,
        platform: t.platform,
        target_id: t.id,
        title: title.trim() || undefined,
        description:
          t.platform === "youtube"
            ? [clip.hook, clip.reason, (clip.tags || []).map((x) => `#${x}`).join(" ")]
                .filter(Boolean)
                .join("\n\n")
            : undefined,
        publish_at: dt.toISOString(),
      };
      const res = await authFetch("/api/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) {
        setErr(d.detail || "Scheduling failed");
        setBusy(false);
        return;
      }
      onClose(true);
    } catch {
      setErr("Scheduling failed");
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Schedule this clip"
      icon="⏰"
      size="sm"
      onClose={() => onClose(false)}
      footer={
        <>
          <Button variant="ghost" onClick={() => onClose(false)}>
            Cancel
          </Button>
          <Button disabled={busy || !targets.length} onClick={submit}>
            {busy ? "…" : "⏰ Schedule"}
          </Button>
        </>
      }
    >
      <div style={{ display: "grid", gap: 14 }}>
        {targets.length === 0 ? (
          <Banner tone="warning">
            No connected accounts — link YouTube or TikTok on the Connections page first.
          </Banner>
        ) : (
          <Field label="Post to">
            <div style={{ display: "grid", gap: 6 }}>
              {targets.map((t) => (
                <Button
                  key={t.key}
                  size="sm"
                  variant={target === t.key ? "primary" : "secondary"}
                  onClick={() => setTarget(t.key)}
                  style={{ justifyContent: "flex-start" }}
                >
                  {t.label}
                </Button>
              ))}
            </div>
          </Field>
        )}
        <Field label="Post title">
          <TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="post title" />
        </Field>
        <Field label="When" hint="Max 6 days out — clips expire from storage after ~7.">
          <TextInput type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        </Field>
        {err && <Banner tone="danger">{err}</Banner>}
      </div>
    </Modal>
  );
}

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { authFetch } from "../lib/supabase";
import {
  Button, Card, Tag, ProBadge, Banner, EmptyState,
  Field, TextInput, Select, SwitchRow, SegmentedControl,
  CollapsibleSection, ProgressBar, Tour,
} from "../components/kit";
import {
  useChannelSettingsForm,
  ChannelSettingsChips,
  PromptsAndMusic,
} from "../features/create/ChannelClipSettings";

const DAY_OPTIONS = [
  { value: 30, label: "30 days back" },
  { value: 60, label: "60 days back" },
  { value: 90, label: "90 days back" },
  { value: 180, label: "6 months back" },
  { value: 365, label: "1 year back" },
];
const VPD_OPTIONS = [1, 2, 3, 5].map((n) => ({ id: n, label: String(n) }));

const TOUR_STEPS = [
  {
    target: "#tour-dg-add",
    title: "Clip the back-catalog",
    text: "Digest works through a channel's whole history, a few videos per day, hands-free. Add a channel, pick how far back to look and the daily pace on its card.",
  },
];

function DigestCard({ bf, ytStatus, ttStatus, onRemove, onRunNow, onPatch }) {
  const isCompleted = bf.status === "completed";
  const processed = (bf.processed_video_ids || []).length;
  const total = bf.total_videos || 0;
  const progressMax = total || processed + 1;

  const [daysBack, setDaysBack] = useState(bf.days_back ?? 30);
  const [videosPerDay, setVideosPerDay] = useState(bf.videos_per_day ?? 2);
  const [ytChannelId, setYtChannelId] = useState(bf.yt_upload_channel_id ?? "");
  const [ttAccountId, setTtAccountId] = useState(bf.tt_open_id ?? "");
  const [autoUpload, setAutoUpload] = useState(bf.auto_upload ?? false);

  const ytChannels = ytStatus?.channels || [];
  const ttAccounts = ttStatus?.accounts || [];
  const patch = (fields) => onPatch(bf.id, fields);

  // Same chip-strip + modals as the create page, PATCHing this digest channel.
  const settings = useChannelSettingsForm(bf, patch);

  return (
    <Card flush>
      {/* Channel info, progress, per-video settings */}
      <div style={{ padding: "16px 20px", display: "grid", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", minWidth: 0 }}>
          <span style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>
            {bf.channel_name || bf.channel_url}
          </span>
          {isCompleted && <Tag tone="success">✓ Done</Tag>}
        </div>
        <div className="t-sm" style={{ color: "var(--text-3)", wordBreak: "break-all" }}>
          {bf.channel_url}
        </div>

        {isCompleted ? (
          <Banner tone="success">
            All {total} videos from the {bf.days_back}-day window have been clipped and posted!
          </Banner>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ flex: 1 }}>
                <ProgressBar progress={progressMax > 0 ? Math.min(100, Math.round((processed / progressMax) * 100)) : 0} />
              </div>
              <span className="t-sm" style={{ color: "var(--text-3)", flexShrink: 0 }}>
                {processed}/{progressMax}
              </span>
            </div>
            <ChannelSettingsChips
              settings={settings}
              videoId={(bf.processed_video_ids || [])[0] || null}
              minDurMax={120}
            />
          </>
        )}
      </div>

      {!isCompleted && (
        <div style={{ borderTop: "1px solid var(--line)", padding: "6px 20px" }}>
          <CollapsibleSection title="AI direction & music" hint="Find/exclude prompts, background music">
            <PromptsAndMusic source={bf} patch={patch} />
          </CollapsibleSection>
        </div>
      )}

      {/* Pace, destinations, actions — stacked below, like the Watchlist card */}
      <div style={{ borderTop: "1px solid var(--line)", padding: "14px 20px", display: "grid", gap: 12 }}>
        <SwitchRow label="🎉 Auto-upload" hint="Post finished clips automatically"
          on={autoUpload}
          onChange={(v) => { setAutoUpload(v); patch({ auto_upload: v }); }} />

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
          <Field label="Look back">
            <Select value={daysBack}
              onChange={(e) => { setDaysBack(Number(e.target.value)); patch({ days_back: Number(e.target.value) }); }}>
              {DAY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Videos / day">
            <SegmentedControl value={videosPerDay} options={VPD_OPTIONS}
              onChange={(id) => { setVideosPerDay(id); patch({ videos_per_day: id }); }} />
          </Field>
        </div>

        {ytChannels.length > 0 && (
          <Field label={<span style={{ color: "var(--yt)" }}>▶ YouTube channel</span>}>
            {ytChannels.length === 1 ? (
              <Tag>{ytChannels[0].yt_channel_name || "YouTube"}</Tag>
            ) : (
              <Select value={ytChannelId}
                onChange={(e) => { setYtChannelId(e.target.value); patch({ yt_upload_channel_id: e.target.value }); }}>
                {ytChannels.map((c) => (
                  <option key={c.yt_channel_id} value={c.yt_channel_id}>
                    {c.yt_channel_name || c.yt_channel_id}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}

        {ttAccounts.length > 0 && (
          <Field label="♪ TikTok account">
            <Select value={ttAccountId}
              onChange={(e) => { setTtAccountId(e.target.value); patch({ tt_open_id: e.target.value || null }); }}>
              <option value="">— off —</option>
              {ttAccounts.map((a) => (
                <option key={a.tt_open_id} value={a.tt_open_id}>
                  {a.tt_display_name || a.tt_open_id}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {!isCompleted && (
            <Button size="sm" variant="secondary" onClick={() => onRunNow(bf.id)}>
              ▶ Run now
            </Button>
          )}
          <Button size="sm" variant="danger" onClick={() => onRemove(bf.id)}>
            Remove
          </Button>
        </div>
      </div>
    </Card>
  );
}

export default function DigestPage() {
  const { ytStatus, ttStatus, isPro } = useApp();
  const navigate = useNavigate();
  const [backfills, setBackfills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");
  const [urlInput, setUrlInput] = useState("");

  const fetchBackfills = async () => {
    try {
      const res = await authFetch("/api/backfill");
      const data = await res.json();
      setBackfills(Array.isArray(data) ? data : []);
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => {
    fetchBackfills();
    const i = setInterval(fetchBackfills, 15000);
    return () => clearInterval(i);
  }, []);

  const handleAdd = async () => {
    if (!urlInput.trim()) return;
    setAdding(true); setAddError("");
    try {
      const res = await authFetch("/api/backfill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel_url: urlInput.trim() }),
      });
      if (!res.ok) { const d = await res.json(); setAddError(d.detail || "Failed to add channel"); }
      else { setUrlInput(""); fetchBackfills(); }
    } catch { setAddError("Cannot reach server."); }
    setAdding(false);
  };

  const handleRemove = async (id) => {
    if (!window.confirm("Remove this digest channel?")) return;
    await authFetch(`/api/backfill/${id}`, { method: "DELETE" });
    fetchBackfills();
  };

  const handleRunNow = async (id) => {
    await authFetch(`/api/backfill/${id}/run`, { method: "POST" });
    fetchBackfills();
  };

  const handlePatch = async (id, updates) => {
    await authFetch(`/api/backfill/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
  };

  if (!isPro) {
    return (
      <div style={{ maxWidth: 1000, margin: "0 auto", display: "grid", gap: 20 }}>
        <div className="page-head">
          <div className="page-head__title">Digest</div>
          <div className="page-head__sub">
            Add a channel — ClipForge works through its backlog a few videos per day.
          </div>
        </div>
        <Banner tone="info" title="Channel Digest is a Pro feature" action={<ProBadge />}>
          Backfill a channel's entire history — turn every past video into clips, fully hands-free.
        </Banner>
        <Card flush>
          <EmptyState
            icon="📼"
            title="The back-catalog is waiting"
            description="Upgrade to Pro and the forge will chew through years of uploads, a few videos a day."
            action={<Button onClick={() => navigate("/upgrade")}>⚡ Upgrade to Pro</Button>}
          />
        </Card>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", display: "grid", gap: 20 }}>
      <div className="page-head">
        <div className="page-head__title">Digest</div>
        <div className="page-head__sub">
          Add a channel — ClipForge works through its backlog a few videos per day.
        </div>
      </div>

      <Card id="tour-dg-add">
        <Field label="Add channel">
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 260px" }}>
              <TextInput value={urlInput}
                placeholder="https://youtube.com/@channel or /channel/UCxxx"
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAdd()} />
            </div>
            <Button onClick={handleAdd} disabled={adding || !urlInput.trim()}>
              {adding ? "Resolving…" : "＋ Add"}
            </Button>
          </div>
        </Field>
        {addError && (
          <div style={{ marginTop: 12 }}>
            <Banner tone="danger" title="Couldn't add the channel">
              {addError}
            </Banner>
          </div>
        )}
      </Card>

      {loading ? (
        <div className="t-sm" style={{ color: "var(--text-3)" }}>Loading…</div>
      ) : backfills.length === 0 ? (
        <Card flush>
          <EmptyState
            icon="📼"
            title="No channels digesting"
            description="Add a YouTube channel URL above and the forge starts working through its backlog."
          />
        </Card>
      ) : (
        <div style={{ display: "grid", gap: 14 }}>
          {backfills.map((bf) => (
            <DigestCard key={bf.id} bf={bf} ytStatus={ytStatus} ttStatus={ttStatus}
              onRemove={handleRemove} onRunNow={handleRunNow} onPatch={handlePatch} />
          ))}
        </div>
      )}

      <Card sub>
        <div className="t-label" style={{ marginBottom: 8 }}>How it works</div>
        <div className="t-sm" style={{ lineHeight: 1.6 }}>
          ClipForge processes a few videos per day from a channel's backlog until all are done.
          <br />
          Set <strong>Look back</strong> to control how far back in the channel's history to go.
          <br />
          <strong>Videos / day</strong> controls the daily pace. Clips are auto-uploaded if a
          YouTube channel is selected.
        </div>
      </Card>

      <Tour steps={TOUR_STEPS} storageKey="cf_tour_digest_v1" />
    </div>
  );
}

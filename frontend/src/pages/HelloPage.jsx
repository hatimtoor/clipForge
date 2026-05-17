import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { C, BORDER, SHADOW_SM, SHADOW, KEYFRAMES } from "../lib/theme";
import { PixelBtn, PixelCard, NumField, Toggle, Tag } from "../components/ui";
import Header from "../components/Header";
import { useApp } from "../context/AppContext";
import { authFetch } from "../lib/supabase";
import { useMobile } from "../hooks/useMobile";

export default function HelloPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isPro, setJobActive } = useApp();

  const [url, setUrl] = useState(searchParams.get("url") || "");
  const [maxClips, setMaxClips] = useState(5);
  const [minDur, setMinDur] = useState(30);
  const [maxDur, setMaxDur] = useState(90);
  const [reframe, setReframe] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const valid = /youtu\.?be/.test(url);
  const isMobile = useMobile();

  const handleSubmit = async () => {
    if (!url.trim()) { setError("Paste a YouTube URL first."); return; }
    setError(""); setLoading(true);
    try {
      const res = await authFetch("/api/clip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, max_clips: maxClips, min_duration: minDur, max_duration: maxDur, reframe }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail || "Failed to start job.");
        setLoading(false);
        return;
      }
      setJobActive(data.job_id);
      navigate(`/work?job=${data.job_id}`);
    } catch {
      setError("Failed to start job. Is the server running?");
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", overflowX: "clip" }}>
      <style>{KEYFRAMES}</style>
      <Header />
      <div className="fade" style={{ padding: isMobile ? "16px 16px 48px" : "32px 32px 64px", maxWidth: 1320, margin: "0 auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "minmax(0,1fr)" : "minmax(0,1.55fr) minmax(0,1fr)", gap: isMobile ? 16 : 32, alignItems: "start" }}>
          <PixelCard color={C.cream} padding={isMobile ? 18 : 32} style={isMobile ? { boxShadow: "none" } : {}}>
            <div className="pixel" style={{ fontSize: 10, color: C.hotDeep, marginBottom: 16 }}>{`>`} NEW JOB - STANDING BY</div>
            <h1 className="pixel" style={{ fontSize: isMobile ? 20 : 30, lineHeight: 1.3, color: C.ink, marginBottom: 14 }}>
              Drop a long video.<br />
              <span style={{ color: C.signalDeep }}>Pull the moments<br />that travel.</span>
            </h1>
            <p className="vt" style={{ fontSize: isMobile ? 18 : 22, color: C.dim2, lineHeight: 1.4, marginBottom: 28 }}>
              ⚡ One YouTube link in. <strong style={{ color: C.ink }}>Up to 10 viral-ready shorts</strong> out — captions burned, hooks scored, ready to ship. ✂️
            </p>

            <div className="pixel" style={{ fontSize: 9, color: C.dim2, marginBottom: 8 }}>YOUTUBE URL</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", background: C.paper, border: BORDER, boxShadow: isMobile ? "none" : (valid ? `4px 4px 0 ${C.signalDeep}` : `4px 4px 0 ${C.ink}`), marginBottom: 24, transition: "box-shadow .15s" }}>
              <span className="pixel" style={{ fontSize: 12, color: valid ? C.signalDeep : C.dim }}>{`>`}</span>
              <input value={url} onChange={e => setUrl(e.target.value)}
                onKeyDown={e => e.key === "Enter" && valid && handleSubmit()}
                placeholder="https://youtube.com/watch?v="
                className="mono" style={{ flex: 1, background: "transparent", color: C.ink, fontSize: 15, fontWeight: 500, minWidth: 0 }} />
              {url && <button onClick={() => setUrl("")} className="pixel" style={{ background: "transparent", color: C.dim, fontSize: 9, cursor: "pointer" }}>x</button>}
              {valid && <Tag color={C.signalDeep} bg={C.signal}>v OK</Tag>}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 24 }}>
              <NumField label="MAX CLIPS" value={maxClips} setValue={setMaxClips} min={1} max={10} step={1} bg={C.lavender} />
              <NumField label="MIN DUR" suffix="s" value={minDur} setValue={setMinDur} min={15} max={60} step={5} bg={C.peach} />
              <NumField label="MAX DUR" suffix="s" value={maxDur} setValue={setMaxDur} min={30} max={180} step={10} bg={C.amber} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 24 }}>
              <Toggle on={true} setOn={() => {}} label="HOOKS" hint="find the line that travels" />
              <Toggle on={true} setOn={() => {}} label="CAPS" hint="burn word-by-word subs" />
              {isPro
                ? <Toggle on={reframe} setOn={setReframe} label="9:16" hint="auto-reframe speaker to portrait" />
                : <button className="pixel" style={{ textAlign: "left", padding: 14, background: C.cream2, color: C.dim, border: BORDER, boxShadow: SHADOW_SM, cursor: "not-allowed", opacity: .7 }} disabled>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <span style={{ fontSize: 10 }}>9:16</span>
                      <Tag bg={C.amber} color={C.ink}>PRO</Tag>
                    </div>
                    <div className="vt" style={{ fontSize: 14, color: C.dim2, letterSpacing: 0, textTransform: "none", lineHeight: 1.2 }}>upgrade to unlock reframe</div>
                  </button>
              }
            </div>

            {error && (
              <div className="pixel" style={{ padding: "10px 12px", background: `${C.hot}55`, border: `2px solid ${C.hotDeep}`, color: C.hotDeep, fontSize: 9, marginBottom: 16 }}>
                ! {error}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 18, borderTop: `2px dashed ${C.ink}33`, gap: 14, flexWrap: "wrap" }}>
              <div className="vt" style={{ fontSize: 18, color: C.dim2 }}>Ctrl+V to paste · Enter to forge · est. 2-4 min</div>
              <PixelBtn color="hot" size="lg" onClick={handleSubmit} disabled={!valid || loading}>
                {loading ? "STARTING..." : `> ROLL TAPE`}
              </PixelBtn>
            </div>
          </PixelCard>

          <aside style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <PixelCard color={C.paper} padding={22} style={isMobile ? { boxShadow: "none" } : {}}>
              <div className="pixel" style={{ fontSize: 10, color: C.dim2, marginBottom: 14 }}>WHAT WE LOOK FOR</div>
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 14 }}>
                {[
                  ["⚡", "Tension shifts", "Moments where energy changes register."],
                  ["💰", "Numbers & names", "Specific dollar figures, ages, places."],
                  ["🌶️", "Contrarian frames", "Statements that invite disagreement."],
                  ["💬", "Confessions", "First-person admissions land everywhere."],
                ].map(([emoji, h, d]) => (
                  <li key={h} style={{ display: "grid", gridTemplateColumns: "32px 1fr", gap: 12, alignItems: "start" }}>
                    <div style={{ fontSize: 20 }}>{emoji}</div>
                    <div>
                      <div className="pixel" style={{ fontSize: 10, color: C.ink }}>{h}</div>
                      <div className="vt" style={{ fontSize: 18, color: C.dim2, lineHeight: 1.3, marginTop: 3 }}>{d}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </PixelCard>

            <PixelCard color={C.lavender} padding={20} style={isMobile ? { boxShadow: "none" } : {}}>
              <div className="pixel" style={{ fontSize: 10, color: C.ink, marginBottom: 10 }}><span style={{ fontSize: 20 }}>💁‍♂️</span> TIP</div>
              <p className="vt" style={{ fontSize: 18, color: C.ink, lineHeight: 1.35 }}>
                Long videos can take 5-10 min. Your job keeps running on the server even if you close this tab — find it under <strong>ARCHIVE</strong>.
              </p>
            </PixelCard>
          </aside>
        </div>
      </div>
    </div>
  );
}

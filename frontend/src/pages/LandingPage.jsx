import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { C, BORDER, BORDER_SM, SHADOW, SHADOW_SM, KEYFRAMES } from "../lib/theme";
import { PixelSprite, ANVIL, ANVIL_PAL, HAMMER, HAMMER_PAL, PixelBtn, PixelCard, Tag } from "../components/ui";
import { useMobile } from "../hooks/useMobile";

function LandingHeader({ onLogin, onSignup, isMobile }) {
  return (
    <header style={{ padding: isMobile ? "14px 16px" : "24px 40px", display: "flex", alignItems: "center", gap: 16, maxWidth: 1320, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <PixelSprite data={ANVIL} palette={ANVIL_PAL} size={isMobile ? 4 : 5} />
        <div className="pixel" style={{ fontSize: isMobile ? 16 : 22, color: C.ink, lineHeight: 1 }}>
          <span style={{ color: C.hotDeep }}>CLIP</span><span>FORGE</span>
        </div>
      </div>
      <div style={{ flex: 1 }} />
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <PixelBtn color="cream" size="sm" onClick={onLogin}>LOG IN</PixelBtn>
        {!isMobile && <PixelBtn color="hot" size="sm" onClick={onSignup}>GET STARTED</PixelBtn>}
      </div>
    </header>
  );
}

function HeroSection({ onSignup, isMobile }) {
  return (
    <section style={{ padding: isMobile ? "40px 16px 56px" : "72px 40px 96px", maxWidth: 1320, margin: "0 auto", textAlign: "center" }}>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 10, background: C.amber, border: BORDER, boxShadow: SHADOW_SM, padding: "8px 16px", marginBottom: 28 }}>
        <span className="pixel" style={{ fontSize: 8, color: C.ink }}>⚡ AI-POWERED CLIP EXTRACTION</span>
      </div>

      <h1 className="pixel" style={{ fontSize: isMobile ? 22 : 40, lineHeight: 1.4, color: C.ink, marginBottom: 24, maxWidth: 820, margin: "0 auto 24px" }}>
        One long video.<br />
        <span style={{ color: C.hotDeep }}>Ten viral shorts.</span><br />
        Fully automatic.
      </h1>

      <p className="vt" style={{ fontSize: isMobile ? 20 : 26, color: C.dim2, lineHeight: 1.5, maxWidth: 600, margin: "0 auto 40px" }}>
        Drop any YouTube link. ClipForge's AI finds the best moments, burns captions, scores hooks, and hands you shorts ready to post — in under 5 minutes.
      </p>

      <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: 14, justifyContent: "center", alignItems: "center", marginBottom: 56 }}>
        <PixelBtn color="hot" size="lg" onClick={onSignup}>
          &gt; FORGE MY FIRST CLIPS — FREE
        </PixelBtn>
        <div className="vt" style={{ fontSize: 18, color: C.dim2 }}>No credit card · up to 30 free clips/month</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: isMobile ? 10 : 16, maxWidth: 780, margin: "0 auto" }}>
        {[
          ["< 5 min", "turnaround"],
          ["10 clips", "per video"],
          ["100%", "auto captions"],
          ["0 editing", "required"],
        ].map(([stat, label]) => (
          <div key={label} style={{ background: C.cream, border: BORDER, boxShadow: SHADOW_SM, padding: isMobile ? "14px 10px" : "18px 12px", textAlign: "center" }}>
            <div className="pixel" style={{ fontSize: isMobile ? 12 : 16, color: C.hotDeep, marginBottom: 6 }}>{stat}</div>
            <div className="vt" style={{ fontSize: isMobile ? 16 : 18, color: C.dim2 }}>{label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function fmtStat(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1).replace(/\.0$/, "") + "M";
  if (n >= 1_000)     return (n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1).replace(/\.0$/, "") + "K";
  return String(n);
}

function AnimatedStat({ value, label, isMobile }) {
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);
  useEffect(() => {
    const from = fromRef.current, to = value || 0, dur = 1200, start = performance.now();
    let raf;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);          // ease-out
      setDisplay(Math.round(from + (to - from) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = to;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return (
    <div style={{ background: C.cream, border: BORDER, boxShadow: SHADOW_SM, padding: isMobile ? "16px 10px" : "22px 14px", textAlign: "center" }}>
      <div className="pixel" style={{ fontSize: isMobile ? 16 : 26, color: C.hotDeep, marginBottom: 6 }}>{fmtStat(display)}</div>
      <div className="vt" style={{ fontSize: isMobile ? 14 : 17, color: C.dim2 }}>{label}</div>
    </div>
  );
}

function LiveStats({ isMobile }) {
  const [stats, setStats] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = () => fetch("/api/stats/public").then(r => r.json()).then(d => { if (alive) setStats(d); }).catch(() => {});
    load();
    const id = setInterval(load, 30000);  // refresh every 30s for a "live" feel
    return () => { alive = false; clearInterval(id); };
  }, []);
  // Don't render until there's real data to brag about.
  if (!stats || ((stats.videos || 0) === 0 && (stats.views || 0) === 0)) return null;
  const items = [
    [stats.videos || 0,      "videos published"],
    [stats.views || 0,       "views generated"],
    [stats.likes || 0,       "likes earned"],
    [stats.subscribers || 0, "combined subscribers"],
  ];
  return (
    <section style={{ padding: isMobile ? "0 16px 44px" : "0 40px 72px", maxWidth: 1320, margin: "0 auto" }}>
      <div style={{ textAlign: "center", marginBottom: isMobile ? 16 : 22 }}>
        <span className="pixel" style={{ fontSize: 8, color: C.signalDeep }}>
          <span style={{ animation: "blink 1.2s steps(1) infinite" }}>●</span> LIVE — REAL CLIPS, REAL RESULTS
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: isMobile ? 10 : 16 }}>
        {items.map(([val, label]) => <AnimatedStat key={label} value={val} label={label} isMobile={isMobile} />)}
      </div>
    </section>
  );
}

function HowItWorksSection({ isMobile }) {
  const steps = [
    {
      num: "01",
      color: C.hot,
      icon: <PixelSprite data={ANVIL} palette={ANVIL_PAL} size={3} />,
      title: "PASTE A LINK",
      desc: "Drop any YouTube URL — podcast, interview, long-form vlog, lecture. ClipForge handles everything from 10 minutes to 3 hours.",
    },
    {
      num: "02",
      color: C.amber,
      icon: <span style={{ fontSize: 28 }}>🤖</span>,
      title: "AI FINDS THE GOLD",
      desc: "Every word gets transcribed. Our AI reads the full transcript and scores each segment for virality — tension, hooks, confessions, numbers.",
    },
    {
      num: "03",
      color: C.signal,
      icon: <PixelSprite data={HAMMER} palette={HAMMER_PAL} size={3} />,
      title: "DOWNLOAD & POST",
      desc: "Captions burned in word-by-word. Clips trimmed frame-perfect. Download all at once or push straight to YouTube Shorts with one click.",
    },
  ];

  return (
    <section style={{ padding: isMobile ? "40px 16px" : "72px 40px", background: `${C.ink}08` }}>
      <div style={{ maxWidth: 1320, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: isMobile ? 28 : 48 }}>
          <div className="pixel" style={{ fontSize: 8, color: C.dim2, marginBottom: 12 }}>&gt; HOW IT WORKS</div>
          <h2 className="pixel" style={{ fontSize: isMobile ? 16 : 24, color: C.ink }}>Three steps. Done.</h2>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: isMobile ? 14 : 24 }}>
          {steps.map((step, i) => (
            <PixelCard key={step.num} color={C.cream} padding={isMobile ? 20 : 28} style={{ position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", top: 12, right: 16 }}>
                <span className="pixel" style={{ fontSize: 28, color: `${C.ink}18` }}>{step.num}</span>
              </div>
              <div style={{ width: 48, height: 48, background: step.color, border: BORDER, boxShadow: SHADOW_SM, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 18 }}>
                {step.icon}
              </div>
              <div className="pixel" style={{ fontSize: 10, color: C.ink, marginBottom: 10 }}>{step.title}</div>
              <p className="vt" style={{ fontSize: 18, color: C.dim2, lineHeight: 1.4, margin: 0 }}>{step.desc}</p>
            </PixelCard>
          ))}
        </div>
      </div>
    </section>
  );
}

function FeaturesSection({ isMobile }) {
  const signals = [
    { emoji: "⚡", title: "Tension shifts", desc: "Moments where energy spikes or drops. These are natural cut points and attention magnets.", color: C.hot },
    { emoji: "💰", title: "Numbers & names", desc: "Specific dollar figures, dates, ages, places. Concrete details stop the scroll.", color: C.amber },
    { emoji: "🌶️", title: "Contrarian frames", desc: "Statements that invite disagreement. Polarizing takes drive saves, shares, and comments.", color: C.signal },
    { emoji: "💬", title: "Confessions", desc: "First-person admissions. Vulnerability lands universally — every platform, every niche.", color: C.lavender },
    { emoji: "🎯", title: "Strong openers", desc: "The first five seconds decide everything. We score each clip's cold-open hook strength.", color: C.peach },
    { emoji: "📈", title: "Story arcs", desc: "Clips that have a clear setup → conflict → resolution outperform pure highlights every time.", color: C.cream2 },
  ];

  return (
    <section style={{ padding: isMobile ? "40px 16px" : "72px 40px" }}>
      <div style={{ maxWidth: 1320, margin: "0 auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? 24 : 48, alignItems: "center" }}>
          <div>
            <div className="pixel" style={{ fontSize: 8, color: C.dim2, marginBottom: 12 }}>&gt; SIGNAL DETECTION</div>
            <h2 className="pixel" style={{ fontSize: isMobile ? 16 : 24, color: C.ink, lineHeight: 1.5, marginBottom: 20 }}>
              We don't just cut clips.<br />
              <span style={{ color: C.hotDeep }}>We find the moments<br />that travel.</span>
            </h2>
            <p className="vt" style={{ fontSize: isMobile ? 18 : 22, color: C.dim2, lineHeight: 1.5, marginBottom: 24 }}>
              ClipForge reads every word of your transcript and applies a multi-signal virality model. Each clip gets a hook score so you know exactly what to post first.
            </p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Tag bg={C.hot} color={C.ink}>Hook scoring</Tag>
              <Tag bg={C.amber} color={C.ink}>Transcript analysis</Tag>
              <Tag bg={C.signal} color={C.ink}>Frame detection</Tag>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? 10 : 12 }}>
            {signals.map((s) => (
              <div key={s.title} style={{ background: C.cream, border: BORDER, boxShadow: SHADOW_SM, padding: isMobile ? 14 : 16 }}>
                <div style={{ fontSize: 22, marginBottom: 8 }}>{s.emoji}</div>
                <div className="pixel" style={{ fontSize: 8, color: C.ink, marginBottom: 6 }}>{s.title}</div>
                <div className="vt" style={{ fontSize: 15, color: C.dim2, lineHeight: 1.3 }}>{s.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function ToolsSection({ isMobile }) {
  const tools = [
    { icon: "🎬", color: C.peach,    tag: null,           title: "BLUR BACKGROUND",    desc: "Landscape clip centered on a blurred, scaled background — full 9:16 frame, no black bars, no crop." },
    { icon: "🎵", color: C.signal,   tag: null,           title: "BACKGROUND MUSIC",   desc: "Paste any YouTube music URL. Lay a bed track under every clip at the volume you choose." },
    { icon: "✂️", color: C.amber,    tag: null,           title: "TRIM SILENCE",       desc: "Dead air and long pauses cut automatically. Tighter pacing, higher watch time, no manual editing." },
    { icon: "📺", color: C.lavender, tag: "PRO",          title: "DIGEST",             desc: "Backfill an entire channel's history. Clips from every video ever uploaded, completely hands-free." },
    { icon: "♪",  color: C.tt,       tag: "COMING SOON",  title: "TIKTOK AUTO-UPLOAD", desc: "Connect your TikTok account and publish clips directly — no downloading, no re-uploading." },
    { icon: "🎨", color: C.cream2,   tag: null,           title: "CAPTION STYLES",     desc: "Bold bottom, center pop, or minimal. Custom font size and highlight color per job." },
  ];

  return (
    <section style={{ padding: isMobile ? "40px 16px" : "72px 40px", background: `${C.ink}05` }}>
      <div style={{ maxWidth: 1320, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: isMobile ? 28 : 48 }}>
          <div className="pixel" style={{ fontSize: 8, color: C.dim2, marginBottom: 12 }}>&gt; BUILT-IN TOOLS</div>
          <h2 className="pixel" style={{ fontSize: isMobile ? 16 : 24, color: C.ink }}>Everything in one pipeline.</h2>
          <p className="vt" style={{ fontSize: isMobile ? 18 : 21, color: C.dim2, maxWidth: 540, margin: "12px auto 0", lineHeight: 1.5 }}>
            No stitching together apps. Every tool runs in the same job — one link, one click, one batch of ready-to-post clips.
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(3, 1fr)", gap: isMobile ? 10 : 16 }}>
          {tools.map((t) => (
            <PixelCard key={t.title} color={C.cream} padding={isMobile ? 14 : 22} style={{ position: "relative" }}>
              {t.tag && (
                <div style={{ position: "absolute", top: -10, right: 12, background: t.tag === "COMING SOON" ? C.ink : C.amber, border: BORDER, padding: "4px 10px" }}>
                  <span className="pixel" style={{ fontSize: 6, color: t.tag === "COMING SOON" ? C.cream : C.ink }}>{t.tag}</span>
                </div>
              )}
              <div style={{ width: 38, height: 38, background: t.color, border: BORDER, boxShadow: SHADOW_SM, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14, fontSize: 18 }}>
                {t.icon}
              </div>
              <div className="pixel" style={{ fontSize: isMobile ? 7 : 8, color: C.ink, marginBottom: 8 }}>{t.title}</div>
              <p className="vt" style={{ fontSize: isMobile ? 13 : 16, color: C.dim2, lineHeight: 1.4, margin: 0 }}>{t.desc}</p>
            </PixelCard>
          ))}
        </div>
      </div>
    </section>
  );
}

function WatchlistSection({ onSignup, isMobile }) {
  return (
    <section style={{ padding: isMobile ? "40px 16px" : "72px 40px", background: `${C.ink}08` }}>
      <div style={{ maxWidth: 1320, margin: "0 auto" }}>
        <PixelCard color={C.lavender} padding={isMobile ? 24 : 40}>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? 24 : 48, alignItems: "center" }}>
            <div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: C.ink, border: BORDER, padding: "6px 14px", marginBottom: 18 }}>
                <span className="pixel" style={{ fontSize: 8, color: C.lavender }}>PRO FEATURE</span>
              </div>
              <h2 className="pixel" style={{ fontSize: isMobile ? 14 : 22, color: C.ink, lineHeight: 1.5, marginBottom: 16 }}>
                Watchlist & Digest.<br />
                <span style={{ color: C.lavenderDeep }}>Set it. Forget it.<br />Never miss a clip.</span>
              </h2>
              <p className="vt" style={{ fontSize: isMobile ? 18 : 22, color: C.dim2, lineHeight: 1.5, marginBottom: 24 }}>
                <strong style={{ color: C.ink }}>Watchlist</strong> monitors any YouTube channel — the moment a new video drops, clipping starts automatically. <strong style={{ color: C.ink }}>Digest</strong> goes further: backfill the entire channel history and get clips from every video ever uploaded.
              </p>
              <PixelBtn color="lavender" size="md" onClick={onSignup} style={isMobile ? { width: "100%" } : {}}>&gt; GET PRO — START AUTOMATING</PixelBtn>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {[
                { emoji: "📡", title: "CHANNEL MONITORING", desc: "Add any YouTube channel URL. ClipForge polls for new uploads automatically." },
                { emoji: "⚡", title: "INSTANT PROCESSING", desc: "New video detected? Clipping starts within minutes. No manual trigger needed." },
                { emoji: "📥", title: "CLIPS WAITING FOR YOU", desc: "Log in and find your shorts already rendered, captioned, and scored." },
                { emoji: "🔗", title: "DIRECT YT UPLOAD", desc: "Pair with YouTube auto-upload and clips go live the same day they're created." },
              ].map(step => (
                <div key={step.title} style={{ display: "flex", gap: 14, alignItems: "flex-start", background: `${C.cream}88`, border: BORDER_SM, padding: "14px 16px" }}>
                  <span style={{ fontSize: 22, lineHeight: 1 }}>{step.emoji}</span>
                  <div>
                    <div className="pixel" style={{ fontSize: 8, color: C.ink, marginBottom: 4 }}>{step.title}</div>
                    <div className="vt" style={{ fontSize: 16, color: C.dim2, lineHeight: 1.3 }}>{step.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </PixelCard>
      </div>
    </section>
  );
}

function PricingSection({ onSignup, isMobile }) {
  const free = [
    "10 jobs per month",
    "Up to 3 clips per job (≈30 clips/mo)",
    "Word-by-word captions",
    "Hook scoring",
    "Download MP4",
  ];
  const pro = [
    "Unlimited clips",
    "10 clips per job",
    "Word-by-word captions",
    "Hook scoring",
    "Download MP4",
    "9:16 auto-reframe",
    "Blur background style",
    "Background music",
    "Trim silence",
    "Caption styles & colors",
    "Watchlist automation",
    "Digest (backfill history)",
    "YouTube auto-upload",
    "TikTok auto-upload (soon)",
  ];

  return (
    <section style={{ padding: isMobile ? "40px 16px 64px" : "72px 40px 96px" }}>
      <div style={{ maxWidth: 1320, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: isMobile ? 28 : 48 }}>
          <div className="pixel" style={{ fontSize: 8, color: C.dim2, marginBottom: 12 }}>&gt; PRICING</div>
          <h2 className="pixel" style={{ fontSize: isMobile ? 16 : 24, color: C.ink }}>Start free. Go pro when ready.</h2>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? 16 : 28, maxWidth: 820, margin: "0 auto" }}>
          {/* Free */}
          <PixelCard color={C.paper} padding={isMobile ? 24 : 32}>
            <div className="pixel" style={{ fontSize: 9, color: C.dim2, marginBottom: 8 }}>FREE</div>
            <div className="pixel" style={{ fontSize: isMobile ? 28 : 36, color: C.ink, marginBottom: 4 }}>$0</div>
            <div className="vt" style={{ fontSize: 18, color: C.dim2, marginBottom: 24 }}>forever · no card needed</div>
            <ul style={{ listStyle: "none", padding: 0, margin: "0 0 28px", display: "flex", flexDirection: "column", gap: 10 }}>
              {free.map(f => (
                <li key={f} className="pixel" style={{ fontSize: 8, color: C.ink, display: "flex", gap: 10, alignItems: "center" }}>
                  <span style={{ color: C.signalDeep }}>✓</span> {f}
                </li>
              ))}
            </ul>
            <PixelBtn color="cream" full onClick={onSignup}>START FREE</PixelBtn>
          </PixelCard>

          {/* Pro */}
          <PixelCard color={C.hotDeep} padding={isMobile ? 24 : 32} style={{ position: "relative" }}>
            <div style={{ position: "absolute", top: -14, right: 20, background: C.ink, border: BORDER, padding: "6px 12px" }}>
              <span className="pixel" style={{ fontSize: 8, color: C.amber }}>MOST POPULAR</span>
            </div>
            <div className="pixel" style={{ fontSize: 9, color: `${C.cream}cc`, marginBottom: 8 }}>PRO</div>
            <div className="pixel" style={{ fontSize: isMobile ? 28 : 36, color: C.cream, marginBottom: 4 }}>$29<span style={{ fontSize: 14 }}>/mo</span></div>
            <div className="vt" style={{ fontSize: 18, color: `${C.cream}bb`, marginBottom: 24 }}>or $290/yr — 2 months free</div>
            <ul style={{ listStyle: "none", padding: 0, margin: "0 0 28px", display: "flex", flexDirection: "column", gap: 10 }}>
              {pro.map(f => (
                <li key={f} className="pixel" style={{ fontSize: 8, color: C.cream, display: "flex", gap: 10, alignItems: "center" }}>
                  <span style={{ color: C.signal }}>✓</span> {f}
                </li>
              ))}
            </ul>
            <PixelBtn color="cream" full onClick={onSignup}>GET PRO</PixelBtn>
          </PixelCard>
        </div>

        <div className="vt" style={{ textAlign: "center", fontSize: 18, color: C.dim2, marginTop: 28 }}>
          Questions? Email us at <span style={{ color: C.ink }}>hatimtoor2025@gmail.com</span>
        </div>
      </div>
    </section>
  );
}

function Footer({ isMobile }) {
  const navigate = useNavigate();
  return (
    <footer style={{ borderTop: BORDER, background: C.ink, padding: isMobile ? "24px 16px" : "32px 40px" }}>
      <div style={{ maxWidth: 1320, margin: "0 auto", display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center", justifyContent: "space-between" }}>
        <div className="pixel" style={{ fontSize: 12, color: C.cream }}>
          <span style={{ color: C.hot }}>CLIP</span>FORGE
        </div>
        <div style={{ display: "flex", gap: 20 }}>
          <button onClick={() => navigate("/privacy")} className="pixel" style={{ background: "transparent", color: `${C.cream}88`, fontSize: 7, cursor: "pointer" }}>PRIVACY</button>
          <button onClick={() => navigate("/terms")} className="pixel" style={{ background: "transparent", color: `${C.cream}88`, fontSize: 7, cursor: "pointer" }}>TERMS</button>
        </div>
        <div className="vt" style={{ fontSize: 16, color: `${C.cream}66` }}>© 2025 ClipForge</div>
      </div>
    </footer>
  );
}

export default function LandingPage() {
  const navigate = useNavigate();
  const isMobile = useMobile();

  const onLogin  = () => navigate("/login");
  const onSignup = () => navigate("/login?mode=signup");

  return (
    <div style={{ minHeight: "100vh", overflowX: "clip" }}>
      <style>{KEYFRAMES}</style>
      <LandingHeader onLogin={onLogin} onSignup={onSignup} isMobile={isMobile} />
      <HeroSection onSignup={onSignup} isMobile={isMobile} />
      <LiveStats isMobile={isMobile} />
      <HowItWorksSection isMobile={isMobile} />
      <FeaturesSection isMobile={isMobile} />
      <ToolsSection isMobile={isMobile} />
      <WatchlistSection onSignup={onSignup} isMobile={isMobile} />
      <PricingSection onSignup={onSignup} isMobile={isMobile} />
      <Footer isMobile={isMobile} />
    </div>
  );
}

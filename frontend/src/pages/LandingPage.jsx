import { useNavigate } from "react-router-dom";
import { C, BORDER, BORDER_SM, SHADOW, SHADOW_SM, KEYFRAMES } from "../lib/theme";
import { PixelSprite, ANVIL, ANVIL_PAL, HAMMER, HAMMER_PAL, PixelBtn, PixelCard, Tag } from "../components/ui";
import { useMobile } from "../hooks/useMobile";

function LandingHeader({ onGetStarted }) {
  const isMobile = useMobile();
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
        <PixelBtn color="cream" size="sm" onClick={onGetStarted}>LOG IN</PixelBtn>
        <PixelBtn color="hot" size="sm" onClick={onGetStarted}>GET STARTED</PixelBtn>
      </div>
    </header>
  );
}

function HeroSection({ onGetStarted, isMobile }) {
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
        <PixelBtn color="hot" size="lg" onClick={onGetStarted}>
          &gt; FORGE MY FIRST CLIPS — FREE
        </PixelBtn>
        <div className="vt" style={{ fontSize: 18, color: C.dim2 }}>No credit card · 10 free clips/month</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: isMobile ? 10 : 16, maxWidth: 780, margin: "0 auto" }}>
        {[
          ["&lt; 5 min", "turnaround"],
          ["10 clips", "per video"],
          ["100%", "auto captions"],
          ["0 editing", "required"],
        ].map(([stat, label]) => (
          <div key={label} style={{ background: C.cream, border: BORDER, boxShadow: SHADOW_SM, padding: isMobile ? "14px 10px" : "18px 12px", textAlign: "center" }}>
            <div className="pixel" style={{ fontSize: isMobile ? 12 : 16, color: C.hotDeep, marginBottom: 6 }} dangerouslySetInnerHTML={{ __html: stat }} />
            <div className="vt" style={{ fontSize: isMobile ? 16 : 18, color: C.dim2 }}>{label}</div>
          </div>
        ))}
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
      desc: "Whisper transcribes every word. Llama reads the transcript and scores each segment for virality — tension, hooks, confessions, numbers.",
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

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {signals.map((s) => (
              <div key={s.title} style={{ background: C.cream, border: BORDER, boxShadow: SHADOW_SM, padding: 16 }}>
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

function PricingSection({ onGetStarted, isMobile }) {
  const free = [
    "10 clips per month",
    "3 clips per job",
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
    "YouTube auto-upload",
    "9:16 auto-reframe",
    "Priority processing",
    "Watchlist automation",
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
            <PixelBtn color="cream" full onClick={onGetStarted}>START FREE</PixelBtn>
          </PixelCard>

          {/* Pro */}
          <PixelCard color={C.hotDeep} padding={isMobile ? 24 : 32} style={{ position: "relative" }}>
            <div style={{ position: "absolute", top: -14, right: 20, background: C.amber, border: BORDER, padding: "6px 12px" }}>
              <span className="pixel" style={{ fontSize: 8, color: C.ink }}>MOST POPULAR</span>
            </div>
            <div className="pixel" style={{ fontSize: 9, color: `${C.cream}cc`, marginBottom: 8 }}>PRO</div>
            <div className="pixel" style={{ fontSize: isMobile ? 28 : 36, color: C.cream, marginBottom: 4 }}>$29<span style={{ fontSize: 14 }}>/mo</span></div>
            <div className="vt" style={{ fontSize: 18, color: `${C.cream}bb`, marginBottom: 24 }}>cancel any time</div>
            <ul style={{ listStyle: "none", padding: 0, margin: "0 0 28px", display: "flex", flexDirection: "column", gap: 10 }}>
              {pro.map(f => (
                <li key={f} className="pixel" style={{ fontSize: 8, color: C.cream, display: "flex", gap: 10, alignItems: "center" }}>
                  <span style={{ color: C.signal }}>✓</span> {f}
                </li>
              ))}
            </ul>
            <PixelBtn color="signal" full onClick={onGetStarted}>GET PRO</PixelBtn>
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

  const onGetStarted = () => navigate("/login");

  return (
    <div style={{ minHeight: "100vh", overflowX: "clip" }}>
      <style>{KEYFRAMES}</style>
      <LandingHeader onGetStarted={onGetStarted} />
      <HeroSection onGetStarted={onGetStarted} isMobile={isMobile} />
      <HowItWorksSection isMobile={isMobile} />
      <FeaturesSection isMobile={isMobile} />
      <PricingSection onGetStarted={onGetStarted} isMobile={isMobile} />
      <Footer isMobile={isMobile} />
    </div>
  );
}

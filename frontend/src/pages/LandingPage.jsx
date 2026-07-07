import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Card, Tag, RetroSprite } from "../components/kit";
import { ANVIL, ANVIL_PAL } from "../components/ui";
import { IconAnvil } from "../components/shell/icons";
import ThemeFab from "../components/theme/ThemeFab";

function Logo({ onClick }) {
  return (
    <div className="landing__logo" onClick={onClick}>
      <RetroSprite
        data={ANVIL}
        palette={ANVIL_PAL}
        size={4}
        modern={
          <span style={{ color: "var(--accent)", display: "inline-flex" }}>
            <IconAnvil size={24} />
          </span>
        }
      />
      <span>
        <b>Clip</b>Forge
      </span>
    </div>
  );
}

function fmtStat(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1).replace(/\.0$/, "") + "K";
  return String(n);
}

function AnimatedStat({ value, label }) {
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);
  useEffect(() => {
    const from = fromRef.current,
      to = value || 0,
      dur = 1200,
      start = performance.now();
    let raf;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out
      setDisplay(Math.round(from + (to - from) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = to;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return (
    <div className="lstat">
      <div className="lstat__num">{fmtStat(display)}</div>
      <div className="lstat__label">{label}</div>
    </div>
  );
}

function LiveStats() {
  const [stats, setStats] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/stats/public")
        .then((r) => r.json())
        .then((d) => {
          if (alive) setStats(d);
        })
        .catch(() => {});
    load();
    const id = setInterval(load, 30000); // refresh every 30s for a "live" feel
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  // Don't render until there's real data to brag about.
  if (!stats || ((stats.videos || 0) === 0 && (stats.views || 0) === 0)) return null;
  const items = [
    [stats.videos || 0, "videos published"],
    [stats.views || 0, "views generated"],
    [stats.likes || 0, "likes earned"],
    [stats.subscribers || 0, "combined subscribers"],
  ];
  return (
    <section className="lsection" style={{ paddingTop: 0 }}>
      <div className="lsection__inner" style={{ textAlign: "center" }}>
        <div className="lsection__kicker" style={{ marginBottom: 18 }}>
          <span style={{ animation: "cf-blink 1.2s steps(1) infinite" }}>●</span> Live — real clips,
          real results
        </div>
        <div className="lstats">
          {items.map(([val, label]) => (
            <AnimatedStat key={label} value={val} label={label} />
          ))}
        </div>
      </div>
    </section>
  );
}

const STEPS = [
  {
    num: "01",
    icon: "🔗",
    title: "Paste a link",
    desc: "Drop any YouTube URL — podcast, interview, gameplay stream, lecture. ClipForge handles everything from 10 minutes to 3 hours.",
  },
  {
    num: "02",
    icon: "🤖",
    title: "AI finds the gold",
    desc: "Transcript, audio energy, and your own prompts — every segment scored 0-99 for hook, flow, value, and trend. Even low-dialogue gameplay gets clipped by its loudest moments.",
  },
  {
    num: "03",
    icon: "🚀",
    title: "Download & post",
    desc: "Captions burned in word-by-word. Clips trimmed frame-perfect. Download all at once or push straight to YouTube Shorts with one click.",
  },
];

const SIGNALS = [
  { emoji: "⚡", title: "Tension shifts", desc: "Moments where energy spikes or drops. These are natural cut points and attention magnets." },
  { emoji: "💰", title: "Numbers & names", desc: "Specific dollar figures, dates, ages, places. Concrete details stop the scroll." },
  { emoji: "🌶️", title: "Contrarian frames", desc: "Statements that invite disagreement. Polarizing takes drive saves, shares, and comments." },
  { emoji: "💬", title: "Confessions", desc: "First-person admissions. Vulnerability lands universally — every platform, every niche." },
  { emoji: "🎯", title: "Strong openers", desc: "The first five seconds decide everything. We score each clip's cold-open hook strength." },
  { emoji: "📈", title: "Story arcs", desc: "Clips with a clear setup → conflict → resolution outperform pure highlights every time." },
];

const TOOLS = [
  { icon: "🧠", tag: "New", title: "Auto layout", desc: "The AI reads your video and picks the layout itself — split for podcasts, screen-share for tutorials, gameplay split for streams." },
  { icon: "🎮", tag: "New", title: "Gameplay split", desc: "Facecam framed on top, tracked gameplay below — and if detection misses, draw the cam box yourself." },
  { icon: "👥", tag: "New", title: "Split & screen", desc: "Two speakers stacked for podcasts. Screen content up top, presenter below for tutorials and webinars." },
  { icon: "🎨", tag: "New", title: "10 caption styles", desc: "Hormozi, Karaoke, Beasty and more — animated previews, AI keyword highlights, auto emoji on big moments." },
  { icon: "🔍", tag: "New", title: "Clip by prompt", desc: "“Find every moment about pricing. Skip the sponsor reads.” Then re-clip the same video with a new prompt — no reprocessing." },
  { icon: "📐", tag: null, title: "3 formats", desc: "9:16 Shorts, 1:1 square, 16:9 wide — same clip intelligence, every placement covered." },
  { icon: "📊", tag: null, title: "Virality 0-99", desc: "Every clip scored on hook, flow, value, and trend — post the winners first, skip the guesswork." },
  { icon: "🎬", tag: null, title: "Blur background", desc: "Landscape clip centered on a blurred, scaled background — full 9:16 frame, no black bars, no crop." },
  { icon: "🎵", tag: null, title: "Background music", desc: "Paste any YouTube music URL. Lay a bed track under every clip at the volume you choose." },
  { icon: "✂️", tag: null, title: "Trim silence", desc: "Dead air and long pauses cut automatically. Tighter pacing, higher watch time, no manual editing." },
  { icon: "📺", tag: "Pro", title: "Digest", desc: "Backfill an entire channel's history. Clips from every video ever uploaded, completely hands-free." },
  { icon: "♪", tag: "Pro", title: "TikTok posting", desc: "Connect your TikTok account and publish clips directly — no downloading, no re-uploading." },
];

const FREE_FEATURES = [
  "10 jobs per month",
  "Up to 3 clips per job (≈30 clips/mo)",
  "Word-by-word captions",
  "Hook scoring",
  "Download MP4",
];
const PRO_FEATURES = [
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
  "TikTok posting",
];

export default function LandingPage() {
  const navigate = useNavigate();
  const onLogin = () => navigate("/login");
  const onSignup = () => navigate("/login?mode=signup");

  return (
    <div className="landing">
      <nav className="landing__nav">
        <Logo onClick={() => navigate("/")} />
        <span style={{ flex: 1 }} />
        <Button size="sm" variant="secondary" onClick={onLogin}>
          Log in
        </Button>
        <span className="hide-sm">
          <Button size="sm" onClick={onSignup}>
            Get started
          </Button>
        </span>
      </nav>

      <section className="lhero">
        <Tag tone="accent">⚡ AI-powered clip extraction</Tag>
        <h1 className="lhero__title">
          One long video.
          <br />
          <em>Ten viral shorts.</em>
          <br />
          Fully automatic.
        </h1>
        <p className="lhero__sub">
          Drop any YouTube link. ClipForge's AI finds the best moments, burns captions, scores
          hooks, and hands you shorts ready to post — in under 5 minutes.
        </p>
        <div className="lhero__cta">
          <Button size="lg" onClick={onSignup}>
            ⚡ Forge my first clips — free
          </Button>
          <span className="t-sm">No credit card · up to 30 free clips/month</span>
        </div>
        <div className="lstats">
          {[
            ["< 5 min", "turnaround"],
            ["10 clips", "per video"],
            ["100%", "auto captions"],
            ["0 editing", "required"],
          ].map(([stat, label]) => (
            <div key={label} className="lstat">
              <div className="lstat__num">{stat}</div>
              <div className="lstat__label">{label}</div>
            </div>
          ))}
        </div>
      </section>

      <LiveStats />

      <section className="lsection lsection--tint">
        <div className="lsection__inner">
          <div style={{ textAlign: "center", marginBottom: 44 }}>
            <div className="lsection__kicker">How it works</div>
            <h2 className="lsection__title">Three steps. Done.</h2>
          </div>
          <div className="lgrid-3">
            {STEPS.map((step) => (
              <Card key={step.num} style={{ overflow: "hidden" }}>
                <span className="lstep__num">{step.num}</span>
                <div className="lstep__icon">{step.icon}</div>
                <div className="lcard__title">{step.title}</div>
                <p className="lcard__desc">{step.desc}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="lsection">
        <div className="lsection__inner">
          <div className="lsplit">
            <div>
              <div className="lsection__kicker">Signal detection</div>
              <h2 className="lsection__title">
                We don't just cut clips.
                <br />
                <em style={{ fontStyle: "normal", color: "var(--accent)" }}>
                  We find the moments that travel.
                </em>
              </h2>
              <p className="lsection__sub" style={{ margin: "16px 0 22px", maxWidth: "none" }}>
                ClipForge reads every word of your transcript and applies a multi-signal virality
                model. Each clip gets a hook score so you know exactly what to post first.
              </p>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <Tag tone="accent">Hook scoring</Tag>
                <Tag>Transcript analysis</Tag>
                <Tag>Frame detection</Tag>
              </div>
            </div>
            <div className="lgrid-2 lgrid-2--keep">
              {SIGNALS.map((s) => (
                <Card key={s.title} sub style={{ padding: 16 }}>
                  <div style={{ fontSize: 22, marginBottom: 8 }}>{s.emoji}</div>
                  <div className="lcard__title">{s.title}</div>
                  <p className="lcard__desc">{s.desc}</p>
                </Card>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="lsection lsection--tint">
        <div className="lsection__inner">
          <div style={{ textAlign: "center", marginBottom: 44 }}>
            <div className="lsection__kicker">Built-in tools</div>
            <h2 className="lsection__title">Everything in one pipeline.</h2>
            <p className="lsection__sub">
              No stitching together apps. Every tool runs in the same job — one link, one click,
              one batch of ready-to-post clips.
            </p>
          </div>
          <div className="lgrid-3">
            {TOOLS.map((t) => (
              <Card key={t.title} style={{ padding: 20 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  <div className="lstep__icon" style={{ width: 38, height: 38, fontSize: 18, marginBottom: 0 }}>
                    {t.icon}
                  </div>
                  <span style={{ flex: 1 }} />
                  {t.tag && <Tag tone={t.tag === "Pro" ? "accent" : "success"}>{t.tag}</Tag>}
                </div>
                <div className="lcard__title">{t.title}</div>
                <p className="lcard__desc">{t.desc}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="lsection">
        <div className="lsection__inner">
          <Card style={{ padding: "clamp(24px, 4vw, 44px)" }}>
            <div className="lsplit">
              <div>
                <Tag tone="accent">Pro feature</Tag>
                <h2 className="lsection__title" style={{ margin: "16px 0" }}>
                  Watchlist & Digest.
                  <br />
                  <em style={{ fontStyle: "normal", color: "var(--accent)" }}>
                    Set it. Forget it. Never miss a clip.
                  </em>
                </h2>
                <p className="lsection__sub" style={{ margin: "0 0 24px", maxWidth: "none" }}>
                  <strong>Watchlist</strong> monitors any YouTube channel — the moment a new video
                  drops, clipping starts automatically. <strong>Digest</strong> goes further:
                  backfill the entire channel history and get clips from every video ever uploaded.
                </p>
                <Button onClick={onSignup}>→ Get Pro — start automating</Button>
              </div>
              <div style={{ display: "grid", gap: 12 }}>
                {[
                  ["📡", "Channel monitoring", "Add any YouTube channel URL. ClipForge polls for new uploads automatically."],
                  ["⚡", "Instant processing", "New video detected? Clipping starts within minutes. No manual trigger needed."],
                  ["📥", "Clips waiting for you", "Log in and find your shorts already rendered, captioned, and scored."],
                  ["🔗", "Direct YT upload", "Pair with YouTube auto-upload and clips go live the same day they're created."],
                ].map(([emoji, title, desc]) => (
                  <Card key={title} sub style={{ padding: "14px 16px", display: "flex", gap: 14 }}>
                    <span style={{ fontSize: 22, lineHeight: 1 }}>{emoji}</span>
                    <div>
                      <div className="lcard__title" style={{ marginBottom: 4 }}>
                        {title}
                      </div>
                      <p className="lcard__desc">{desc}</p>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          </Card>
        </div>
      </section>

      <section className="lsection lsection--tint">
        <div className="lsection__inner">
          <div style={{ textAlign: "center", marginBottom: 44 }}>
            <div className="lsection__kicker">Pricing</div>
            <h2 className="lsection__title">Start free. Go pro when ready.</h2>
          </div>
          <div className="lprice">
            <Card>
              <div className="t-label">Free</div>
              <div className="lprice__num">$0</div>
              <div className="t-sm lprice__muted" style={{ marginBottom: 22 }}>
                forever · no card needed
              </div>
              <ul className="lprice__list">
                {FREE_FEATURES.map((f) => (
                  <li key={f}>
                    <span className="lprice__check">✓</span> {f}
                  </li>
                ))}
              </ul>
              <Button variant="secondary" full onClick={onSignup}>
                Start free
              </Button>
            </Card>
            <Card className="lprice__card--pro">
              <span className="lribbon">Most popular</span>
              <div className="t-label" style={{ color: "rgba(245,241,234,.65)" }}>
                Pro
              </div>
              <div className="lprice__num">
                $29<span style={{ fontSize: 16, fontWeight: 600 }}>/mo</span>
              </div>
              <div className="t-sm lprice__muted" style={{ marginBottom: 22 }}>
                or $290/yr — 2 months free
              </div>
              <ul className="lprice__list">
                {PRO_FEATURES.map((f) => (
                  <li key={f}>
                    <span className="lprice__check">✓</span> {f}
                  </li>
                ))}
              </ul>
              <Button full onClick={onSignup}>
                Get Pro
              </Button>
            </Card>
          </div>
          <div className="t-sm" style={{ textAlign: "center", marginTop: 28 }}>
            Questions? Email us at{" "}
            <a href="mailto:support@clipforging.com" style={{ color: "var(--accent-strong)" }}>
              support@clipforging.com
            </a>
          </div>
        </div>
      </section>

      <footer className="lfoot">
        <div className="lfoot__inner">
          <div className="lfoot__logo">
            <b>Clip</b>Forge
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <button className="lfoot__link" onClick={() => navigate("/privacy")}>
              Privacy
            </button>
            <button className="lfoot__link" onClick={() => navigate("/terms")}>
              Terms
            </button>
          </div>
          <div className="lfoot__muted">© 2026 ClipForge</div>
        </div>
      </footer>

      <ThemeFab />
    </div>
  );
}

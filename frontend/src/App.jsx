import { useState, useEffect, Component } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";

class ErrorBoundary extends Component {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError)
      return (
        <div style={{ fontFamily: "monospace", textAlign: "center", padding: 60 }}>
          <div style={{ fontSize: 22, fontWeight: "bold", marginBottom: 12 }}>Something went wrong.</div>
          <div style={{ marginBottom: 24, color: "#4a3d68" }}>Please refresh the page to continue.</div>
          <button onClick={() => window.location.reload()}
            style={{ padding: "10px 24px", background: "#f5a3c7", border: "2px solid #1a0d2e", fontFamily: "monospace", cursor: "pointer", fontWeight: "bold" }}>
            Refresh
          </button>
        </div>
      );
    return this.props.children;
  }
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}
import { AppContext } from "./context/AppContext";
import { supabase, authFetch } from "./lib/supabase";
import AppShell     from "./components/shell/AppShell";
import ThemeTransition from "./components/theme/ThemeTransition";
import KitPage      from "./pages/KitPage";
import LoginPage    from "./pages/LoginPage";
import HelloPage    from "./pages/HelloPage";
import WorkPage     from "./pages/WorkPage";
import WatchlistPage from "./pages/WatchlistPage";
import ArchivePage  from "./pages/ArchivePage";
import DigestPage   from "./pages/DigestPage";
import ConnectionsPage from "./pages/ConnectionsPage";
import CalendarPage from "./pages/CalendarPage";
import UpgradePage   from "./pages/UpgradePage";
import PrivacyPage  from "./pages/PrivacyPage";
import TermsPage    from "./pages/TermsPage";
import LandingPage  from "./pages/LandingPage";

function PrivateRoute({ children }) {
  const [authed, setAuthed] = useState(null); // null = checking
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setAuthed(!!session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => setAuthed(!!session));
    return () => subscription.unsubscribe();
  }, []);
  if (authed === null) return null; // brief loading flash
  return authed ? children : <Navigate to="/login" replace />;
}

export default function App() {
  const [authed, setAuthed] = useState(null);
  const [profile, setProfile] = useState({ plan: "free", clips_used: 0, clips_limit: 10 });
  const [ytStatus, setYtStatus] = useState({ connected: false });
  const [ttStatus, setTtStatus] = useState({ connected: false });
  const [igStatus, setIgStatus] = useState({ connected: false });
  const [jobActive, setJobActive] = useState(null); // null | jobId string

  const isPro = profile.plan === "pro";

  const refreshProfile = async () => {
    try {
      const res = await authFetch("/api/profile");
      if (res.ok) setProfile(await res.json());
    } catch {}
  };

  const refreshYtStatus = async () => {
    try {
      const res = await authFetch("/api/youtube/status");
      if (res.ok) setYtStatus(await res.json());
    } catch {}
  };

  const refreshTtStatus = async () => {
    try {
      const res = await authFetch("/api/tiktok/status");
      if (res.ok) setTtStatus(await res.json());
    } catch {}
  };

  const refreshIgStatus = async () => {
    try {
      const res = await authFetch("/api/instagram/status");
      if (res.ok) setIgStatus(await res.json());
    } catch {}
  };

  const [promoMsg, setPromoMsg] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setAuthed(!!session);
      if (session) refreshProfile();
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setAuthed(!!session);
      if (session) refreshProfile();
    });
    return () => subscription.unsubscribe();
  }, []);

  // Capture an invite code from the landing URL (?promo=CODE) so it survives sign-up.
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("promo");
    if (code) localStorage.setItem("cf_promo", code.trim());
  }, []);

  // Once signed in, redeem any stored invite code for time-limited Pro.
  useEffect(() => {
    if (!authed) return;
    const code = localStorage.getItem("cf_promo");
    if (!code) return;
    (async () => {
      try {
        const res = await authFetch("/api/promo/redeem", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok) {
          setPromoMsg(`🎉 You've unlocked ${data.pro_days} days of Pro — enjoy!`);
          refreshProfile();
        }
        localStorage.removeItem("cf_promo");  // got a definitive answer — don't retry
      } catch {
        /* network error — keep the code so it can retry on next load */
      }
    })();
  }, [authed]);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (authed && isPro) { refreshYtStatus(); refreshTtStatus(); refreshIgStatus(); }
  }, [authed, isPro]);

  const ctx = { authed, profile, isPro, ytStatus, refreshYtStatus, ttStatus, refreshTtStatus, igStatus, refreshIgStatus, refreshProfile, jobActive, setJobActive };

  return (
    <BrowserRouter>
      <AppContext.Provider value={ctx}>
        <ScrollToTop />
        <ThemeTransition />
        {promoMsg && (
          <div onClick={() => setPromoMsg("")}
            style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 1000, cursor: "pointer",
              background: "#7ee787", color: "#1a0d2e", textAlign: "center",
              padding: "12px 16px", fontFamily: "monospace", fontWeight: 700, fontSize: 14,
              borderBottom: "2px solid #1a0d2e" }}>
            {promoMsg} <span style={{ opacity: 0.6, marginLeft: 8, fontWeight: 400 }}>(tap to dismiss)</span>
          </div>
        )}
        <ErrorBoundary>
        <Routes>
          <Route path="/"       element={authed ? <Navigate to="/hello" replace /> : <LandingPage />} />
          <Route path="/login" element={authed ? <Navigate to="/hello" replace /> : <LoginPage />} />
          <Route element={<PrivateRoute><AppShell /></PrivateRoute>}>
            <Route path="/hello" element={<HelloPage />} />
            <Route path="/work" element={<WorkPage />} />
            <Route path="/archive" element={<ArchivePage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/connections" element={<ConnectionsPage />} />
            <Route path="/upgrade" element={<UpgradePage />} />
            <Route path="/watchlist" element={<WatchlistPage />} />
            <Route path="/digest" element={<DigestPage />} />
          </Route>
          <Route path="/privacy"   element={<PrivacyPage />} />
          <Route path="/terms"     element={<TermsPage />} />
          {import.meta.env.DEV && (
            <Route element={<AppShell />}>
              <Route path="/kit" element={<KitPage />} />
            </Route>
          )}
          <Route path="*"          element={<Navigate to="/" replace />} />
        </Routes>
        </ErrorBoundary>
      </AppContext.Provider>
    </BrowserRouter>
  );
}

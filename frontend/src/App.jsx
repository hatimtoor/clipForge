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
import LoginPage    from "./pages/LoginPage";
import HelloPage    from "./pages/HelloPage";
import WorkPage     from "./pages/WorkPage";
import WatchlistPage from "./pages/WatchlistPage";
import ArchivePage  from "./pages/ArchivePage";
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

  useEffect(() => {
    if (authed && isPro) refreshYtStatus();
  }, [authed, isPro]);

  const ctx = { authed, profile, isPro, ytStatus, refreshYtStatus, refreshProfile, jobActive, setJobActive };

  return (
    <BrowserRouter>
      <AppContext.Provider value={ctx}>
        <ScrollToTop />
        <ErrorBoundary>
        <Routes>
          <Route path="/"       element={authed ? <Navigate to="/hello" replace /> : <LandingPage />} />
          <Route path="/login" element={authed ? <Navigate to="/hello" replace /> : <LoginPage />} />
          <Route path="/hello"     element={<PrivateRoute><HelloPage /></PrivateRoute>} />
          <Route path="/work"      element={<PrivateRoute><WorkPage /></PrivateRoute>} />
          <Route path="/watchlist" element={<PrivateRoute><WatchlistPage /></PrivateRoute>} />
          <Route path="/archive"   element={<PrivateRoute><ArchivePage /></PrivateRoute>} />
          <Route path="/privacy"   element={<PrivacyPage />} />
          <Route path="/terms"     element={<TermsPage />} />
          <Route path="*"          element={<Navigate to="/" replace />} />
        </Routes>
        </ErrorBoundary>
      </AppContext.Provider>
    </BrowserRouter>
  );
}

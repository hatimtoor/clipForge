import { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";

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
  const [jobActive, setJobActive] = useState(false);

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
        <Routes>
          <Route path="/login" element={authed ? <Navigate to="/hello" replace /> : <LoginPage />} />
          <Route path="/hello"     element={<PrivateRoute><HelloPage /></PrivateRoute>} />
          <Route path="/work"      element={<PrivateRoute><WorkPage /></PrivateRoute>} />
          <Route path="/watchlist" element={<PrivateRoute><WatchlistPage /></PrivateRoute>} />
          <Route path="/archive"   element={<PrivateRoute><ArchivePage /></PrivateRoute>} />
          <Route path="*"          element={<Navigate to="/hello" replace />} />
        </Routes>
      </AppContext.Provider>
    </BrowserRouter>
  );
}

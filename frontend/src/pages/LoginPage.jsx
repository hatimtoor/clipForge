import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { Button, Card, Banner, Field, TextInput, SegmentedControl, RetroSprite } from "../components/kit";
import { ANVIL, ANVIL_PAL } from "../components/ui";
import { IconAnvil } from "../components/shell/icons";
import ThemeFab from "../components/theme/ThemeFab";

// Instant-feedback blocklist of common disposable providers. The real,
// unbypassable enforcement is the auth.users trigger in Supabase
// (backend/sql/block_disposable_emails.sql) — this just gives a clean message.
const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.net", "guerrillamail.org",
  "sharklasers.com", "grr.la", "spam4.me", "10minutemail.com", "10minutemail.net",
  "temp-mail.org", "temp-mail.io", "tempmail.com", "tempmailo.com", "tempr.email",
  "throwawaymail.com", "yopmail.com", "yopmail.net", "yopmail.fr", "mailnesia.com",
  "maildrop.cc", "mailcatch.com", "getnada.com", "nada.email", "dispostable.com",
  "trashmail.com", "trash-mail.com", "wegwerfmail.de", "tempinbox.com", "emailondeck.com",
  "fakeinbox.com", "fakemail.net", "mohmal.com", "emailfake.com", "email-fake.com",
  "mailpoof.com", "inboxkitten.com", "33mail.com", "discard.email", "discardmail.com",
  "spamgourmet.com", "1secmail.com", "1secmail.org", "1secmail.net", "mailto.plus",
  "fexbox.org", "burnermail.io", "temp-mail.ru", "mailsac.com", "disposablemail.com",
  "throwawayemail.com", "tempmailaddress.com", "mailforspam.com", "tmpmail.org",
]);

function isDisposableEmail(email) {
  const domain = (email.split("@")[1] || "").trim().toLowerCase();
  return DISPOSABLE_DOMAINS.has(domain);
}

export default function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  // signin | signup | forgot (enter email → send reset) | update (set new pw)
  const [mode, setMode] = useState(searchParams.get("mode") === "signup" ? "signup" : "signin");
  const [signupDone, setSignupDone] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [newPass, setNewPass] = useState("");
  const [updated, setUpdated] = useState(false);

  // When the user clicks the reset link in their email, Supabase lands them
  // back here with a recovery session and fires PASSWORD_RECOVERY — switch to
  // the "set a new password" form.
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") { setMode("update"); setErr(""); }
    });
    return () => data?.subscription?.unsubscribe?.();
  }, []);

  const sendReset = async () => {
    if (!email) { setErr("Enter your email first."); return; }
    setLoading(true); setErr("");
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + "/login",
      });
      if (error) { setErr(error.message); setLoading(false); return; }
      setResetSent(true);
    } catch {
      setErr("Cannot reach server.");
    } finally { setLoading(false); }
  };

  const updatePassword = async () => {
    if (newPass.length < 6) { setErr("Password must be at least 6 characters."); return; }
    setLoading(true); setErr("");
    try {
      const { error } = await supabase.auth.updateUser({ password: newPass });
      if (error) { setErr(error.message); setLoading(false); return; }
      setUpdated(true);
      setTimeout(() => navigate("/hello"), 1200);
    } catch {
      setErr("Cannot reach server.");
    } finally { setLoading(false); }
  };

  const switchMode = (m) => { setMode(m); setErr(""); setResetSent(false); };
  const LinkBtn = ({ onClick, children }) => (
    <button type="button" onClick={onClick} className="t-sm"
      style={{ background: "none", padding: 0, cursor: "pointer", color: "var(--accent)", textDecoration: "underline" }}>
      {children}
    </button>
  );

  const attempt = async () => {
    if (!email || !pass) {
      setErr("Enter email and password.");
      return;
    }
    setLoading(true);
    setErr("");
    try {
      if (mode === "signup") {
        if (isDisposableEmail(email)) {
          setErr("Please use a permanent email address — temporary/disposable email providers aren't allowed.");
          setLoading(false);
          return;
        }
        const { error } = await supabase.auth.signUp({ email, password: pass });
        if (error) {
          // The DB triggers reject disposable domains and email aliases that map
          // to an existing account. Supabase wraps these generically, so use a
          // neutral message that's honest for both cases.
          const msg = /disposable|not allowed|database error|already/i.test(error.message)
            ? "We couldn't create an account with this email. Please use a different permanent email address (temporary inboxes and aliases of an existing account aren't allowed)."
            : error.message;
          setErr(msg);
          setLoading(false);
          return;
        }
        setSignupDone(true);
        setLoading(false);
        return;
      }
      const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
      if (error) {
        setErr(error.message);
        setLoading(false);
        return;
      }
      navigate("/hello");
    } catch {
      setErr("Cannot reach server.");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setErr("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin + "/hello" },
    });
    if (error) setErr(error.message);
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <Card style={{ width: 440, maxWidth: "94vw" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 24,
            cursor: "pointer",
          }}
          onClick={() => navigate("/")}
        >
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
          <span className="side__logo-name" style={{ fontSize: 20 }}>
            <b>Clip</b>Forge
          </span>
        </div>

        {signupDone ? (
          <div style={{ textAlign: "center", display: "grid", gap: 14 }}>
            <div className="t-h2" style={{ color: "var(--success)" }}>
              ✓ Check your email
            </div>
            <p className="t-sm" style={{ margin: 0 }}>
              We sent a confirmation link to <strong>{email}</strong>. Click it to activate your
              account, then sign in.
            </p>
            <Button
              variant="secondary"
              onClick={() => {
                setSignupDone(false);
                setMode("signin");
              }}
            >
              Back to sign in
            </Button>
          </div>
        ) : mode === "update" ? (
          /* Landed here from the password-reset email link. */
          updated ? (
            <div style={{ textAlign: "center", display: "grid", gap: 14 }}>
              <div className="t-h2" style={{ color: "var(--success)" }}>✓ Password updated</div>
              <p className="t-sm" style={{ margin: 0 }}>Signing you in…</p>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 16 }}>
              <div className="t-h2">Set a new password</div>
              <Field label="New password">
                <TextInput type="password" value={newPass} onChange={(e) => setNewPass(e.target.value)}
                  placeholder="••••••••" autoComplete="new-password"
                  onKeyDown={(e) => e.key === "Enter" && updatePassword()} />
              </Field>
              {err && <Banner tone="danger">{err}</Banner>}
              <Button size="lg" full onClick={updatePassword} disabled={loading}>
                {loading ? "Saving…" : "Update password"}
              </Button>
            </div>
          )
        ) : mode === "forgot" ? (
          resetSent ? (
            <div style={{ textAlign: "center", display: "grid", gap: 14 }}>
              <div className="t-h2" style={{ color: "var(--success)" }}>✓ Check your email</div>
              <p className="t-sm" style={{ margin: 0 }}>
                If an account exists for <strong>{email}</strong>, we sent a password-reset link.
                Open it to choose a new password.
              </p>
              <Button variant="secondary" onClick={() => switchMode("signin")}>Back to sign in</Button>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 16 }}>
              <div className="t-h2">Reset your password</div>
              <p className="t-sm" style={{ margin: 0 }}>
                Enter your account email and we'll send you a reset link.
              </p>
              <Field label="Email">
                <TextInput value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com" type="email" autoComplete="email"
                  onKeyDown={(e) => e.key === "Enter" && sendReset()} />
              </Field>
              {err && <Banner tone="danger">{err}</Banner>}
              <Button size="lg" full onClick={sendReset} disabled={loading}>
                {loading ? "Sending…" : "Send reset link"}
              </Button>
              <div style={{ textAlign: "center" }}>
                <LinkBtn onClick={() => switchMode("signin")}>← Back to sign in</LinkBtn>
              </div>
            </div>
          )
        ) : (
          <div style={{ display: "grid", gap: 16 }}>
            <SegmentedControl
              value={mode}
              onChange={(m) => {
                setMode(m);
                setErr("");
              }}
              options={[
                { id: "signin", label: "Sign in" },
                { id: "signup", label: "Sign up" },
              ]}
            />

            <Field label="Email">
              <TextInput
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                type="email"
                autoComplete="email"
              />
            </Field>
            <Field label="Password">
              <TextInput
                type="password"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                placeholder="••••••••"
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                onKeyDown={(e) => e.key === "Enter" && attempt()}
              />
              {mode === "signin" && (
                <div style={{ textAlign: "right", marginTop: 6 }}>
                  <LinkBtn onClick={() => switchMode("forgot")}>Forgot password?</LinkBtn>
                </div>
              )}
            </Field>

            {err && <Banner tone="danger">{err}</Banner>}

            <Button size="lg" full onClick={attempt} disabled={loading}>
              {loading ? "Loading…" : mode === "signup" ? "Create account" : "→ Enter the forge"}
            </Button>

            <div className="t-sm" style={{ textAlign: "center" }}>
              {mode === "signup" ? (
                <>Already have an account? <LinkBtn onClick={() => switchMode("signin")}>Sign in</LinkBtn></>
              ) : (
                <>New to ClipForge? <LinkBtn onClick={() => switchMode("signup")}>Create an account</LinkBtn></>
              )}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ flex: 1, height: 1, background: "var(--line)" }} />
              <span className="t-label">or</span>
              <div style={{ flex: 1, height: 1, background: "var(--line)" }} />
            </div>

            <Button variant="secondary" full onClick={handleGoogle}>
              <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6.1C12.3 13.4 17.7 9.5 24 9.5Z" />
                <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5Z" />
                <path fill="#FBBC05" d="M10.4 28.7a14.5 14.5 0 0 1 0-9.4l-7.8-6.1a24 24 0 0 0 0 21.6l7.8-6.1Z" />
                <path fill="#34A853" d="M24 48c6.2 0 11.4-2 15.4-5.5l-7.5-5.8c-2.1 1.4-4.8 2.3-7.9 2.3-6.3 0-11.7-3.9-13.6-9.3l-7.8 6.1C6.5 42.6 14.6 48 24 48Z" />
              </svg>
              Continue with Google
            </Button>
          </div>
        )}
      </Card>
      <ThemeFab />
    </div>
  );
}

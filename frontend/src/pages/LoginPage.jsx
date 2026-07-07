import { useState } from "react";
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
  const [mode, setMode] = useState(searchParams.get("mode") === "signup" ? "signup" : "signin");
  const [signupDone, setSignupDone] = useState(false);

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
                onKeyDown={(e) => e.key === "Enter" && attempt()}
              />
            </Field>

            {err && <Banner tone="danger">{err}</Banner>}

            <Button size="lg" full onClick={attempt} disabled={loading}>
              {loading ? "Loading…" : mode === "signup" ? "Create account" : "→ Enter the forge"}
            </Button>

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

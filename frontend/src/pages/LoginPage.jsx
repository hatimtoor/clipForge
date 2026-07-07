import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { C, SHADOW_SM, BORDER } from "../lib/theme";
import { PixelSprite, ANVIL, ANVIL_PAL, PixelBtn, Field, Tag } from "../components/ui";
import { supabase } from "../lib/supabase";

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
  const [googleHover, setGoogleHover] = useState(false);

  const attempt = async () => {
    if (!email || !pass) { setErr("Enter email and password."); return; }
    setLoading(true); setErr("");
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
          setErr(msg); setLoading(false); return;
        }
        setSignupDone(true);
        setLoading(false);
        return;
      }
      const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
      if (error) { setErr(error.message); setLoading(false); return; }
      navigate("/hello");
    } catch { setErr("Cannot reach server."); } finally { setLoading(false); }
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
    <>
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", position: "relative", overflow: "hidden", padding: 24 }}>
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 80, background: `repeating-linear-gradient(90deg,${C.signalDeep} 0 8px,${C.signal} 8px 16px)`, borderTop: BORDER, zIndex: 0 }} />
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 80, height: 8, background: `repeating-linear-gradient(90deg,#5a3a1a 0 8px,#7a4a2a 8px 16px)`, borderTop: BORDER, zIndex: 0 }} />
        <div style={{ position: "absolute", bottom: 84, left: "calc(50% - 280px)", zIndex: 1, animation: "bob 2s ease-in-out infinite" }}>
          <PixelSprite data={ANVIL} palette={ANVIL_PAL} size={6} />
        </div>

        <div className="fade" style={{ position: "relative", zIndex: 2 }}>
          <div style={{ background: C.cream, border: BORDER, boxShadow: `5px 5px 0 ${C.ink}`, padding: 36, width: 440, maxWidth: "90vw" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 24 }}>
              <PixelSprite data={ANVIL} palette={ANVIL_PAL} size={4} />
              <div className="pixel" style={{ fontSize: 18, color: C.ink }}><span style={{ color: C.hotDeep }}>CLIP</span>FORGE</div>
            </div>

            {signupDone ? (
              <div style={{ textAlign: "center" }}>
                <div className="pixel" style={{ fontSize: 11, color: C.signalDeep, marginBottom: 12 }}>v CHECK YOUR EMAIL</div>
                <p className="vt" style={{ fontSize: 18, color: C.dim2 }}>We sent a confirmation link to <strong style={{ color: C.ink }}>{email}</strong>. Click it to activate your account, then sign in.</p>
                <div style={{ marginTop: 20 }}>
                  <PixelBtn color="cream" onClick={() => { setSignupDone(false); setMode("signin"); }}>BACK TO SIGN IN</PixelBtn>
                </div>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
                  {[["signin", "SIGN IN"], ["signup", "SIGN UP"]].map(([m, l]) => (
                    <button key={m} onClick={() => { setMode(m); setErr(""); }} className="pixel" style={{
                      flex: 1, padding: "10px", fontSize: 9,
                      background: mode === m ? (m === "signup" ? C.signal : C.hot) : C.paper,
                      color: C.ink, border: BORDER,
                      boxShadow: mode === m ? `0 0 0 ${C.ink}` : SHADOW_SM,
                      transform: mode === m ? "translate(3px,3px)" : "none",
                      cursor: "pointer",
                    }}>{l}</button>
                  ))}
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <Field label="EMAIL">
                    <input value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" type="email" className="mono" autoComplete="email"
                      style={{ width: "100%", padding: "12px 14px", background: C.paper, border: BORDER, color: C.ink, fontSize: 14, fontWeight: 500, boxShadow: SHADOW_SM }} />
                  </Field>
                  <Field label="PASSWORD">
                    <input type="password" value={pass} onChange={e => setPass(e.target.value)} placeholder="••••••••" className="mono"
                      onKeyDown={e => e.key === "Enter" && attempt()}
                      style={{ width: "100%", padding: "12px 14px", background: C.paper, border: BORDER, color: C.ink, fontSize: 14, fontWeight: 500, boxShadow: SHADOW_SM }} />
                  </Field>

                  {err && <div className="pixel" style={{ fontSize: 9, color: C.hotDeep, padding: "8px 10px", background: `${C.hot}55`, border: `2px solid ${C.hotDeep}` }}>! {err}</div>}

                  <PixelBtn color="signal" size="lg" full onClick={attempt} disabled={loading}>
                    {loading && <span style={{ width: 10, height: 10, background: C.ink, animation: "blink .4s steps(1) infinite" }} />}
                    {loading ? "LOADING..." : mode === "signup" ? "> CREATE ACCOUNT" : "> ENTER FORGE"}
                  </PixelBtn>

                  <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "4px 0" }}>
                    <div style={{ flex: 1, height: 2, background: `${C.ink}22` }} />
                    <span className="pixel" style={{ fontSize: 8, color: C.dim }}>OR</span>
                    <div style={{ flex: 1, height: 2, background: `${C.ink}22` }} />
                  </div>

                  <PixelBtn color="cream" size="md" full onClick={handleGoogle}
                    style={{ background: googleHover ? C.lavender : C.cream }}
                    onMouseEnter={() => setGoogleHover(true)}
                    onMouseLeave={() => setGoogleHover(false)}>
                    G&nbsp; CONTINUE WITH GOOGLE
                  </PixelBtn>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

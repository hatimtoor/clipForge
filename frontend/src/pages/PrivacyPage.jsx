import { C, KEYFRAMES } from "../lib/theme";
import { PixelCard } from "../components/ui";
import { useNavigate } from "react-router-dom";
import { useMobile } from "../hooks/useMobile";

export default function PrivacyPage() {
  const navigate = useNavigate();
  const isMobile = useMobile();
  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(180deg,#b8a5e8 0%,#d8b6e0 30%,#f4c4d8 55%,#ffd2b8 80%,#ffe8c8 100%)", backgroundAttachment: "fixed" }}>
      <style>{KEYFRAMES}</style>
      <div style={{ maxWidth: 860, margin: "0 auto", padding: isMobile ? "24px 16px 48px" : "40px 32px 80px" }}>

        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <button onClick={() => navigate("/")} className="pixel"
            style={{ fontSize: 9, color: C.dim2, background: "transparent", border: "none", cursor: "pointer", marginBottom: 24, padding: 0 }}>
            {"<"} BACK
          </button>
          <div className="pixel" style={{ fontSize: 11, color: C.hotDeep, marginBottom: 10 }}>LEGAL</div>
          <h1 className="pixel" style={{ fontSize: 28, color: C.ink, marginBottom: 8 }}>Privacy Policy</h1>
          <p className="vt" style={{ fontSize: 17, color: C.dim2 }}>Last updated: May 17, 2026</p>
        </div>

        <PixelCard color={C.cream} padding={32} style={{ marginBottom: 24 }}>
          <Section title="1. Who We Are">
            ClipForge is operated by Muhammad Hatim Shahid Toor ("we", "us", "our"). ClipForge is an AI-powered video clip extraction service accessible at clipforge.duckdns.org. For privacy-related questions, contact us at hatimtoor2025@gmail.com.
          </Section>
        </PixelCard>

        <PixelCard color={C.cream} padding={32} style={{ marginBottom: 24 }}>
          <Section title="2. Information We Collect">
            <SubSection title="Account Information">
              When you sign in with Google, we receive your name, email address, and Google account ID via Supabase Authentication. We do not receive or store your Google password.
            </SubSection>
            <SubSection title="Usage Data">
              We store the YouTube URLs you submit for processing, job status and progress, the clips generated from your videos, and your plan and usage statistics (clips used per month).
            </SubSection>
            <SubSection title="YouTube Account (Optional)">
              If you connect your YouTube channel for direct uploads, we store your YouTube OAuth access token and refresh token in our database. This token is used solely to upload clips on your behalf. You can disconnect at any time.
            </SubSection>
            <SubSection title="Video Content">
              We do not store your original source videos. Videos are downloaded temporarily for processing and deleted immediately after clips are rendered. Rendered clips are stored in Cloudflare R2 cloud storage and are accessible only to you via time-limited secure links.
            </SubSection>
          </Section>
        </PixelCard>

        <PixelCard color={C.cream} padding={32} style={{ marginBottom: 24 }}>
          <Section title="3. How We Use Your Information">
            <ul style={{ paddingLeft: 20, margin: 0 }}>
              {[
                "To authenticate your identity and maintain your session",
                "To process YouTube videos and generate short-form clips",
                "To store and deliver your generated clips",
                "To track your plan usage and enforce tier limits",
                "To upload clips to YouTube on your behalf (if you have connected your YouTube account)",
                "To monitor YouTube channels and auto-process new videos (Watchlist feature, Pro only)",
                "To communicate with you about your account if necessary",
              ].map((item, i) => (
                <li key={i} className="vt" style={{ fontSize: 17, color: C.ink, marginBottom: 8, lineHeight: 1.5 }}>{item}</li>
              ))}
            </ul>
          </Section>
        </PixelCard>

        <PixelCard color={C.cream} padding={32} style={{ marginBottom: 24 }}>
          <Section title="4. Third-Party Services">
            ClipForge uses the following third-party services to operate. By using ClipForge you acknowledge that your data passes through these services as described:
            <br /><br />
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${C.ink}` }}>
                  {["Service", "Purpose", "Data Shared"].map(h => (
                    <th key={h} className="pixel" style={{ fontSize: 8, color: C.dim2, textAlign: "left", padding: "8px 12px" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  ["Supabase", "Database, authentication, session management", "Email, user ID, job data, YouTube tokens"],
                  ["Cloudflare R2", "Clip file storage", "Rendered MP4 clip files"],
                  ["Groq", "AI transcription (Whisper) and analysis (Llama)", "Audio extracted from your submitted videos"],
                  ["Google / YouTube", "OAuth sign-in, optional YouTube upload", "YouTube OAuth tokens (if connected)"],
                  ["yt-dlp", "YouTube video download", "YouTube URLs you submit"],
                ].map(([s, p, d], i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${C.ink}22` }}>
                    <td className="pixel" style={{ fontSize: 9, color: C.ink, padding: "10px 12px", fontWeight: 700 }}>{s}</td>
                    <td className="vt" style={{ fontSize: 16, color: C.ink, padding: "10px 12px" }}>{p}</td>
                    <td className="vt" style={{ fontSize: 16, color: C.dim2, padding: "10px 12px" }}>{d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <br />
            <span className="vt" style={{ fontSize: 16, color: C.dim2 }}>
              Specifically regarding Groq: audio extracted from your submitted videos is sent to Groq's API for transcription. We do not send full video files to Groq. Groq's privacy policy is available at groq.com.
            </span>
          </Section>
        </PixelCard>

        <PixelCard color={C.cream} padding={32} style={{ marginBottom: 24 }}>
          <Section title="5. Data Storage & Retention">
            <SubSection title="Clip Files">
              Rendered clips are stored in a private Cloudflare R2 bucket. They are not publicly accessible. Access is provided via presigned URLs that expire after 1 hour. We retain your clips indefinitely unless you delete your account.
            </SubSection>
            <SubSection title="Job Data">
              Job records (URL submitted, status, progress, clip metadata) are stored in our Supabase database and retained indefinitely unless you delete your account.
            </SubSection>
            <SubSection title="Source Videos">
              Original source videos downloaded from YouTube are stored temporarily in server memory during processing only. They are deleted immediately after clip rendering is complete. We do not permanently store source videos.
            </SubSection>
            <SubSection title="Account Data">
              Your account data (email, usage stats, plan) is retained until you request deletion.
            </SubSection>
          </Section>
        </PixelCard>

        <PixelCard color={C.cream} padding={32} style={{ marginBottom: 24 }}>
          <Section title="6. Data Security">
            We implement the following measures to protect your data:
            <ul style={{ paddingLeft: 20, margin: "12px 0 0" }}>
              {[
                "All data in transit is encrypted via HTTPS/TLS",
                "Clip files are stored in a private R2 bucket with no public access",
                "Database access uses service role keys never exposed to the client",
                "YouTube OAuth tokens are stored server-side and never sent to the browser",
                "Authentication is handled entirely by Supabase — we never handle passwords",
              ].map((item, i) => (
                <li key={i} className="vt" style={{ fontSize: 17, color: C.ink, marginBottom: 8, lineHeight: 1.5 }}>{item}</li>
              ))}
            </ul>
          </Section>
        </PixelCard>

        <PixelCard color={C.cream} padding={32} style={{ marginBottom: 24 }}>
          <Section title="7. Your Rights">
            You have the right to:
            <ul style={{ paddingLeft: 20, margin: "12px 0 0" }}>
              {[
                "Access the personal data we hold about you",
                "Request deletion of your account and all associated data",
                "Disconnect your YouTube account at any time from within the app",
                "Request a copy of your data",
              ].map((item, i) => (
                <li key={i} className="vt" style={{ fontSize: 17, color: C.ink, marginBottom: 8, lineHeight: 1.5 }}>{item}</li>
              ))}
            </ul>
            <br />
            <span className="vt" style={{ fontSize: 17, color: C.ink }}>
              To exercise any of these rights, email us at <strong>hatimtoor2025@gmail.com</strong>. We will respond within 30 days.
            </span>
          </Section>
        </PixelCard>

        <PixelCard color={C.cream} padding={32} style={{ marginBottom: 24 }}>
          <Section title="8. Children's Privacy">
            ClipForge is not directed at children under 13. We do not knowingly collect personal information from children under 13. If you believe a child has provided us with personal data, contact us at hatimtoor2025@gmail.com and we will delete it promptly.
          </Section>
        </PixelCard>

        <PixelCard color={C.cream} padding={32} style={{ marginBottom: 24 }}>
          <Section title="9. Changes to This Policy">
            We may update this Privacy Policy from time to time. When we do, we will update the "Last updated" date at the top of this page. Continued use of ClipForge after changes constitutes acceptance of the updated policy.
          </Section>
        </PixelCard>

        <PixelCard color={C.cream} padding={32}>
          <Section title="10. Contact">
            For any privacy-related questions, data requests, or concerns:
            <br /><br />
            <span className="pixel" style={{ fontSize: 10, color: C.ink }}>Muhammad Hatim Shahid Toor</span><br />
            <span className="vt" style={{ fontSize: 17, color: C.dim2 }}>hatimtoor2025@gmail.com</span><br />
            <span className="vt" style={{ fontSize: 17, color: C.dim2 }}>Pakistan</span>
          </Section>
        </PixelCard>

      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <h2 className="pixel" style={{ fontSize: 13, color: C.ink, marginBottom: 16 }}>{title}</h2>
      <div className="vt" style={{ fontSize: 17, color: C.ink, lineHeight: 1.6 }}>{children}</div>
    </div>
  );
}

function SubSection({ title, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div className="pixel" style={{ fontSize: 9, color: C.hotDeep, marginBottom: 6 }}>{title}</div>
      <div className="vt" style={{ fontSize: 17, color: C.ink, lineHeight: 1.6 }}>{children}</div>
    </div>
  );
}

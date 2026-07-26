import { useNavigate } from "react-router-dom";
import { Card, Button } from "../components/kit";

export default function PrivacyPage() {
  const navigate = useNavigate();
  return (
    <div style={{ minHeight: "100vh" }}>
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "40px 20px 80px" }}>

        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ marginBottom: 20 }}>
            <Button variant="ghost" size="sm" onClick={() => navigate("/")}>← Back</Button>
          </div>
          <div className="t-label" style={{ color: "var(--accent-strong)", marginBottom: 8 }}>Legal</div>
          <h1 className="t-display" style={{ margin: "0 0 8px" }}>Privacy Policy</h1>
          <p className="t-sm" style={{ margin: 0 }}>Last updated: June 21, 2026</p>
        </div>

        <Card style={{ marginBottom: 20 }}>
          <Section title="1. Who We Are">
            ClipForge is operated by Hatim Toor ("we", "us", "our"). ClipForge is an AI-powered video clip extraction service accessible at clipforging.com. For privacy-related questions, contact us at hatimtoor2025@gmail.com.
          </Section>
        </Card>

        <Card style={{ marginBottom: 20 }}>
          <Section title="2. Information We Collect">
            <SubSection title="Account Information">
              When you sign in with Google, we receive your name, email address, and Google account ID via Supabase Authentication. We do not receive or store your Google password.
            </SubSection>
            <SubSection title="Usage Data">
              We store the YouTube URLs you submit for processing, job status and progress, the clips generated from your videos, and your plan and usage statistics (jobs used per month). For clips you upload to YouTube, we also store public performance metrics (views, likes, comments) retrieved from the YouTube Data API.
            </SubSection>
            <SubSection title="YouTube & TikTok Accounts (Optional)">
              If you connect your YouTube channel and/or TikTok account for direct uploads, we store the corresponding OAuth access and refresh tokens in our database. These tokens are used solely to upload clips and read basic account information on your behalf. You can disconnect either account at any time.
            </SubSection>
            <SubSection title="Billing Information">
              When you purchase a Pro subscription, payment is handled by Lemon Squeezy (our Merchant of Record). We do not collect or store your full card details. We store a subscription identifier, customer identifier, subscription status, and renewal date returned by Lemon Squeezy so we can manage your plan.
            </SubSection>
            <SubSection title="Video Content">
              We do not permanently store your original source videos. Videos are downloaded temporarily to the server during processing and deleted once clips are rendered. Rendered clips are stored in Cloudflare R2 cloud storage, are accessible only to you via time-limited secure links, and are automatically deleted after a retention period (see Section 6).
            </SubSection>
          </Section>
        </Card>

        <Card style={{ marginBottom: 20 }}>
          <Section title="3. How We Use Your Information">
            <ul style={{ paddingLeft: 20, margin: 0 }}>
              {[
                "To authenticate your identity and maintain your session",
                "To process YouTube videos and generate short-form clips",
                "To store and deliver your generated clips",
                "To track your plan usage and enforce tier limits",
                "To upload clips to YouTube and/or TikTok on your behalf (if you have connected those accounts)",
                "To monitor YouTube channels and auto-process new and historical videos (Watchlist and Digest features, Pro only)",
                "To retrieve public performance metrics for clips you have uploaded to YouTube",
                "To process subscription payments and manage your plan via our payment processor",
                "To send you transactional emails about your jobs and account",
              ].map((item, i) => (
                <li key={i} style={{ marginBottom: 8, lineHeight: 1.55 }}>{item}</li>
              ))}
            </ul>
          </Section>
        </Card>

        <Card style={{ marginBottom: 20 }}>
          <Section title="4. Third-Party Services">
            ClipForge uses the following third-party services to operate. By using ClipForge you acknowledge that your data passes through these services as described:
            <br /><br />
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid var(--line-strong)" }}>
                  {["Service", "Purpose", "Data Shared"].map(h => (
                    <th key={h} className="t-label" style={{ textAlign: "left", padding: "8px 12px" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  ["Supabase", "Database, authentication, session management", "Email, user ID, job data, YouTube/TikTok tokens"],
                  ["Cloudflare R2", "Clip file storage", "Rendered MP4 clip files"],
                  ["Groq", "AI transcription (Whisper) and analysis (Llama)", "Audio extracted from your submitted videos; transcript text"],
                  ["OpenRouter", "AI virality analysis (when enabled)", "Transcript text derived from your videos"],
                  ["Google / YouTube", "OAuth sign-in, optional upload, public video metrics", "YouTube OAuth tokens (if connected); uploaded video IDs"],
                  ["TikTok", "OAuth, optional clip publishing", "TikTok OAuth tokens (if connected); clips you choose to upload"],
                  ["Lemon Squeezy", "Payment processing (Merchant of Record)", "Name, email, billing address, and payment details you enter at checkout"],
                  ["Resend", "Transactional email delivery", "Your email address and job notification content"],
                  ["yt-dlp", "YouTube video download", "YouTube URLs you submit"],
                ].map(([s, p, d], i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--line)" }}>
                    <td style={{ padding: "10px 12px", fontWeight: 700, fontSize: "var(--fs-sm)" }}>{s}</td>
                    <td style={{ fontSize: "var(--fs-sm)", padding: "10px 12px" }}>{p}</td>
                    <td style={{ fontSize: "var(--fs-sm)", color: "var(--text-2)", padding: "10px 12px" }}>{d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <br />
            <span style={{ fontSize: "var(--fs-sm)", color: "var(--text-2)" }}>
              Specifically regarding Groq: audio extracted from your submitted videos is sent to Groq's API for transcription. We do not send full video files to Groq. Groq's privacy policy is available at groq.com.
            </span>
          </Section>
        </Card>

        <Card style={{ marginBottom: 20 }}>
          <Section title="5. Google API Services & YouTube API">
            ClipForge uses <strong>YouTube API Services</strong>. By using ClipForge's YouTube features you
            agree to be bound by the{" "}
            <a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer">YouTube Terms of Service</a>.
            Google's handling of your data is described in the{" "}
            <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">Google Privacy Policy</a>.
            <br /><br />
            <SubSection title="Google User Data We Access">
              If you connect a YouTube channel, we request two permissions: <strong>viewing your YouTube
              account</strong> (used only to display your connected channel's name and ID inside ClipForge and to
              retrieve public performance metrics for clips you uploaded through ClipForge) and{" "}
              <strong>managing your YouTube videos</strong> (used only to upload the clips you explicitly choose to
              upload, with the title, description, and privacy setting you select). We never read your private
              videos, comments, or messages, never modify or delete existing videos, and never post anything you
              did not explicitly submit.
            </SubSection>
            <SubSection title="Storage & Sharing of Google User Data">
              The OAuth tokens Google issues are stored server-side in our database, are never exposed to the
              browser, and are used solely to provide the features above. We do not sell, share, or transfer your
              Google user data to third parties except as required to operate the service (see Section 4), and we
              do not use it for advertising. Tokens are deleted when you disconnect your channel.
            </SubSection>
            <SubSection title="Revoking Access">
              You can disconnect your YouTube channel at any time on the Connections page inside ClipForge. You can
              also revoke ClipForge's access entirely from your Google account's security settings at{" "}
              <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">
                myaccount.google.com/permissions</a>.
            </SubSection>
          </Section>
        </Card>

        <Card style={{ marginBottom: 20 }}>
          <Section title="6. Data Storage & Retention">
            <SubSection title="Clip Files">
              Rendered clips are stored in a private Cloudflare R2 bucket. They are not publicly accessible. Access is provided via presigned URLs that expire after 1 hour. Clip files are automatically deleted approximately 7 days after the job is completed, so you should download or publish clips you wish to keep. Clip metadata may remain in your job history until you delete the job or your account.
            </SubSection>
            <SubSection title="Job Data">
              Job records (URL submitted, status, progress, clip metadata) are stored in our Supabase database and retained until you delete the job or your account.
            </SubSection>
            <SubSection title="Source Videos">
              Original source videos downloaded from YouTube are stored temporarily on the server during processing only. They are deleted once clip rendering is complete. We do not permanently store source videos.
            </SubSection>
            <SubSection title="Account & Billing Data">
              Your account data (email, usage stats, plan) is retained until you request deletion. Subscription records (subscription/customer identifiers, status, renewal date) are retained while your subscription is active and for a reasonable period afterward for accounting and legal compliance.
            </SubSection>
          </Section>
        </Card>

        <Card style={{ marginBottom: 20 }}>
          <Section title="7. Data Security">
            We implement the following measures to protect your data:
            <ul style={{ paddingLeft: 20, margin: "12px 0 0" }}>
              {[
                "All data in transit is encrypted via HTTPS/TLS",
                "Clip files are stored in a private R2 bucket with no public access",
                "Database access uses service role keys never exposed to the client",
                "YouTube and TikTok OAuth tokens are stored server-side and never sent to the browser",
                "Authentication is handled entirely by Supabase — we never handle passwords",
              ].map((item, i) => (
                <li key={i} style={{ marginBottom: 8, lineHeight: 1.55 }}>{item}</li>
              ))}
            </ul>
          </Section>
        </Card>

        <Card style={{ marginBottom: 20 }}>
          <Section title="8. Your Rights">
            You have the right to:
            <ul style={{ paddingLeft: 20, margin: "12px 0 0" }}>
              {[
                "Access the personal data we hold about you",
                "Request deletion of your account and all associated data",
                "Disconnect your YouTube or TikTok account at any time from within the app",
                "Cancel your subscription at any time via the billing portal in the app",
                "Request a copy of your data",
              ].map((item, i) => (
                <li key={i} style={{ marginBottom: 8, lineHeight: 1.55 }}>{item}</li>
              ))}
            </ul>
            <br />
            <span>
              To exercise any of these rights, email us at <strong>hatimtoor2025@gmail.com</strong>. We will respond within 30 days.
            </span>
          </Section>
        </Card>

        <Card style={{ marginBottom: 20 }}>
          <Section title="9. Children's Privacy">
            ClipForge is not directed at children under 13. We do not knowingly collect personal information from children under 13. If you believe a child has provided us with personal data, contact us at hatimtoor2025@gmail.com and we will delete it promptly.
          </Section>
        </Card>

        <Card style={{ marginBottom: 20 }}>
          <Section title="10. Changes to This Policy">
            We may update this Privacy Policy from time to time. When we do, we will update the "Last updated" date at the top of this page. Continued use of ClipForge after changes constitutes acceptance of the updated policy.
          </Section>
        </Card>

        <Card>
          <Section title="11. Contact">
            For any privacy-related questions, data requests, or concerns:
            <br /><br />
            <span style={{ fontWeight: 700 }}>Hatim Toor</span><br />
            <span style={{ color: "var(--text-2)" }}>hatimtoor2025@gmail.com</span><br />
            <span style={{ color: "var(--text-2)" }}>Pakistan</span>
          </Section>
        </Card>

      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <h2 className="t-h2" style={{ margin: "0 0 14px" }}>{title}</h2>
      <div style={{ fontSize: "var(--fs-body)", color: "var(--text-1)", lineHeight: 1.65 }}>{children}</div>
    </div>
  );
}

function SubSection({ title, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div className="t-label" style={{ color: "var(--accent-strong)", marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: "var(--fs-body)", color: "var(--text-1)", lineHeight: 1.65 }}>{children}</div>
    </div>
  );
}

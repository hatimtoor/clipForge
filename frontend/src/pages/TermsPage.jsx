import { C, KEYFRAMES } from "../lib/theme";
import { PixelCard } from "../components/ui";
import { useNavigate } from "react-router-dom";
import { useMobile } from "../hooks/useMobile";

export default function TermsPage() {
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
          <h1 className="pixel" style={{ fontSize: 28, color: C.ink, marginBottom: 8 }}>Terms of Service</h1>
          <p className="vt" style={{ fontSize: 17, color: C.dim2 }}>Last updated: May 17, 2026</p>
        </div>

        <PixelCard color={C.cream} padding={32} style={{ marginBottom: 24 }}>
          <Section title="1. Agreement">
            By accessing or using ClipForge at clipforging.com ("the Service"), you agree to be bound by these Terms of Service. If you do not agree, do not use the Service. ClipForge is operated by Hatim Toor, Pakistan. Contact: hatimtoor2025@gmail.com.
          </Section>
        </PixelCard>

        <PixelCard color={C.cream} padding={32} style={{ marginBottom: 24 }}>
          <Section title="2. Description of Service">
            ClipForge is an AI-powered tool that:
            <ul style={{ paddingLeft: 20, margin: "12px 0 0" }}>
              {[
                "Downloads publicly accessible YouTube videos you submit",
                "Transcribes audio using AI (Groq Whisper)",
                "Analyzes transcripts to identify viral-worthy moments",
                "Renders short-form video clips with burned-in captions",
                "Stores rendered clips in cloud storage for your download",
                "Optionally uploads clips to your connected YouTube channel",
                "Optionally monitors YouTube channels and auto-processes new videos",
              ].map((item, i) => (
                <li key={i} className="vt" style={{ fontSize: 17, color: C.ink, marginBottom: 8, lineHeight: 1.5 }}>{item}</li>
              ))}
            </ul>
          </Section>
        </PixelCard>

        <PixelCard color={C.cream} padding={32} style={{ marginBottom: 24 }}>
          <Section title="3. Acceptable Use">
            You agree to use ClipForge only for lawful purposes. You must not use the Service to:
            <ul style={{ paddingLeft: 20, margin: "12px 0 0" }}>
              {[
                "Process videos you do not own or do not have rights to clip and redistribute",
                "Violate YouTube's Terms of Service or any other platform's terms",
                "Generate clips containing illegal content, hate speech, harassment, or content that violates any applicable law",
                "Attempt to reverse engineer, scrape, or abuse the Service's infrastructure",
                "Share your account credentials with others",
                "Use the Service for any automated bulk processing outside of the Watchlist feature",
                "Circumvent plan limits through any means",
              ].map((item, i) => (
                <li key={i} className="vt" style={{ fontSize: 17, color: C.ink, marginBottom: 8, lineHeight: 1.5 }}>{item}</li>
              ))}
            </ul>
          </Section>
        </PixelCard>

        <PixelCard color={C.cream} padding={32} style={{ marginBottom: 24 }}>
          <Section title="4. Your Content & Intellectual Property">
            You retain all rights to the videos you submit and the clips generated from them. By using ClipForge, you grant us a limited, non-exclusive license to process your submitted URLs and store your rendered clips solely for the purpose of delivering the Service to you.
            <br /><br />
            You are solely responsible for ensuring you have the right to process, clip, and redistribute any video you submit to ClipForge. We do not verify copyright ownership of submitted content.
          </Section>
        </PixelCard>

        <PixelCard color={C.cream} padding={32} style={{ marginBottom: 24 }}>
          <Section title="5. YouTube & Third-Party Platform Compliance">
            ClipForge uses yt-dlp to download YouTube videos for processing. You acknowledge that:
            <ul style={{ paddingLeft: 20, margin: "12px 0 0" }}>
              {[
                "You are responsible for complying with YouTube's Terms of Service regarding the content you process",
                "ClipForge is not affiliated with, endorsed by, or in any way officially connected with YouTube or Google",
                "You must only submit videos for which you have permission to create derivative clips",
                "If you use the YouTube upload feature, you are responsible for the content uploaded to your channel",
              ].map((item, i) => (
                <li key={i} className="vt" style={{ fontSize: 17, color: C.ink, marginBottom: 8, lineHeight: 1.5 }}>{item}</li>
              ))}
            </ul>
          </Section>
        </PixelCard>

        <PixelCard color={C.cream} padding={32} style={{ marginBottom: 24 }}>
          <Section title="6. Plans, Limits & Payment">
            <SubSection title="Free Plan">
              Free accounts are limited to 10 clips per month and 3 clips per job. Limits reset every 30 days.
            </SubSection>
            <SubSection title="Pro Plan">
              Pro accounts have access to all features including unlimited clips, 9:16 auto-reframe, YouTube upload, and Watchlist. Pro plan pricing and billing terms are displayed at the point of purchase.
            </SubSection>
            <SubSection title="Refunds">
              We offer refunds within 7 days of payment if the Service did not function as described. Contact hatimtoor2025@gmail.com with your request. We do not offer refunds for partial month usage beyond the 7-day window.
            </SubSection>
          </Section>
        </PixelCard>

        <PixelCard color={C.cream} padding={32} style={{ marginBottom: 24 }}>
          <Section title="7. Service Availability">
            We aim to keep ClipForge running reliably but do not guarantee 100% uptime. The Service may be unavailable due to maintenance, server issues, or events outside our control. We are not liable for losses caused by downtime.
            <br /><br />
            Processing times depend on video length and server load. Typical processing time is 5–10 minutes for a 1-hour video. We do not guarantee specific processing times.
          </Section>
        </PixelCard>

        <PixelCard color={C.cream} padding={32} style={{ marginBottom: 24 }}>
          <Section title="8. Disclaimer of Warranties">
            ClipForge is provided "as is" and "as available" without warranties of any kind, either express or implied. We do not warrant that:
            <ul style={{ paddingLeft: 20, margin: "12px 0 0" }}>
              {[
                "The Service will meet your specific requirements",
                "Generated clips will achieve any particular virality or performance on social platforms",
                "AI-generated transcriptions will be 100% accurate",
                "The Service will be uninterrupted or error-free",
                "Any particular video can be successfully downloaded or processed",
              ].map((item, i) => (
                <li key={i} className="vt" style={{ fontSize: 17, color: C.ink, marginBottom: 8, lineHeight: 1.5 }}>{item}</li>
              ))}
            </ul>
          </Section>
        </PixelCard>

        <PixelCard color={C.cream} padding={32} style={{ marginBottom: 24 }}>
          <Section title="9. Limitation of Liability">
            To the maximum extent permitted by applicable law, Hatim Toor and ClipForge shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including but not limited to loss of profits, data, or goodwill, arising from your use of or inability to use the Service.
            <br /><br />
            Our total liability to you for any claim arising from use of the Service shall not exceed the amount you paid us in the 3 months preceding the claim.
          </Section>
        </PixelCard>

        <PixelCard color={C.cream} padding={32} style={{ marginBottom: 24 }}>
          <Section title="10. Account Termination">
            We reserve the right to suspend or terminate your account at any time if you violate these Terms. You may delete your account at any time by contacting hatimtoor2025@gmail.com.
            <br /><br />
            Upon termination, your access to the Service ends immediately. We may retain your data for up to 30 days after termination before permanent deletion.
          </Section>
        </PixelCard>

        <PixelCard color={C.cream} padding={32} style={{ marginBottom: 24 }}>
          <Section title="11. Changes to Terms">
            We may modify these Terms at any time. Updated Terms will be posted at this URL with a new "Last updated" date. Continued use of the Service after changes constitutes acceptance of the new Terms.
          </Section>
        </PixelCard>

        <PixelCard color={C.cream} padding={32}>
          <Section title="12. Contact">
            For any questions about these Terms:
            <br /><br />
            <span className="pixel" style={{ fontSize: 10, color: C.ink }}>Hatim Toor</span><br />
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

import { Link } from "react-router-dom"
import Logo from "../components/Logo"
import ThemeToggle from "../theme/ThemeToggle"

/**
 * Placeholder Terms / Privacy / About pages — required for any product that
 * lets users sign up. The body text is intentionally honest about being a
 * draft so legal can take it from here without it pretending to be vetted
 * boilerplate.
 */

interface LegalContent {
  eyebrow:  string
  title:    string
  intro:    string
  sections: { heading: string; body: string }[]
}

const TERMS: LegalContent = {
  eyebrow: "— Terms of service —",
  title:   "Terms of Service",
  intro:   "By using Percy, you agree to the following. These terms are an early draft — we'll publish a fuller, lawyer-reviewed version before general availability.",
  sections: [
    { heading: "Your account",
      body:    "You're responsible for what happens under your account. Use a strong password and keep it private. Don't share access with people outside your team without going through the invitation flow." },
    { heading: "Your content",
      body:    "Decks, data sources, and templates you upload remain yours. Percy stores and processes them only to provide the service. We don't sell your content, and we don't train models on private content without explicit opt-in." },
    { heading: "Acceptable use",
      body:    "Don't use Percy to host illegal content, attempt to break the service, or impersonate others. We reserve the right to suspend accounts that do." },
    { heading: "Termination",
      body:    "You can delete your account at any time. We'll provide an export option before final deletion." },
    { heading: "Changes",
      body:    "If we update these terms in a meaningful way, we'll email you and post a changelog." },
  ],
}

const PRIVACY: LegalContent = {
  eyebrow: "— Privacy policy —",
  title:   "Privacy Policy",
  intro:   "Percy collects what's needed to make presentations work and not much else. This is a draft policy — a fuller version will follow before GA.",
  sections: [
    { heading: "What we collect",
      body:    "Account details (email, name, optional avatar). Decks and templates you upload. Telemetry on which features you use, so we can fix what's broken. Standard server logs (IP, user-agent) for security." },
    { heading: "What we don't",
      body:    "We don't sell your data. We don't share decks with third parties. We don't use private content to train AI models." },
    { heading: "Cookies",
      body:    "A single session cookie keeps you signed in. We don't use third-party tracking cookies." },
    { heading: "Third parties",
      body:    "If you connect data sources (Snowflake, BigQuery, Sheets), Percy reads from them only when you trigger a refresh. Connection credentials are encrypted at rest." },
    { heading: "Your rights",
      body:    "Export your data, delete your account, or ask what we have on you — email privacy@percy.app and we'll respond within 30 days." },
  ],
}

function LegalShell({ content }: { content: LegalContent }) {
  return (
    <div className="min-h-screen flex flex-col bg-ink text-paper">
      <div className="h-14 shrink-0 flex items-center justify-between px-8 border-b border-edge">
        <Link to="/" className="flex items-center gap-2.5">
          <Logo size={18} />
          <span className="wordmark text-[12px]">Percy</span>
        </Link>
        <ThemeToggle size="xs" />
      </div>

      <div className="flex-1 overflow-y-auto py-12 px-6">
        <div className="max-w-2xl mx-auto">
          <div className="text-[10px] tracking-[0.22em] uppercase text-muted mb-3">{content.eyebrow}</div>
          <h1 className="text-[32px] font-semibold tracking-[-0.01em] mb-5">{content.title}</h1>
          <p className="text-[14px] text-muted leading-[1.8] mb-10">{content.intro}</p>

          <div className="space-y-8">
            {content.sections.map((s) => (
              <section key={s.heading}>
                <h2 className="text-[16px] font-semibold tracking-[-0.01em] mb-2">{s.heading}</h2>
                <p className="text-[13px] text-muted leading-[1.8]">{s.body}</p>
              </section>
            ))}
          </div>

          <div className="mt-12 pt-6 border-t border-edge text-[11px] text-muted">
            Last updated: 2026-05-05 ·{" "}
            <Link to="/" className="text-paper hover:underline">Back to home</Link>
          </div>
        </div>
      </div>
    </div>
  )
}

export function TermsPage()   { return <LegalShell content={TERMS} /> }
export function PrivacyPage() { return <LegalShell content={PRIVACY} /> }

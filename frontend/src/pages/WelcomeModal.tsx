import { useState } from "react"
import type { User } from "../lib/authApi"

const STORAGE_KEY = "percy_welcomed_v1"

export function shouldShowWelcome(user: User | null): boolean {
  if (!user) return false
  return localStorage.getItem(STORAGE_KEY) !== user.id
}

export function markWelcomeSeen(user: User | null): void {
  if (user) localStorage.setItem(STORAGE_KEY, user.id)
}

export default function WelcomeModal({ user, onClose }: { user: User; onClose: () => void }) {
  const [step, setStep] = useState(0)

  const close = () => {
    markWelcomeSeen(user)
    onClose()
  }

  // Slides walk the pitch arc: history gap → cost → mission → product → call-to-action.
  // Tone: confident, measured, specific. No emoji, no gradients, no consumer flourishes.
  const slides: Array<{
    eyebrow: string
    title: React.ReactNode
    body: React.ReactNode
  }> = [
    {
      eyebrow: "1987",
      title: <>The last time presentations got an upgrade.</>,
      body: (
        <>
          PowerPoint replaced flipping through physical slides. Nothing meaningful has happened since.
          The data layer has been transformed — SQL, Python, warehouses, dashboards, AI. The communication
          layer is still 1987.
        </>
      ),
    },
    {
      eyebrow: "The gap",
      title: <>Your deck is disconnected from the data, code, and templates that created it.</>,
      body: (
        <>
          Numbers go stale the moment they're pasted. Recurring reports get rebuilt from scratch every week.
          Your most expensive people spend Friday afternoon on slide formatting. There is no PowerPoint
          equivalent of a data pipeline.
        </>
      ),
    },
    {
      eyebrow: "The Bridge",
      title: <>Every element is a Bridge element — structured, inspectable, programmable.</>,
      body: (
        <>
          When you onboard a deck, Percy doesn't see a screenshot or raw Office XML. It extracts every chart,
          table, shape, and layout as a structured Bridge element with a name, history, and a place to attach
          logic. AI operates on that structure, not on guesses.
        </>
      ),
    },
    {
      eyebrow: "The product",
      title: <>Bind elements to Python. Refresh on demand. The deck becomes a rendered result.</>,
      body: (
        <>
          Attach a Connect — a Python snippet — to any element. Run it. The element updates from your
          warehouse, your spreadsheet, or your model output. Export back to .pptx, PDF, or the web.
          The deck is no longer the source of truth.
        </>
      ),
    },
    {
      eyebrow: `Welcome, ${user.display_name.split(" ")[0]}`,
      title: <>This is your workspace.</>,
      body: (
        <>
          {user.orgs.some((o) => o.kind === "team") ? (
            <>You and anyone at <span className="text-white">@{user.email.split("@")[1]}</span> share a
            team workspace. Invite collaborators from the Members panel.</>
          ) : (
            <>You're in a private workspace. Sign in with a company email later to spin up a team
            workspace.</>
          )} Onboard a deck and Percy will start building your team's element memory from day one.
        </>
      ),
    },
  ]
  const slide = slides[step]
  const last = step === slides.length - 1

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/90 backdrop-blur-[2px]" onClick={close}>
      <div className="bg-surface border border-edge w-[600px] max-w-[95vw] shadow-2xl"
           onClick={(e) => e.stopPropagation()}>
        <div className="px-12 py-14">
          <div className="flex items-baseline gap-3 mb-6">
            <span className="text-[10px] tracking-[0.22em] uppercase text-muted">— {slide.eyebrow} —</span>
            <span className="text-[10px] tracking-[0.22em] uppercase text-muted ml-auto">
              {String(step + 1).padStart(2, "0")} / {String(slides.length).padStart(2, "0")}
            </span>
          </div>
          <div className="text-[28px] font-semibold leading-[1.18] tracking-[-0.01em] text-paper mb-6">
            {slide.title}
          </div>
          <div className="text-[14px] text-muted leading-[1.7] max-w-lg">{slide.body}</div>
        </div>
        <div className="flex items-center justify-between px-7 py-4 border-t border-edge">
          <div className="flex gap-1">
            {slides.map((_, i) => (
              <span key={i} className={`h-px transition-all duration-300 ${i === step ? "w-8 bg-paper" : "w-4 bg-paper/20"}`} />
            ))}
          </div>
          <div className="flex gap-2 items-center">
            <button onClick={close} className="text-[10px] tracking-[0.14em] uppercase text-muted hover:text-paper px-2 py-1.5 transition-colors">
              Skip
            </button>
            <button
              onClick={() => last ? close() : setStep((s) => s + 1)}
              className="text-[11px] tracking-[0.14em] uppercase px-5 py-2 bg-paper text-ink hover:bg-paper/90 font-medium transition-colors"
            >
              {last ? "Enter workspace" : "Continue"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

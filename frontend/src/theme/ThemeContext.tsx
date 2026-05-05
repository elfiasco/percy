import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react"

export type ThemeMode = "dark" | "light"

const STORAGE_KEY = "percy_theme_v1"

function readInitialTheme(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === "light" || v === "dark") return v
  } catch { /* ignore */ }
  // No saved preference: respect OS preference, default to dark (Gatsby evening).
  if (typeof window !== "undefined" && window.matchMedia) {
    const prefersLight = window.matchMedia("(prefers-color-scheme: light)").matches
    return prefersLight ? "light" : "dark"
  }
  return "dark"
}

function applyTheme(mode: ThemeMode) {
  const root = document.documentElement
  root.classList.remove("theme-light", "theme-dark")
  root.classList.add(`theme-${mode}`)
  // also expose color-scheme so native form controls match
  root.style.colorScheme = mode
}

interface ThemeContextValue {
  mode: ThemeMode
  setMode: (mode: ThemeMode) => void
  toggle: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => readInitialTheme())

  useEffect(() => {
    applyTheme(mode)
    try { localStorage.setItem(STORAGE_KEY, mode) } catch { /* ignore */ }
  }, [mode])

  const setMode = useCallback((m: ThemeMode) => setModeState(m), [])
  const toggle  = useCallback(() => setModeState((m) => m === "dark" ? "light" : "dark"), [])

  return (
    <ThemeContext.Provider value={{ mode, setMode, toggle }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>")
  return ctx
}

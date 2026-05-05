import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react"
import type { User } from "../lib/authApi"
import { fetchMe, login as apiLogin, signup as apiSignup, logout as apiLogout } from "../lib/authApi"

interface AuthState {
  user: User | null
  loading: boolean
  error: string | null
  refresh:  () => Promise<void>
  login:    (email: string, password: string) => Promise<User>
  signup:   (email: string, password: string, displayName?: string) => Promise<User>
  logout:   () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user,    setUser]    = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setError(null)
    try {
      const u = await fetchMe()
      setUser(u)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const login = useCallback(async (email: string, password: string) => {
    const u = await apiLogin(email, password)
    setUser(u)
    return u
  }, [])

  const signup = useCallback(async (email: string, password: string, displayName?: string) => {
    const u = await apiSignup(email, password, displayName)
    setUser(u)
    return u
  }, [])

  const logout = useCallback(async () => {
    await apiLogout()
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, error, refresh, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>")
  return ctx
}

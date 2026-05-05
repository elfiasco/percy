import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter, Routes, Route } from "react-router-dom"
import "./index.css"

import { AuthProvider } from "./auth/AuthContext"
import { ThemeProvider } from "./theme/ThemeContext"
import { ToasterProvider } from "./components/Toaster"
import ErrorBoundary from "./components/ErrorBoundary"
import NotFoundPage from "./pages/NotFoundPage"
import Splash    from "./pages/Splash"
import Login     from "./pages/Login"
import Signup    from "./pages/Signup"
import Dashboard from "./pages/Dashboard"
import ProjectsPage from "./pages/ProjectsPage"
import ProjectDetailPage from "./pages/ProjectDetailPage"
import TemplatesPage from "./pages/TemplatesPage"
import StudioPage from "./pages/StudioPage"
import DevPage   from "./pages/DevPage"
import InviteAccept from "./pages/InviteAccept"
import Settings from "./pages/Settings"
import ForgotPassword from "./pages/ForgotPassword"
import { TermsPage, PrivacyPage } from "./pages/LegalPage"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <ToasterProvider>
          <ErrorBoundary>
        <AuthProvider>
          <Routes>
          <Route path="/"                 element={<Splash />} />
          <Route path="/login"            element={<Login />} />
          <Route path="/signup"           element={<Signup />} />
          <Route path="/forgot-password"  element={<ForgotPassword />} />
          <Route path="/terms"            element={<TermsPage />} />
          <Route path="/privacy"          element={<PrivacyPage />} />
          <Route path="/home"             element={<Dashboard />} />
          <Route path="/projects"         element={<ProjectsPage />} />
          <Route path="/project/:projectId" element={<ProjectDetailPage />} />
          <Route path="/templates"        element={<TemplatesPage />} />
          <Route path="/studio/:projectId" element={<StudioPage />} />
          <Route path="/dev"              element={<DevPage />} />
          <Route path="/invite/accept"    element={<InviteAccept />} />
          <Route path="/settings"         element={<Settings />} />
          <Route path="*"                 element={<NotFoundPage />} />
          </Routes>
        </AuthProvider>
          </ErrorBoundary>
        </ToasterProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
)

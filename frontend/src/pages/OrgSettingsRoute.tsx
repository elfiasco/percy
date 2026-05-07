import { useParams, Navigate } from "react-router-dom"
import { useAuth } from "../auth/AuthContext"
import OrgSettingsPage from "../components/OrgSettingsPage"
import PageLoader from "../components/PageLoader"

export default function OrgSettingsRoute() {
  const { orgId } = useParams<{ orgId: string }>()
  const { user, loading } = useAuth()

  if (loading) return <PageLoader />
  if (!user) return <Navigate to="/login" replace />

  const org = user.orgs.find(o => o.id === orgId)
  if (!org) return <Navigate to="/home" replace />

  const userRole = org.role || "member"

  return (
    <OrgSettingsPage
      orgId={org.id}
      orgName={org.name}
      userRole={userRole}
    />
  )
}

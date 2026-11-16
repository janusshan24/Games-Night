import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from './AuthProvider'
import { Loading } from '../components/ui'

/** Only signed-in, active players get past this. */
export function RequireAuth() {
  const { session, profile, loading } = useAuth()
  const location = useLocation()
  if (loading) return <Loading />
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (profile && !profile.is_active) {
    return (
      <div className="center-screen">
        <div className="card auth-card">
          <h2>Account paused</h2>
          <p className="muted">An admin has deactivated this account. Ask them to reactivate it.</p>
        </div>
      </div>
    )
  }
  return <Outlet />
}

/**
 * Hides admin pages in the UI. Real enforcement is in the database:
 * row level security rejects admin writes from non-admins.
 */
export function RequireAdmin() {
  const { isAdmin, loading } = useAuth()
  if (loading) return <Loading />
  if (!isAdmin) return <Navigate to="/" replace />
  return <Outlet />
}

import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthProvider'
import { RequireAdmin, RequireAuth } from './auth/guards'
import { AppShell, MoreMenu } from './components/AppShell'
import { isConfigured } from './lib/supabase'
import { Admin } from './pages/Admin'
import { AdminPlayers } from './pages/AdminPlayers'
import { Coming } from './pages/Coming'
import { DesignSystem } from './pages/DesignSystem'
import { Home } from './pages/Home'
import { League } from './pages/League'
import { Login, ResetPassword } from './pages/Login'
import { Me } from './pages/Me'
import { SetupNeeded } from './pages/SetupNeeded'

export default function App() {
  if (!isConfigured) return <SetupNeeded />
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route element={<RequireAuth />}>
            <Route element={<AppShell />}>
              <Route index element={<Home />} />
              <Route path="me" element={<Me />} />
              <Route path="more" element={<MoreMenu />} />
              <Route path="design" element={<DesignSystem />} />
              <Route path="league" element={<League />} />
              <Route path="nights" element={<Coming title="Games nights" icon="🎉" phase={2} text="Plan nights, RSVP, check in and track the games being played." />} />
              <Route path="games" element={<Coming title="Games library" icon="🎲" phase={2} text="Your shared library of games, rules and house rules." />} />
              <Route path="players" element={<Coming title="Players" icon="👥" phase={2} text="Profiles, attendance and personal stats." />} />
              <Route path="rules" element={<Coming title="House rules" icon="📜" phase={2} text="Propose, vote on and approve custom rules." />} />
              <Route path="disputes" element={<Coming title="Disputes" icon="⚖️" phase={4} text="Report incidents, add evidence and vote on penalties." />} />
              <Route path="history" element={<Coming title="History" icon="🗂️" phase={4} text="Every past games night and its results." />} />
              <Route element={<RequireAdmin />}>
                <Route path="admin" element={<Admin />} />
                <Route path="admin/players" element={<AdminPlayers />} />
              </Route>
              <Route path="*" element={<Coming title="Not found" icon="🤔" phase={1} text="That page doesn't exist." />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

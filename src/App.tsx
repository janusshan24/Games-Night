import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthProvider'
import { RequireAdmin, RequireAuth } from './auth/guards'
import { AppShell, MoreMenu } from './components/AppShell'
import { isConfigured } from './lib/supabase'
import { Admin } from './pages/Admin'
import { AdminPlayers } from './pages/AdminPlayers'
import { AdminSettings } from './pages/AdminSettings'
import { Coming } from './pages/Coming'
import { Declaration } from './pages/Declaration'
import { Disputes } from './pages/Disputes'
import { History } from './pages/History'
import { GameDetail } from './pages/GameDetail'
import { Games } from './pages/Games'
import { HouseRules } from './pages/HouseRules'
import { NightDetail } from './pages/NightDetail'
import { Nights } from './pages/Nights'
import { MatchDetail } from './pages/match/MatchDetail'
import { Picker } from './pages/Picker'
import { PlayerDetail, Players } from './pages/Players'
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
              <Route path="declaration" element={<Declaration />} />
              <Route path="nights" element={<Nights />} />
              <Route path="nights/:id" element={<NightDetail />} />
              <Route path="games" element={<Games />} />
              <Route path="games/:id" element={<GameDetail />} />
              <Route path="matches/:id" element={<MatchDetail />} />
              <Route path="picker" element={<Picker />} />
              <Route path="players" element={<Players />} />
              <Route path="players/:id" element={<PlayerDetail />} />
              <Route path="rules" element={<HouseRules />} />
              <Route path="disputes" element={<Disputes />} />
              <Route path="history" element={<History />} />
              <Route element={<RequireAdmin />}>
                <Route path="admin" element={<Admin />} />
                <Route path="admin/players" element={<AdminPlayers />} />
                <Route path="admin/settings" element={<AdminSettings />} />
              </Route>
              <Route path="*" element={<Coming title="Not found" icon="🤔" phase={1} text="That page doesn't exist." />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

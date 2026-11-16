import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { Avatar } from './ui'

interface NavItem {
  to: string
  label: string
  icon: string
  admin?: boolean
  mobile?: boolean // shown in the bottom tab bar on phones
}

// One list drives both the desktop sidebar and the mobile tab bar.
const NAV: NavItem[] = [
  { to: '/', label: 'Home', icon: '🏠', mobile: true },
  { to: '/nights', label: 'Games nights', icon: '🎉', mobile: true },
  { to: '/games', label: 'Games', icon: '🎲', mobile: true },
  { to: '/league', label: 'League', icon: '🏆', mobile: true },
  { to: '/players', label: 'Players', icon: '👥' },
  { to: '/rules', label: 'House rules', icon: '📜' },
  { to: '/disputes', label: 'Disputes', icon: '⚖️' },
  { to: '/history', label: 'History', icon: '🗂️' },
  { to: '/admin', label: 'Admin', icon: '🛠️', admin: true },
]

export function AppShell() {
  const { profile, isAdmin, signOut } = useAuth()
  const items = NAV.filter((n) => !n.admin || isAdmin)

  return (
    <div className="shell">
      <aside className="shell__sidebar">
        <Brand />
        {items.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'} className="nav-link">
            <span className="nav-link__icon">{n.icon}</span>
            {n.label}
          </NavLink>
        ))}
        <div className="shell__spacer" />
        {profile && (
          <NavLink to="/me" className="nav-link">
            <Avatar id={profile.id} name={profile.display_name} size={28} />
            {profile.display_name}
          </NavLink>
        )}
        <button className="nav-link btn--ghost" style={{ border: 0, cursor: 'pointer' }} onClick={signOut}>
          <span className="nav-link__icon">🚪</span>
          Sign out
        </button>
      </aside>

      <header className="topbar">
        <Brand />
        {profile && (
          <NavLink to="/me" aria-label="My profile">
            <Avatar id={profile.id} name={profile.display_name} size={32} />
          </NavLink>
        )}
      </header>

      <main className="shell__main">
        <div className="shell__content">
          <Outlet />
        </div>
      </main>

      <nav className="tabbar" aria-label="Main">
        {items
          .filter((n) => n.mobile)
          .map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'}>
              <span className="tabbar__icon">{n.icon}</span>
              {n.label.replace('Games nights', 'Nights')}
            </NavLink>
          ))}
        <NavLink to="/more">
          <span className="tabbar__icon">☰</span>
          More
        </NavLink>
      </nav>
    </div>
  )
}

function Brand() {
  return (
    <NavLink to="/" className="shell__brand" style={{ textDecoration: 'none' }}>
      <span className="shell__brand-mark">🎲</span>
      <span>
        Games <span className="gradient-text">Night</span>
      </span>
    </NavLink>
  )
}

/** Mobile "More" page: everything not in the tab bar. */
export function MoreMenu() {
  const { isAdmin, signOut } = useAuth()
  return (
    <div className="stack">
      <h1>More</h1>
      <div className="card" style={{ padding: 'var(--space-2)' }}>
        {NAV.filter((n) => !n.mobile && (!n.admin || isAdmin)).map((n) => (
          <NavLink key={n.to} to={n.to} className="nav-link">
            <span className="nav-link__icon">{n.icon}</span>
            {n.label}
          </NavLink>
        ))}
        <NavLink to="/design" className="nav-link">
          <span className="nav-link__icon">🎨</span>
          Design system
        </NavLink>
        <button className="nav-link btn--ghost" style={{ border: 0, width: '100%', cursor: 'pointer' }} onClick={signOut}>
          <span className="nav-link__icon">🚪</span>
          Sign out
        </button>
      </div>
    </div>
  )
}

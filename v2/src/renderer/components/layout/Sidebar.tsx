import React from 'react'
import { NavLink } from 'react-router-dom'
import { LayoutDashboard, Disc3, Activity, Clock, Settings } from 'lucide-react'

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/rip', icon: Disc3, label: 'Rip Disc' },
  { to: '/progress', icon: Activity, label: 'Progress' },
  { to: '/history', icon: Clock, label: 'History' },
  { to: '/settings', icon: Settings, label: 'Settings' }
]

export function Sidebar() {
  return (
    <aside className="w-48 bg-zinc-900/50 border-r border-zinc-800 flex flex-col shrink-0">
      <div className="p-4 border-b border-zinc-800 drag-region">
        <h1 className="text-lg font-bold text-purple-400 no-drag">Zac the Ripper</h1>
        <span className="label-tech">v2.0</span>
      </div>

      <nav className="flex-1 p-2 space-y-0.5">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded text-sm transition-colors duration-200 ${
                isActive
                  ? 'bg-purple-600/20 text-purple-400 border border-purple-500/30'
                  : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/50 border border-transparent'
              }`
            }
          >
            <Icon className="w-4 h-4 shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="p-3 border-t border-zinc-800">
        <div className="label-tech">System</div>
        <div className="mt-1 flex items-center gap-2">
          <span className="status-dot status-dot-ready" />
          <span className="text-[10px] text-zinc-500">Ready</span>
        </div>
      </div>
    </aside>
  )
}

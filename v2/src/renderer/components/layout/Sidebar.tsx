import React from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { LayoutDashboard, Disc3, Play, Activity, Clock, Settings, RefreshCw, ArrowUpFromLine } from 'lucide-react'
import { Logo } from '../ui'
import { useDiscStore } from '../../stores/disc-store'
import { useDiscDetection } from '../../hooks/useDiscDetection'

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/preview', icon: Play, label: 'Preview' },
  { to: '/rip', icon: Disc3, label: 'Rip Disc' },
  { to: '/progress', icon: Activity, label: 'Progress' },
  { to: '/history', icon: Clock, label: 'History' },
  { to: '/settings', icon: Settings, label: 'Settings' }
]

export function Sidebar() {
  const navigate = useNavigate()
  const { discInfo, drives, selectedDrive, scanning, loading } = useDiscStore()
  const { rescanDisc } = useDiscDetection({ pollInterval: 0, autoLoadDiscInfo: false })

  // A disc is present if we have full info OR if drive polling detected one
  const driveWithDisc = drives.find(d => d.discTitle || d.discType)
  const hasDisc = !!discInfo || !!driveWithDisc

  const handleRefresh = async () => {
    await rescanDisc(true)
  }

  const handleEject = async () => {
    const driveIndex = selectedDrive ?? driveWithDisc?.index ?? 0
    await window.ztr.disc.eject(driveIndex)
    useDiscStore.getState().setDiscInfo(null)
    useDiscStore.getState().resetDiscSession()
    navigate('/')
  }

  return (
    <aside className="w-48 bg-zinc-900/50 border-r border-zinc-800 flex flex-col shrink-0">
      <div className="p-4 border-b border-zinc-800 drag-region">
        <div className="flex items-center gap-2.5 no-drag">
          <Logo size={28} glow />
          <div>
            <h1 className="text-lg font-bold text-purple-400 font-display leading-tight animate-header-glow">Zac the Ripper</h1>
            <span className="label-tech">v2.0</span>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-2 space-y-0.5">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded text-sm transition-all duration-200 ${
                isActive
                  ? 'bg-purple-600/20 text-purple-400 border border-purple-500/30 nav-active-glow'
                  : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/50 border border-transparent'
              }`
            }
          >
            <Icon className="w-4 h-4 shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* ── Drive ─────────────────────────────── */}
      <div className="px-3 py-2 border-t border-zinc-800">
        <span className="label-tech text-[10px] text-zinc-600 uppercase tracking-wider">Drive</span>

        {discInfo ? (
          <div className="mt-1.5 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Disc3 className="w-3 h-3 text-purple-400 shrink-0 animate-disc-idle" />
              <span className="text-xs text-zinc-300 truncate">{discInfo.title}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="badge badge-default text-[9px]">{discInfo.discType}</span>
              <span className="text-[10px] text-zinc-500">{discInfo.trackCount} titles</span>
            </div>
          </div>
        ) : loading && driveWithDisc ? (
          <div className="mt-1.5 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <RefreshCw className="w-3 h-3 text-purple-400 shrink-0 animate-spin" />
              <span className="text-xs text-zinc-400 truncate">{driveWithDisc.discTitle || 'Scanning...'}</span>
            </div>
            <span className="text-[10px] text-zinc-600">Reading disc info...</span>
          </div>
        ) : driveWithDisc ? (
          <div className="mt-1.5 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Disc3 className="w-3 h-3 text-zinc-500 shrink-0" />
              <span className="text-xs text-zinc-400 truncate">{driveWithDisc.discTitle || 'Disc detected'}</span>
            </div>
            <span className="text-[10px] text-zinc-600">Tap Refresh to scan</span>
          </div>
        ) : (
          <div className="mt-1.5 text-[10px] text-zinc-600">No disc detected</div>
        )}

        <div className="flex gap-1 mt-2">
          <button
            className="btn-ghost flex-1 flex items-center justify-center gap-1 text-xs py-1"
            onClick={handleRefresh}
            disabled={scanning}
          >
            <RefreshCw className={`w-3 h-3 ${scanning ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            className="btn-ghost flex-1 flex items-center justify-center gap-1 text-xs py-1"
            onClick={handleEject}
            disabled={!hasDisc}
          >
            <ArrowUpFromLine className="w-3 h-3" />
            Eject
          </button>
        </div>
      </div>

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

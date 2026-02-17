import React from 'react'
import { useNavigate } from 'react-router-dom'
import { DriveStatusCard } from './DriveStatusCard'
import { ActiveJobsPanel } from './ActiveJobsPanel'
import { RecentRipsPanel } from './RecentRipsPanel'
import { SystemStatusBar } from './SystemStatusBar'
import { useDiscDetection } from '../../hooks/useDiscDetection'
import { useDiscStore } from '../../stores/disc-store'
import { TechLabel, Spinner } from '../ui'

export function DashboardPage() {
  const navigate = useNavigate()
  const { drives, scanning, selectedDrive, tmdbResult, discInfo } = useDiscStore()
  // No polling here — global disc detection in App.tsx handles polling + auto-load
  const { scan, loadDiscInfo } = useDiscDetection({ pollInterval: 0, autoLoadDiscInfo: false })

  const handleScan = (driveIndex: number) => {
    loadDiscInfo(driveIndex)
  }

  const handleRip = (driveIndex: number) => {
    loadDiscInfo(driveIndex).then(() => {
      navigate('/rip')
    })
  }

  const handleEject = async (driveIndex: number) => {
    await window.ztr.disc.eject(driveIndex)
    // Re-scan drives to update the UI (disc will be gone)
    scan()
  }

  // Build disc info summary for dashboard display
  const buildDiscInfoSummary = (driveIndex: number) => {
    if (driveIndex !== selectedDrive || !discInfo) return null
    const track = discInfo.tracks[0]
    if (!track) return null
    const h = Math.floor(track.durationSeconds / 3600)
    const m = Math.floor((track.durationSeconds % 3600) / 60)
    const duration = h > 0 ? `${h}h ${m}m` : `${m}m`
    const langs = [...new Set(track.audioTracks.map(a => a.language.slice(0, 3).toUpperCase()))]
    const audioSummary = `${track.audioTracks.length}ch ${track.audioTracks[0]?.codec || ''} (${langs.join(', ')})`
    return {
      trackCount: discInfo.trackCount,
      resolution: track.resolution,
      framerate: track.framerate,
      duration,
      audioSummary
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-purple-400 font-display">Dashboard</h1>
        {scanning && <Spinner size={16} />}
      </div>

      {/* Drives */}
      <div>
        <TechLabel className="mb-2 block">Optical Drives</TechLabel>
        <div className="space-y-2">
          {drives.length > 0 ? (
            drives.map((drive) => (
              <DriveStatusCard
                key={drive.index}
                drive={drive}
                onScan={handleScan}
                onRip={handleRip}
                onEject={handleEject}
                tmdbPosterPath={drive.index === selectedDrive ? tmdbResult?.poster_path : undefined}
                tmdbTitle={drive.index === selectedDrive ? tmdbResult?.title : undefined}
                tmdbYear={drive.index === selectedDrive ? tmdbResult?.year : undefined}
                scannedTitle={drive.index === selectedDrive ? discInfo?.title : undefined}
                discInfo={buildDiscInfoSummary(drive.index)}
              />
            ))
          ) : (
            <div className="text-sm text-zinc-600 p-4 text-center border border-zinc-800 rounded-lg">
              {scanning ? 'Scanning for drives...' : 'No optical drives detected'}
            </div>
          )}
        </div>
      </div>

      {/* Active Jobs */}
      <ActiveJobsPanel />

      {/* Recent Rips */}
      <RecentRipsPanel />

      {/* System Status */}
      <SystemStatusBar />
    </div>
  )
}

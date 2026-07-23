import React, { useEffect, useState } from 'react'
import { Routes, Route } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'
import { DashboardPage } from './components/dashboard/DashboardPage'
import { RipPage } from './components/rip/RipPage'
import { ProgressPage } from './components/progress/ProgressPage'
import { HistoryPage } from './components/history/HistoryPage'
import { SettingsPage } from './components/settings/SettingsPage'
import { PreviewPage } from './components/preview/PreviewPage'
import { MakeMKVSetupScreen } from './components/setup/MakeMKVSetupScreen'
import { useAppStore } from './stores/app-store'
import { useJobsStore } from './stores/jobs-store'
import { useJobProgress } from './hooks/useJobProgress'
import { useTerminalLogs } from './hooks/useTerminalLogs'
import { useDiscDetection } from './hooks/useDiscDetection'

function App() {
  const { setInitialized, setSettings, setToolStatuses } = useAppStore()
  const [showMakeMKVSetup, setShowMakeMKVSetup] = useState(false)

  // Register global job progress listeners
  useJobProgress()

  // Forward main process logs to terminal panel
  useTerminalLogs()

  // ── Global disc detection ────────────────────────────────────
  // Polls for drives every 5s, auto-loads disc info + TMDB when a disc is inserted.
  // Runs here (App never unmounts) so it works regardless of which page is active.
  useDiscDetection({ pollInterval: 5000, autoLoadDiscInfo: true })

  const initApp = async () => {
    try {
      // Load settings
      const settings = await window.ztr.settings.getAll()
      setSettings(settings)

      // Check tools
      const tools = await window.ztr.tools.check()
      setToolStatuses(tools)

      // Show MakeMKV setup if not found
      const makemkv = tools.find((t: { name: string }) => t.name === 'makemkvcon')
      if (makemkv && !makemkv.available) {
        setShowMakeMKVSetup(true)
      }

      // Rehydrate jobs still running in the main process — without this,
      // activeJobs only ever contained jobs the CURRENT renderer session
      // itself started via addJob(). Any reload (crash, dev refresh,
      // navigating away and the window recreating) permanently lost
      // visibility into a job that was still actively ripping/encoding:
      // its progress/complete/error events would arrive but find no
      // matching entry in the store and silently no-op.
      try {
        const queuedJobs = await window.ztr.jobs.list() as Array<{
          id: string; dbId: number; type: string
          status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
          progress?: number; message?: string
        }> | undefined

        const stillActive = (queuedJobs || []).filter(j => j.status === 'pending' || j.status === 'running')
        const known = new Set(useJobsStore.getState().activeJobs.map(j => j.jobId))
        for (const j of stillActive) {
          if (known.has(j.id)) continue
          useJobsStore.getState().addJob({
            jobId: j.id,
            dbId: j.dbId,
            type: j.type,
            status: j.status,
            percentage: j.progress ?? 0,
            message: j.message || 'Resumed after app restart'
          })
        }
      } catch (err) {
        console.error('Job rehydration failed (non-fatal):', err)
      }

      setInitialized(true)
    } catch (err) {
      console.error('App init failed:', err)
      setInitialized(true) // Still render even on error
    }
  }

  // Initialize app on mount
  useEffect(() => {
    initApp()
  }, [])

  const handleMakeMKVSetupComplete = async () => {
    setShowMakeMKVSetup(false)
    // Refresh tool statuses
    const tools = await window.ztr.tools.check()
    setToolStatuses(tools)
  }

  return (
    <>
      {showMakeMKVSetup && (
        <MakeMKVSetupScreen
          onComplete={handleMakeMKVSetupComplete}
          onSkip={() => setShowMakeMKVSetup(false)}
        />
      )}
      <AppShell>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/preview" element={<PreviewPage />} />
          <Route path="/rip" element={<RipPage />} />
          <Route path="/progress" element={<ProgressPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </AppShell>
    </>
  )
}

export default App

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
import { useJobProgress } from './hooks/useJobProgress'
import { useTerminalLogs } from './hooks/useTerminalLogs'
import { useDiscDetection } from './hooks/useDiscDetection'

function App() {
  const { setInitialized, setSettings, setToolStatuses, toolStatuses } = useAppStore()
  const [showMakeMKVSetup, setShowMakeMKVSetup] = useState(false)

  // Register global job progress listeners
  useJobProgress()

  // Forward main process logs to terminal panel
  useTerminalLogs()

  // ── Global disc detection ────────────────────────────────────
  // Polls for drives every 5s, auto-loads disc info + TMDB when a disc is inserted.
  // Runs here (App never unmounts) so it works regardless of which page is active.
  useDiscDetection({ pollInterval: 5000, autoLoadDiscInfo: true })

  // Initialize app on mount
  useEffect(() => {
    initApp()
  }, [])

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

      setInitialized(true)
    } catch (err) {
      console.error('App init failed:', err)
      setInitialized(true) // Still render even on error
    }
  }

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

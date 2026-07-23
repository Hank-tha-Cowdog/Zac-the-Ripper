import { useEffect, useCallback, useRef } from 'react'
import { useAppStore } from '../stores/app-store'

const SAVE_DEBOUNCE_MS = 400

export function useSettings() {
  const { settings, setSettings, updateSetting } = useAppStore()
  // Per-key timers — every settings page wires its text inputs' onChange
  // straight to this function, so without debouncing, each keystroke was
  // an immediate IPC round-trip + DB write. Keyed by setting key (not one
  // shared timer) so typing in field A doesn't reset/delay a pending save
  // for unrelated field B.
  const saveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const loadSettings = useCallback(async () => {
    try {
      const all = await window.ztr.settings.getAll()
      setSettings(all)
    } catch (err) {
      console.error('Failed to load settings:', err)
    }
  }, [setSettings])

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  // Cancel any pending debounced saves on unmount — an in-flight timer
  // firing after the settings page is gone would still be harmless (it
  // targets the global store/IPC, not local state), but there is nothing
  // left it needs to accomplish once the page navigates away.
  useEffect(() => {
    const timers = saveTimers.current
    return () => {
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
    }
  }, [])

  const saveSetting = useCallback((key: string, value: string) => {
    // Optimistic local update happens immediately, every keystroke — only
    // the IPC call + DB write is debounced, so inputs stay responsive.
    updateSetting(key, value)

    const existing = saveTimers.current.get(key)
    if (existing) clearTimeout(existing)

    const timer = setTimeout(async () => {
      saveTimers.current.delete(key)
      try {
        await window.ztr.settings.set(key, value)
      } catch (err) {
        console.error('Failed to save setting:', err)
      }
    }, SAVE_DEBOUNCE_MS)
    saveTimers.current.set(key, timer)
  }, [updateSetting])

  return { settings, saveSetting, loadSettings }
}

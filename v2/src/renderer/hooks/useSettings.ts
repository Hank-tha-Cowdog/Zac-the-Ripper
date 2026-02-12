import { useEffect, useCallback } from 'react'
import { useAppStore } from '../stores/app-store'

export function useSettings() {
  const { settings, setSettings, updateSetting } = useAppStore()

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    try {
      const all = await window.ztr.settings.getAll()
      setSettings(all)
    } catch (err) {
      console.error('Failed to load settings:', err)
    }
  }

  const saveSetting = useCallback(async (key: string, value: string) => {
    try {
      await window.ztr.settings.set(key, value)
      updateSetting(key, value)
    } catch (err) {
      console.error('Failed to save setting:', err)
    }
  }, [updateSetting])

  return { settings, saveSetting, loadSettings }
}

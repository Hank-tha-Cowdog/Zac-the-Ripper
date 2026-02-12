import { create } from 'zustand'

interface ToolStatus {
  name: string
  path: string | null
  available: boolean
  version: string | null
}

interface DiskSpace {
  free: number
  total: number
  available: number
}

interface AppState {
  initialized: boolean
  settings: Record<string, string>
  toolStatuses: ToolStatus[]
  diskSpace: DiskSpace | null

  setInitialized: (v: boolean) => void
  setSettings: (settings: Record<string, string>) => void
  updateSetting: (key: string, value: string) => void
  setToolStatuses: (statuses: ToolStatus[]) => void
  setDiskSpace: (space: DiskSpace | null) => void
}

export const useAppStore = create<AppState>((set) => ({
  initialized: false,
  settings: {},
  toolStatuses: [],
  diskSpace: null,

  setInitialized: (v) => set({ initialized: v }),
  setSettings: (settings) => set({ settings }),
  updateSetting: (key, value) => set((state) => ({
    settings: { ...state.settings, [key]: value }
  })),
  setToolStatuses: (toolStatuses) => set({ toolStatuses }),
  setDiskSpace: (diskSpace) => set({ diskSpace })
}))

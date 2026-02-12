import { create } from 'zustand'

export interface TerminalEntry {
  timestamp: string
  level: 'debug' | 'info' | 'warn' | 'error'
  module: string
  message: string
}

interface TerminalState {
  entries: TerminalEntry[]
  isOpen: boolean
  panelHeight: number

  addEntry: (entry: TerminalEntry) => void
  clearEntries: () => void
  toggleOpen: () => void
  setOpen: (open: boolean) => void
  setPanelHeight: (height: number) => void
}

export const useTerminalStore = create<TerminalState>((set) => ({
  entries: [],
  isOpen: false,
  panelHeight: 240,

  addEntry: (entry) => set((state) => ({
    entries: [...state.entries, entry].slice(-2000)
  })),

  clearEntries: () => set({ entries: [] }),

  toggleOpen: () => set((state) => ({ isOpen: !state.isOpen })),

  setOpen: (isOpen) => set({ isOpen }),

  setPanelHeight: (panelHeight) => set({ panelHeight: Math.max(120, Math.min(600, panelHeight)) })
}))

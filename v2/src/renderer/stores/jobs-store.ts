import { create } from 'zustand'

export interface JobProgress {
  jobId: string
  dbId: number
  type: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  percentage: number
  message: string
  speed?: number
  eta?: string
  outputFiles?: string[]
  error?: string
  movieTitle?: string
  movieYear?: string
  collectionName?: string
  edition?: string
  soundVersion?: string
  discNumber?: number
  totalDiscs?: number
  posterUrl?: string
}

interface LogEntry {
  timestamp: string
  level: 'info' | 'warn' | 'error'
  message: string
  jobId?: string
}

interface JobsState {
  activeJobs: JobProgress[]
  recentJobs: JobProgress[]
  logs: LogEntry[]

  addJob: (job: JobProgress) => void
  updateJobProgress: (jobId: string, updates: Partial<JobProgress>) => void
  completeJob: (jobId: string, outputFiles?: string[]) => void
  failJob: (jobId: string, error: string) => void
  cancelJob: (jobId: string) => void
  loadRecentJobs: (jobs: JobProgress[]) => void
  addLog: (entry: LogEntry) => void
  clearLogs: () => void
}

export const useJobsStore = create<JobsState>((set, get) => ({
  activeJobs: [],
  recentJobs: [],
  logs: [],

  addJob: (job) => set((state) => ({
    activeJobs: [...state.activeJobs, job]
  })),

  updateJobProgress: (jobId, updates) => set((state) => ({
    activeJobs: state.activeJobs.map((j) =>
      j.jobId === jobId ? { ...j, ...updates } : j
    )
  })),

  completeJob: (jobId, outputFiles) => set((state) => {
    const job = state.activeJobs.find((j) => j.jobId === jobId)
    if (!job) return state

    return {
      activeJobs: state.activeJobs.filter((j) => j.jobId !== jobId),
      recentJobs: [
        { ...job, status: 'completed', percentage: 100, outputFiles },
        ...state.recentJobs
      ].slice(0, 50)
    }
  }),

  failJob: (jobId, error) => set((state) => {
    const job = state.activeJobs.find((j) => j.jobId === jobId)
    if (!job) return state

    return {
      activeJobs: state.activeJobs.filter((j) => j.jobId !== jobId),
      recentJobs: [
        { ...job, status: 'failed', error },
        ...state.recentJobs
      ].slice(0, 50)
    }
  }),

  cancelJob: (jobId) => set((state) => ({
    activeJobs: state.activeJobs.filter((j) => j.jobId !== jobId)
  })),

  loadRecentJobs: (jobs) => set((state) => {
    // Merge DB history with in-memory recent jobs (in-memory takes precedence)
    const inMemoryIds = new Set(state.recentJobs.map(j => j.dbId))
    const dbOnly = jobs.filter(j => !inMemoryIds.has(j.dbId))
    return { recentJobs: [...state.recentJobs, ...dbOnly].slice(0, 50) }
  }),

  addLog: (entry) => set((state) => ({
    logs: [...state.logs, entry].slice(-1000)
  })),

  clearLogs: () => set({ logs: [] })
}))

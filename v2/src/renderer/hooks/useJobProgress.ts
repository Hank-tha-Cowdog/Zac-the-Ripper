import { useEffect } from 'react'
import { useJobsStore } from '../stores/jobs-store'

export function useJobProgress() {
  const { updateJobProgress, completeJob, failJob, addLog } = useJobsStore()

  useEffect(() => {
    // ── RIP events ──────────────────────────────────────────────
    const cleanupProgress = window.ztr.rip.onProgress((data: unknown) => {
      const d = data as { jobId: string; percentage: number; message: string; speed?: number }
      const job = useJobsStore.getState().activeJobs.find(j => j.jobId === d.jobId)

      // kodi_export pipeline manages its own progress (already scaled 0-100)
      // Non-kodi jobs: pass through directly
      const isKodiPipeline = job?.type === 'kodi_export'

      updateJobProgress(d.jobId, {
        percentage: d.percentage,
        message: d.message,
        speed: d.speed,
        status: 'running'
      })

      addLog({
        timestamp: new Date().toISOString(),
        level: 'info',
        message: d.message,
        jobId: d.jobId
      })
    })

    const cleanupComplete = window.ztr.rip.onComplete((data: unknown) => {
      const d = data as { jobId: string; outputFiles?: string[] }
      completeJob(d.jobId, d.outputFiles)
      addLog({
        timestamp: new Date().toISOString(),
        level: 'info',
        message: 'Job completed successfully',
        jobId: d.jobId
      })
    })

    const cleanupError = window.ztr.rip.onError((data: unknown) => {
      const d = data as { jobId: string; error: string }
      failJob(d.jobId, d.error)
      addLog({
        timestamp: new Date().toISOString(),
        level: 'error',
        message: d.error,
        jobId: d.jobId
      })
    })

    // ── Encode events (for standalone encode jobs, NOT kodi pipeline) ──
    const cleanupEncProgress = window.ztr.encode.onProgress((data: unknown) => {
      const d = data as { jobId: string; percentage: number; message: string; speed?: number }
      const job = useJobsStore.getState().activeJobs.find(j => j.jobId === d.jobId)

      // kodi_export uses pipe encoding with callback-based progress,
      // not IPC encode events — ignore encode events for kodi jobs
      if (job?.type === 'kodi_export') return

      updateJobProgress(d.jobId, {
        percentage: d.percentage,
        message: d.message,
        speed: d.speed,
        status: 'running'
      })
    })

    const cleanupEncComplete = window.ztr.encode.onComplete((data: unknown) => {
      const d = data as { jobId: string; outputPath?: string }
      const job = useJobsStore.getState().activeJobs.find(j => j.jobId === d.jobId)

      // kodi_export pipeline handles its own completion — ignore
      if (job?.type === 'kodi_export') return

      completeJob(d.jobId, d.outputPath ? [d.outputPath] : undefined)
    })

    const cleanupEncError = window.ztr.encode.onError((data: unknown) => {
      const d = data as { jobId: string; error: string }
      const job = useJobsStore.getState().activeJobs.find(j => j.jobId === d.jobId)

      // kodi_export pipeline handles its own errors — ignore
      if (job?.type === 'kodi_export') return

      failJob(d.jobId, d.error)
    })

    return () => {
      cleanupProgress()
      cleanupComplete()
      cleanupError()
      cleanupEncProgress()
      cleanupEncComplete()
      cleanupEncError()
    }
  }, [updateJobProgress, completeJob, failJob, addLog])
}

import { useEffect } from 'react'
import { useJobsStore, type JobProgress } from '../stores/jobs-store'

/**
 * Some progress events (notably ffmpeg's separate "speed=" line, sent on
 * its own without out_time_us) carry a message/speed update with no
 * percentage field at all. updateJobProgress does a plain {...job, ...updates}
 * merge, so including `percentage: undefined` in the update object
 * overwrites the job's last known-good percentage with undefined — which
 * ProgressBar then renders as the literal string "NaN%". Omitting the key
 * entirely (not just passing undefined) keeps the merge a no-op for it.
 */
export function withDefinedPercentage(updates: { percentage?: number; message: string; speed?: number; status: 'running' }): Partial<JobProgress> {
  if (typeof updates.percentage === 'number' && !Number.isNaN(updates.percentage)) {
    return updates
  }
  const { percentage: _drop, ...rest } = updates
  return rest
}

export function useJobProgress() {
  const { addJob, updateJobProgress, completeJob, failJob } = useJobsStore()

  useEffect(() => {
    // ── Follow-up jobs (ffv1_archival/streaming_encode queued after a
    // primary rip) mint their own jobId in the main process with no
    // renderer-initiated addJob() call — without this listener, their
    // progress/complete/error events arrive for a jobId the store has
    // never seen and silently no-op.
    const cleanupCreated = window.ztr.jobs.onCreated((data: unknown) => {
      const d = data as { jobId: string; dbId: number; type: string }
      const known = useJobsStore.getState().activeJobs.some(j => j.jobId === d.jobId)
      if (known) return
      addJob({
        jobId: d.jobId,
        dbId: d.dbId,
        type: d.type,
        status: 'pending',
        percentage: 0,
        message: 'Queued...'
      })
    })

    // ── RIP events ──────────────────────────────────────────────
    const cleanupProgress = window.ztr.rip.onProgress((data: unknown) => {
      const d = data as { jobId: string; percentage: number; message: string; speed?: number }

      updateJobProgress(d.jobId, withDefinedPercentage({
        percentage: d.percentage,
        message: d.message,
        speed: d.speed,
        status: 'running'
      }))
    })

    const cleanupComplete = window.ztr.rip.onComplete((data: unknown) => {
      const d = data as { jobId: string; outputFiles?: string[]; readErrorSummary?: string }
      completeJob(d.jobId, d.outputFiles)
    })

    const cleanupError = window.ztr.rip.onError((data: unknown) => {
      const d = data as { jobId: string; error: string }
      failJob(d.jobId, d.error)
    })

    // ── Encode events (for standalone encode jobs, NOT kodi pipeline) ──
    const cleanupEncProgress = window.ztr.encode.onProgress((data: unknown) => {
      const d = data as { jobId: string; percentage: number; message: string; speed?: number }
      const job = useJobsStore.getState().activeJobs.find(j => j.jobId === d.jobId)

      // kodi_export uses pipe encoding with callback-based progress,
      // not IPC encode events — ignore encode events for kodi jobs
      if (job?.type === 'kodi_export') return

      updateJobProgress(d.jobId, withDefinedPercentage({
        percentage: d.percentage,
        message: d.message,
        speed: d.speed,
        status: 'running'
      }))
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
      cleanupCreated()
      cleanupProgress()
      cleanupComplete()
      cleanupError()
      cleanupEncProgress()
      cleanupEncComplete()
      cleanupEncError()
    }
  }, [addJob, updateJobProgress, completeJob, failJob])
}

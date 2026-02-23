import React, { useEffect } from 'react'
import { PipelineView } from './PipelineView'
import { JobCard } from './JobCard'
import { useJobsStore, type JobProgress } from '../../stores/jobs-store'
import { TechLabel } from '../ui'

export function ProgressPage() {
  const activeJobs = useJobsStore((s) => s.activeJobs)
  const recentJobs = useJobsStore((s) => s.recentJobs)
  const loadRecentJobs = useJobsStore((s) => s.loadRecentJobs)

  // Load persistent rip history from DB on mount
  useEffect(() => {
    window.ztr.db.jobs.recent(20).then((rows: Array<{
      id: number; job_type: string; status: string; progress: number;
      movie_title: string | null; poster_url: string | null;
      error_message: string | null; completed_at: string | null
    }>) => {
      const jobs: JobProgress[] = rows.map((row) => ({
        jobId: `db-${row.id}`,
        dbId: row.id,
        type: row.job_type,
        status: (row.status as JobProgress['status']),
        percentage: row.status === 'completed' ? 100 : row.progress || 0,
        message: row.status === 'completed'
          ? `Completed${row.completed_at ? ` at ${new Date(row.completed_at + 'Z').toLocaleString()}` : ''}`
          : row.error_message || '',
        movieTitle: row.movie_title || undefined,
        posterUrl: row.poster_url || undefined,
        error: row.error_message || undefined
      }))
      loadRecentJobs(jobs)
    }).catch(() => {})
  }, [])

  const handleCancel = async (jobId: string) => {
    await window.ztr.jobs.cancel(jobId)
    useJobsStore.getState().cancelJob(jobId)
  }

  // Determine active pipeline stage
  const activeStage = activeJobs.length > 0
    ? (activeJobs.some(j => j.type.includes('rip') || j.type.includes('capture'))
      ? 'ripping' as const
      : activeJobs.some(j => j.type.includes('encode'))
      ? 'encoding' as const
      : activeJobs.some(j => j.type.includes('kodi'))
      ? 'export' as const
      : null)
    : null

  return (
    <div className="space-y-6 animate-fade-in">
      <h1 className="text-2xl font-bold text-purple-400 font-display animate-header-glow">Progress</h1>

      <PipelineView activeStage={activeStage} />

      {/* Active Jobs */}
      <div>
        <TechLabel className="mb-2 block">Active Jobs</TechLabel>
        {activeJobs.length > 0 ? (
          <div className="space-y-3">
            {activeJobs.map((job) => (
              <JobCard key={job.jobId} job={job} onCancel={handleCancel} />
            ))}
          </div>
        ) : (
          <div className="text-sm text-zinc-600 p-6 text-center border border-zinc-800 rounded-lg">
            No active jobs. Start a rip from the Rip Disc page.
          </div>
        )}
      </div>

      {/* Recent completed */}
      <div>
        <TechLabel className="mb-2 block">Recently Completed</TechLabel>
        {recentJobs.length > 0 ? (
          <div className="space-y-2">
            {recentJobs.slice(0, 10).map((job) => (
              <JobCard key={job.jobId} job={job} onCancel={handleCancel} />
            ))}
          </div>
        ) : (
          <div className="text-sm text-zinc-600 p-6 text-center border border-zinc-800 rounded-lg">
            No recent rips
          </div>
        )}
      </div>

    </div>
  )
}

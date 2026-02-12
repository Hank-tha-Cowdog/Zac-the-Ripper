import React from 'react'
import { PipelineView } from './PipelineView'
import { JobCard } from './JobCard'
import { useJobsStore } from '../../stores/jobs-store'
import { TechLabel } from '../ui'

export function ProgressPage() {
  const activeJobs = useJobsStore((s) => s.activeJobs)
  const recentJobs = useJobsStore((s) => s.recentJobs)

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
      <h1 className="text-2xl font-bold text-purple-400">Progress</h1>

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
      {recentJobs.length > 0 && (
        <div>
          <TechLabel className="mb-2 block">Recently Completed</TechLabel>
          <div className="space-y-2">
            {recentJobs.slice(0, 5).map((job) => (
              <JobCard key={job.jobId} job={job} onCancel={handleCancel} />
            ))}
          </div>
        </div>
      )}

    </div>
  )
}

import React from 'react'
import { X } from 'lucide-react'
import { Card, Badge, ProgressBar, Button, TechLabel } from '../ui'
import { useJobsStore } from '../../stores/jobs-store'

export function ActiveJobsPanel() {
  const activeJobs = useJobsStore((s) => s.activeJobs)

  if (activeJobs.length === 0) {
    return (
      <div>
        <TechLabel>Active Jobs</TechLabel>
        <div className="mt-2 text-sm text-zinc-600">No active jobs</div>
      </div>
    )
  }

  const handleCancel = async (jobId: string) => {
    await window.ztr.jobs.cancel(jobId)
  }

  return (
    <div>
      <TechLabel>Active Jobs</TechLabel>
      <div className="mt-2 space-y-2">
        {activeJobs.map((job) => (
          <Card key={job.jobId} variant="solid" className="p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Badge variant={job.status === 'running' ? 'warning' : 'default'}>
                  {job.type.replace('_', ' ')}
                </Badge>
                <span className="text-xs text-zinc-400">{job.message}</span>
              </div>
              <Button variant="ghost" size="sm" onClick={() => handleCancel(job.jobId)}>
                <X className="w-3 h-3" />
              </Button>
            </div>
            <ProgressBar
              value={job.percentage}
              color={job.status === 'running' ? 'purple' : 'amber'}
              striped={job.status === 'running'}
              showLabel
            />
            {job.speed && (
              <div className="mt-1 text-[10px] text-zinc-500 font-mono">
                Speed: {job.speed.toFixed(1)}x
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  )
}

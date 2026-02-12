import React from 'react'
import { X, Clock } from 'lucide-react'
import { Card, Badge, ProgressBar, Button } from '../ui'

interface JobCardProps {
  job: {
    jobId: string
    type: string
    status: string
    percentage: number
    message: string
    speed?: number
    eta?: string
    error?: string
  }
  onCancel: (jobId: string) => void
}

export function JobCard({ job, onCancel }: JobCardProps) {
  const statusVariant = job.status === 'running' ? 'warning' :
    job.status === 'completed' ? 'success' :
    job.status === 'failed' ? 'error' : 'default'

  return (
    <Card variant="solid" className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Badge variant={statusVariant}>
            {job.type.replace(/_/g, ' ')}
          </Badge>
          <Badge variant={statusVariant}>
            {job.status}
          </Badge>
        </div>

        <div className="flex items-center gap-3">
          {job.speed && (
            <span className="text-xs font-mono text-zinc-400">
              {job.speed.toFixed(1)}x
            </span>
          )}
          {job.eta && (
            <div className="flex items-center gap-1 text-xs text-zinc-500">
              <Clock className="w-3 h-3" />
              ETA {job.eta}
            </div>
          )}
          {(job.status === 'running' || job.status === 'pending') && (
            <Button variant="ghost" size="sm" onClick={() => onCancel(job.jobId)}>
              <X className="w-4 h-4 text-zinc-500 hover:text-red-400" />
            </Button>
          )}
        </div>
      </div>

      <ProgressBar
        value={job.percentage}
        color={job.status === 'failed' ? 'amber' : 'purple'}
        striped={job.status === 'running'}
        showLabel
      />

      <div className="mt-2 text-xs text-zinc-500">{job.message}</div>

      {job.error && (
        <div className="mt-2 text-xs text-red-400 bg-red-500/10 p-2 rounded">
          {job.error}
        </div>
      )}
    </Card>
  )
}

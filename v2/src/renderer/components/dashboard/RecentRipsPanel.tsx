import React, { useEffect, useState } from 'react'
import { CheckCircle, XCircle, Clock } from 'lucide-react'
import { Badge, TechLabel } from '../ui'

interface RecentJob {
  id: number
  job_type: string
  status: string
  output_path: string | null
  completed_at: string | null
  duration_seconds: number | null
}

export function RecentRipsPanel() {
  const [recentJobs, setRecentJobs] = useState<RecentJob[]>([])

  const loadRecent = async () => {
    try {
      // db.jobs.list() has no LIMIT — it fetches every job ever recorded
      // across IPC just to keep 10, getting linearly slower as history
      // accumulates. db.jobs.recent() is the same query bounded in SQL
      // (LIMIT), and also includes 'failed' jobs — this panel already had
      // an XCircle icon branch for non-completed jobs (below) that could
      // never fire against the old completed-only filter.
      const jobs = await window.ztr.db.jobs.recent(10)
      setRecentJobs(jobs || [])
    } catch {
      // DB might not have data yet
    }
  }

  useEffect(() => {
    loadRecent()
  }, [])

  const formatDuration = (seconds: number | null): string => {
    if (!seconds) return '--'
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m}m ${s}s`
  }

  const formatDate = (date: string | null): string => {
    if (!date) return '--'
    return new Date(date).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  return (
    <div>
      <TechLabel>Recent Rips</TechLabel>
      {recentJobs.length === 0 ? (
        <div className="mt-2 text-sm text-zinc-600">No finished rips yet</div>
      ) : (
        <div className="mt-2 space-y-1">
          {recentJobs.map((job) => (
            <div
              key={job.id}
              className="flex items-center gap-3 p-2 rounded hover:bg-zinc-800/50 transition-colors"
            >
              {job.status === 'completed' ? (
                <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" />
              ) : (
                <XCircle className="w-4 h-4 text-red-500 shrink-0" />
              )}
              <Badge>{job.job_type.replace('_', ' ')}</Badge>
              <span className="text-xs text-zinc-400 truncate flex-1">
                {job.output_path?.split('/').pop() || 'Unknown'}
              </span>
              <div className="flex items-center gap-1 text-[10px] text-zinc-600 font-mono shrink-0">
                <Clock className="w-3 h-3" />
                {formatDuration(job.duration_seconds)}
              </div>
              <span className="text-[10px] text-zinc-600 shrink-0">
                {formatDate(job.completed_at)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

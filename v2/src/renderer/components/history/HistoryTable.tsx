import React, { useEffect, useState } from 'react'
import { Eye, CheckCircle, XCircle, Clock } from 'lucide-react'
import { Badge, Button, TechLabel } from '../ui'

interface HistoryJob {
  id: number
  disc_id: number | null
  disc_title: string | null
  movie_title: string | null
  job_type: string
  status: string
  output_path: string | null
  completed_at: string | null
  duration_seconds: number | null
  created_at: string
}

const TYPE_LABELS: Record<string, string> = {
  mkv_rip: 'MKV Rip',
  raw_capture: 'Raw',
  ffv1_encode: 'FFV1',
  h264_encode: 'H.264',
  hevc_encode: 'HEVC',
  kodi_export: 'Kodi',
  jellyfin_export: 'Jellyfin',
  plex_export: 'Plex'
}

interface HistoryTableProps {
  onViewDetails: (jobId: number) => void
}

export function HistoryTable({ onViewDetails }: HistoryTableProps) {
  const [jobs, setJobs] = useState<HistoryJob[]>([])
  const [filter, setFilter] = useState<string>('all')

  useEffect(() => {
    loadJobs()
  }, [filter])

  const loadJobs = async () => {
    try {
      const filters = filter !== 'all' ? { status: filter } : undefined
      const result = await window.ztr.db.jobs.list(filters)
      setJobs(result || [])
    } catch {
      setJobs([])
    }
  }

  const formatDuration = (seconds: number | null): string => {
    if (!seconds) return '--'
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = Math.floor(seconds % 60)
    if (h > 0) return `${h}h ${m}m ${s}s`
    return `${m}m ${s}s`
  }

  const formatDate = (date: string): string => {
    return new Date(date).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const statusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle className="w-4 h-4 text-emerald-500" />
      case 'failed': return <XCircle className="w-4 h-4 text-red-500" />
      case 'cancelled': return <XCircle className="w-4 h-4 text-zinc-500" />
      default: return <Clock className="w-4 h-4 text-amber-500" />
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <TechLabel>Job History</TechLabel>
        <div className="flex gap-1">
          {['all', 'completed', 'failed', 'cancelled'].map((f) => (
            <Button
              key={f}
              variant={filter === f ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => setFilter(f)}
            >
              {f}
            </Button>
          ))}
        </div>
      </div>

      <div className="border border-zinc-800 rounded-lg overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-900/50">
              <th className="label-tech text-left p-3">Status</th>
              <th className="label-tech text-left p-3">Date</th>
              <th className="label-tech text-left p-3">Disc</th>
              <th className="label-tech text-left p-3">Title</th>
              <th className="label-tech text-left p-3">Type</th>
              <th className="label-tech text-left p-3">Output</th>
              <th className="label-tech text-left p-3">Duration</th>
              <th className="label-tech text-right p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr
                key={job.id}
                className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors"
              >
                <td className="p-3">{statusIcon(job.status)}</td>
                <td className="p-3 text-xs text-zinc-400">{formatDate(job.created_at)}</td>
                <td className="p-3 text-xs text-zinc-300 font-mono truncate max-w-40">
                  {job.disc_title || '--'}
                </td>
                <td className="p-3 text-xs text-zinc-300 truncate max-w-48">
                  {job.movie_title || job.disc_title || '--'}
                </td>
                <td className="p-3">
                  <Badge>{TYPE_LABELS[job.job_type] || job.job_type}</Badge>
                </td>
                <td className="p-3 text-xs text-zinc-400 font-mono truncate max-w-48">
                  {job.output_path?.split('/').pop() || '--'}
                </td>
                <td className="p-3 text-xs text-zinc-500 font-mono">
                  {formatDuration(job.duration_seconds)}
                </td>
                <td className="p-3 text-right">
                  <Button variant="ghost" size="sm" onClick={() => onViewDetails(job.id)}>
                    <Eye className="w-3 h-3" />
                  </Button>
                </td>
              </tr>
            ))}

            {jobs.length === 0 && (
              <tr>
                <td colSpan={8} className="p-8 text-center text-sm text-zinc-600">
                  No jobs found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

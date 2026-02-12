import React, { useEffect, useState } from 'react'
import { FolderOpen } from 'lucide-react'
import { Modal, Badge, DataGrid, Button, TechLabel } from '../ui'

interface JobDetail {
  id: number
  disc_id: number | null
  job_type: string
  status: string
  progress: number
  input_path: string | null
  output_path: string | null
  encoding_preset: string | null
  error_message: string | null
  started_at: string | null
  completed_at: string | null
  duration_seconds: number | null
  created_at: string
}

interface OutputFile {
  id: number
  file_path: string
  format: string | null
  video_codec: string | null
  audio_codec: string | null
  resolution: string | null
  file_size: number | null
}

interface HistoryDetailModalProps {
  jobId: number | null
  isOpen: boolean
  onClose: () => void
}

export function HistoryDetailModal({ jobId, isOpen, onClose }: HistoryDetailModalProps) {
  const [job, setJob] = useState<JobDetail | null>(null)
  const [files, setFiles] = useState<OutputFile[]>([])

  useEffect(() => {
    if (jobId && isOpen) {
      loadDetails(jobId)
    }
  }, [jobId, isOpen])

  const loadDetails = async (id: number) => {
    try {
      const [jobData, filesData] = await Promise.all([
        window.ztr.db.jobs.get(id),
        window.ztr.db.outputFiles.list(id)
      ])
      setJob(jobData)
      setFiles(filesData || [])
    } catch {}
  }

  const formatDuration = (seconds: number | null): string => {
    if (!seconds) return '--'
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = Math.floor(seconds % 60)
    if (h > 0) return `${h}h ${m}m ${s}s`
    return `${m}m ${s}s`
  }

  const formatBytes = (bytes: number | null): string => {
    if (!bytes) return '--'
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(1024))
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Job Details" maxWidth="max-w-2xl">
      {job && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Badge>{job.job_type.replace(/_/g, ' ')}</Badge>
            <Badge variant={
              job.status === 'completed' ? 'success' :
              job.status === 'failed' ? 'error' : 'warning'
            }>
              {job.status}
            </Badge>
          </div>

          <DataGrid
            items={[
              { label: 'Created', value: new Date(job.created_at).toLocaleString() },
              { label: 'Duration', value: formatDuration(job.duration_seconds) },
              { label: 'Preset', value: job.encoding_preset || '--' },
              { label: 'Output', value: job.output_path?.split('/').pop() || '--' }
            ]}
          />

          {job.error_message && (
            <div className="bg-red-500/10 border border-red-500/30 rounded p-3 text-xs text-red-400">
              {job.error_message}
            </div>
          )}

          {files.length > 0 && (
            <div>
              <TechLabel className="mb-2 block">Output Files</TechLabel>
              <div className="space-y-2">
                {files.map((file) => (
                  <div
                    key={file.id}
                    className="flex items-center gap-3 p-2 bg-zinc-900 border border-zinc-800 rounded"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-mono text-zinc-300 truncate">
                        {file.file_path.split('/').pop()}
                      </div>
                      <div className="flex gap-2 mt-1">
                        {file.format && <Badge>{file.format}</Badge>}
                        {file.video_codec && <Badge variant="info">{file.video_codec}</Badge>}
                        {file.resolution && <Badge variant="info">{file.resolution}</Badge>}
                        <span className="text-[10px] text-zinc-600 font-mono">
                          {formatBytes(file.file_size)}
                        </span>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => window.ztr.fs.openPath(file.file_path)}
                    >
                      <FolderOpen className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

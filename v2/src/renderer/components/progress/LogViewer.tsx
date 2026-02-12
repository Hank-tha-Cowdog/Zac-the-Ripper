import React, { useRef, useEffect, useState } from 'react'
import { ChevronDown, Trash2 } from 'lucide-react'
import { Button, TechLabel } from '../ui'
import { useJobsStore } from '../../stores/jobs-store'

export function LogViewer() {
  const logs = useJobsStore((s) => s.logs)
  const clearLogs = useJobsStore((s) => s.clearLogs)
  const [autoScroll, setAutoScroll] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs, autoScroll])

  const levelColor = (level: string): string => {
    switch (level) {
      case 'error': return 'text-red-400'
      case 'warn': return 'text-amber-400'
      default: return 'text-zinc-500'
    }
  }

  return (
    <div className="flex flex-col h-64">
      <div className="flex items-center justify-between mb-2">
        <TechLabel>Log Output</TechLabel>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setAutoScroll(!autoScroll)}
            className={autoScroll ? 'text-purple-400' : ''}
          >
            <ChevronDown className="w-3 h-3" />
            Auto-scroll
          </Button>
          <Button variant="ghost" size="sm" onClick={clearLogs}>
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 bg-zinc-950 border border-zinc-800 rounded p-2 overflow-y-auto scrollbar-thin font-mono text-[11px]"
      >
        {logs.length === 0 ? (
          <div className="text-zinc-700 text-center mt-8">No log entries</div>
        ) : (
          logs.map((entry, i) => (
            <div key={i} className="flex gap-2 leading-5">
              <span className="text-zinc-700 shrink-0">
                {new Date(entry.timestamp).toLocaleTimeString()}
              </span>
              <span className={`shrink-0 uppercase w-10 ${levelColor(entry.level)}`}>
                {entry.level}
              </span>
              <span className="text-zinc-300">{entry.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

import React, { useRef, useEffect, useCallback, useState } from 'react'
import { Terminal, ChevronDown, ChevronUp, Trash2 } from 'lucide-react'
import { useTerminalStore } from '../../stores/terminal-store'

const LEVEL_COLORS: Record<string, string> = {
  error: 'text-red-400',
  warn: 'text-amber-400',
  info: 'text-zinc-400',
  debug: 'text-zinc-600'
}

const LEVEL_BG: Record<string, string> = {
  error: 'bg-red-500/5',
  warn: 'bg-amber-500/5',
  info: '',
  debug: ''
}

const MODULE_COLORS: Record<string, string> = {
  'job-queue': 'text-purple-400',
  'ffmpeg': 'text-cyan-400',
  'makemkv': 'text-orange-400',
  'disc-detection': 'text-blue-400',
  'kodi-output': 'text-emerald-400',
  'ffprobe': 'text-teal-400',
  'tmdb': 'text-pink-400'
}

function getModuleColor(module: string): string {
  return MODULE_COLORS[module] || 'text-zinc-500'
}

export function TerminalPanel() {
  const { entries, isOpen, panelHeight, toggleOpen, clearEntries, setPanelHeight } = useTerminalStore()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const [isDragging, setIsDragging] = useState(false)
  const dragStartY = useRef(0)
  const dragStartHeight = useRef(0)

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    if (autoScroll && scrollRef.current && isOpen) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [entries, autoScroll, isOpen])

  // Detect manual scroll (user scrolled up)
  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current
    const atBottom = scrollHeight - scrollTop - clientHeight < 30
    if (autoScroll !== atBottom) setAutoScroll(atBottom)
  }, [autoScroll])

  // Resizable divider drag handlers
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
    dragStartY.current = e.clientY
    dragStartHeight.current = panelHeight
  }, [panelHeight])

  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      const delta = dragStartY.current - e.clientY
      setPanelHeight(dragStartHeight.current + delta)
    }

    const handleMouseUp = () => {
      setIsDragging(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, setPanelHeight])

  const errorCount = entries.filter(e => e.level === 'error').length
  const warnCount = entries.filter(e => e.level === 'warn').length

  return (
    <div className="flex-shrink-0 border-t border-zinc-800 bg-zinc-950">
      {/* Tab bar / toggle */}
      <div
        className="flex items-center justify-between px-3 py-1.5 cursor-pointer select-none hover:bg-zinc-900/50 transition-colors no-drag"
        onClick={toggleOpen}
      >
        <div className="flex items-center gap-2">
          <Terminal className="w-3.5 h-3.5 text-zinc-500" />
          <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.15em] font-mono">
            Terminal
          </span>
          <span className="text-[10px] text-zinc-600 font-mono">
            {entries.length} lines
          </span>
          {errorCount > 0 && (
            <span className="text-[10px] bg-red-500/15 text-red-400 px-1.5 py-0.5 rounded font-mono font-bold">
              {errorCount} error{errorCount > 1 ? 's' : ''}
            </span>
          )}
          {warnCount > 0 && (
            <span className="text-[10px] bg-amber-500/15 text-amber-400 px-1.5 py-0.5 rounded font-mono font-bold">
              {warnCount} warn{warnCount > 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {isOpen && (
            <>
              <button
                className="p-1 text-zinc-600 hover:text-zinc-400 transition-colors"
                onClick={(e) => { e.stopPropagation(); setAutoScroll(true) }}
                title="Scroll to bottom"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
              <button
                className="p-1 text-zinc-600 hover:text-zinc-400 transition-colors"
                onClick={(e) => { e.stopPropagation(); clearEntries() }}
                title="Clear"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}
          {isOpen
            ? <ChevronDown className="w-3.5 h-3.5 text-zinc-600" />
            : <ChevronUp className="w-3.5 h-3.5 text-zinc-600" />
          }
        </div>
      </div>

      {/* Resizable divider + log output */}
      {isOpen && (
        <>
          {/* Drag handle — wider hit area with visible grip line */}
          <div
            className={`h-3 cursor-row-resize transition-colors flex items-center justify-center group ${
              isDragging ? 'bg-purple-500/20' : 'hover:bg-purple-500/10'
            }`}
            onMouseDown={handleDragStart}
          >
            <div className={`w-8 h-0.5 rounded-full transition-colors ${
              isDragging ? 'bg-purple-400/60' : 'bg-zinc-700 group-hover:bg-purple-400/40'
            }`} />
          </div>

          {/* Log entries */}
          <div
            ref={scrollRef}
            className="overflow-y-auto scrollbar-thin font-mono text-[11px] leading-[18px] px-2 py-1"
            style={{ height: panelHeight }}
            onScroll={handleScroll}
          >
            {entries.length === 0 ? (
              <div className="text-zinc-700 text-center py-8">
                No log output yet. Logs will appear here when jobs run.
              </div>
            ) : (
              entries.map((entry, i) => (
                <div
                  key={i}
                  className={`flex gap-2 px-1 rounded ${LEVEL_BG[entry.level] || ''}`}
                >
                  <span className="text-zinc-700 shrink-0 select-none">
                    {new Date(entry.timestamp).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                  <span className={`shrink-0 w-12 uppercase font-bold ${LEVEL_COLORS[entry.level] || 'text-zinc-500'}`}>
                    {entry.level}
                  </span>
                  <span className={`shrink-0 w-24 truncate ${getModuleColor(entry.module)}`}>
                    [{entry.module}]
                  </span>
                  <span className={
                    entry.level === 'error' ? 'text-red-300' :
                    entry.level === 'warn' ? 'text-amber-300' :
                    entry.message.includes('complete') || entry.message.includes('succeeded') || entry.message.includes('success')
                      ? 'text-emerald-400'
                      : 'text-zinc-300'
                  }>
                    {entry.message}
                  </span>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  )
}

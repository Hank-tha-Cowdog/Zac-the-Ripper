import { useEffect } from 'react'
import { useTerminalStore } from '../stores/terminal-store'

/**
 * Listens for log entries forwarded from the main process via IPC
 * and adds them to the terminal store.
 */
export function useTerminalLogs() {
  const addEntry = useTerminalStore((s) => s.addEntry)

  useEffect(() => {
    const cleanup = window.ztr.log.onEntry((data: unknown) => {
      const d = data as {
        timestamp: string
        level: 'debug' | 'info' | 'warn' | 'error'
        module: string
        message: string
      }
      addEntry({
        timestamp: d.timestamp,
        level: d.level,
        module: d.module,
        message: d.message
      })
    })

    return cleanup
  }, [addEntry])
}

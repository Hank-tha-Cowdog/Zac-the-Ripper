import { useEffect, useCallback, useRef } from 'react'

export function useIpcListener(event: string, callback: (data: unknown) => void) {
  const callbackRef = useRef(callback)
  callbackRef.current = callback

  useEffect(() => {
    // The preload API exposes event listeners via onProgress/onComplete/onError
    // We handle them directly in the stores/pages
  }, [event])
}

export function useIpcInvoke<T>(channel: string) {
  return useCallback(async (...args: unknown[]): Promise<T> => {
    // This is a generic wrapper; prefer using window.ztr.* directly
    const parts = channel.split('.')
    let target: unknown = window.ztr
    for (const part of parts) {
      target = (target as Record<string, unknown>)?.[part]
    }
    if (typeof target === 'function') {
      return (target as (...args: unknown[]) => Promise<T>)(...args)
    }
    throw new Error(`IPC method not found: ${channel}`)
  }, [channel])
}

import React, { useState, useRef, useCallback } from 'react'
import { HelpCircle } from 'lucide-react'

type TooltipPosition = 'top' | 'bottom' | 'left' | 'right'

interface TooltipProps {
  content: string
  children?: React.ReactNode
  position?: TooltipPosition
  /** Show an inline (?) help icon instead of wrapping children */
  inline?: boolean
  className?: string
}

export function Tooltip({ content, children, position = 'top', inline = false, className = '' }: TooltipProps) {
  const [visible, setVisible] = useState(false)
  const [coords, setCoords] = useState({ x: 0, y: 0 })
  const triggerRef = useRef<HTMLSpanElement>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>()

  const show = useCallback(() => {
    clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => {
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect()
        setCoords({
          x: rect.left + rect.width / 2,
          y: position === 'bottom' ? rect.bottom : rect.top
        })
      }
      setVisible(true)
    }, 300)
  }, [position])

  const hide = useCallback(() => {
    clearTimeout(timeoutRef.current)
    setVisible(false)
  }, [])

  const positionClasses: Record<TooltipPosition, string> = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2'
  }

  const arrowClasses: Record<TooltipPosition, string> = {
    top: 'top-full left-1/2 -translate-x-1/2 border-t-zinc-700 border-x-transparent border-b-transparent',
    bottom: 'bottom-full left-1/2 -translate-x-1/2 border-b-zinc-700 border-x-transparent border-t-transparent',
    left: 'left-full top-1/2 -translate-y-1/2 border-l-zinc-700 border-y-transparent border-r-transparent',
    right: 'right-full top-1/2 -translate-y-1/2 border-r-zinc-700 border-y-transparent border-l-transparent'
  }

  return (
    <span
      ref={triggerRef}
      className={`relative inline-flex ${className}`}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {inline ? (
        <HelpCircle className="w-3.5 h-3.5 text-zinc-600 hover:text-purple-400 cursor-help transition-colors" />
      ) : (
        children
      )}

      {visible && (
        <span
          role="tooltip"
          className={`absolute z-[100] ${positionClasses[position]} pointer-events-none`}
        >
          <span className="tooltip-bubble">
            {content}
          </span>
          <span className={`absolute w-0 h-0 border-4 ${arrowClasses[position]}`} />
        </span>
      )}
    </span>
  )
}

/** Convenience: label text + inline tooltip icon */
interface LabelWithTooltipProps {
  label: string
  tooltip: string
  className?: string
}

export function LabelWithTooltip({ label, tooltip, className = '' }: LabelWithTooltipProps) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span>{label}</span>
      <Tooltip content={tooltip} inline position="top" />
    </span>
  )
}

import React, { useState, useRef, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
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
  const tooltipRef = useRef<HTMLDivElement>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>()

  const show = useCallback(() => {
    clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => {
      if (!triggerRef.current) return
      const rect = triggerRef.current.getBoundingClientRect()
      let x = rect.left + rect.width / 2
      let y = position === 'bottom' ? rect.bottom + 8 : rect.top - 8
      setCoords({ x, y })
      setVisible(true)
    }, 300)
  }, [position])

  const hide = useCallback(() => {
    clearTimeout(timeoutRef.current)
    setVisible(false)
  }, [])

  // Post-render viewport clamping
  useEffect(() => {
    if (!visible || !tooltipRef.current) return
    const el = tooltipRef.current
    const r = el.getBoundingClientRect()
    const pad = 8

    let adjustX = 0
    let adjustY = 0
    if (r.right > window.innerWidth - pad) adjustX = window.innerWidth - pad - r.right
    if (r.left < pad) adjustX = pad - r.left
    if (r.bottom > window.innerHeight - pad) adjustY = window.innerHeight - pad - r.bottom
    if (r.top < pad) adjustY = pad - r.top

    if (adjustX || adjustY) {
      setCoords(prev => ({ x: prev.x + adjustX, y: prev.y + adjustY }))
    }
  }, [visible])

  useEffect(() => {
    return () => clearTimeout(timeoutRef.current)
  }, [])

  const tooltipEl = visible ? createPortal(
    <div
      ref={tooltipRef}
      role="tooltip"
      className="fixed z-[9999] pointer-events-none"
      style={{
        left: coords.x,
        top: coords.y,
        transform: position === 'bottom'
          ? 'translateX(-50%)'
          : 'translateX(-50%) translateY(-100%)'
      }}
    >
      <span className="tooltip-bubble">
        {content}
      </span>
    </div>,
    document.body
  ) : null

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
      {tooltipEl}
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

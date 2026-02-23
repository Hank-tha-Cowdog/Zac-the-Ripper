import React from 'react'

interface LogoProps {
  size?: number
  className?: string
  glow?: boolean
}

export function Logo({ size = 32, className = '', glow = false }: LogoProps) {
  const id = `ztr-grad-${size}`
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      className={`${glow ? 'animate-logo-glow' : ''} ${className}`}
      aria-label="Zac the Ripper"
    >
      <defs>
        <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#c084fc" />
          <stop offset="50%" stopColor="#a855f7" />
          <stop offset="100%" stopColor="#7c3aed" />
        </linearGradient>
      </defs>
      {/* Disc outer ring */}
      <circle cx="24" cy="24" r="22" fill="none" stroke="#a855f7" strokeWidth="1.5" opacity="0.4" />
      {/* Disc track ring */}
      <circle cx="24" cy="24" r="17" fill="none" stroke="#a855f7" strokeWidth="0.5" opacity="0.2" />
      {/* Disc inner ring */}
      <circle cx="24" cy="24" r="8" fill="none" stroke="#a855f7" strokeWidth="1" opacity="0.3" />
      {/* Center hub */}
      <circle cx="24" cy="24" r="3" fill={`url(#${id})`} opacity="0.8" />
      {/* Z rip mark — bold diagonal letter */}
      <path
        d="M 15 13 L 33 13 L 15 35 L 33 35"
        fill="none"
        stroke={`url(#${id})`}
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

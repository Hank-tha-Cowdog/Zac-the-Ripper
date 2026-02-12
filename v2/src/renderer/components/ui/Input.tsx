import React from 'react'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  hint?: string
}

export function Input({ label, hint, className = '', id, ...props }: InputProps) {
  const inputId = id || label?.toLowerCase().replace(/\s+/g, '-')

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={inputId} className="label-tech">
          {label}
        </label>
      )}
      <input id={inputId} className={`input ${className}`} {...props} />
      {hint && <span className="text-[10px] text-zinc-600">{hint}</span>}
    </div>
  )
}

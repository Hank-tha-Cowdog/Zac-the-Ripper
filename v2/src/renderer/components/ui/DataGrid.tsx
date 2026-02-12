import React from 'react'

interface DataGridItem {
  label: string
  value: React.ReactNode
}

interface DataGridProps {
  items: DataGridItem[]
  className?: string
}

export function DataGrid({ items, className = '' }: DataGridProps) {
  return (
    <div className={`data-grid ${className}`}>
      {items.map((item) => (
        <React.Fragment key={item.label}>
          <span className="data-label">{item.label}</span>
          <span className="data-value">{item.value}</span>
        </React.Fragment>
      ))}
    </div>
  )
}

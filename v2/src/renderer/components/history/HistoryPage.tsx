import React, { useState } from 'react'
import { HistoryTable } from './HistoryTable'
import { HistoryDetailModal } from './HistoryDetailModal'

export function HistoryPage() {
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null)

  return (
    <div className="space-y-6 animate-fade-in">
      <h1 className="text-2xl font-bold text-purple-400">History</h1>

      <HistoryTable onViewDetails={setSelectedJobId} />

      <HistoryDetailModal
        jobId={selectedJobId}
        isOpen={selectedJobId !== null}
        onClose={() => setSelectedJobId(null)}
      />
    </div>
  )
}

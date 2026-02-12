import React, { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { Select, Button, Modal, Input, LabelWithTooltip } from '../ui'

interface DiscSet {
  id: number
  set_name: string
  media_type: string
  total_discs: number
  ripped_discs?: number
}

interface DiscSetSelectorProps {
  selectedSetId: number | null
  discNumber: number | null
  onSelectSet: (setId: number | null, discNumber: number | null) => void
}

export function DiscSetSelector({ selectedSetId, discNumber, onSelectSet }: DiscSetSelectorProps) {
  const [sets, setSets] = useState<DiscSet[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [newSetName, setNewSetName] = useState('')
  const [newSetType, setNewSetType] = useState('movie')
  const [newSetDiscs, setNewSetDiscs] = useState('1')

  useEffect(() => {
    loadSets()
  }, [])

  const loadSets = async () => {
    try {
      const result = await window.ztr.db.discSets.list()
      setSets(result || [])
    } catch {}
  }

  const handleCreate = async () => {
    if (!newSetName.trim()) return
    try {
      const created = await window.ztr.db.discSets.create({
        set_name: newSetName.trim(),
        media_type: newSetType,
        total_discs: parseInt(newSetDiscs) || 1
      })
      setSets([...sets, created])
      onSelectSet(created.id, 1)
      setShowCreate(false)
      setNewSetName('')
    } catch {}
  }

  const options = [
    { value: '', label: 'None (standalone)' },
    { value: '__new__', label: '+ Create New Set...' },
    ...sets.map((s) => ({
      value: String(s.id),
      label: `${s.set_name} (${s.ripped_discs || 0}/${s.total_discs})`
    }))
  ]

  return (
    <div>
      <div className="flex flex-col gap-1">
        <LabelWithTooltip
          label="Disc Set"
          tooltip="Group multiple discs that belong together (e.g., a TV season box set, or a multi-disc movie collection like Lord of the Rings). Discs in a set share Kodi metadata and are tracked together in History."
          className="label-tech"
        />
        <div className="relative">
          <select
            className="select w-full pr-8"
            value={selectedSetId ? String(selectedSetId) : ''}
            onChange={(e) => {
              const val = e.target.value
              if (val === '__new__') {
                setShowCreate(true)
              } else if (val === '') {
                onSelectSet(null, null)
              } else {
                const set = sets.find((s) => s.id === parseInt(val))
                onSelectSet(parseInt(val), (set?.ripped_discs || 0) + 1)
              }
            }}
          >
            {options.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {selectedSetId && discNumber && (
        <div className="mt-2 flex items-center gap-2">
          <Input
            label="Disc Number"
            type="number"
            value={String(discNumber)}
            onChange={(e) => onSelectSet(selectedSetId, parseInt(e.target.value) || 1)}
            className="w-20"
          />
          <span className="text-xs text-zinc-500 mt-5">
            of {sets.find((s) => s.id === selectedSetId)?.total_discs || '?'}
          </span>
        </div>
      )}

      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="Create Disc Set">
        <div className="space-y-4">
          <Input
            label="Set Name"
            placeholder="e.g., The Lord of the Rings"
            value={newSetName}
            onChange={(e) => setNewSetName(e.target.value)}
            hint="Name used for Kodi movie set grouping"
          />
          <div className="flex flex-col gap-1">
            <LabelWithTooltip
              label="Media Type"
              tooltip="Movie Collection: groups movies in a Kodi movie set (e.g., 'The Lord of the Rings Collection'). TV Season: episodes from multiple discs merge into Season folders."
              className="label-tech"
            />
            <div className="relative">
              <select
                className="select w-full pr-8"
                value={newSetType}
                onChange={(e) => setNewSetType(e.target.value)}
              >
                <option value="movie">Movie Collection</option>
                <option value="tvshow">TV Season / Box Set</option>
              </select>
            </div>
          </div>
          <Input
            label="Total Discs"
            type="number"
            value={newSetDiscs}
            onChange={(e) => setNewSetDiscs(e.target.value)}
            hint="How many discs in this set?"
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate}>Create</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

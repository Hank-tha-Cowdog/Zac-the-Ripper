import React from 'react'
import { Clock, HardDrive, Film, Music, Subtitles } from 'lucide-react'
import { Card, Badge, Button, TechLabel } from '../ui'
import { useDiscStore } from '../../stores/disc-store'

export function TrackSelector() {
  const { discInfo, selectedTracks, toggleTrack, selectAllTracks, selectMainFeature } = useDiscStore()

  if (!discInfo) return null

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <TechLabel>Title Tracks</TechLabel>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={selectAllTracks}>
            Select All
          </Button>
          <Button variant="ghost" size="sm" onClick={selectMainFeature}>
            Main Feature Only
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {discInfo.tracks.map((track) => {
          const isSelected = selectedTracks.includes(track.id)
          return (
            <Card
              key={track.id}
              variant="solid"
              className={`cursor-pointer transition-all ${
                isSelected ? 'border-purple-500/50 bg-purple-500/5' : ''
              }`}
              padding={false}
            >
              <div
                className="p-3"
                onClick={() => toggleTrack(track.id)}
              >
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleTrack(track.id)}
                    className="accent-purple-600"
                  />
                  <span className="text-sm font-medium text-zinc-100">
                    {track.title}
                  </span>

                  {track.resolution && (
                    <Badge variant={track.isInterlaced ? 'warning' : 'info'}>
                      {track.resolution}
                    </Badge>
                  )}

                  <div className="flex items-center gap-1 text-xs text-zinc-500 font-mono">
                    <Clock className="w-3 h-3" />
                    {track.duration}
                  </div>

                  <div className="flex items-center gap-1 text-xs text-zinc-500 font-mono">
                    <HardDrive className="w-3 h-3" />
                    {track.size}
                  </div>

                  {track.chapters > 0 && (
                    <div className="flex items-center gap-1 text-xs text-zinc-500">
                      <Film className="w-3 h-3" />
                      {track.chapters} ch
                    </div>
                  )}

                  {track.framerate && (
                    <Badge variant="info">{track.framerate}fps</Badge>
                  )}
                </div>

                {/* Audio tracks */}
                {track.audioTracks.length > 0 && (
                  <div className="mt-2 ml-7 flex flex-wrap gap-1">
                    <Music className="w-3 h-3 text-zinc-600 mt-0.5" />
                    {track.audioTracks.map((audio) => (
                      <Badge key={audio.id} variant="default">
                        {audio.codec} {audio.channels} {audio.language.toUpperCase()}
                      </Badge>
                    ))}
                  </div>
                )}

                {/* Subtitle tracks */}
                {track.subtitleTracks.length > 0 && (
                  <div className="mt-1 ml-7 flex flex-wrap gap-1">
                    <Subtitles className="w-3 h-3 text-zinc-600 mt-0.5" />
                    {track.subtitleTracks.map((sub) => (
                      <Badge key={sub.id} variant="info">
                        {sub.type} {sub.language.toUpperCase()}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

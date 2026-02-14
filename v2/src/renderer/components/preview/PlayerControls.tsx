import React, { useCallback, useRef, useState } from 'react'
import {
  Play, Pause, SkipBack, SkipForward,
  Volume2, VolumeX, ChevronDown
} from 'lucide-react'

interface TrackInfo {
  id: number
  title: string
  lang: string
}

interface PlaybackState {
  playing: boolean
  position: number
  duration: number
  chapter: number
  chapterCount: number
  audioTrack: number
  audioTracks: TrackInfo[]
  subtitleTrack: number | false
  subtitleTracks: TrackInfo[]
  volume: number
  title: number
}

interface PlayerControlsProps {
  state: PlaybackState
  onTogglePause: () => void
  onSeek: (seconds: number) => void
  onNextChapter: () => void
  onPrevChapter: () => void
  onAudioTrackChange: (id: number) => void
  onSubtitleTrackChange: (id: number | false) => void
  onVolumeChange: (vol: number) => void
  disabled?: boolean
}

function formatTime(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return '0:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

export function PlayerControls({
  state, onTogglePause, onSeek, onNextChapter, onPrevChapter,
  onAudioTrackChange, onSubtitleTrackChange, onVolumeChange, disabled
}: PlayerControlsProps) {
  const seekBarRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [showAudioMenu, setShowAudioMenu] = useState(false)
  const [showSubMenu, setShowSubMenu] = useState(false)
  const [prevVolume, setPrevVolume] = useState(100)

  const progress = state.duration > 0 ? (state.position / state.duration) * 100 : 0

  const handleSeekBarClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!seekBarRef.current || !state.duration || disabled) return
    const rect = seekBarRef.current.getBoundingClientRect()
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    onSeek(pct * state.duration)
  }, [state.duration, onSeek, disabled])

  const handleSeekBarMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!seekBarRef.current || !state.duration || disabled) return
    setIsDragging(true)
    const rect = seekBarRef.current.getBoundingClientRect()
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    onSeek(pct * state.duration)

    const onMove = (me: MouseEvent) => {
      const movePct = Math.max(0, Math.min(1, (me.clientX - rect.left) / rect.width))
      onSeek(movePct * state.duration)
    }
    const onUp = () => {
      setIsDragging(false)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [state.duration, onSeek, disabled])

  const toggleMute = useCallback(() => {
    if (state.volume > 0) {
      setPrevVolume(state.volume)
      onVolumeChange(0)
    } else {
      onVolumeChange(prevVolume || 100)
    }
  }, [state.volume, prevVolume, onVolumeChange])

  const activeAudio = state.audioTracks.find(t => t.id === state.audioTrack)
  const activeSub = state.subtitleTrack !== false
    ? state.subtitleTracks.find(t => t.id === state.subtitleTrack)
    : null

  return (
    <div className="border-t border-zinc-800 bg-zinc-900/80 p-3 space-y-2">
      {/* Seek bar */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-zinc-500 font-mono w-14 text-right">
          {formatTime(state.position)}
        </span>
        <div
          ref={seekBarRef}
          className="flex-1 h-1.5 bg-zinc-800 rounded-full cursor-pointer group relative"
          onClick={handleSeekBarClick}
          onMouseDown={handleSeekBarMouseDown}
        >
          <div
            className="h-full bg-purple-500 rounded-full transition-all relative"
            style={{ width: `${progress}%` }}
          >
            <div className={`absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-purple-400 rounded-full shadow-lg transition-opacity ${isDragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`} />
          </div>
        </div>
        <span className="text-[10px] text-zinc-500 font-mono w-14">
          {formatTime(state.duration)}
        </span>
      </div>

      {/* Controls row */}
      <div className="flex items-center gap-2">
        {/* Playback controls */}
        <div className="flex items-center gap-1">
          <button
            className="btn-ghost p-1.5 rounded"
            onClick={onPrevChapter}
            disabled={disabled}
            title="Previous chapter"
          >
            <SkipBack className="w-3.5 h-3.5" />
          </button>
          <button
            className="btn-ghost p-1.5 rounded"
            onClick={onTogglePause}
            disabled={disabled}
            title={state.playing ? 'Pause' : 'Play'}
          >
            {state.playing
              ? <Pause className="w-4 h-4" />
              : <Play className="w-4 h-4" />
            }
          </button>
          <button
            className="btn-ghost p-1.5 rounded"
            onClick={onNextChapter}
            disabled={disabled}
            title="Next chapter"
          >
            <SkipForward className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Chapter counter */}
        {state.chapterCount > 0 && (
          <span className="text-[10px] text-zinc-500 font-mono">
            Ch {state.chapter + 1}/{state.chapterCount}
          </span>
        )}

        {/* Volume */}
        <div className="flex items-center gap-1 ml-2">
          <button
            className="btn-ghost p-1 rounded"
            onClick={toggleMute}
            disabled={disabled}
            title={state.volume > 0 ? 'Mute' : 'Unmute'}
          >
            {state.volume > 0
              ? <Volume2 className="w-3.5 h-3.5" />
              : <VolumeX className="w-3.5 h-3.5 text-zinc-600" />
            }
          </button>
          <input
            type="range"
            min="0"
            max="100"
            value={state.volume}
            onChange={(e) => onVolumeChange(Number(e.target.value))}
            className="w-16 h-1 accent-purple-500"
            disabled={disabled}
          />
        </div>

        <div className="flex-1" />

        {/* Audio track dropdown */}
        {state.audioTracks.length > 0 && (
          <div className="relative">
            <button
              className="btn-ghost text-[10px] py-1 px-2 flex items-center gap-1 rounded"
              onClick={() => { setShowAudioMenu(!showAudioMenu); setShowSubMenu(false) }}
              disabled={disabled}
            >
              Audio: {activeAudio ? `${activeAudio.lang || activeAudio.title}` : `Track ${state.audioTrack}`}
              <ChevronDown className="w-3 h-3" />
            </button>
            {showAudioMenu && (
              <div className="absolute bottom-full mb-1 right-0 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl min-w-40 py-1 z-50">
                {state.audioTracks.map((track) => (
                  <button
                    key={track.id}
                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-700 transition-colors ${track.id === state.audioTrack ? 'text-purple-400' : 'text-zinc-300'}`}
                    onClick={() => { onAudioTrackChange(track.id); setShowAudioMenu(false) }}
                  >
                    {track.lang ? `${track.lang}` : ''} {track.title}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Subtitle track dropdown */}
        {state.subtitleTracks.length > 0 && (
          <div className="relative">
            <button
              className="btn-ghost text-[10px] py-1 px-2 flex items-center gap-1 rounded"
              onClick={() => { setShowSubMenu(!showSubMenu); setShowAudioMenu(false) }}
              disabled={disabled}
            >
              Sub: {activeSub ? `${activeSub.lang || activeSub.title}` : state.subtitleTrack === false ? 'Off' : `Track ${state.subtitleTrack}`}
              <ChevronDown className="w-3 h-3" />
            </button>
            {showSubMenu && (
              <div className="absolute bottom-full mb-1 right-0 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl min-w-40 py-1 z-50">
                <button
                  className={`w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-700 transition-colors ${state.subtitleTrack === false ? 'text-purple-400' : 'text-zinc-300'}`}
                  onClick={() => { onSubtitleTrackChange(false); setShowSubMenu(false) }}
                >
                  Off
                </button>
                {state.subtitleTracks.map((track) => (
                  <button
                    key={track.id}
                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-700 transition-colors ${track.id === state.subtitleTrack ? 'text-purple-400' : 'text-zinc-300'}`}
                    onClick={() => { onSubtitleTrackChange(track.id); setShowSubMenu(false) }}
                  >
                    {track.lang ? `${track.lang}` : ''} {track.title}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Play, Square, Disc3, Clock, HardDrive, Loader2, AlertTriangle, MonitorPlay } from 'lucide-react'
import { useDiscStore } from '../../stores/disc-store'
import { PlayerControls } from './PlayerControls'

interface PlaybackState {
  playing: boolean
  position: number
  duration: number
  chapter: number
  chapterCount: number
  audioTrack: number
  audioTracks: { id: number; title: string; lang: string }[]
  subtitleTrack: number | false
  subtitleTracks: { id: number; title: string; lang: string }[]
  volume: number
  title: number
}

type PlayerType = 'mpv' | 'ffplay' | 'none'

export function PreviewPage() {
  const navigate = useNavigate()
  const { discInfo, selectedDrive, loading: discLoading, setSelectedTracks } = useDiscStore()
  const [selectedTitle, setSelectedTitle] = useState<number | null>(null)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [playerAvailability, setPlayerAvailability] = useState<{ mpvAvailable: boolean; ffplayAvailable: boolean } | null>(null)
  const [activePlayer, setActivePlayer] = useState<PlayerType | null>(null)
  const [playbackState, setPlaybackState] = useState<PlaybackState>({
    playing: false,
    position: 0,
    duration: 0,
    chapter: 0,
    chapterCount: 0,
    audioTrack: 1,
    audioTracks: [],
    subtitleTrack: false,
    subtitleTracks: [],
    volume: 100,
    title: 0
  })

  // Check player availability on mount
  useEffect(() => {
    window.ztr.preview.check().then((result: { mpvAvailable: boolean; ffplayAvailable: boolean }) => {
      setPlayerAvailability(result)
    }).catch(() => {
      setPlayerAvailability({ mpvAvailable: false, ffplayAvailable: false })
    })
  }, [])

  // Subscribe to state updates from main process
  useEffect(() => {
    const unsubscribe = window.ztr.preview.onStateUpdate((state: PlaybackState) => {
      setPlaybackState(state)
    })
    return () => { unsubscribe() }
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (activePlayer) {
        window.ztr.preview.stop().catch(() => {})
      }
    }
  }, [activePlayer])

  // Auto-select first title when disc info is available
  useEffect(() => {
    if (discInfo && discInfo.tracks.length > 0 && selectedTitle === null) {
      setSelectedTitle(discInfo.tracks[0].id)
    }
  }, [discInfo, selectedTitle])

  // Keyboard shortcuts
  useEffect(() => {
    if (!activePlayer || activePlayer !== 'mpv') return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      switch (e.key) {
        case ' ':
          e.preventDefault()
          window.ztr.preview.command('togglePause')
          break
        case 'ArrowLeft':
          e.preventDefault()
          window.ztr.preview.command('seek', -10)
          break
        case 'ArrowRight':
          e.preventDefault()
          window.ztr.preview.command('seek', 10)
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activePlayer])

  const handleStartPreview = useCallback(async () => {
    if (starting || discLoading || selectedTitle === null) return
    const driveIndex = selectedDrive ?? 0
    setStarting(true)
    setError(null)

    try {
      const result = await window.ztr.preview.start(driveIndex, selectedTitle)
      if (result.success) {
        setActivePlayer(result.player as PlayerType)
      } else {
        setError(result.error || 'Failed to start preview')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setStarting(false)
    }
  }, [selectedDrive, selectedTitle, starting, discLoading])

  const handleStopPreview = useCallback(async () => {
    await window.ztr.preview.stop().catch(() => {})
    setActivePlayer(null)
    setPlaybackState(prev => ({ ...prev, playing: false, position: 0 }))
  }, [])

  const handleTitleClick = useCallback((titleId: number) => {
    setSelectedTitle(titleId)
    // If already playing, switch title via mpv
    if (activePlayer === 'mpv') {
      window.ztr.preview.command('setTitle', titleId)
    }
  }, [activePlayer])

  const handleRipTitle = () => {
    if (selectedTitle !== null) {
      setSelectedTracks([selectedTitle])
      navigate('/rip')
    }
  }

  // Command helpers
  const cmd = useCallback((command: string, ...args: unknown[]) => {
    window.ztr.preview.command(command, ...args)
  }, [])

  if (!discInfo) {
    return (
      <div className="space-y-6 animate-fade-in">
        <h1 className="text-2xl font-bold text-purple-400">Disc Preview</h1>
        <div className="card p-8 text-center">
          <Disc3 className="w-12 h-12 text-zinc-600 mx-auto mb-3" />
          <p className="text-zinc-400">Insert a disc and scan it from the Dashboard or Rip page first.</p>
        </div>
      </div>
    )
  }

  const hasMpv = playerAvailability?.mpvAvailable
  const hasFfplay = playerAvailability?.ffplayAvailable
  const hasPlayer = hasMpv || hasFfplay
  const isPlaying = activePlayer !== null

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold text-purple-400">Disc Preview</h1>
        {playerAvailability && (
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono ${hasMpv ? 'bg-purple-500/20 text-purple-400' : hasFfplay ? 'bg-amber-500/20 text-amber-400' : 'bg-red-500/20 text-red-400'}`}>
            {hasMpv ? 'mpv' : hasFfplay ? 'ffplay' : 'no player'}
          </span>
        )}
      </div>

      {error && (
        <div className="card-solid border-red-500/30 bg-red-500/5 p-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        {/* Player panel */}
        <div className="col-span-2">
          <div className="card-solid overflow-hidden">
            <div className="aspect-video bg-black flex items-center justify-center">
              {!hasPlayer && playerAvailability ? (
                /* No player available */
                <div className="flex flex-col items-center gap-4 text-center px-8">
                  <AlertTriangle className="w-10 h-10 text-amber-500/60" />
                  <div>
                    <div className="text-sm text-zinc-300 mb-1">No Preview Player Found</div>
                    <div className="text-[11px] text-zinc-500 max-w-md">
                      Install mpv for full DVD preview with playback controls, or ffplay (bundled with ffmpeg) for basic playback.
                    </div>
                    <div className="text-[10px] text-zinc-600 mt-2">
                      brew install mpv
                    </div>
                  </div>
                </div>
              ) : starting ? (
                <div className="flex flex-col items-center gap-3 text-zinc-500">
                  <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
                  <div className="text-sm">Starting {hasMpv ? 'mpv' : 'ffplay'}...</div>
                  <div className="text-[10px] text-zinc-600">This may take a moment while the disc spins up</div>
                </div>
              ) : isPlaying ? (
                /* mpv/ffplay is running in its own window — show status here */
                <div className="flex flex-col items-center gap-3">
                  <MonitorPlay className="w-10 h-10 text-purple-400" />
                  <div className="text-sm text-zinc-300">
                    Playing in {activePlayer === 'mpv' ? 'mpv' : 'ffplay'} window
                  </div>
                  {activePlayer === 'mpv' && playbackState.playing && (
                    <div className="text-[10px] text-zinc-500 font-mono">
                      Title {playbackState.title} — Use controls below
                    </div>
                  )}
                </div>
              ) : (
                /* Ready to play */
                <div className="flex flex-col items-center gap-3">
                  <Disc3 className="w-10 h-10 text-zinc-700" />
                  {playerAvailability === null ? (
                    <div className="flex items-center gap-2 text-zinc-500 text-sm">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Checking preview support...
                    </div>
                  ) : (
                    <>
                      <button
                        className="btn-primary text-sm py-2 px-6 flex items-center gap-2"
                        onClick={handleStartPreview}
                        disabled={discLoading || selectedTitle === null}
                      >
                        <Play className="w-4 h-4" />
                        Start Preview
                      </button>
                      {discLoading && (
                        <div className="text-[10px] text-zinc-600">Wait for disc scan to finish...</div>
                      )}
                      {!hasMpv && hasFfplay && (
                        <div className="text-[10px] text-zinc-500">
                          ffplay mode — limited controls (no seek/chapters)
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Controls / action bar */}
            {isPlaying && activePlayer === 'mpv' ? (
              <PlayerControls
                state={playbackState}
                onTogglePause={() => cmd('togglePause')}
                onSeek={(s) => cmd('seekAbsolute', s)}
                onNextChapter={() => cmd('nextChapter')}
                onPrevChapter={() => cmd('prevChapter')}
                onAudioTrackChange={(id) => cmd('setAudioTrack', id)}
                onSubtitleTrackChange={(id) => cmd('setSubtitleTrack', id)}
                onVolumeChange={(v) => cmd('setVolume', v)}
              />
            ) : (
              <div className="p-3 flex items-center gap-2 border-t border-zinc-800">
                {isPlaying && (
                  <button className="btn-ghost text-xs py-1 px-3 flex items-center gap-1" onClick={handleStopPreview}>
                    <Square className="w-3 h-3" /> Stop
                  </button>
                )}
                <div className="flex-1" />
                <button
                  className="btn-secondary text-xs py-1 px-3"
                  onClick={handleRipTitle}
                  disabled={selectedTitle === null}
                >
                  Rip This Title
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Title list */}
        <div className="space-y-1.5 max-h-[calc(100vh-12rem)] overflow-y-auto">
          <span className="label-tech text-[10px] text-zinc-600 uppercase tracking-wider">Titles</span>
          {discInfo.tracks.map((track) => (
            <button
              key={track.id}
              className={`w-full text-left p-2 rounded border transition-colors ${
                selectedTitle === track.id
                  ? 'border-purple-500/50 bg-purple-500/10 text-zinc-100'
                  : 'border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:bg-zinc-800/50'
              }`}
              onClick={() => handleTitleClick(track.id)}
            >
              <div className="flex items-center gap-1.5">
                {isPlaying && playbackState.title === track.id && (
                  <span className="status-dot bg-purple-500" />
                )}
                <div className="text-xs font-medium truncate">{track.title}</div>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="flex items-center gap-0.5 text-[10px] text-zinc-500 font-mono">
                  <Clock className="w-2.5 h-2.5" /> {track.duration}
                </span>
                <span className="flex items-center gap-0.5 text-[10px] text-zinc-500 font-mono">
                  <HardDrive className="w-2.5 h-2.5" /> {track.size}
                </span>
                {track.resolution && (
                  <span className="text-[10px] text-zinc-600">{track.resolution}</span>
                )}
              </div>
            </button>
          ))}

          {/* Rip button below title list */}
          {isPlaying && (
            <div className="pt-2 border-t border-zinc-800 mt-2">
              <button
                className="btn-primary w-full text-xs py-2"
                onClick={handleRipTitle}
                disabled={selectedTitle === null}
              >
                Rip Title {selectedTitle}
              </button>
              <button
                className="btn-ghost w-full text-xs py-1.5 mt-1 flex items-center justify-center gap-1"
                onClick={handleStopPreview}
              >
                <Square className="w-3 h-3" /> Stop Preview
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

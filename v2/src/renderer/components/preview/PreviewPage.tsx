import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Play, Square, Disc3, Clock, HardDrive, Loader2 } from 'lucide-react'
import { useDiscStore } from '../../stores/disc-store'

export function PreviewPage() {
  const navigate = useNavigate()
  const { discInfo, selectedDrive, loading: discLoading, setSelectedTracks } = useDiscStore()
  const [streamPort, setStreamPort] = useState<number | null>(null)
  const [selectedTitle, setSelectedTitle] = useState<number | null>(null)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamActiveRef = useRef(false)

  // Stop stream on unmount
  useEffect(() => {
    return () => {
      if (streamActiveRef.current) {
        window.ztr.disc.stopStream().catch(() => {})
        streamActiveRef.current = false
      }
    }
  }, [])

  // Auto-select first title when disc info is available
  useEffect(() => {
    if (discInfo && discInfo.tracks.length > 0 && selectedTitle === null) {
      setSelectedTitle(discInfo.tracks[0].id)
    }
  }, [discInfo, selectedTitle])

  const handleStartStream = useCallback(async () => {
    if (starting || discLoading) return
    const driveIndex = selectedDrive ?? 0
    setStarting(true)
    setError(null)
    setStreamPort(null)
    streamActiveRef.current = false

    try {
      const result = await window.ztr.disc.startStream(driveIndex)
      if (result.port) {
        setStreamPort(result.port)
        streamActiveRef.current = true
      } else if ((result as { error?: string }).error) {
        setError((result as { error?: string }).error || 'Failed to start stream')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setStarting(false)
    }
  }, [selectedDrive, starting, discLoading])

  const handleStopStream = useCallback(async () => {
    if (videoRef.current) {
      videoRef.current.pause()
      videoRef.current.removeAttribute('src')
      videoRef.current.load()
    }
    setStreamPort(null)
    streamActiveRef.current = false
    await window.ztr.disc.stopStream().catch(() => {})
  }, [])

  // Update video source when title changes
  useEffect(() => {
    if (videoRef.current && streamPort && selectedTitle !== null) {
      videoRef.current.src = `http://localhost:${streamPort}/stream/title${selectedTitle}.ts`
      videoRef.current.load()
    }
  }, [streamPort, selectedTitle])

  const handleRipTitle = () => {
    if (selectedTitle !== null) {
      setSelectedTracks([selectedTitle])
      navigate('/rip')
    }
  }

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

  return (
    <div className="space-y-4 animate-fade-in">
      <h1 className="text-2xl font-bold text-purple-400">Disc Preview</h1>

      {error && (
        <div className="card-solid border-red-500/30 bg-red-500/5 p-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        {/* Video player */}
        <div className="col-span-2">
          <div className="card-solid overflow-hidden">
            <div className="aspect-video bg-black flex items-center justify-center">
              {starting ? (
                <div className="flex flex-col items-center gap-3 text-zinc-500">
                  <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
                  <div className="text-sm">Starting stream server...</div>
                  <div className="text-[10px] text-zinc-600">This may take up to 90 seconds while the disc spins up</div>
                </div>
              ) : streamPort ? (
                <video
                  ref={videoRef}
                  className="w-full h-full"
                  controls
                />
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <Disc3 className="w-10 h-10 text-zinc-700" />
                  <button
                    className="btn-primary text-sm py-2 px-6 flex items-center gap-2"
                    onClick={handleStartStream}
                    disabled={discLoading}
                  >
                    <Play className="w-4 h-4" />
                    Start Preview
                  </button>
                  {discLoading && (
                    <div className="text-[10px] text-zinc-600">Wait for disc scan to finish...</div>
                  )}
                </div>
              )}
            </div>
            <div className="p-3 flex items-center gap-2 border-t border-zinc-800">
              {streamPort ? (
                <>
                  <button className="btn-ghost text-xs py-1 px-3 flex items-center gap-1" onClick={handleStopStream}>
                    <Square className="w-3 h-3" /> Stop Server
                  </button>
                  <div className="flex-1" />
                </>
              ) : (
                <div className="flex-1" />
              )}
              <button
                className="btn-secondary text-xs py-1 px-3"
                onClick={handleRipTitle}
                disabled={selectedTitle === null}
              >
                Rip This Title
              </button>
            </div>
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
              onClick={() => setSelectedTitle(track.id)}
            >
              <div className="text-xs font-medium truncate">{track.title}</div>
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
        </div>
      </div>
    </div>
  )
}

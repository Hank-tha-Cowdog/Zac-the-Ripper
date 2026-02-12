import React, { useState } from 'react'
import { Download, Search, FolderOpen, SkipForward, CheckCircle, XCircle, Loader2 } from 'lucide-react'

interface MakeMKVSetupScreenProps {
  onComplete: () => void
  onSkip: () => void
}

export function MakeMKVSetupScreen({ onComplete, onSkip }: MakeMKVSetupScreenProps) {
  const [detecting, setDetecting] = useState(false)
  const [result, setResult] = useState<{ found: boolean; path: string | null; version: string | null } | null>(null)

  const handleAutoDetect = async () => {
    setDetecting(true)
    setResult(null)
    try {
      const res = await window.ztr.tools.detectMakeMKV()
      setResult(res)
      if (res.found) {
        setTimeout(onComplete, 1500)
      }
    } catch {
      setResult({ found: false, path: null, version: null })
    } finally {
      setDetecting(false)
    }
  }

  const handleManualPath = async () => {
    const path = await window.ztr.fs.selectDirectory('Locate MakeMKV application')
    if (path) {
      // Test common makemkvcon locations relative to selection
      const possiblePaths = [
        `${path}/makemkvcon`,
        `${path}/Contents/MacOS/makemkvcon`,
        `${path}/MacOS/makemkvcon`
      ]
      for (const p of possiblePaths) {
        const testResult = await window.ztr.tools.test('makemkvcon', p)
        if (testResult.available) {
          await window.ztr.settings.set('tools.makemkvcon_path', p)
          setResult({ found: true, path: p, version: testResult.version })
          setTimeout(onComplete, 1500)
          return
        }
      }
      setResult({ found: false, path, version: null })
    }
  }

  const handleDownload = () => {
    window.open('https://www.makemkv.com/download/', '_blank')
  }

  return (
    <div className="fixed inset-0 z-50 bg-void/95 flex items-center justify-center animate-fade-in">
      <div className="max-w-lg w-full mx-4">
        <div className="card-solid p-8 space-y-6">
          <div className="text-center">
            <h2 className="text-xl font-semibold text-zinc-100 mb-2">MakeMKV Setup</h2>
            <p className="text-sm text-zinc-400">
              MakeMKV is required to rip discs. It cannot be bundled with this app due to licensing,
              but setup takes less than a minute.
            </p>
          </div>

          <div className="space-y-3">
            <button
              className="btn-primary w-full flex items-center justify-center gap-2"
              onClick={handleDownload}
            >
              <Download className="w-4 h-4" />
              Download MakeMKV
            </button>

            <button
              className="btn-secondary w-full flex items-center justify-center gap-2"
              onClick={handleAutoDetect}
              disabled={detecting}
            >
              {detecting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Search className="w-4 h-4" />
              )}
              {detecting ? 'Searching...' : 'Auto-detect Installation'}
            </button>

            <button
              className="btn-secondary w-full flex items-center justify-center gap-2"
              onClick={handleManualPath}
            >
              <FolderOpen className="w-4 h-4" />
              Browse for MakeMKV...
            </button>
          </div>

          {result && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-zinc-900 border border-zinc-800">
              {result.found ? (
                <>
                  <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" />
                  <div>
                    <span className="text-sm text-emerald-400">MakeMKV found!</span>
                    {result.version && (
                      <span className="text-xs text-zinc-500 ml-2">v{result.version}</span>
                    )}
                    <p className="text-xs text-zinc-500 font-mono truncate">{result.path}</p>
                  </div>
                </>
              ) : (
                <>
                  <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                  <span className="text-sm text-red-400">
                    MakeMKV not found. Install it first, then try again.
                  </span>
                </>
              )}
            </div>
          )}

          <button
            className="btn-ghost w-full flex items-center justify-center gap-2 text-zinc-500"
            onClick={onSkip}
          >
            <SkipForward className="w-3 h-3" />
            Skip for now
          </button>
        </div>
      </div>
    </div>
  )
}

import React, { useState } from 'react'
import { CheckCircle, XCircle, Play } from 'lucide-react'
import { Card, Input, Button, TechLabel, Badge, LabelWithTooltip } from '../ui'

interface ToolPathSettingsProps {
  settings: Record<string, string>
  onSave: (key: string, value: string) => void
}

interface TestResult {
  available: boolean
  version: string | null
  error?: string
}

const toolTooltips: Record<string, string> = {
  makemkvcon: 'MakeMKV command-line tool for disc ripping. Required for extracting titles from DVD/Blu-ray/UHD discs. Download from makemkv.com. Leave blank to auto-detect.',
  ffmpeg: 'FFmpeg is used for all re-encoding operations (FFV1 archival, HEVC/H.264 streaming). Also handles subtitle extraction and format conversion. Bundled with the app, or install via Homebrew: brew install ffmpeg',
  ffprobe: 'FFprobe analyzes media files to detect resolution, framerate, interlacing, HDR, audio codecs, and subtitle tracks. Bundled with the app, or installed alongside FFmpeg.'
}

export function ToolPathSettings({ settings, onSave }: ToolPathSettingsProps) {
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({})
  const [testing, setTesting] = useState<string | null>(null)

  const tools = [
    { key: 'tools.makemkvcon_path', label: 'MakeMKV (makemkvcon)', name: 'makemkvcon' },
    { key: 'tools.ffmpeg_path', label: 'FFmpeg', name: 'ffmpeg' },
    { key: 'tools.ffprobe_path', label: 'FFprobe', name: 'ffprobe' }
  ]

  const testTool = async (name: string, path: string) => {
    setTesting(name)
    try {
      const result = await window.ztr.tools.test(name, path)
      setTestResults((prev) => ({ ...prev, [name]: result }))
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [name]: { available: false, version: null, error: String(err) }
      }))
    } finally {
      setTesting(null)
    }
  }

  return (
    <Card>
      <TechLabel className="mb-4 block">Tool Paths</TechLabel>

      <div className="space-y-4">
        {tools.map(({ key, label, name }) => {
          const result = testResults[name]
          return (
            <div key={key}>
              <div className="flex items-end gap-2">
                <div className="flex flex-col gap-1 flex-1">
                  <LabelWithTooltip
                    label={label}
                    tooltip={toolTooltips[name]}
                    className="label-tech"
                  />
                  <input
                    className="input w-full"
                    value={settings[key] || ''}
                    onChange={(e) => onSave(key, e.target.value)}
                    placeholder={`/path/to/${name}`}
                  />
                </div>
                <Button
                  variant="secondary"
                  onClick={() => testTool(name, settings[key] || '')}
                  disabled={testing === name}
                >
                  <Play className="w-4 h-4" />
                  {testing === name ? 'Testing...' : 'Test'}
                </Button>
              </div>
              {result && (
                <div className="mt-1 flex items-center gap-2">
                  {result.available ? (
                    <>
                      <CheckCircle className="w-3 h-3 text-emerald-500" />
                      <span className="text-xs text-emerald-400">
                        Found {result.version && `(v${result.version})`}
                      </span>
                    </>
                  ) : (
                    <>
                      <XCircle className="w-3 h-3 text-red-500" />
                      <span className="text-xs text-red-400">
                        {result.error || 'Not found'}
                      </span>
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </Card>
  )
}

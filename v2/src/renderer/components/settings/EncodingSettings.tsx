import React from 'react'
import { Card, Input, Select, TechLabel, Tooltip, LabelWithTooltip } from '../ui'

interface EncodingSettingsProps {
  settings: Record<string, string>
  onSave: (key: string, value: string) => void
}

export function EncodingSettings({ settings, onSave }: EncodingSettingsProps) {
  const codec = settings['encoding.codec'] || 'h264'
  const hwAccel = settings['encoding.hw_accel'] || 'videotoolbox'
  const isSoftware = hwAccel === 'software'
  const isVT = hwAccel === 'videotoolbox'

  return (
    <Card>
      <TechLabel className="mb-4 block">Encoding Settings</TechLabel>

      <div className="space-y-4">
        {/* Streaming Codec */}
        <div className="flex flex-col gap-1">
          <LabelWithTooltip
            label="Streaming Codec"
            tooltip="H.264 is universally compatible with all devices, smart TVs, and streaming clients. HEVC (H.265) produces smaller files but may require transcoding on older devices."
            className="label-tech"
          />
          <div className="relative">
            <select
              className="select w-full pr-8"
              value={codec}
              onChange={(e) => onSave('encoding.codec', e.target.value)}
            >
              <option value="h264">H.264 — Universal compatibility</option>
              <option value="hevc">HEVC (H.265) — Smaller files, modern devices</option>
            </select>
          </div>
        </div>

        {/* VideoToolbox Quality (shown for VT hardware encoding) */}
        {isVT && (
          <div className="flex flex-col gap-1">
            <LabelWithTooltip
              label={codec === 'hevc' ? 'HEVC Quality' : 'H.264 Quality'}
              tooltip="VideoToolbox quality scale: 0-100 (higher = better). 65 is high quality for streaming. 80+ is near-transparent. 95 is near-lossless. Only applies to VideoToolbox hardware encoding."
              className="label-tech"
            />
            <input
              type="number"
              className="input"
              min={0}
              max={100}
              value={codec === 'hevc'
                ? (settings['encoding.hevc_quality'] || '95')
                : (settings['encoding.h264_vt_quality'] || '65')}
              onChange={(e) => onSave(
                codec === 'hevc' ? 'encoding.hevc_quality' : 'encoding.h264_vt_quality',
                e.target.value
              )}
            />
            <span className="text-[10px] text-zinc-600">
              0-100 scale. {codec === 'hevc' ? '95 = near-lossless.' : '65 = high quality streaming.'} Used with VideoToolbox.
            </span>
          </div>
        )}

        {/* Software encoding settings (CRF, preset, maxrate, bufsize) */}
        {isSoftware && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                <LabelWithTooltip
                  label="CRF"
                  tooltip="Constant Rate Factor controls quality vs file size. 0 = lossless, 18 = visually lossless, 23 = default, 28 = low quality. Each +6 roughly halves the file size. Used for software encoding."
                  className="label-tech"
                />
                <input
                  type="number"
                  className="input"
                  value={settings['encoding.h264_crf'] || '18'}
                  onChange={(e) => onSave('encoding.h264_crf', e.target.value)}
                />
                <span className="text-[10px] text-zinc-600">Lower = higher quality. 18 is visually lossless.</span>
              </div>

              <div className="flex flex-col gap-1">
                <LabelWithTooltip
                  label="Preset"
                  tooltip="Controls encoding speed vs compression efficiency. Slower presets produce smaller files at the same quality. 'slow' is a good balance."
                  className="label-tech"
                />
                <div className="relative">
                  <select
                    className="select w-full pr-8"
                    value={settings['encoding.h264_preset'] || 'slow'}
                    onChange={(e) => onSave('encoding.h264_preset', e.target.value)}
                  >
                    {['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow'].map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                <LabelWithTooltip
                  label="Max Bitrate"
                  tooltip="VBV maximum bitrate cap. Prevents bitrate spikes that could cause playback stuttering. 15M is good for 1080p, 40M for 4K."
                  className="label-tech"
                />
                <input
                  className="input"
                  value={settings['encoding.h264_maxrate'] || '15M'}
                  onChange={(e) => onSave('encoding.h264_maxrate', e.target.value)}
                />
                <span className="text-[10px] text-zinc-600">VBV maximum bitrate (e.g., 15M)</span>
              </div>

              <div className="flex flex-col gap-1">
                <LabelWithTooltip
                  label="Buffer Size"
                  tooltip="VBV buffer size controls how strictly the maxrate is enforced. Typically set to 2x the maxrate."
                  className="label-tech"
                />
                <input
                  className="input"
                  value={settings['encoding.h264_bufsize'] || '30M'}
                  onChange={(e) => onSave('encoding.h264_bufsize', e.target.value)}
                />
                <span className="text-[10px] text-zinc-600">VBV buffer size (e.g., 30M)</span>
              </div>
            </div>
          </>
        )}

        <div className="flex flex-col gap-1">
          <LabelWithTooltip
            label="FFV1 Threads"
            tooltip="Number of CPU threads for FFV1 lossless encoding. 0 = auto-detect (uses all available cores). FFV1 uses sliced threading for parallel encoding without quality loss."
            className="label-tech"
          />
          <input
            type="number"
            className="input"
            value={settings['encoding.ffv1_threads'] || '0'}
            onChange={(e) => onSave('encoding.ffv1_threads', e.target.value)}
          />
          <span className="text-[10px] text-zinc-600">0 = auto-detect CPU cores</span>
        </div>

        <div className="flex flex-col gap-1">
          <LabelWithTooltip
            label="Hardware Acceleration"
            tooltip="Use GPU encoding for much faster processing (2-8x). VideoToolbox (recommended on Mac) uses Apple's hardware encoder. Software gives the best quality-per-bit but is slower."
            className="label-tech"
          />
          <div className="relative">
            <select
              className="select w-full pr-8"
              value={hwAccel}
              onChange={(e) => onSave('encoding.hw_accel', e.target.value)}
            >
              <option value="videotoolbox">VideoToolbox (macOS) — Recommended</option>
              <option value="software">Software (libx265 / libx264)</option>
              <option value="auto">Auto-detect</option>
              <option value="qsv">Intel QSV</option>
              <option value="vaapi">VAAPI (Linux)</option>
              <option value="nvenc">NVENC (NVIDIA)</option>
            </select>
          </div>
        </div>
      </div>
    </Card>
  )
}

import React from 'react'
import { Card, Input, Select, TechLabel, Tooltip, LabelWithTooltip } from '../ui'

interface EncodingSettingsProps {
  settings: Record<string, string>
  onSave: (key: string, value: string) => void
}

export function EncodingSettings({ settings, onSave }: EncodingSettingsProps) {
  const codec = settings['encoding.codec'] || 'hevc'
  const hwAccel = settings['encoding.hw_accel'] || 'videotoolbox'
  const isSoftware = hwAccel === 'software'

  return (
    <Card>
      <TechLabel className="mb-4 block">Encoding Settings</TechLabel>

      <div className="space-y-4">
        {/* Streaming Codec */}
        <div className="flex flex-col gap-1">
          <LabelWithTooltip
            label="Streaming Codec"
            tooltip="HEVC (H.265) produces ~50% smaller files than H.264 at equivalent quality. All modern devices, Kodi, Plex, and Jellyfin support HEVC. Use H.264 only for legacy device compatibility."
            className="label-tech"
          />
          <div className="relative">
            <select
              className="select w-full pr-8"
              value={codec}
              onChange={(e) => onSave('encoding.codec', e.target.value)}
            >
              <option value="hevc">HEVC (H.265) — Recommended</option>
              <option value="h264">H.264 — Legacy compatibility</option>
            </select>
          </div>
        </div>

        {/* HEVC Quality (shown when codec is HEVC) */}
        {codec === 'hevc' && (
          <div className="flex flex-col gap-1">
            <LabelWithTooltip
              label="HEVC Quality"
              tooltip="VideoToolbox quality scale: 0-100 (higher = better). 95 is near-lossless with excellent compression. 85 is great quality at smaller files. 65 is good for streaming. Only applies to VideoToolbox hardware encoding."
              className="label-tech"
            />
            <input
              type="number"
              className="input"
              min={0}
              max={100}
              value={settings['encoding.hevc_quality'] || '95'}
              onChange={(e) => onSave('encoding.hevc_quality', e.target.value)}
            />
            <span className="text-[10px] text-zinc-600">0-100 scale. 95 = near-lossless. Used with VideoToolbox.</span>
          </div>
        )}

        {/* H.264 settings (shown when codec is h264 or software mode) */}
        {(codec === 'h264' || isSoftware) && (
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

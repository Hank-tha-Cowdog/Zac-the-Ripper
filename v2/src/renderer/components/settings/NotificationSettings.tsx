import React, { useState } from 'react'
import { Bell, Send } from 'lucide-react'
import { Card, Button, TechLabel, Toggle, LabelWithTooltip } from '../ui'

interface NotificationSettingsProps {
  settings: Record<string, string>
  onSave: (key: string, value: string) => void
}

export function NotificationSettings({ settings, onSave }: NotificationSettingsProps) {
  const [testStatus, setTestStatus] = useState<'idle' | 'sending' | 'success' | 'failed'>('idle')

  const enabled = settings['notifications.enabled'] === 'true'
  const topic = settings['notifications.ntfy_topic'] || ''
  const server = settings['notifications.ntfy_server'] || 'https://ntfy.sh'
  const onComplete = settings['notifications.on_complete'] !== 'false'
  const onFailure = settings['notifications.on_failure'] !== 'false'

  const handleTest = async () => {
    setTestStatus('sending')
    try {
      const result = await window.ztr.notify.test()
      setTestStatus(result.success ? 'success' : 'failed')
    } catch {
      setTestStatus('failed')
    }
    setTimeout(() => setTestStatus('idle'), 3000)
  }

  return (
    <Card>
      <div className="flex items-center gap-2 mb-4">
        <Bell className="w-4 h-4 text-purple-400" />
        <TechLabel>Notifications</TechLabel>
      </div>

      <div className="space-y-4">
        <Toggle
          checked={enabled}
          onChange={(v) => onSave('notifications.enabled', String(v))}
          label="Enable Push Notifications"
          description="Send notifications to your phone via ntfy when jobs complete or fail"
        />

        {enabled && (
          <>
            <div className="flex flex-col gap-1">
              <LabelWithTooltip
                label="ntfy Topic"
                tooltip="Pick any unique topic name (e.g. zac-ripper-zac). Subscribe to the same topic in the ntfy app on your phone. Anyone who knows the topic can see your notifications, so pick something hard to guess."
                className="label-tech"
              />
              <input
                className="input w-full"
                value={topic}
                onChange={(e) => onSave('notifications.ntfy_topic', e.target.value)}
                placeholder="zac-ripper-yourname"
              />
            </div>

            <div className="flex flex-col gap-1">
              <LabelWithTooltip
                label="ntfy Server"
                tooltip="The ntfy server URL. Use https://ntfy.sh for the free public server, or enter your own self-hosted ntfy instance URL."
                className="label-tech"
              />
              <input
                className="input w-full"
                value={server}
                onChange={(e) => onSave('notifications.ntfy_server', e.target.value)}
                placeholder="https://ntfy.sh"
              />
            </div>

            <div className="space-y-2">
              <Toggle
                checked={onComplete}
                onChange={(v) => onSave('notifications.on_complete', String(v))}
                label="On Complete"
                description="Notify when a rip or encode finishes successfully"
              />
              <Toggle
                checked={onFailure}
                onChange={(v) => onSave('notifications.on_failure', String(v))}
                label="On Failure"
                description="Notify when a rip or encode fails"
              />
            </div>

            <Button
              variant="secondary"
              size="sm"
              onClick={handleTest}
              disabled={!topic || testStatus === 'sending'}
            >
              <Send className="w-3.5 h-3.5 mr-1.5" />
              {testStatus === 'sending' ? 'Sending...' :
               testStatus === 'success' ? 'Sent! Check your phone' :
               testStatus === 'failed' ? 'Failed — check topic' :
               'Send Test Notification'}
            </Button>

            <p className="text-[10px] text-zinc-600 font-mono leading-relaxed">
              Install the ntfy app on your phone (iOS/Android), subscribe to the same topic name above, and you'll get push notifications when jobs finish.
            </p>
          </>
        )}
      </div>
    </Card>
  )
}

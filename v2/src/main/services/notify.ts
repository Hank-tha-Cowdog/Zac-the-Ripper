import { getSetting } from '../database/queries/settings'
import { createLogger } from '../util/logger'

const log = createLogger('notify')

interface NotifyOptions {
  title: string
  message: string
  priority?: 1 | 2 | 3 | 4 | 5
  tags?: string[]
}

export async function sendNotification(opts: NotifyOptions): Promise<boolean> {
  const enabled = getSetting('notifications.enabled') === 'true'
  if (!enabled) return false

  const topic = getSetting('notifications.ntfy_topic')
  if (!topic) {
    log.debug('Notification skipped — no ntfy topic configured')
    return false
  }

  const server = getSetting('notifications.ntfy_server') || 'https://ntfy.sh'
  const url = `${server.replace(/\/+$/, '')}/${encodeURIComponent(topic)}`

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Title': opts.title,
        'Priority': String(opts.priority || 3),
        ...(opts.tags?.length ? { 'Tags': opts.tags.join(',') } : {})
      },
      body: opts.message
    })

    if (!res.ok) {
      log.warn(`ntfy POST failed: ${res.status} ${res.statusText}`)
      return false
    }

    log.info(`Notification sent: "${opts.title}"`)
    return true
  } catch (err) {
    log.warn(`ntfy send failed: ${err}`)
    return false
  }
}

export async function notifyJobComplete(title: string, outputPath?: string): Promise<void> {
  if (getSetting('notifications.on_complete') !== 'true') return
  await sendNotification({
    title: `Rip Complete: ${title}`,
    message: outputPath
      ? `${title} has finished processing.\n${outputPath}`
      : `${title} has finished processing.`,
    priority: 3,
    tags: ['white_check_mark', 'movie_camera']
  })
}

export async function notifyJobFailed(title: string, error?: string): Promise<void> {
  if (getSetting('notifications.on_failure') !== 'true') return
  await sendNotification({
    title: `Rip Failed: ${title}`,
    message: error
      ? `${title} failed: ${error}`
      : `${title} failed with an unknown error.`,
    priority: 4,
    tags: ['x', 'warning']
  })
}

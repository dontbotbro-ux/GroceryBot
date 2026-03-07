import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { scrapeAllStores, stores as storeCatalog } from '../fetch-store-data.mjs'

const currentFile = fileURLToPath(import.meta.url)
const rootDir = path.resolve(path.dirname(currentFile), '../..')
const dataDir = path.join(rootDir, 'data')
const settingsFile = path.join(dataDir, 'notifier-settings.json')
const logsDir = path.join(dataDir, 'logs')
const feedFile = path.join(rootDir, 'public', 'store-data.json')
const runnerPath = path.join(rootDir, 'scripts', 'run-summary-job.mjs')
const launchAgentLabel = 'com.grobots.deal-summary'
const launchAgentPath = path.join(os.homedir(), 'Library', 'LaunchAgents', `${launchAgentLabel}.plist`)

const validStoreIds = storeCatalog.map((store) => store.id)
const weekdayMap = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
}

const weekdayOrder = Object.keys(weekdayMap)

function supportsMessagesAutomation() {
  return process.platform === 'darwin'
}

function formatTimestamp(value) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return 'Unknown'
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function xmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function normalizePhoneNumber(value = '') {
  const trimmed = String(value).trim()

  if (!trimmed) {
    return ''
  }

  const hasLeadingPlus = trimmed.startsWith('+')
  const digits = trimmed.replace(/\D/g, '')

  return hasLeadingPlus ? `+${digits}` : digits
}

function normalizeTime(value = '') {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value) ? value : '09:00'
}

function normalizeStoreIds(value) {
  const input = Array.isArray(value) ? value : validStoreIds
  const filtered = input.filter((storeId) => validStoreIds.includes(storeId))
  return filtered.length > 0 ? filtered : validStoreIds
}

function normalizeWeekdays(value, scheduleType) {
  const input = Array.isArray(value) ? value : []
  const filtered = weekdayOrder.filter((day) => input.includes(day))

  if (scheduleType === 'weekly') {
    return filtered.length > 0 ? filtered : ['MON']
  }

  return filtered.length > 0 ? filtered : ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
}

function normalizeSummaryMode(value) {
  return value === 'tracked' ? 'tracked' : 'all'
}

function normalizeScheduleType(value) {
  return value === 'weekly' ? 'weekly' : 'daily'
}

function normalizeWatchlist(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === 'string' && item.trim().length > 0)
    : []
}

function normalizeMaxDeals(value) {
  const parsed = Number(value)

  if (!Number.isFinite(parsed)) {
    return 3
  }

  return Math.min(8, Math.max(1, Math.round(parsed)))
}

export function createDefaultSettings() {
  return {
    enabled: false,
    phoneNumber: '',
    scheduleType: 'daily',
    weekdays: ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'],
    time: '09:00',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    summaryMode: 'all',
    maxDealsPerStore: 3,
    storeIds: validStoreIds,
    watchlistIds: [],
    lastSentAt: '',
    lastRefreshAt: '',
    lastError: '',
  }
}

export function sanitizeSettings(value = {}) {
  const defaults = createDefaultSettings()
  const scheduleType = normalizeScheduleType(value.scheduleType ?? defaults.scheduleType)

  return {
    enabled: Boolean(value.enabled),
    phoneNumber: normalizePhoneNumber(value.phoneNumber ?? defaults.phoneNumber),
    scheduleType,
    weekdays: normalizeWeekdays(value.weekdays ?? defaults.weekdays, scheduleType),
    time: normalizeTime(value.time ?? defaults.time),
    timezone: String(value.timezone || defaults.timezone),
    summaryMode: normalizeSummaryMode(value.summaryMode ?? defaults.summaryMode),
    maxDealsPerStore: normalizeMaxDeals(value.maxDealsPerStore ?? defaults.maxDealsPerStore),
    storeIds: normalizeStoreIds(value.storeIds ?? defaults.storeIds),
    watchlistIds: normalizeWatchlist(value.watchlistIds ?? defaults.watchlistIds),
    lastSentAt: typeof value.lastSentAt === 'string' ? value.lastSentAt : '',
    lastRefreshAt: typeof value.lastRefreshAt === 'string' ? value.lastRefreshAt : '',
    lastError: typeof value.lastError === 'string' ? value.lastError : '',
  }
}

async function ensureDataDir() {
  await fs.mkdir(dataDir, { recursive: true })
  await fs.mkdir(logsDir, { recursive: true })
}

async function writeSettingsFile(settings) {
  await ensureDataDir()
  await fs.writeFile(settingsFile, `${JSON.stringify(settings, null, 2)}\n`)
}

export async function readSettings() {
  try {
    const raw = await fs.readFile(settingsFile, 'utf8')
    return sanitizeSettings(JSON.parse(raw))
  } catch {
    return createDefaultSettings()
  }
}

function buildScheduleDescription(settings) {
  if (!settings.enabled) {
    return 'Disabled'
  }

  const [hour, minute] = settings.time.split(':').map(Number)
  const clock = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(2026, 0, 1, hour, minute))

  if (settings.scheduleType === 'daily') {
    return `Daily at ${clock}`
  }

  return `${settings.weekdays.join(', ')} at ${clock}`
}

export function buildStatusPayload(settings, extra = {}) {
  return {
    settings,
    platform: process.platform,
    supportsMessagesAutomation: supportsMessagesAutomation(),
    scheduleDescription: buildScheduleDescription(settings),
    launchAgentPath,
    ...extra,
  }
}

function buildLaunchSchedule(settings) {
  const [hour, minute] = settings.time.split(':').map(Number)

  if (settings.scheduleType === 'daily') {
    return [{ Hour: hour, Minute: minute }]
  }

  return settings.weekdays.map((day) => ({
    Weekday: weekdayMap[day],
    Hour: hour,
    Minute: minute,
  }))
}

function buildLaunchAgentPlist(settings) {
  const scheduleXml = buildLaunchSchedule(settings)
    .map(
      (interval) => `      <dict>
        ${Object.entries(interval)
          .map(([key, value]) => `<key>${key}</key><integer>${value}</integer>`)
          .join('')}
      </dict>`,
    )
    .join('\n')

  const stdoutPath = path.join(logsDir, 'summary-job.out.log')
  const stderrPath = path.join(logsDir, 'summary-job.err.log')

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(launchAgentLabel)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(process.execPath)}</string>
    <string>${xmlEscape(runnerPath)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(rootDir)}</string>
  <key>RunAtLoad</key>
  <false/>
  <key>StandardOutPath</key>
  <string>${xmlEscape(stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(stderrPath)}</string>
  <key>StartCalendarInterval</key>
  <array>
${scheduleXml}
  </array>
</dict>
</plist>
`
}

function runLaunchctl(args, allowFailure = false) {
  const result = spawnSync('launchctl', args, {
    encoding: 'utf8',
  })

  if (result.status !== 0 && !allowFailure) {
    const detail = result.stderr.trim() || result.stdout.trim() || 'Unknown launchctl error'
    throw new Error(detail)
  }

  return result
}

async function removeLaunchAgent() {
  if (!supportsMessagesAutomation()) {
    return
  }

  await fs.mkdir(path.dirname(launchAgentPath), { recursive: true })

  runLaunchctl(['bootout', `gui/${process.getuid()}`, launchAgentPath], true)

  try {
    await fs.unlink(launchAgentPath)
  } catch {
    // No existing launch agent to remove.
  }
}

export async function syncLaunchAgent(settings) {
  if (!supportsMessagesAutomation()) {
    return
  }

  if (!settings.enabled || !settings.phoneNumber) {
    await removeLaunchAgent()
    return
  }

  await ensureDataDir()
  await fs.mkdir(path.dirname(launchAgentPath), { recursive: true })
  await fs.writeFile(launchAgentPath, buildLaunchAgentPlist(settings))

  runLaunchctl(['bootout', `gui/${process.getuid()}`, launchAgentPath], true)
  runLaunchctl(['bootstrap', `gui/${process.getuid()}`, launchAgentPath])
}

export async function saveSettings(partialSettings) {
  const current = await readSettings()
  const merged = sanitizeSettings({ ...current, ...partialSettings })

  if (merged.enabled && !merged.phoneNumber) {
    throw new Error('A phone number is required before the schedule can be enabled.')
  }

  await writeSettingsFile(merged)
  await syncLaunchAgent(merged)
  return buildStatusPayload(merged)
}

export async function saveWatchlist(watchlistIds) {
  const current = await readSettings()
  const merged = sanitizeSettings({ ...current, watchlistIds })
  await writeSettingsFile(merged)
  return buildStatusPayload(merged)
}

async function readFeed() {
  try {
    const raw = await fs.readFile(feedFile, 'utf8')
    return JSON.parse(raw)
  } catch {
    return await scrapeAllStores()
  }
}

export function buildSummary(feed, settings) {
  const watchedIds = new Set(settings.watchlistIds)
  const selectedStores = feed.stores.filter((store) => settings.storeIds.includes(store.id))

  const sections = selectedStores
    .map((store) => {
      const scopedDeals =
        settings.summaryMode === 'tracked'
          ? store.deals.filter((deal) => watchedIds.has(deal.id))
          : store.deals

      const deals = scopedDeals.slice(0, settings.maxDealsPerStore)

      if (deals.length === 0) {
        return null
      }

      const lines = [store.name]

      for (const deal of deals) {
        const extras = [deal.previousPrice ? `was ${deal.previousPrice}` : '', deal.savings, deal.expires]
          .filter(Boolean)
          .join(', ')
        lines.push(`• ${deal.title} — ${deal.price}${extras ? ` (${extras})` : ''}`)
      }

      return lines.join('\n')
    })
    .filter(Boolean)

  const intro = [
    'grobots deal summary',
    `Refreshed ${formatTimestamp(feed.generatedAt)}`,
    settings.summaryMode === 'tracked' ? 'Mode: tracked deals only' : 'Mode: all selected store deals',
    '',
  ]

  if (sections.length === 0) {
    return `${intro.join('\n')}No matching deals were available for the current summary settings.`
  }

  const body = [...intro, ...sections, '', 'Sources were refreshed immediately before delivery.'].join('\n')
  return body.slice(0, 4000)
}

export async function previewSummary(partialSettings = {}) {
  const current = await readSettings()
  const settings = sanitizeSettings({ ...current, ...partialSettings })
  const feed = await readFeed()
  const summary = buildSummary(feed, settings)

  return {
    ...buildStatusPayload(settings),
    summary,
    feedGeneratedAt: feed.generatedAt,
  }
}

export function sendIMessage(phoneNumber, message) {
  if (!supportsMessagesAutomation()) {
    throw new Error('iMessage delivery is only supported on macOS.')
  }

  const script = `on run argv
set targetPhone to item 1 of argv
set messageText to item 2 of argv
tell application "Messages"
  set targetService to 1st service whose service type = iMessage
  set targetParticipant to participant targetPhone of targetService
  send messageText to targetParticipant
end tell
end run`

  const result = spawnSync('osascript', ['-', phoneNumber, message], {
    input: script,
    encoding: 'utf8',
  })

  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || 'Messages AppleScript failed.'
    throw new Error(detail)
  }
}

export async function runSummaryJob(partialSettings = {}) {
  const current = await readSettings()
  const settings = sanitizeSettings({ ...current, ...partialSettings })

  if (!settings.phoneNumber) {
    throw new Error('A phone number is required before sending a summary.')
  }

  const feed = await scrapeAllStores()
  const summary = buildSummary(feed, settings)
  sendIMessage(settings.phoneNumber, summary)

  const updated = sanitizeSettings({
    ...settings,
    lastSentAt: new Date().toISOString(),
    lastRefreshAt: feed.generatedAt,
    lastError: '',
  })

  await writeSettingsFile(updated)
  return {
    ...buildStatusPayload(updated),
    summary,
    feedGeneratedAt: feed.generatedAt,
  }
}

export async function markLastError(errorMessage) {
  const current = await readSettings()
  const updated = sanitizeSettings({
    ...current,
    lastError: errorMessage,
  })

  await writeSettingsFile(updated)
  return buildStatusPayload(updated)
}

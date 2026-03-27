import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const rootDir = process.cwd()
const publicDir = path.join(rootDir, 'public')
const feedPath = path.join(publicDir, 'store-data.json')
const catalogPath = path.join(publicDir, 'best-price-data.json')
const lookupMetaPath = path.join(publicDir, 'lookup', 'meta.json')
const outputPath = path.join(publicDir, 'source-intel.json')
const codexConfigPath = path.join(os.homedir(), '.codex', 'config.toml')
const firecrawlApiBaseUrl = process.env.FIRECRAWL_API_BASE_URL?.trim() || 'https://api.firecrawl.dev/v2'

const SOURCE_OVERRIDES = {
  aldi: {
    url: 'https://www.aldi.us/weekly-specials/this-weeks-aldi-finds',
  },
  kroger: {
    url: 'https://www.kroger.com/search?keyword=WDDShopAllProduct26021&query=WDDShopAllProduct26021&searchType=mktg%20attribute&monet=curated&fulfillment=all&pzn=relevance',
  },
  lidl: {
    url: 'https://www.lidl.com/mylidl-deals?category=all',
  },
  target: {
    url: 'https://www.target.com/c/grocery-deals/-/N-k4uyq',
  },
  walmart: {
    url: 'https://www.walmart.com/c/kp/groceries-deals',
  },
  wegmans: {
    url: 'https://www.wegmans.com/shop/featured/Hot_Zone_Prices',
  },
}

const HEADING_IGNORE = new Set([
  'all mylidl deals',
  'categories',
  'featured',
  'featured mylidl deals',
  'how would you like to shop',
  'shop for',
  "this week's aldi finds",
])

let cachedFirecrawlApiKey = ''
let firecrawlConfigLoaded = false

function normalizeText(value = '') {
  return String(value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
}

function titleCase(value = '') {
  return normalizeText(value)
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(' ')
}

async function getFirecrawlApiKey() {
  if (process.env.FIRECRAWL_API_KEY?.trim()) {
    return process.env.FIRECRAWL_API_KEY.trim()
  }

  if (firecrawlConfigLoaded) {
    return cachedFirecrawlApiKey
  }

  firecrawlConfigLoaded = true

  try {
    const config = await fs.readFile(codexConfigPath, 'utf8')
    const match = config.match(/\[mcp_servers\.firecrawl\.env\][\s\S]*?FIRECRAWL_API_KEY\s*=\s*"([^"]+)"/)
    cachedFirecrawlApiKey = match?.[1]?.trim() || ''
  } catch {
    cachedFirecrawlApiKey = ''
  }

  return cachedFirecrawlApiKey
}

async function scrapeMarkdown(url, apiKey) {
  const response = await fetch(`${firecrawlApiBaseUrl}/scrape`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      url,
      formats: ['markdown'],
      onlyMainContent: true,
      waitFor: 5000,
      maxAge: 0,
    }),
    signal: AbortSignal.timeout(90000),
  })

  if (!response.ok) {
    throw new Error(`Firecrawl returned ${response.status}`)
  }

  const payload = await response.json()

  return {
    markdown: String(payload?.data?.markdown ?? '').replace(/\u00a0/g, ' '),
    metadata: payload?.data?.metadata ?? {},
  }
}

function countCatalogItemsByStore(catalog) {
  const counts = new Map()

  for (const item of catalog.items ?? []) {
    counts.set(item.storeId, (counts.get(item.storeId) ?? 0) + 1)
  }

  return counts
}

function extractOfficialCount(storeId, markdown) {
  const patternsByStore = {
    kroger: [/\b([\d,]+)\s+results\b/i],
    target: [/\b([\d,]+)\s+results\b/i],
    walmart: [/\bgroceries deals\s*\(([\d,]+)\)/i, /\b([\d,]+)\s+results\b/i],
    wegmans: [],
    aldi: [],
    lidl: [],
  }

  for (const pattern of patternsByStore[storeId] ?? []) {
    const match = markdown.match(pattern)

    if (match?.[1]) {
      const parsed = Number(match[1].replace(/,/g, ''))

      if (Number.isFinite(parsed)) {
        return parsed
      }
    }
  }

  return null
}

function extractDateWindow(markdown) {
  const match = markdown.match(/\b(\d{1,2}\/\d{1,2}\/\d{4}\s*-\s*\d{1,2}\/\d{1,2}\/\d{4})\b/)
  return match?.[1] ?? ''
}

function extractLiveIssue(markdown) {
  const patterns = [
    /there was a problem displaying these items/i,
    /access denied/i,
    /please try again/i,
    /we're sorry/i,
  ]

  for (const pattern of patterns) {
    const match = markdown.match(pattern)

    if (match) {
      return normalizeText(match[0])
    }
  }

  return ''
}

function extractHighlightsFromHeadings(markdown) {
  const matches = markdown.match(/^##\s+\[?([^\]\n]+)\]?/gim) ?? []
  const highlights = []

  for (const rawMatch of matches) {
    const label = normalizeText(rawMatch.replace(/^##\s+/, '').replace(/^\[/, '').replace(/\]$/, ''))
    const normalized = label.toLowerCase()

    if (!label || HEADING_IGNORE.has(normalized)) {
      continue
    }

    if (!highlights.some((entry) => entry.toLowerCase() === normalized)) {
      highlights.push(titleCase(label))
    }
  }

  return highlights
}

function extractCategoryHighlights(store) {
  const categories = new Map()

  for (const deal of store.deals ?? []) {
    const label = normalizeText(deal.category)

    if (!label) {
      continue
    }

    categories.set(label, (categories.get(label) ?? 0) + 1)
  }

  return [...categories.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([label]) => label)
    .slice(0, 4)
}

function pickSummary(store, metadata, markdown) {
  const metadataDescription = normalizeText(metadata?.description ?? '')

  if (metadataDescription) {
    return metadataDescription
  }

  const firstMeaningfulLine =
    markdown
      .split('\n')
      .map((line) => normalizeText(line))
      .find((line) => line.length > 40 && !line.startsWith('#') && !line.startsWith('-') && !/^\d/.test(line)) ?? ''

  if (firstMeaningfulLine) {
    return firstMeaningfulLine
  }

  return store.sourceLabel
}

function buildOfficialSignal(officialCount, dateWindow, highlights, issue) {
  if (issue) {
    return 'Official source returned an error state'
  }

  if (officialCount !== null) {
    return `${officialCount.toLocaleString()} official results`
  }

  if (dateWindow) {
    return `Weekly window ${dateWindow}`
  }

  if (highlights.length > 0) {
    return `${highlights.slice(0, 3).join(' • ')}`
  }

  return 'Official source monitored'
}

function deriveStatus({ store, officialCount, scrapeIssue, hasSnapshot, indexedCount }) {
  const coveragePercent =
    officialCount && officialCount > 0 ? Math.round((indexedCount / officialCount) * 100) : null
  const coverageGap =
    officialCount && officialCount > indexedCount ? officialCount - indexedCount : 0

  if (scrapeIssue || store.status === 'partial') {
    return {
      status: 'partial',
      statusLabel: 'Needs review',
      statusReason: scrapeIssue || store.warning || 'The official source returned an incomplete state during the latest snapshot.',
      coveragePercent,
      coverageGap,
    }
  }

  if (!hasSnapshot) {
    return {
      status: 'watch',
      statusLabel: 'Signal fallback',
      statusReason: 'Firecrawl was unavailable during this build, so the command layer is showing feed-derived signals only.',
      coveragePercent,
      coverageGap,
    }
  }

  if (coveragePercent !== null && coveragePercent < 70) {
    return {
      status: 'watch',
      statusLabel: 'Coverage gap',
      statusReason: `The indexed catalog trails the official source signal by ${coverageGap.toLocaleString()} items.`,
      coveragePercent,
      coverageGap,
    }
  }

  if (coveragePercent !== null && coveragePercent > 130) {
    return {
      status: 'synced',
      statusLabel: 'Expanded coverage',
      statusReason: 'The published catalog is broader than the primary store landing page, which is expected when multiple official sources are combined.',
      coveragePercent,
      coverageGap,
    }
  }

  return {
    status: 'synced',
    statusLabel: 'Healthy',
    statusReason: 'The current catalog is aligned with the latest official source signal.',
    coveragePercent,
    coverageGap,
  }
}

async function main() {
  const [feed, catalog, lookupMeta, firecrawlApiKey, existingIntel] = await Promise.all([
    fs.readFile(feedPath, 'utf8').then((raw) => JSON.parse(raw)),
    fs.readFile(catalogPath, 'utf8').then((raw) => JSON.parse(raw)),
    fs.readFile(lookupMetaPath, 'utf8').then((raw) => JSON.parse(raw)).catch(() => null),
    getFirecrawlApiKey(),
    fs.readFile(outputPath, 'utf8').then((raw) => JSON.parse(raw)).catch(() => null),
  ])

  const catalogCounts = countCatalogItemsByStore(catalog)
  const sourceIntelStores = []

  for (const store of feed.stores ?? []) {
    const sourceUrl = SOURCE_OVERRIDES[store.id]?.url || store.sourceUrl
    const existingStore = existingIntel?.stores?.find((entry) => entry.id === store.id) ?? null
    let snapshot = null
    let scrapeIssue = ''

    if (firecrawlApiKey) {
      try {
        snapshot = await scrapeMarkdown(sourceUrl, firecrawlApiKey)
      } catch (error) {
        scrapeIssue = error instanceof Error ? error.message : 'Unable to load the official source.'
        console.warn(`[source-intel] ${store.name}: ${scrapeIssue}`)
      }
    }

    const markdown = snapshot?.markdown ?? ''
    const metadata = snapshot?.metadata ?? {}
    const officialCount = extractOfficialCount(store.id, markdown) ?? existingStore?.officialCount ?? null
    const dateWindow = extractDateWindow(markdown) || existingStore?.sourceWindow || ''
    const liveIssue = extractLiveIssue(markdown)
    const headingHighlights = extractHighlightsFromHeadings(markdown)
    const categoryHighlights = extractCategoryHighlights(store)
    const highlights = [...new Set([...headingHighlights, ...categoryHighlights, ...(existingStore?.highlights ?? [])])].slice(0, 4)
    const indexedCount = catalogCounts.get(store.id) ?? 0
    const hasStoredSignal = Boolean(existingStore?.snapshottedAt || existingStore?.officialSignal)

    if (!snapshot && existingStore) {
      const storedOfficialCount =
        typeof existingStore.officialCount === 'number' && Number.isFinite(existingStore.officialCount)
          ? existingStore.officialCount
          : null
      const coveragePercent =
        storedOfficialCount && storedOfficialCount > 0 ? Math.round((indexedCount / storedOfficialCount) * 100) : null
      const coverageGap = storedOfficialCount && storedOfficialCount > indexedCount ? storedOfficialCount - indexedCount : 0

      sourceIntelStores.push({
        ...existingStore,
        indexedCount,
        liveFeedCount: Array.isArray(store.deals) ? store.deals.length : 0,
        coveragePercent,
        coverageGap,
      })
      continue
    }

    const status = deriveStatus({
      store,
      officialCount,
      scrapeIssue: liveIssue || scrapeIssue,
      hasSnapshot: Boolean(snapshot) || hasStoredSignal,
      indexedCount,
    })
    const statusReason =
      !snapshot && hasStoredSignal && !liveIssue && !scrapeIssue
        ? `Using the last successful Firecrawl snapshot from ${existingStore.snapshottedAt || existingIntel.generatedAt}.`
        : status.statusReason

    sourceIntelStores.push({
      id: store.id,
      name: store.name,
      logo: store.logo,
      theme: store.theme,
      sourceUrl,
      sourceLabel: store.sourceLabel,
      officialTitle: normalizeText(metadata?.title ?? '') || existingStore?.officialTitle || store.sourceLabel,
      officialSummary: snapshot ? pickSummary(store, metadata, markdown) : existingStore?.officialSummary || pickSummary(store, metadata, markdown),
      officialCount,
      officialSignal:
        snapshot || !existingStore?.officialSignal
          ? buildOfficialSignal(officialCount, dateWindow, highlights, liveIssue || scrapeIssue)
          : existingStore.officialSignal,
      indexedCount,
      liveFeedCount: Array.isArray(store.deals) ? store.deals.length : 0,
      coveragePercent: status.coveragePercent,
      coverageGap: status.coverageGap,
      status: status.status,
      statusLabel: status.statusLabel,
      statusReason,
      highlights,
      sourceWindow: dateWindow,
      snapshottedAt: snapshot ? new Date().toISOString() : existingStore?.snapshottedAt || '',
    })
  }

  const storesNeedingAttention = sourceIntelStores.filter((store) => store.status !== 'synced').length
  const storesWithSignals = sourceIntelStores.filter(
    (store) =>
      Boolean(store.officialSignal) &&
      store.officialSignal !== 'Official source monitored' &&
      store.officialSignal !== 'Official source returned an error state',
  ).length
  const largestCoverageGapStore = [...sourceIntelStores]
    .filter((store) => Number.isFinite(store.coverageGap) && store.coverageGap > 0)
    .sort((left, right) => right.coverageGap - left.coverageGap)[0]

  const payload = {
    generatedAt: new Date().toISOString(),
    feedGeneratedAt: feed.generatedAt,
    catalogGeneratedAt: catalog.generatedAt,
    overview: {
      storesTracked: sourceIntelStores.length,
      storesWithSignals,
      storesNeedingAttention,
      totalCatalogItems: catalog.itemCount ?? 0,
      comparableOptionCount: lookupMeta?.comparableOptionCount ?? 0,
      largestCoverageGap: largestCoverageGapStore
        ? {
            storeId: largestCoverageGapStore.id,
            name: largestCoverageGapStore.name,
            gap: largestCoverageGapStore.coverageGap,
          }
        : null,
    },
    stores: sourceIntelStores,
  }

  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`)
  console.log(`[source-intel] wrote ${outputPath}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

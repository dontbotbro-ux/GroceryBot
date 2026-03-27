import axios from 'axios'
import { useDeferredValue, useEffect, useState, type CSSProperties } from 'react'

type Deal = {
  id: string
  title: string
  price: string
  previousPrice?: string
  savings?: string
  detail?: string
  expires?: string
  category?: string
  link?: string
  image?: string
}

type StoreData = {
  id: string
  name: string
  logo: string
  theme: string
  sourceUrl: string
  sourceLabel: string
  rangeLabel?: string
  fetchedAt: string
  status: 'ok' | 'partial'
  warning?: string
  deals: Deal[]
}

type StoreFeed = {
  generatedAt: string
  stores: StoreData[]
}

type LookupMatch = {
  storeId: string
  title: string
  price: string
  priceValue: number
  sourceLabel: string
  detail?: string
  link?: string
}

type LookupOption = {
  key: string
  title: string
  detail: string
  image?: string
  primaryStoreId: string
  searchTokens: string[]
  minPrice: number
  minPriceLabel: string
  storeCount: number
  matches: LookupMatch[]
}

type LookupMeta = {
  generatedAt: string
  itemCount: number
  optionCount: number
  comparableOptionCount: number
  lowestPrice: number | null
  shards: Array<{
    key: string
    optionCount: number
  }>
}

type LookupShard = {
  generatedAt: string
  shardKey: string
  optionCount: number
  options: LookupOption[]
}

type SourceIntelStore = {
  id: string
  name: string
  logo: string
  theme: string
  sourceUrl: string
  sourceLabel: string
  officialTitle: string
  officialSummary: string
  officialCount: number | null
  officialSignal: string
  indexedCount: number
  liveFeedCount: number
  coveragePercent: number | null
  coverageGap: number
  status: 'synced' | 'watch' | 'partial'
  statusLabel: string
  statusReason: string
  highlights: string[]
  sourceWindow: string
  snapshottedAt: string
}

type SourceIntel = {
  generatedAt: string
  feedGeneratedAt: string
  catalogGeneratedAt: string
  overview: {
    storesTracked: number
    storesWithSignals: number
    storesNeedingAttention: number
    totalCatalogItems: number
    comparableOptionCount: number
    largestCoverageGap: {
      storeId: string
      name: string
      gap: number
    } | null
  }
  stores: SourceIntelStore[]
}

type AppPage = 'command' | 'deals' | 'lookup' | 'summary' | 'watchlist'

type ScheduleType = 'daily' | 'weekly'
type SummaryMode = 'all' | 'tracked'
type Weekday = 'SUN' | 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT'

type NotifierSettings = {
  enabled: boolean
  phoneNumber: string
  scheduleType: ScheduleType
  weekdays: Weekday[]
  time: string
  timezone: string
  summaryMode: SummaryMode
  maxDealsPerStore: number
  storeIds: string[]
  watchlistIds: string[]
  lastSentAt: string
  lastRefreshAt: string
  lastError: string
}

type NotifierResponse = {
  settings: NotifierSettings
  platform: string
  supportsMessagesAutomation: boolean
  scheduleDescription: string
  launchAgentPath: string
  summary?: string
  feedGeneratedAt?: string
}

const WATCHLIST_KEY = 'grobots-watchlist-v1'
const NOTIFIER_API = 'http://127.0.0.1:8787/api'
const SUMMARY_SEND_API = 'http://localhost:3000/send-summary'
const LOOKUP_META_API = '/lookup/meta.json'
const LOOKUP_SHARD_DIR = '/lookup/shards'
const SOURCE_INTEL_API = '/source-intel.json'
const EMPTY_STORES: StoreData[] = []
const LOOKUP_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'brand',
  'by',
  'classic',
  'each',
  'family',
  'for',
  'form',
  'fresh',
  'good',
  'gather',
  'large',
  'organic',
  'original',
  'pack',
  'packs',
  'pk',
  'premium',
  'regular',
  'sold',
  'style',
  'the',
  'value',
])
const LOOKUP_UNIT_TOKENS = new Set([
  'ct',
  'count',
  'ea',
  'fl',
  'gal',
  'gallon',
  'gallons',
  'gm',
  'grams',
  'kg',
  'l',
  'lb',
  'lbs',
  'liter',
  'liters',
  'ml',
  'ounce',
  'ounces',
  'oz',
  'pack',
  'packs',
  'pint',
  'pints',
  'pk',
  'pt',
  'qt',
  'quart',
  'quarts',
])
const WEEKDAYS: Array<{ id: Weekday; label: string }> = [
  { id: 'SUN', label: 'Sun' },
  { id: 'MON', label: 'Mon' },
  { id: 'TUE', label: 'Tue' },
  { id: 'WED', label: 'Wed' },
  { id: 'THU', label: 'Thu' },
  { id: 'FRI', label: 'Fri' },
  { id: 'SAT', label: 'Sat' },
]

function readWatchlist(): string[] {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const value = window.localStorage.getItem(WATCHLIST_KEY)
    if (!value) {
      return []
    }

    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function createDefaultNotifierSettings(storeIds: string[]): NotifierSettings {
  return {
    enabled: false,
    phoneNumber: '',
    scheduleType: 'daily',
    weekdays: ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'],
    time: '09:00',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    summaryMode: 'all',
    maxDealsPerStore: 3,
    storeIds,
    watchlistIds: [],
    lastSentAt: '',
    lastRefreshAt: '',
    lastError: '',
  }
}

function formatTimestamp(value: string): string {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return 'Unknown'
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function normalizeLookupText(value = ''): string {
  return value
    .toLowerCase()
    .replace(/(\d+(?:\.\d+)?)\s*%/g, '$1pct ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function singularizeLookupToken(token: string): string {
  if (token.endsWith('ies') && token.length > 3) {
    return `${token.slice(0, -3)}y`
  }

  if (token.endsWith('s') && !token.endsWith('ss') && token.length > 3) {
    return token.slice(0, -1)
  }

  return token
}

function normalizeLookupCountToken(token: string): string {
  return token === 'dozen' ? '12ct' : token
}

function buildLookupQueryTokens(value = ''): string[] {
  return normalizeLookupText(value)
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => normalizeLookupCountToken(singularizeLookupToken(token)))
    .filter((token) => !LOOKUP_STOPWORDS.has(token))
    .filter((token) => !LOOKUP_UNIT_TOKENS.has(token))
    .filter((token) => !/^\d+(?:\.\d+)?$/.test(token))
}

function getLookupShardKey(token = ''): string {
  const normalized = normalizeLookupText(token)

  if (!normalized) {
    return 'misc'
  }

  const firstCharacter = normalized[0]
  return /[a-z0-9]/.test(firstCharacter) ? firstCharacter : 'misc'
}

function dealQualityScore(deal: Deal): number {
  let score = 0

  if (deal.link) {
    score += 4
  }

  if (deal.image) {
    score += 3
  }

  if (deal.previousPrice) {
    score += 2
  }

  if (deal.savings) {
    score += 2
  }

  if (deal.expires) {
    score += 1
  }

  score += Math.min((deal.detail || '').trim().length, 80) / 80
  return score
}

function dedupeDealCards(deals: Deal[]): Deal[] {
  const byKey = new Map<string, Deal>()

  for (const deal of deals) {
    const normalizedTitle = deal.title.trim().toLowerCase()
    const normalizedPrice = deal.price.trim().toLowerCase()
    const key = `${normalizedTitle}::${normalizedPrice}`
    const current = byKey.get(key)

    if (!current) {
      byKey.set(key, deal)
      continue
    }

    const currentScore = dealQualityScore(current)
    const candidateScore = dealQualityScore(deal)
    const preferred = candidateScore > currentScore ? deal : current
    const fallback = preferred === deal ? current : deal

    byKey.set(key, {
      ...fallback,
      ...preferred,
      previousPrice: preferred.previousPrice || fallback.previousPrice,
      savings: preferred.savings || fallback.savings,
      detail: preferred.detail || fallback.detail,
      expires: preferred.expires || fallback.expires,
      category: preferred.category || fallback.category,
      link: preferred.link || fallback.link,
      image: preferred.image || fallback.image,
    })
  }

  return [...byKey.values()]
}

function buildSearchHaystack(store: StoreData, deal: Deal): string {
  return [
    store.name,
    deal.title,
    deal.price,
    deal.previousPrice,
    deal.savings,
    deal.detail,
    deal.expires,
    deal.category,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

function matchesSearch(store: StoreData, deal: Deal, query: string): boolean {
  if (!query) {
    return true
  }

  return buildSearchHaystack(store, deal).includes(query)
}

function getTileImage(deal: Deal, store: StoreData) {
  return {
    src: deal.image || store.logo,
    alt: deal.image ? deal.title : `${store.name} logo`,
  }
}

function buildDealSummary(feed: StoreFeed, storeIds: string[]): string {
  const selectedStoreIds = storeIds.length > 0 ? new Set(storeIds) : null
  const sections = feed.stores
    .filter((store) => (selectedStoreIds ? selectedStoreIds.has(store.id) : true))
    .map((store) => {
      const deals = dedupeDealCards(store.deals).slice(0, 3)

      if (deals.length === 0) {
        return ''
      }

      const lines = deals.map((deal) => `- ${deal.title}: ${deal.price}`)
      return [store.name, ...lines].join('\n')
    })
    .filter(Boolean)

  if (sections.length === 0) {
    return `grobots deal summary\nUpdated ${formatTimestamp(feed.generatedAt)}\n\nNo current deals were available.`
  }

  return [`grobots deal summary`, `Updated ${formatTimestamp(feed.generatedAt)}`, '', ...sections].join('\n\n')
}

async function fetchNotifierSettings() {
  return apiRequest<NotifierResponse>('/settings')
}

async function apiRequest<T>(pathname: string, options?: RequestInit): Promise<T> {
  let response: Response

  try {
    response = await fetch(`${NOTIFIER_API}${pathname}`, {
      headers: {
        'Content-Type': 'application/json',
        ...(options?.headers ?? {}),
      },
      ...options,
    })
  } catch {
    throw new Error('The local notifier service is unreachable. Start `npm run notifier:service` on the Mac that owns Messages.')
  }

  const payload = (await response.json()) as T & { error?: string }

  if (!response.ok) {
    throw new Error(payload.error || 'The notifier service request failed.')
  }

  return payload
}

export default function App() {
  const [feed, setFeed] = useState<StoreFeed | null>(null)
  const [sourceIntel, setSourceIntel] = useState<SourceIntel | null>(null)
  const [sourceIntelLoading, setSourceIntelLoading] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activePage, setActivePage] = useState<AppPage>('command')
  const [search, setSearch] = useState('')
  const [bestPriceQuery, setBestPriceQuery] = useState('')
  const [bestPriceSelection, setBestPriceSelection] = useState('')
  const [lookupMeta, setLookupMeta] = useState<LookupMeta | null>(null)
  const [lookupMetaLoading, setLookupMetaLoading] = useState(false)
  const [lookupShards, setLookupShards] = useState<Record<string, LookupOption[]>>({})
  const [lookupShardLoading, setLookupShardLoading] = useState(false)
  const [bestPriceError, setBestPriceError] = useState('')
  const [activeStore, setActiveStore] = useState('all')
  const [watchOnly, setWatchOnly] = useState(false)
  const [watchlist, setWatchlist] = useState<string[]>(readWatchlist)

  const [notifierSettings, setNotifierSettings] = useState<NotifierSettings>(() => createDefaultNotifierSettings([]))
  const [notifierOnline, setNotifierOnline] = useState(false)
  const [notifierLoading, setNotifierLoading] = useState(true)
  const [notifierBusy, setNotifierBusy] = useState(false)
  const [notifierMessage, setNotifierMessage] = useState('')
  const [notifierError, setNotifierError] = useState('')
  const [notifierSummary, setNotifierSummary] = useState('')
  const [scheduleDescription, setScheduleDescription] = useState('Disabled')
  const isRemoteOrigin =
    typeof window !== 'undefined' && !['localhost', '127.0.0.1'].includes(window.location.hostname)

  useEffect(() => {
    let cancelled = false

    async function loadFeed() {
      try {
        setLoading(true)
        const response = await fetch('/store-data.json', { cache: 'no-store' })

        if (!response.ok) {
          throw new Error(`Failed to load store feed (${response.status})`)
        }

        const data = (await response.json()) as StoreFeed

        if (!cancelled) {
          setFeed(data)
          setError('')
        }
      } catch (loadError) {
        if (!cancelled) {
          const message = loadError instanceof Error ? loadError.message : 'Unable to load the store feed.'
          setError(message)
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void loadFeed()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadSourceIntel() {
      try {
        setSourceIntelLoading(true)
        const response = await fetch(SOURCE_INTEL_API, { cache: 'no-store' })

        if (!response.ok) {
          throw new Error(`Failed to load source intelligence (${response.status})`)
        }

        const data = (await response.json()) as SourceIntel

        if (!cancelled) {
          setSourceIntel(data)
        }
      } catch {
        if (!cancelled) {
          setSourceIntel(null)
        }
      } finally {
        if (!cancelled) {
          setSourceIntelLoading(false)
        }
      }
    }

    void loadSourceIntel()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    window.localStorage.setItem(WATCHLIST_KEY, JSON.stringify(watchlist))
  }, [watchlist])

  useEffect(() => {
    let cancelled = false

    async function loadNotifier() {
      try {
        const payload = await fetchNotifierSettings()

        if (!cancelled) {
          setNotifierSettings(payload.settings)
          setScheduleDescription(payload.scheduleDescription)
          setNotifierOnline(true)
          setNotifierError('')
        }
      } catch {
        if (!cancelled) {
          setNotifierOnline(false)
        }
      } finally {
        if (!cancelled) {
          setNotifierLoading(false)
        }
      }
    }

    void loadNotifier()

    return () => {
      cancelled = true
    }
  }, [])

  const stores = feed?.stores ?? EMPTY_STORES
  const displayStores = stores.map((store) => ({
    ...store,
    deals: dedupeDealCards(store.deals),
  }))
  const sourceIntelStores = sourceIntel?.stores ?? []
  const sourceIntelById = new Map(sourceIntelStores.map((store) => [store.id, store]))

  useEffect(() => {
    if (stores.length === 0) {
      return
    }

    setNotifierSettings((current) => {
      const nextStoreIds =
        current.storeIds.length > 0
          ? current.storeIds.filter((storeId) => stores.some((store) => store.id === storeId))
          : stores.map((store) => store.id)

      return {
        ...current,
        storeIds: nextStoreIds.length > 0 ? nextStoreIds : stores.map((store) => store.id),
        watchlistIds: watchlist,
      }
    })
  }, [stores, watchlist])

  useEffect(() => {
    if (!notifierOnline) {
      return
    }

    void apiRequest<NotifierResponse>('/watchlist', {
      method: 'POST',
      body: JSON.stringify({
        watchlistIds: watchlist,
      }),
    }).catch(() => {
      // Ignore transient sync issues and keep the UI responsive.
    })
  }, [notifierOnline, watchlist])

  const normalizedQuery = search.trim().toLowerCase()
  const deferredBestPriceQuery = useDeferredValue(bestPriceQuery)
  const normalizedBestPriceQuery = normalizeLookupText(deferredBestPriceQuery)
  const bestPriceTokens = buildLookupQueryTokens(deferredBestPriceQuery)
  const bestPriceLoading = lookupMetaLoading || lookupShardLoading
  const storesById = new Map(displayStores.map((store) => [store.id, store]))
  const requiredLookupShardKeys = bestPriceTokens.length > 0 ? [...new Set(bestPriceTokens.map(getLookupShardKey))] : []
  const requiredLookupShardSignature = requiredLookupShardKeys.join('|')

  useEffect(() => {
    if (lookupMeta || bestPriceError) {
      return
    }

    let cancelled = false

    async function loadLookupMeta() {
      try {
        setLookupMetaLoading(true)
        const response = await fetch(LOOKUP_META_API, { cache: 'force-cache' })

        if (!response.ok) {
          throw new Error(`Failed to load lookup metadata (${response.status})`)
        }

        const data = (await response.json()) as LookupMeta

        if (!cancelled) {
          setLookupMeta(data)
          setBestPriceError('')
        }
      } catch (loadError) {
        if (!cancelled) {
          setBestPriceError(
            loadError instanceof Error ? loadError.message : 'Unable to load the lookup metadata.',
          )
        }
      } finally {
        if (!cancelled) {
          setLookupMetaLoading(false)
        }
      }
    }

    void loadLookupMeta()

    return () => {
      cancelled = true
    }
  }, [bestPriceError, lookupMeta])

  useEffect(() => {
    if (!lookupMeta || !requiredLookupShardSignature) {
      return
    }

    const requestedShardKeys = requiredLookupShardSignature.split('|').filter(Boolean)
    const missingShardKeys = requestedShardKeys.filter((shardKey) => !lookupShards[shardKey])

    if (missingShardKeys.length === 0) {
      return
    }

    let cancelled = false

    async function loadLookupShards() {
      try {
        setLookupShardLoading(true)
        const loadedShards = await Promise.all(
          missingShardKeys.map(async (shardKey) => {
            const response = await fetch(`${LOOKUP_SHARD_DIR}/${shardKey}.json`, { cache: 'force-cache' })

            if (!response.ok) {
              throw new Error(`Failed to load lookup shard ${shardKey} (${response.status})`)
            }

            const data = (await response.json()) as LookupShard
            return [shardKey, data.options] as const
          }),
        )

        if (!cancelled) {
          setLookupShards((current) => {
            const next = { ...current }

            for (const [shardKey, options] of loadedShards) {
              next[shardKey] = options
            }

            return next
          })
          setBestPriceError('')
        }
      } catch (loadError) {
        if (!cancelled) {
          setBestPriceError(
            loadError instanceof Error ? loadError.message : 'Unable to load matching product shards.',
          )
        }
      } finally {
        if (!cancelled) {
          setLookupShardLoading(false)
        }
      }
    }

    void loadLookupShards()

    return () => {
      cancelled = true
    }
  }, [lookupMeta, lookupShards, requiredLookupShardSignature])

  const filteredStores = displayStores
    .filter((store) => activeStore === 'all' || store.id === activeStore)
    .map((store) => ({
      ...store,
      deals: store.deals.filter((deal) => {
        const isTracked = watchlist.includes(deal.id)

        if (watchOnly && !isTracked) {
          return false
        }

        return matchesSearch(store, deal, normalizedQuery)
      }),
    }))
    .filter((store) => store.deals.length > 0 || (!normalizedQuery && !watchOnly))
  const visibleDealStores = activeStore === 'all' ? [] : filteredStores

  const watchlistDeals = displayStores.flatMap((store) =>
    store.deals
      .filter((deal) => watchlist.includes(deal.id))
      .map((deal) => ({
        store,
        deal,
      })),
  )

  const totalDeals = displayStores.reduce((sum, store) => sum + store.deals.length, 0)
  const indexedCatalogItems = sourceIntel?.overview.totalCatalogItems ?? totalDeals
  const sourceSignalsCaptured = sourceIntel?.overview.storesWithSignals ?? 0
  const attentionStoreCount =
    sourceIntel?.overview.storesNeedingAttention ??
    displayStores.filter((store) => store.status === 'partial').length
  const largestCoverageGap = sourceIntel?.overview.largestCoverageGap ?? null
  const attentionStores = [...sourceIntelStores]
    .filter((store) => store.status !== 'synced')
    .sort(
      (left, right) =>
        Number(right.status === 'partial') - Number(left.status === 'partial') ||
        right.coverageGap - left.coverageGap ||
        left.name.localeCompare(right.name),
    )
  const commandStores =
    sourceIntelStores.length > 0
      ? sourceIntelStores
      : displayStores.map((store) => ({
          id: store.id,
          name: store.name,
          logo: store.logo,
          theme: store.theme,
          sourceUrl: store.sourceUrl,
          sourceLabel: store.sourceLabel,
          officialTitle: store.sourceLabel,
          officialSummary: store.rangeLabel || store.sourceLabel,
          officialCount: null,
          officialSignal: 'Firecrawl signal loading',
          indexedCount: store.deals.length,
          liveFeedCount: store.deals.length,
          coveragePercent: null,
          coverageGap: 0,
          status: store.status === 'partial' ? 'partial' : 'watch',
          statusLabel: store.status === 'partial' ? 'Needs review' : 'Feed only',
          statusReason:
            store.warning || 'The command layer is waiting for the latest official-source snapshot for this retailer.',
          highlights: store.deals
            .map((deal) => deal.category)
            .filter((value): value is string => Boolean(value))
            .slice(0, 3),
          sourceWindow: '',
          snapshottedAt: '',
        }))
  const comparableLookupCount = lookupMeta?.comparableOptionCount ?? 0
  const lowestIndexedPrice =
    lookupMeta?.lowestPrice !== null && lookupMeta?.lowestPrice !== undefined
      ? lookupMeta.lowestPrice
      : Number.POSITIVE_INFINITY
  const loadedLookupOptions = Array.from(
    requiredLookupShardKeys.reduce<Map<string, LookupOption>>((optionsByKey, shardKey) => {
      for (const option of lookupShards[shardKey] ?? []) {
        if (!optionsByKey.has(option.key)) {
          optionsByKey.set(option.key, option)
        }
      }

      return optionsByKey
    }, new Map()).values(),
  )
  const allLoadedLookupOptions = Array.from(
    Object.values(lookupShards).reduce<Map<string, LookupOption>>((optionsByKey, options) => {
      for (const option of options) {
        if (!optionsByKey.has(option.key)) {
          optionsByKey.set(option.key, option)
        }
      }

      return optionsByKey
    }, new Map()).values(),
  )
  const bestPriceOptions = loadedLookupOptions
    .filter(
      (option) =>
        bestPriceTokens.length > 0 &&
        bestPriceTokens.every((token) => option.searchTokens.includes(token)),
    )
    .sort(
      (left, right) => {
        const leftTitle = normalizeLookupText(left.title)
        const rightTitle = normalizeLookupText(right.title)
        const leftExact = Number(leftTitle === normalizedBestPriceQuery)
        const rightExact = Number(rightTitle === normalizedBestPriceQuery)

        if (leftExact !== rightExact) {
          return rightExact - leftExact
        }

        const leftStartsWith = Number(leftTitle.startsWith(normalizedBestPriceQuery))
        const rightStartsWith = Number(rightTitle.startsWith(normalizedBestPriceQuery))

        if (leftStartsWith !== rightStartsWith) {
          return rightStartsWith - leftStartsWith
        }

        return (
          left.minPrice - right.minPrice ||
          right.storeCount - left.storeCount ||
          left.title.localeCompare(right.title)
        )
      },
    )
    .slice(0, 8)

  const selectedLookupOption =
    allLoadedLookupOptions.find((option) => option.key === bestPriceSelection) ?? null
  const selectedLookupMatches = selectedLookupOption?.matches ?? null
  const bestPriceMatches = (selectedLookupMatches ?? [])
    .map((item) => {
      const store = storesById.get(item.storeId)

      if (!store) {
        return null
      }

      return {
        store,
        item,
        numericPrice: item.priceValue,
      }
    })
    .filter(
      (
        result,
      ): result is {
        store: StoreData
        item: LookupMatch
        numericPrice: number
      } => result !== null && Number.isFinite(result.numericPrice),
    )
    .sort(
      (left, right) =>
        left.numericPrice - right.numericPrice ||
        left.item.title.localeCompare(right.item.title) ||
        left.store.name.localeCompare(right.store.name),
    )
  const bestPriceWinner = bestPriceMatches[0] ?? null
  const bestPriceShortlist = bestPriceMatches.slice(0, 6)
  const bestPriceCrossChecks = Array.from(
    bestPriceMatches.reduce<
      Map<
        string,
        {
          store: StoreData
          item: LookupMatch
          numericPrice: number
        }
      >
    >((matchesByStore, match) => {
      if (matchesByStore.has(match.store.id) || !match.item.link) {
        return matchesByStore
      }

      matchesByStore.set(match.store.id, match)
      return matchesByStore
    }, new Map()).values(),
  )
  const bestPriceComparisonLoading =
    Boolean(bestPriceSelection) && lookupShardLoading && selectedLookupMatches === null

  function toggleWatch(id: string) {
    setWatchlist((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
  }

  function updateNotifier<K extends keyof NotifierSettings>(key: K, value: NotifierSettings[K]) {
    setNotifierSettings((current) => ({
      ...current,
      [key]: value,
    }))
  }

  function toggleWeekday(day: Weekday) {
    setNotifierSettings((current) => ({
      ...current,
      weekdays: current.weekdays.includes(day)
        ? current.weekdays.filter((item) => item !== day)
        : [...current.weekdays, day],
    }))
  }

  function toggleNotifierStore(storeId: string) {
    setNotifierSettings((current) => ({
      ...current,
      storeIds: current.storeIds.includes(storeId)
        ? current.storeIds.filter((item) => item !== storeId)
        : [...current.storeIds, storeId],
    }))
  }

  function openStoreFeed(storeId: string) {
    setActiveStore(storeId)
    setActivePage('deals')
  }

  async function retryNotifierConnection() {
    try {
      setNotifierLoading(true)
      setNotifierError('')
      const payload = await fetchNotifierSettings()
      setNotifierSettings(payload.settings)
      setScheduleDescription(payload.scheduleDescription)
      setNotifierOnline(true)
      setNotifierMessage('Local notifier connected.')
    } catch (connectionError) {
      setNotifierOnline(false)
      setNotifierError(
        connectionError instanceof Error ? connectionError.message : 'Unable to reach the local notifier service.',
      )
    } finally {
      setNotifierLoading(false)
    }
  }

  async function saveNotifierSettings() {
    if (!notifierOnline) {
      setNotifierError('The iMessage notifier is offline. Start `npm run notifier:service` on your Mac to save or schedule summaries.')
      return
    }

    try {
      setNotifierBusy(true)
      setNotifierError('')
      const payload = await apiRequest<NotifierResponse>('/settings', {
        method: 'POST',
        body: JSON.stringify({
          ...notifierSettings,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          watchlistIds: watchlist,
        }),
      })

      setNotifierOnline(true)
      setNotifierSettings(payload.settings)
      setScheduleDescription(payload.scheduleDescription)
      setNotifierMessage('Summary settings saved. Scheduled sends will refresh deals immediately before delivery.')
    } catch (saveError) {
      setNotifierError(saveError instanceof Error ? saveError.message : 'Unable to save the notifier settings.')
    } finally {
      setNotifierBusy(false)
    }
  }

  async function previewNotifierSummary() {
    if (!notifierOnline) {
      setNotifierError('The iMessage notifier is offline. Start `npm run notifier:service` on your Mac to preview summaries.')
      return
    }

    try {
      setNotifierBusy(true)
      setNotifierError('')
      const payload = await apiRequest<NotifierResponse>('/preview', {
        method: 'POST',
        body: JSON.stringify({
          ...notifierSettings,
          watchlistIds: watchlist,
        }),
      })

      setNotifierOnline(true)
      setNotifierSettings(payload.settings)
      setScheduleDescription(payload.scheduleDescription)
      setNotifierSummary(payload.summary || '')
      setNotifierMessage(`Preview generated from the latest stored feed (${formatTimestamp(payload.feedGeneratedAt || '')}).`)
    } catch (previewError) {
      setNotifierError(previewError instanceof Error ? previewError.message : 'Unable to preview the summary.')
    } finally {
      setNotifierBusy(false)
    }
  }

  async function sendNotifierNow() {
    if (!notifierSettings.phoneNumber.trim()) {
      setNotifierError('Enter an iMessage phone number before sending a summary.')
      return
    }

    try {
      setNotifierBusy(true)
      setNotifierError('')
      const response = await fetch('/store-data.json', { cache: 'no-store' })

      if (!response.ok) {
        throw new Error(`Failed to refresh the store feed (${response.status}).`)
      }

      const latestFeed = (await response.json()) as StoreFeed
      const summary = buildDealSummary(latestFeed, notifierSettings.storeIds)

      await axios.post(SUMMARY_SEND_API, {
        phoneNumber: notifierSettings.phoneNumber.trim(),
        summary,
      })

      setNotifierOnline(true)
      setNotifierSummary(summary)
      setNotifierMessage(`Summary sent from the latest feed at ${formatTimestamp(latestFeed.generatedAt)}.`)
    } catch (sendError) {
      if (axios.isAxiosError(sendError)) {
        setNotifierOnline(false)
        const serviceError =
          typeof sendError.response?.data === 'object' &&
          sendError.response?.data !== null &&
          'error' in sendError.response.data &&
          typeof sendError.response.data.error === 'string'
            ? sendError.response.data.error
            : ''
        setNotifierError(serviceError || sendError.message || 'Unable to send the summary.')
      } else {
        setNotifierError(sendError instanceof Error ? sendError.message : 'Unable to send the summary.')
      }
    } finally {
      setNotifierBusy(false)
    }
  }

  return (
    <div className="page-shell">
      <header className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Scraped from official store pages</p>
          <h1>grobots</h1>
          <p className="hero-text">
            Firecrawl-backed grocery intelligence for Wegmans, Walmart, Aldi, Lidl, Target, and Kroger.
            Monitor source health, spot coverage gaps, compare products, and push a clean iMessage summary
            without digging through retailer sites one by one.
          </p>
        </div>

        <div className="hero-stats">
          <article className="metric-card">
            <span className="metric-label">Retailers monitored</span>
            <strong>{stores.length || 6}</strong>
          </article>
          <article className="metric-card">
            <span className="metric-label">Catalog items indexed</span>
            <strong>{indexedCatalogItems.toLocaleString()}</strong>
          </article>
          <article className="metric-card">
            <span className="metric-label">Official source signals</span>
            <strong>{sourceIntelLoading ? 'Refreshing...' : sourceSignalsCaptured.toLocaleString()}</strong>
          </article>
          <article className="metric-card">
            <span className="metric-label">Stores needing attention</span>
            <strong>{attentionStoreCount.toLocaleString()}</strong>
          </article>
        </div>
      </header>

      <main className="content-shell">
        <nav className="page-tabs" aria-label="Primary workspace tabs">
          <button
            type="button"
            className={`page-tab ${activePage === 'command' ? 'is-active' : ''}`}
            onClick={() => setActivePage('command')}
          >
            Command center
          </button>
          <button
            type="button"
            className={`page-tab ${activePage === 'deals' ? 'is-active' : ''}`}
            onClick={() => setActivePage('deals')}
          >
            Deals feed
          </button>
          <button
            type="button"
            className={`page-tab ${activePage === 'lookup' ? 'is-active' : ''}`}
            onClick={() => setActivePage('lookup')}
          >
            Cross-store lookup
          </button>
          <button
            type="button"
            className={`page-tab ${activePage === 'summary' ? 'is-active' : ''}`}
            onClick={() => setActivePage('summary')}
          >
            iMessage summary
          </button>
          <button
            type="button"
            className={`page-tab ${activePage === 'watchlist' ? 'is-active' : ''}`}
            onClick={() => setActivePage('watchlist')}
          >
            Watchlist
          </button>
        </nav>

        {activePage === 'command' ? (
          <section className="page-panel">
            <div className="page-panel-header">
              <div>
                <p className="section-kicker">Command center</p>
                <h2>Executive grocery snapshot</h2>
              </div>
              <p>
                Firecrawl snapshots of the official store pages, indexed catalog coverage, and the fastest next
                actions for price checks, store review, and summary delivery.
              </p>
            </div>

            <section className="command-shell">
              <section className="command-metrics" aria-label="Executive metrics">
                <article className="command-metric-card">
                  <span className="lookup-brief-label">Feed refresh</span>
                  <strong>{feed ? formatTimestamp(feed.generatedAt) : 'Loading...'}</strong>
                  <p>The published store feed and price index were last rebuilt at this time.</p>
                </article>
                <article className="command-metric-card">
                  <span className="lookup-brief-label">Coverage gap</span>
                  <strong>
                    {largestCoverageGap
                      ? `${largestCoverageGap.name} +${largestCoverageGap.gap.toLocaleString()}`
                      : 'No major gap'}
                  </strong>
                  <p>The biggest delta between the indexed catalog and the current official source signal.</p>
                </article>
                <article className="command-metric-card">
                  <span className="lookup-brief-label">Cross-store groups</span>
                  <strong>{lookupMeta ? lookupMeta.optionCount.toLocaleString() : 'Indexing...'}</strong>
                  <p>Grouped products available for exact-item comparison without loading the entire catalog in-browser.</p>
                </article>
                <article className="command-metric-card">
                  <span className="lookup-brief-label">Lowest indexed floor</span>
                  <strong>{Number.isFinite(lowestIndexedPrice) ? `$${lowestIndexedPrice.toFixed(2)}` : 'N/A'}</strong>
                  <p>The current lowest indexed price across the tracked assortment.</p>
                </article>
              </section>

              {sourceIntelLoading ? (
                <div className="empty-state compact-state">Refreshing official source snapshots for the command center...</div>
              ) : null}

              <section className="command-layout">
                <div className="command-main">
                  <section className="command-panel-card">
                    <div className="section-heading">
                      <div>
                        <p className="section-kicker">Source health</p>
                        <h2>Retailer command board</h2>
                      </div>
                      <p>
                        Official source signals are captured with Firecrawl, then compared with the indexed catalog that powers lookup and the live feed.
                      </p>
                    </div>

                    <div className="command-store-grid">
                      {commandStores.map((store) => (
                        <article key={store.id} className="command-store-card">
                          <div className="command-store-top">
                            <div className="store-heading">
                              <img src={store.logo} alt={`${store.name} logo`} className="store-logo" />
                              <div>
                                <h3>{store.name}</h3>
                                <p>{store.officialTitle}</p>
                              </div>
                            </div>
                            <span className={`status-badge status-${store.status}`}>{store.statusLabel}</span>
                          </div>

                          <p className="command-store-summary">{store.officialSummary}</p>

                          <div className="command-store-metrics">
                            <div>
                              <span>Indexed</span>
                              <strong>{store.indexedCount.toLocaleString()}</strong>
                            </div>
                            <div>
                              <span>Official signal</span>
                              <strong>{store.officialSignal}</strong>
                            </div>
                            <div>
                              <span>Coverage</span>
                              <strong>
                                {store.coveragePercent !== null ? `${store.coveragePercent}%` : `${store.liveFeedCount} live cards`}
                              </strong>
                            </div>
                          </div>

                          <p className="command-store-reason">{store.statusReason}</p>

                          {store.highlights.length > 0 ? (
                            <div className="command-highlight-row">
                              {store.highlights.map((highlight) => (
                                <span key={highlight} className="deal-tag">
                                  {highlight}
                                </span>
                              ))}
                            </div>
                          ) : null}

                          <div className="command-actions">
                            <button type="button" className="store-jump" onClick={() => openStoreFeed(store.id)}>
                              Open feed
                            </button>
                            <a href={store.sourceUrl} target="_blank" rel="noreferrer" className="source-link">
                              Official page
                            </a>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                </div>

                <aside className="command-side">
                  <section className="command-panel-card">
                    <div className="section-heading">
                      <div>
                        <p className="section-kicker">Attention queue</p>
                        <h2>What needs action</h2>
                      </div>
                    </div>

                    {attentionStores.length > 0 ? (
                      <div className="attention-list">
                        {attentionStores.map((store) => (
                          <article key={store.id} className="attention-item">
                            <div>
                              <strong>{store.name}</strong>
                              <p>{store.statusReason}</p>
                            </div>
                            <button type="button" className="store-jump" onClick={() => openStoreFeed(store.id)}>
                              Review
                            </button>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <div className="empty-state compact-state">All tracked retailers are currently reporting healthy source coverage.</div>
                    )}
                  </section>

                  <section className="command-panel-card">
                    <div className="section-heading">
                      <div>
                        <p className="section-kicker">Quick actions</p>
                        <h2>Jump straight into work</h2>
                      </div>
                    </div>

                    <div className="command-action-stack">
                      <button type="button" className="toggle-btn" onClick={() => setActivePage('lookup')}>
                        Compare an item now
                      </button>
                      <button type="button" className="toggle-btn" onClick={() => setActivePage('summary')}>
                        Open iMessage summary
                      </button>
                      <button type="button" className="toggle-btn" onClick={() => setActivePage('watchlist')}>
                        Review tracked items
                      </button>
                    </div>

                    <div className="command-note-block">
                      <p className="catalog-meta">
                        Source intelligence refreshed {sourceIntel ? formatTimestamp(sourceIntel.generatedAt) : 'from the latest available feed'}.
                      </p>
                      <p className="catalog-meta">
                        {sourceIntel?.overview.comparableOptionCount ?? comparableLookupCount} matched products are ready for cross-store comparison.
                      </p>
                    </div>
                  </section>
                </aside>
              </section>
            </section>
          </section>
        ) : null}

        {activePage === 'deals' ? (
          <>
            <section className="page-panel">
              <div className="page-panel-header">
                <div>
                  <p className="section-kicker">Deals feed</p>
                  <h2>Store directory and live feed</h2>
                </div>
                <p>Browse tracked stores, focus the feed by retailer, and inspect the latest scraped offers.</p>
              </div>

              <section className="toolbar">
                <label className="search-panel">
                  <span>Search deals</span>
                  <input
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Bananas, cereal, chicken, Circle offers..."
                  />
                </label>

                <div className="toolbar-actions">
                  <button
                    type="button"
                    className={`toggle-btn ${watchOnly ? 'is-active' : ''}`}
                    onClick={() => setWatchOnly((current) => !current)}
                  >
                    {watchOnly ? 'Showing watchlist only' : 'Show watchlist only'}
                  </button>
                </div>
              </section>

              <section className="directory-shell">
                <div className="section-heading">
                  <div>
                    <p className="section-kicker">Store directory</p>
                    <h2>Tracked stores and filters</h2>
                  </div>
                  <p>Select a store to focus the live deal feed below.</p>
                </div>

                <section className="filter-row" aria-label="Store filters">
                  <button
                    type="button"
                    className={`filter-pill ${activeStore === 'all' ? 'is-active' : ''}`}
                    onClick={() => setActiveStore('all')}
                  >
                    All stores
                  </button>

                  {stores.map((store) => (
                    <button
                      key={store.id}
                      type="button"
                      className={`filter-pill ${activeStore === store.id ? 'is-active' : ''}`}
                      onClick={() => setActiveStore(store.id)}
                      style={
                        activeStore === store.id
                          ? {
                              borderColor: store.theme,
                              backgroundColor: `${store.theme}18`,
                              color: store.theme,
                            }
                          : undefined
                      }
                    >
                      {store.name}
                    </button>
                  ))}
                </section>

                <section className="store-grid">
                  {displayStores.map((store) => {
                    const storeIntel = sourceIntelById.get(store.id)

                    return (
                      <article
                        key={store.id}
                        className={`store-card ${activeStore === store.id ? 'is-selected' : ''}`}
                        style={{ '--store-theme': store.theme } as CSSProperties}
                      >
                        <div className="store-card-top">
                          <img src={store.logo} alt={`${store.name} logo`} className="store-logo" />
                          <div className="store-card-actions">
                            {storeIntel ? (
                              <span className={`status-badge status-${storeIntel.status}`}>{storeIntel.statusLabel}</span>
                            ) : null}
                            <button type="button" className="store-jump" onClick={() => setActiveStore(store.id)}>
                              Focus
                            </button>
                          </div>
                        </div>

                        <h2>{store.name}</h2>
                        <p>{storeIntel?.officialSignal || store.rangeLabel || store.sourceLabel}</p>

                        <div className="store-meta">
                          <span>{(storeIntel?.indexedCount ?? store.deals.length).toLocaleString()} indexed</span>
                          <span>{formatTimestamp(store.fetchedAt)}</span>
                        </div>

                        {storeIntel && storeIntel.coveragePercent !== null ? (
                          <p className="store-subtle">Coverage: {storeIntel.coveragePercent}% of the current official source signal.</p>
                        ) : null}

                        <a href={store.sourceUrl} target="_blank" rel="noreferrer" className="source-link">
                          Open official source
                        </a>
                      </article>
                    )
                  })}
                </section>
              </section>
            </section>

            {loading ? <div className="empty-state">Loading the latest store feed...</div> : null}
            {!loading && error ? <div className="empty-state error-state">{error}</div> : null}
            {!loading && !error && activeStore === 'all' ? (
              <div className="empty-state">Select a store above to open its full listing.</div>
            ) : null}
            {!loading && !error && activeStore !== 'all' && visibleDealStores.length === 0 ? (
              <div className="empty-state">No deals match the current filters.</div>
            ) : null}
            {!loading && !error
              ? visibleDealStores.map((store) => (
                  <section key={store.id} className="deals-section">
                    <div className="section-heading">
                      <div className="store-heading">
                        <img src={store.logo} alt={`${store.name} logo`} className="deal-logo" />
                        <div>
                          <p className="section-kicker">{store.rangeLabel || store.sourceLabel}</p>
                          <h2>{store.name}</h2>
                        </div>
                      </div>

                      <div className="section-meta">
                        <p>Updated {formatTimestamp(store.fetchedAt)}</p>
                        <a href={store.sourceUrl} target="_blank" rel="noreferrer" className="source-link">
                          Official page
                        </a>
                      </div>
                    </div>

                    {store.warning ? <p className="warning-banner">{store.warning}</p> : null}

                    <div className="deal-grid">
                      {store.deals.map((deal) => {
                        const tracked = watchlist.includes(deal.id)
                        const tileImage = getTileImage(deal, store)

                        return (
                          <article key={deal.id} className="deal-card">
                            <div className="tile-media">
                              <img src={tileImage.src} alt={tileImage.alt} className="deal-image" />
                            </div>
                            <div className="deal-tags">
                              {deal.category ? <span className="deal-tag">{deal.category}</span> : null}
                              {deal.expires ? <span className="deal-tag deal-tag-warm">{deal.expires}</span> : null}
                            </div>

                            <h3>{deal.title}</h3>

                            <div className="deal-pricing">
                              <p className="deal-price">{deal.price}</p>
                              {deal.previousPrice ? <p className="deal-previous">Was {deal.previousPrice}</p> : null}
                              {deal.savings ? <p className="deal-savings">{deal.savings}</p> : null}
                            </div>

                            {deal.detail ? <p className="deal-detail">{deal.detail}</p> : null}

                            <div className="deal-actions">
                              <button
                                type="button"
                                aria-pressed={tracked}
                                className={`track-btn ${tracked ? 'is-tracked' : ''}`}
                                onClick={() => toggleWatch(deal.id)}
                              >
                                {tracked ? 'Tracked' : 'Track'}
                              </button>

                              {deal.link ? (
                                <a href={deal.link} target="_blank" rel="noreferrer" className="deal-link">
                                  Open item
                                </a>
                              ) : null}
                            </div>
                          </article>
                        )
                      })}
                    </div>
                  </section>
                ))
              : null}
          </>
        ) : null}

        {activePage === 'lookup' ? (
          <section className="page-panel">
              <div className="page-panel-header">
                <div>
                  <p className="section-kicker">Cross-store lookup</p>
                  <h2>Today&apos;s best price</h2>
                </div>
                <p>Choose the exact item you want, then compare the lowest current price and direct links across stores.</p>
              </div>

            <section className="best-price-shell">
              <section className="lookup-brief" aria-label="Lookup performance summary">
                <article className="lookup-brief-card">
                  <span className="lookup-brief-label">Lookup status</span>
                  <strong>{lookupMeta ? 'Ready instantly' : bestPriceLoading ? 'Indexing' : 'Standby'}</strong>
                  <p>Lookup metadata loads immediately and matching product shards stream in only when the query needs them.</p>
                </article>
                <article className="lookup-brief-card">
                  <span className="lookup-brief-label">Grouped products</span>
                  <strong>{lookupMeta ? lookupMeta.optionCount.toLocaleString() : '...'}</strong>
                  <p>Normalized product groups built from the live feed for faster exact-item selection.</p>
                </article>
                <article className="lookup-brief-card">
                  <span className="lookup-brief-label">Cross-store matches</span>
                  <strong>{comparableLookupCount.toLocaleString()}</strong>
                  <p>Products currently matched across two or more retailers and ready for side-by-side comparison.</p>
                </article>
                <article className="lookup-brief-card">
                  <span className="lookup-brief-label">Lowest indexed price</span>
                  <strong>{Number.isFinite(lowestIndexedPrice) ? `$${lowestIndexedPrice.toFixed(2)}` : 'N/A'}</strong>
                  <p>Fastest signal for price floor movement across the indexed assortment right now.</p>
                </article>
              </section>

              <label className="search-panel best-price-search">
                <span>Item search</span>
                <input
                  type="search"
                  value={bestPriceQuery}
                  onChange={(event) => {
                    setBestPriceQuery(event.target.value)
                    setBestPriceSelection('')
                  }}
                  placeholder="Milk, bananas, eggs, salmon, cereal..."
                  aria-autocomplete="list"
                  aria-expanded={bestPriceOptions.length > 0 && !bestPriceSelection}
                />
              </label>

              {bestPriceTokens.length > 0 && !bestPriceLoading && bestPriceOptions.length > 0 && !bestPriceSelection ? (
                <div className="lookup-dropdown" role="listbox" aria-label="Matching grocery items">
                  {bestPriceOptions.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      className="lookup-option"
                      onClick={() => {
                        setBestPriceQuery(option.title)
                        setBestPriceSelection(option.key)
                      }}
                    >
                      <img
                        src={option.image || storesById.get(option.primaryStoreId)?.logo || ''}
                        alt={option.title}
                        className="lookup-option-image"
                      />
                      <span className="lookup-option-copy">
                        <strong>{option.title}</strong>
                        <span>
                          {option.detail || 'Select this exact item'}
                          {` • ${option.storeCount} store${option.storeCount === 1 ? '' : 's'} matched`}
                        </span>
                      </span>
                      <span className="lookup-option-price">From {option.minPriceLabel}</span>
                    </button>
                  ))}
                </div>
              ) : null}

              {bestPriceTokens.length > 0 && !bestPriceLoading && bestPriceOptions.length > 0 && bestPriceSelection ? (
                <div className="lookup-selection-bar">
                  <span>
                    Comparing exact item: <strong>{bestPriceQuery}</strong>
                  </span>
                  <button type="button" className="lookup-clear-btn" onClick={() => setBestPriceSelection('')}>
                    Change item
                  </button>
                </div>
              ) : null}

              {bestPriceTokens.length === 0 ? (
                <div className="empty-state compact-state">
                  Search for an item, then choose the exact product from the dropdown to compare prices across stores.
                </div>
              ) : null}
              {bestPriceTokens.length > 0 && (bestPriceLoading || !lookupMeta) ? (
                <div className="empty-state compact-state">Loading matching product groups...</div>
              ) : null}
              {bestPriceError ? <p className="warning-banner">{bestPriceError}</p> : null}
              {lookupMeta ? (
                <p className="catalog-meta">
                  Lookup index updated {formatTimestamp(lookupMeta.generatedAt)} across {lookupMeta.optionCount} grouped products from {lookupMeta.itemCount} current listings.
                </p>
              ) : null}
              {lookupMeta && bestPriceTokens.length > 0 && !bestPriceLoading && bestPriceOptions.length === 0 ? (
                <div className="empty-state compact-state">No current deal matches that search.</div>
              ) : null}
              {lookupMeta && bestPriceTokens.length > 0 && !bestPriceLoading && bestPriceOptions.length > 0 && !bestPriceSelection ? (
                <div className="empty-state compact-state">Choose the exact item from the dropdown to compare store prices.</div>
              ) : null}
              {bestPriceComparisonLoading ? (
                <div className="empty-state compact-state">Loading store-by-store comparisons...</div>
              ) : null}
              {bestPriceSelection && !bestPriceLoading && !bestPriceComparisonLoading && !bestPriceWinner ? (
                <div className="empty-state compact-state">That item is not currently priced across the tracked stores.</div>
              ) : null}

              {bestPriceWinner ? (
                <div className="best-price-layout">
                  <article className="best-price-card">
                    <div className="best-price-card-top">
                        <div className="store-heading">
                          <img
                            src={selectedLookupOption?.image || bestPriceWinner.store.logo}
                            alt={bestPriceWinner.item.title}
                          className="deal-image best-price-image"
                        />
                        <div>
                          <p className="section-kicker">Lowest current match</p>
                          <h2>{bestPriceWinner.item.title}</h2>
                        </div>
                      </div>
                      <p className="best-price-value">{bestPriceWinner.item.price}</p>
                    </div>

                    <div className="best-price-meta">
                      <span className="deal-tag">{bestPriceWinner.store.name}</span>
                      {bestPriceWinner.item.sourceLabel ? (
                        <span className="deal-tag deal-tag-warm">{bestPriceWinner.item.sourceLabel}</span>
                      ) : null}
                    </div>

                    {bestPriceWinner.item.detail ? (
                      <p className="deal-detail best-price-detail">{bestPriceWinner.item.detail}</p>
                    ) : null}

                    <div className="deal-actions">
                      {bestPriceWinner.item.link ? (
                        <a href={bestPriceWinner.item.link} target="_blank" rel="noreferrer" className="deal-link">
                          Open item
                        </a>
                      ) : null}
                    </div>

                    {bestPriceCrossChecks.length > 0 ? (
                      <div className="cross-check-links">
                        <p className="catalog-meta">Direct links for the stores that were cross-checked</p>
                        <div className="cross-check-grid">
                          {bestPriceCrossChecks.map(({ store, item }) => (
                            <a
                              key={store.id}
                              href={item.link}
                              target="_blank"
                              rel="noreferrer"
                              className="cross-check-link"
                            >
                              <img src={store.logo} alt={`${store.name} logo`} className="deal-logo" />
                              <span>{store.name}</span>
                              <strong>{item.price}</strong>
                            </a>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </article>

                  <div className="best-price-results">
                    {bestPriceShortlist.map(({ store, item }, index) => (
                      <article key={store.id} className="best-price-row">
                        <div className="best-price-rank">{index + 1}</div>
                        <img src={store.logo} alt={`${store.name} logo`} className="deal-logo" />
                        <div className="best-price-copy">
                          <strong>{item.title}</strong>
                          <p>
                            {store.name}
                            {item.detail ? ` • ${item.detail}` : ''}
                          </p>
                        </div>
                        <div className="best-price-price">
                          <strong>{item.price}</strong>
                          <span>{item.sourceLabel || 'Current listed price'}</span>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              ) : null}
            </section>
          </section>
        ) : null}

        {activePage === 'summary' ? (
          <section className="page-panel">
            <div className="page-panel-header">
              <div>
                <p className="section-kicker">iMessage summary</p>
                <h2>Scheduled delivery</h2>
              </div>
              <p>Configure your Messages summary, set send timing, and preview or trigger a refreshed delivery.</p>
            </div>

            <section className="notifier-shell">
              <div className="section-heading">
                <div>
                  <p className="section-kicker">iMessage summary</p>
                  <h2>Scheduled delivery</h2>
                </div>
                <div className="notifier-status-wrap">
                  <span className={`service-badge ${notifierOnline ? 'is-online' : 'is-offline'}`}>
                    {notifierLoading ? 'Checking service...' : notifierOnline ? 'Notifier online' : 'Notifier offline'}
                  </span>
                  <p>{scheduleDescription}</p>
                </div>
              </div>

              <p className="notifier-note">
                This macOS-only helper sends your summary through Messages and refreshes the store feed immediately
                before every scheduled or manual send.
              </p>

              {!notifierOnline ? (
                <p className="warning-banner">
                  {isRemoteOrigin
                    ? 'This deployed site cannot send iMessages by itself. Start `npm run notifier:service` on the Mac that owns Messages, then refresh this page.'
                    : 'Start `npm run notifier:service` or `npm run dev:full` to enable schedule saving, previews, and iMessage delivery.'}
                </p>
              ) : null}
              {notifierMessage ? <p className="success-banner">{notifierMessage}</p> : null}
              {notifierError ? <p className="warning-banner">{notifierError}</p> : null}

              <div className="settings-grid">
                <label className="settings-field">
                  <span>iMessage phone number</span>
                  <input
                    type="tel"
                    value={notifierSettings.phoneNumber}
                    onChange={(event) => updateNotifier('phoneNumber', event.target.value)}
                    placeholder="+15555550123"
                  />
                </label>
                <label className="settings-field">
                  <span>Summary scope</span>
                  <select
                    value={notifierSettings.summaryMode}
                    onChange={(event) => updateNotifier('summaryMode', event.target.value as SummaryMode)}
                  >
                    <option value="all">All selected store deals</option>
                    <option value="tracked">Tracked deals only</option>
                  </select>
                </label>
                <label className="settings-field">
                  <span>Schedule type</span>
                  <select
                    value={notifierSettings.scheduleType}
                    onChange={(event) => updateNotifier('scheduleType', event.target.value as ScheduleType)}
                  >
                    <option value="daily">Daily</option>
                    <option value="weekly">Selected weekdays</option>
                  </select>
                </label>
                <label className="settings-field">
                  <span>Send time</span>
                  <input
                    type="time"
                    value={notifierSettings.time}
                    onChange={(event) => updateNotifier('time', event.target.value)}
                  />
                </label>
                <label className="settings-field">
                  <span>Deals per store</span>
                  <input
                    type="number"
                    min={1}
                    max={8}
                    value={notifierSettings.maxDealsPerStore}
                    onChange={(event) => updateNotifier('maxDealsPerStore', Number(event.target.value))}
                  />
                </label>
                <label className="settings-checkbox">
                  <input
                    type="checkbox"
                    checked={notifierSettings.enabled}
                    onChange={(event) => updateNotifier('enabled', event.target.checked)}
                  />
                  <span>Enable scheduled iMessage summary</span>
                </label>
              </div>

              {notifierSettings.scheduleType === 'weekly' ? (
                <div className="chip-group">
                  {WEEKDAYS.map((day) => (
                    <button
                      key={day.id}
                      type="button"
                      className={`filter-pill ${notifierSettings.weekdays.includes(day.id) ? 'is-active' : ''}`}
                      onClick={() => toggleWeekday(day.id)}
                    >
                      {day.label}
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="store-checkboxes">
                {stores.map((store) => (
                  <label key={store.id} className="store-checkbox">
                    <input
                      type="checkbox"
                      checked={notifierSettings.storeIds.includes(store.id)}
                      onChange={() => toggleNotifierStore(store.id)}
                    />
                    <img src={store.logo} alt={`${store.name} logo`} className="deal-logo" />
                    <span>{store.name}</span>
                  </label>
                ))}
              </div>

              <div className="notifier-actions">
                <button
                  type="button"
                  className="toggle-btn"
                  onClick={() => void retryNotifierConnection()}
                  disabled={notifierBusy || notifierLoading}
                >
                  {notifierLoading ? 'Checking...' : 'Retry connection'}
                </button>
                <button
                  type="button"
                  className="toggle-btn"
                  onClick={() => void saveNotifierSettings()}
                  disabled={notifierBusy || !notifierOnline}
                >
                  Save schedule
                </button>
                <button
                  type="button"
                  className="toggle-btn"
                  onClick={() => void previewNotifierSummary()}
                  disabled={notifierBusy || !notifierOnline}
                >
                  Preview summary
                </button>
                <button
                  type="button"
                  className="toggle-btn is-active"
                  onClick={() => void sendNotifierNow()}
                  disabled={notifierBusy || !notifierOnline}
                >
                  Refresh and send now
                </button>
              </div>

              <div className="notifier-meta">
                <p>{notifierSettings.storeIds.length} stores selected for delivery.</p>
                <p>Timezone: {notifierSettings.timezone}</p>
                <p>{notifierSettings.lastSentAt ? `Last sent ${formatTimestamp(notifierSettings.lastSentAt)}` : 'No summary sent yet.'}</p>
                <p>
                  {notifierSettings.summaryMode === 'tracked'
                    ? `${watchlist.length} watched deals will be considered for tracked-only sends.`
                    : 'All current deals from the selected stores will be considered.'}
                </p>
              </div>

              {notifierSummary ? (
                <div className="summary-preview-card">
                  <div className="section-heading">
                    <div>
                      <p className="section-kicker">Preview</p>
                      <h2>Next message body</h2>
                    </div>
                  </div>
                  <pre className="summary-preview">{notifierSummary}</pre>
                </div>
              ) : null}
            </section>
          </section>
        ) : null}

        {activePage === 'watchlist' ? (
          <section className="page-panel">
            <div className="page-panel-header">
              <div>
                <p className="section-kicker">Personal watchlist</p>
                <h2>Tracked deals</h2>
              </div>
              <p>Review the items you have saved across stores and remove them when they are no longer relevant.</p>
            </div>

            {watchlistDeals.length > 0 ? (
              <section className="watchlist-shell">
                <div className="watchlist-grid">
                  {watchlistDeals.map(({ store, deal }) => (
                    <article key={deal.id} className="watch-card">
                      <div className="tile-media">
                        <img
                          src={getTileImage(deal, store).src}
                          alt={getTileImage(deal, store).alt}
                          className="deal-image"
                        />
                      </div>
                      <div className="watch-card-top">
                        <img src={store.logo} alt={`${store.name} logo`} className="deal-logo" />
                        <div>
                          <strong>{store.name}</strong>
                          <p>{deal.category || store.sourceLabel}</p>
                        </div>
                      </div>
                      <h3>{deal.title}</h3>
                      <p className="deal-price">{deal.price}</p>
                      {deal.expires ? <p className="deal-subtle">{deal.expires}</p> : null}
                      <button type="button" className="track-btn is-tracked" onClick={() => toggleWatch(deal.id)}>
                        Remove
                      </button>
                    </article>
                  ))}
                </div>
              </section>
            ) : (
              <div className="empty-state">No tracked deals yet. Save items from the deals feed to build your watchlist.</div>
            )}
          </section>
        ) : null}
      </main>
    </div>
  )
}

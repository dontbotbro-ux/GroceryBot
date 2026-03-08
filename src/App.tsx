import { useEffect, useState, type CSSProperties } from 'react'

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

type BestPriceItem = {
  id: string
  storeId: string
  sourceLabel: string
  title: string
  price: string
  priceValue: number
  detail?: string
  category?: string
  link?: string
  image?: string
}

type BestPriceFeed = {
  generatedAt: string
  itemCount: number
  items: BestPriceItem[]
}

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
const EMPTY_STORES: StoreData[] = []
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

function parsePriceValue(value: string): number | null {
  const match = value.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/)

  if (!match) {
    return null
  }

  const parsed = Number(match[1])
  return Number.isFinite(parsed) ? parsed : null
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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [bestPriceQuery, setBestPriceQuery] = useState('')
  const [bestPriceFeed, setBestPriceFeed] = useState<BestPriceFeed | null>(null)
  const [bestPriceLoading, setBestPriceLoading] = useState(false)
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
  const bestPriceTokens = bestPriceQuery
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
  const storesById = new Map(stores.map((store) => [store.id, store]))

  useEffect(() => {
    if (bestPriceTokens.length === 0 || bestPriceFeed || bestPriceLoading || bestPriceError) {
      return
    }

    let cancelled = false

    async function loadBestPriceFeed() {
      try {
        setBestPriceLoading(true)
        const response = await fetch('/best-price-data.json', { cache: 'no-store' })

        if (!response.ok) {
          throw new Error(`Failed to load best-price catalog (${response.status})`)
        }

        const data = (await response.json()) as BestPriceFeed

        if (!cancelled) {
          setBestPriceFeed(data)
          setBestPriceError('')
        }
      } catch (loadError) {
        if (!cancelled) {
          setBestPriceError(
            loadError instanceof Error ? loadError.message : 'Unable to load the best-price catalog.',
          )
        }
      } finally {
        if (!cancelled) {
          setBestPriceLoading(false)
        }
      }
    }

    void loadBestPriceFeed()

    return () => {
      cancelled = true
    }
  }, [bestPriceError, bestPriceFeed, bestPriceLoading, bestPriceTokens.length])

  const filteredStores = stores
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

  const watchlistDeals = stores.flatMap((store) =>
    store.deals
      .filter((deal) => watchlist.includes(deal.id))
      .map((deal) => ({
        store,
        deal,
      })),
  )

  const totalDeals = stores.reduce((sum, store) => sum + store.deals.length, 0)
  const bestPriceMatches = (bestPriceFeed?.items ?? [])
    .map((item) => {
      const store = storesById.get(item.storeId)

      if (!store) {
        return null
      }

      const haystack = [
        store.name,
        item.title,
        item.price,
        item.detail,
        item.category,
        item.sourceLabel,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      const matches = bestPriceTokens.length > 0 && bestPriceTokens.every((token) => haystack.includes(token))

      if (!matches) {
        return null
      }

      return {
        store,
        item,
        numericPrice: item.priceValue ?? parsePriceValue(item.price) ?? Number.POSITIVE_INFINITY,
      }
    })
    .filter(
      (
        result,
      ): result is {
        store: StoreData
        item: BestPriceItem
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
          item: BestPriceItem
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
    if (!notifierOnline) {
      setNotifierError('The iMessage notifier is offline. Start `npm run notifier:service` on your Mac before sending a summary.')
      return
    }

    try {
      setNotifierBusy(true)
      setNotifierError('')
      const payload = await apiRequest<NotifierResponse>('/send-now', {
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
      setNotifierMessage(`Summary sent. Deals were refreshed at ${formatTimestamp(payload.feedGeneratedAt || '')}.`)
    } catch (sendError) {
      setNotifierError(sendError instanceof Error ? sendError.message : 'Unable to send the summary.')
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
            Weekly grocery deal intelligence for Wegmans, Walmart, Aldi, Lidl, Target, and Kroger. Search
            the live feed, compare stores, track items, and send an iMessage summary on your schedule.
          </p>
        </div>

        <div className="hero-stats">
          <article className="metric-card">
            <span className="metric-label">Stores tracked</span>
            <strong>{stores.length || 6}</strong>
          </article>
          <article className="metric-card">
            <span className="metric-label">Deals scraped</span>
            <strong>{totalDeals}</strong>
          </article>
          <article className="metric-card">
            <span className="metric-label">Watchlist</span>
            <strong>{watchlistDeals.length}</strong>
          </article>
          <article className="metric-card">
            <span className="metric-label">Last refresh</span>
            <strong>{feed ? formatTimestamp(feed.generatedAt) : 'Loading...'}</strong>
          </article>
        </div>
      </header>

      <main className="content-shell">
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

        <section className="best-price-shell">
          <div className="section-heading">
            <div>
              <p className="section-kicker">Cross-store lookup</p>
              <h2>Today&apos;s best price</h2>
            </div>
            <p>
              Search the current scraped deals across Wegmans, Walmart, Aldi, Lidl, Target, and Kroger to
              find the lowest listed price.
            </p>
          </div>

          <label className="search-panel best-price-search">
            <span>Item search</span>
            <input
              type="search"
              value={bestPriceQuery}
              onChange={(event) => setBestPriceQuery(event.target.value)}
              placeholder="Milk, bananas, eggs, salmon, cereal..."
            />
          </label>

          {bestPriceTokens.length === 0 ? (
            <div className="empty-state compact-state">
              Search for an item to compare today&apos;s lowest matching price across all stores.
            </div>
          ) : null}

          {bestPriceTokens.length > 0 && bestPriceLoading ? (
            <div className="empty-state compact-state">Loading the broader product catalog...</div>
          ) : null}

          {bestPriceError ? <p className="warning-banner">{bestPriceError}</p> : null}

          {bestPriceFeed ? (
            <p className="catalog-meta">
              Catalog updated {formatTimestamp(bestPriceFeed.generatedAt)} across {bestPriceFeed.itemCount} items.
            </p>
          ) : null}

          {bestPriceTokens.length > 0 && !bestPriceLoading && !bestPriceWinner ? (
            <div className="empty-state compact-state">No current deal matches that search.</div>
          ) : null}

          {bestPriceWinner ? (
            <div className="best-price-layout">
              <article className="best-price-card">
                <div className="best-price-card-top">
                  <div className="store-heading">
                    <img
                      src={bestPriceWinner.item.image || bestPriceWinner.store.logo}
                      alt={bestPriceWinner.item.image ? bestPriceWinner.item.title : `${bestPriceWinner.store.name} logo`}
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
                          key={`${store.id}-${item.id}`}
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
                  <article key={item.id} className="best-price-row">
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

        {watchlistDeals.length > 0 ? (
          <section className="watchlist-shell">
            <div className="section-heading">
              <div>
                <p className="section-kicker">Personal watchlist</p>
                <h2>Tracked deals</h2>
              </div>
              <p>{watchlistDeals.length} saved offers</p>
            </div>

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
        ) : null}

        <section className="store-grid">
          {stores.map((store) => (
            <article
              key={store.id}
              className={`store-card ${activeStore === store.id ? 'is-selected' : ''}`}
              style={{ '--store-theme': store.theme } as CSSProperties}
            >
              <div className="store-card-top">
                <img src={store.logo} alt={`${store.name} logo`} className="store-logo" />
                <button type="button" className="store-jump" onClick={() => setActiveStore(store.id)}>
                  Focus
                </button>
              </div>

              <h2>{store.name}</h2>
              <p>{store.rangeLabel || store.sourceLabel}</p>

              <div className="store-meta">
                <span>{store.deals.length} deals</span>
                <span>{formatTimestamp(store.fetchedAt)}</span>
              </div>

              <a href={store.sourceUrl} target="_blank" rel="noreferrer" className="source-link">
                Open official source
              </a>
            </article>
          ))}
        </section>

        {loading ? <div className="empty-state">Loading the latest store feed...</div> : null}
        {!loading && error ? <div className="empty-state error-state">{error}</div> : null}

        {!loading && !error && filteredStores.length === 0 ? (
          <div className="empty-state">No deals match the current filters.</div>
        ) : null}

        {!loading && !error
          ? filteredStores.map((store) => (
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
      </main>
    </div>
  )
}

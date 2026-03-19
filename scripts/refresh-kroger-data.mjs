import fs from 'node:fs/promises'
import path from 'node:path'
import { scrapeKrogerData } from './fetch-store-data.mjs'

const rootDir = process.cwd()
const storeFeedPath = path.join(rootDir, 'public', 'store-data.json')
const catalogFeedPath = path.join(rootDir, 'public', 'best-price-data.json')

function hasKrogerApiCredentials() {
  return Boolean(process.env.KROGER_CLIENT_ID?.trim() && process.env.KROGER_CLIENT_SECRET?.trim())
}

function dedupeCatalogItems(items) {
  const byKey = new Map()

  for (const item of items) {
    const key = [
      item.storeId,
      (item.link ?? '').toLowerCase(),
      item.title.toLowerCase(),
      (item.detail ?? '').toLowerCase(),
    ].join('::')
    const current = byKey.get(key)

    if (!current) {
      byKey.set(key, item)
      continue
    }

    const shouldReplace =
      item.priceValue < current.priceValue ||
      (!current.image && item.image) ||
      (!current.link && item.link)

    if (shouldReplace) {
      byKey.set(key, {
        ...current,
        ...item,
      })
    }
  }

  return [...byKey.values()].sort(
    (left, right) =>
      left.storeId.localeCompare(right.storeId) ||
      left.title.localeCompare(right.title) ||
      left.priceValue - right.priceValue,
  )
}

async function main() {
  if (!hasKrogerApiCredentials()) {
    console.log('[kroger refresh] skipped: KROGER_CLIENT_ID/KROGER_CLIENT_SECRET not set')
    return
  }

  const [{ store, catalogItems, fetchedAt }, storeFeedRaw, catalogFeedRaw] = await Promise.all([
    scrapeKrogerData(),
    fs.readFile(storeFeedPath, 'utf8'),
    fs.readFile(catalogFeedPath, 'utf8'),
  ])

  const storeFeed = JSON.parse(storeFeedRaw)
  const catalogFeed = JSON.parse(catalogFeedRaw)

  storeFeed.generatedAt = fetchedAt
  storeFeed.stores = storeFeed.stores.map((entry) => (entry.id === 'kroger' ? store : entry))

  const mergedCatalogItems = dedupeCatalogItems([
    ...catalogFeed.items.filter((item) => item.storeId !== 'kroger'),
    ...catalogItems,
  ])

  catalogFeed.generatedAt = fetchedAt
  catalogFeed.items = mergedCatalogItems
  catalogFeed.itemCount = mergedCatalogItems.length

  await Promise.all([
    fs.writeFile(storeFeedPath, `${JSON.stringify(storeFeed, null, 2)}\n`),
    fs.writeFile(catalogFeedPath, `${JSON.stringify(catalogFeed, null, 2)}\n`),
  ])

  console.log(`[kroger refresh] wrote ${store.deals.length} store deals and ${catalogItems.length} catalog items`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

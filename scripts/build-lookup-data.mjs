import fs from 'node:fs/promises'
import path from 'node:path'

const rootDir = process.cwd()
const catalogPath = path.join(rootDir, 'public', 'best-price-data.json')
const lookupDir = path.join(rootDir, 'public', 'lookup')
const lookupMetaPath = path.join(lookupDir, 'meta.json')
const lookupShardsDir = path.join(lookupDir, 'shards')

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

function normalizeText(value = '') {
  return String(value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
}

function normalizeLookupText(value = '') {
  return normalizeText(value)
    .toLowerCase()
    .replace(/(\d+(?:\.\d+)?)\s*%/g, '$1pct ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function singularizeLookupToken(token) {
  if (token.endsWith('ies') && token.length > 3) {
    return `${token.slice(0, -3)}y`
  }

  if (token.endsWith('s') && !token.endsWith('ss') && token.length > 3) {
    return token.slice(0, -1)
  }

  return token
}

function normalizeLookupCountToken(token) {
  return token === 'dozen' ? '12ct' : token
}

function extractLookupBrand(detail = '') {
  const segments = String(detail)
    .split('•')
    .map((segment) => normalizeLookupText(segment))
    .filter(Boolean)
    .filter((segment) => !/\d/.test(segment))
    .filter((segment) => !/\b(oz|lb|ct|count|each|per|form)\b/.test(segment))

  const brandSegment = segments.at(-1) ?? ''
  return brandSegment.split(' ').filter(Boolean)
}

function isShellEggItem(item) {
  const combined = normalizeLookupText(
    [item.title, item.detail, item.category, item.sourceLabel].filter(Boolean).join(' '),
  )

  if (!/\begg\b/.test(combined)) {
    return false
  }

  if (
    /\b(cadbury|candy|chocolate|easter|snickers|soup|noodle|yogurt|waffle|muffin|salad|roll|bite|sandwich)\b/.test(
      combined,
    )
  ) {
    return false
  }

  return /\b(grade|large|brown|white|cage|free range|free-run|dozen|ct|count|egg)\b/.test(combined)
}

function buildLookupOptionKey(item) {
  if (isShellEggItem(item)) {
    return 'shell eggs'
  }

  const brandTokens = new Set(extractLookupBrand(item.detail))

  const tokens = normalizeLookupText(item.title)
    .split(' ')
    .filter(Boolean)
    .filter((token) => !LOOKUP_STOPWORDS.has(token))
    .filter((token) => !LOOKUP_UNIT_TOKENS.has(token))
    .filter((token) => !brandTokens.has(token))
    .filter((token) => !/^\d+(?:\.\d+)?$/.test(token))
    .map((token) => normalizeLookupCountToken(singularizeLookupToken(token)))

  return tokens.join(' ')
}

function buildOptionSearchTokens(item, key) {
  const tokenSet = new Set()
  const rawTokens = normalizeLookupText([item.title, key].filter(Boolean).join(' '))
    .split(' ')
    .filter(Boolean)

  for (const rawToken of rawTokens) {
    const token = normalizeLookupCountToken(singularizeLookupToken(rawToken))

    if (!token || LOOKUP_STOPWORDS.has(token) || LOOKUP_UNIT_TOKENS.has(token) || /^\d+(?:\.\d+)?$/.test(token)) {
      continue
    }

    tokenSet.add(token)
  }

  return [...tokenSet]
}

function getLookupShardKey(token = '') {
  const normalized = normalizeLookupText(token)

  if (!normalized) {
    return 'misc'
  }

  const firstCharacter = normalized[0]
  return /[a-z0-9]/.test(firstCharacter) ? firstCharacter : 'misc'
}

async function main() {
  const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8'))
  const grouped = new Map()

  for (const item of catalog.items ?? []) {
    const key = buildLookupOptionKey(item)

    if (!key) {
      continue
    }

    const optionTitle = key === 'shell eggs' ? 'Shell Eggs' : item.title
    const optionDetail =
      key === 'shell eggs'
        ? 'Large, white, brown, cage-free, and dozen-count egg listings'
        : normalizeText(item.detail ?? '') || 'Select this exact item'

    if (!grouped.has(key)) {
      grouped.set(key, {
        key,
        title: optionTitle,
        detail: optionDetail,
        image: item.image ?? '',
        primaryStoreId: item.storeId,
        searchTokens: new Set(),
        minPrice: item.priceValue,
        minPriceLabel: item.price,
        matchesByStore: new Map(),
      })
    }

    const current = grouped.get(key)

    for (const token of buildOptionSearchTokens(item, key)) {
      current.searchTokens.add(token)
    }

    if (!current.image && item.image) {
      current.image = item.image
    }

    if (item.priceValue < current.minPrice) {
      current.minPrice = item.priceValue
      current.minPriceLabel = item.price
      current.primaryStoreId = item.storeId
    }

    const existingStoreMatch = current.matchesByStore.get(item.storeId)

    if (!existingStoreMatch || item.priceValue < existingStoreMatch.priceValue) {
      current.matchesByStore.set(item.storeId, {
        storeId: item.storeId,
        title: item.title,
        price: item.price,
        priceValue: item.priceValue,
        sourceLabel: item.sourceLabel,
        detail: normalizeText(item.detail ?? ''),
        link: item.link,
      })
    }
  }

  const options = [...grouped.values()]
    .map((option) => {
      const matches = [...option.matchesByStore.values()].sort(
        (left, right) =>
          left.priceValue - right.priceValue ||
          left.title.localeCompare(right.title) ||
          left.storeId.localeCompare(right.storeId),
      )

      return {
        key: option.key,
        title: option.title,
        detail: normalizeLookupText(option.detail) === normalizeLookupText(option.title) ? '' : option.detail,
        image: option.image,
        primaryStoreId: option.primaryStoreId,
        searchTokens: [...option.searchTokens].sort(),
        minPrice: option.minPrice,
        minPriceLabel: option.minPriceLabel,
        storeCount: matches.length,
        matches,
      }
    })
    .sort(
      (left, right) =>
        left.title.localeCompare(right.title) || left.minPrice - right.minPrice,
    )

  const shards = new Map()

  for (const option of options) {
    const shardKeys = new Set(option.searchTokens.map((token) => getLookupShardKey(token)))

    if (shardKeys.size === 0) {
      shardKeys.add(getLookupShardKey(option.title))
    }

    for (const shardKey of shardKeys) {
      if (!shards.has(shardKey)) {
        shards.set(shardKey, [])
      }

      shards.get(shardKey).push(option)
    }
  }

  const comparableOptionCount = options.filter((option) => option.storeCount > 1).length
  const lowestPrice =
    options.length > 0
      ? options.reduce((lowest, option) => (option.minPrice < lowest ? option.minPrice : lowest), Number.POSITIVE_INFINITY)
      : null

  await fs.rm(lookupDir, { recursive: true, force: true })
  await fs.mkdir(lookupShardsDir, { recursive: true })

  const shardEntries = [...shards.entries()].sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))

  for (const [shardKey, shardOptions] of shardEntries) {
    const shardPayload = {
      generatedAt: catalog.generatedAt,
      shardKey,
      optionCount: shardOptions.length,
      options: shardOptions,
    }

    await fs.writeFile(
      path.join(lookupShardsDir, `${shardKey}.json`),
      `${JSON.stringify(shardPayload)}\n`,
    )
  }

  const metaPayload = {
    generatedAt: catalog.generatedAt,
    itemCount: catalog.itemCount,
    optionCount: options.length,
    comparableOptionCount,
    lowestPrice: Number.isFinite(lowestPrice) ? lowestPrice : null,
    shards: shardEntries.map(([key, shardOptions]) => ({
      key,
      optionCount: shardOptions.length,
    })),
  }

  await fs.writeFile(lookupMetaPath, `${JSON.stringify(metaPayload)}\n`)
  console.log(
    `[lookup] wrote ${lookupMetaPath} and ${shardEntries.length} lookup shards in ${lookupShardsDir}`,
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

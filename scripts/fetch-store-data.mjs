import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import vm from 'node:vm'
import * as cheerio from 'cheerio'
import { chromium } from 'playwright'

const rootDir = process.cwd()
const publicDir = path.join(rootDir, 'public')
const logosDir = path.join(publicDir, 'logos')
const outputFile = path.join(publicDir, 'store-data.json')
const catalogOutputFile = path.join(publicDir, 'best-price-data.json')

const userAgent =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

const groceryKeywords =
  /avocado|bacon|banana|beef|bread|breakfast|candy|cereal|cheese|chicken|chips|coffee|cookie|cucumber|curry|drinks|egg|energy|fish|frozen|fruit|granola|grocery|ice cream|juice|lettuce|meal|meat|milk|momos|orange|pasta|pizza|popcorn|potato|pretzel|produce|ribs|salad|salmon|samosa|scallops|seafood|shrimp|snack|soda|spring mix|strawberries|tea|tomato|vegetable|water|watermelon|wings|yogurt/i

const mixedMerchandiseKeywords =
  /athletic|bin|box(es)?|camping|coir|garden|grid|ladies|landscape|mat|men'?s|pant|planter|sensory|shirt|storage|table/i

const krogerDealSearchLinks = [
  '/search?keyword=TDFreshCuratedSavingsP2W1&query=TDFreshCuratedSavingsP2W1&searchType=mktg%20attribute&monet=curated&fulfillment=all&pzn=relevance',
  '/search?keyword=MustBuyTDSoda1&query=MustBuyTDSoda1&searchType=mktg%20attribute&monet=curated&fulfillment=all&pzn=relevance',
  '/search?keyword=TDBabySave10P1W326&query=TDBabySave10P1W326&searchType=mktg%20attribute&monet=curated&fulfillment=all&pzn=relevance',
  '/search?keyword=WDDShopAllProduct26021&query=WDDShopAllProduct26021&searchType=mktg%20attribute&monet=curated&fulfillment=all&pzn=relevance',
]

const krogerGroceryCategoryLinks = [
  '/pl/fresh-fruits-vegetables/06',
  '/pl/fresh-fruit/06111',
  '/pl/meat-seafood/05',
  '/pl/breakfast/03',
  '/pl/deli/13',
]

const krogerSeedProducts = [
  { upc: '0003338320027', description: 'fresh strawberries - 1 lb clamshell' },
  { upc: '0020324300000', description: 'kroger natural pork baby back ribs' },
  { upc: '0000000004225', description: 'fresh large ripe avocado' },
  { upc: '0001111079542', description: 'private selection petite gold gourmet potatoes' },
  { upc: '0001111008068', description: 'simple truth jumbo raw shrimp peeled and deveined tail off' },
  { upc: '0003338324000', description: 'fresh blackberries - 6 oz clamshell' },
  { upc: '0000000003283', description: 'large honeycrisp apple - each' },
  { upc: '0000000004430', description: 'fresh ripe whole pineapple' },
  { upc: '0001111022298', description: 'private selection seedless mini cucumbers' },
  { upc: '0007224013381', description: 'wonderful halos mandarins' },
  { upc: '0007790011553', description: 'jimmy dean premium pork regular breakfast sausage roll' },
  { upc: '0001111091687', description: 'private selection campari tomatoes' },
]

const krogerStaticFallbackItems = [
  {
    id: '0003338320027',
    title: 'Fresh Strawberries - 1 LB Clamshell',
    priceValue: 1.99,
    price: '$1.99',
    previousPrice: '$3.99',
    detail: 'Fresh Fruit • UPC: 0003338320027',
    category: 'Fresh Fruit',
    link: 'https://www.kroger.com/p/fresh-strawberries-1-lb-clamshell/0003338320027',
    image: 'https://www.kroger.com/product/images/large/front/0003338320027',
    sourceLabel: 'Top Deals',
    expires: '2026-03-11T03:59:59.999Z',
  },
  {
    id: '0001111063061',
    title: 'Kroger Chef Salad Kit',
    priceValue: 3.67,
    price: '3 For $11.00',
    previousPrice: '$3.99',
    detail: 'Kroger • 6.7 oz',
    category: 'Deli',
    link: 'https://www.kroger.com/p/kroger-chef-salad-kit/0001111063061',
    image: 'https://www.kroger.com/product/images/large/front/0001111063061',
    sourceLabel: 'Top Deals',
    expires: '2026-04-01T03:59:59.999Z',
  },
  {
    id: '0000000004225',
    title: 'Fresh Large Ripe Avocado',
    priceValue: 1.25,
    price: '4 For $5.00',
    previousPrice: '$2.79',
    detail: '1 each',
    category: 'Produce',
    link: 'https://www.kroger.com/p/fresh-large-ripe-avocado/0000000004225',
    image: 'https://www.kroger.com/product/images/large/front/0000000004225',
    sourceLabel: 'Top Deals',
    expires: '2026-03-11T03:59:59.999Z',
  },
  {
    id: '0004470002268',
    title: 'Oscar Mayer Original Center Cut Bacon',
    priceValue: 8.49,
    price: 'Buy 1, Get 1 Free',
    previousPrice: '$8.49',
    detail: 'Oscar Mayer • 12 oz',
    category: 'Meat & Seafood',
    link: 'https://www.kroger.com/p/oscar-mayer-original-center-cut-bacon/0004470002268',
    image: 'https://www.kroger.com/product/images/large/front/0004470002268',
    sourceLabel: 'Top Deals',
    expires: '2026-03-11T03:59:59.999Z',
  },
  {
    id: '0004470001990',
    title: 'Oscar Mayer 12-Hour Real Wood Smoked Thick Cut Bacon',
    priceValue: 8.49,
    price: 'Buy 1, Get 1 Free',
    previousPrice: '$8.49',
    detail: 'Oscar Mayer • 16 oz',
    category: 'Meat & Seafood',
    link: 'https://www.kroger.com/p/oscar-mayer-12-hour-real-wood-smoked-thick-cut-bacon/0004470001990',
    image: 'https://www.kroger.com/product/images/large/front/0004470001990',
    sourceLabel: 'Top Deals',
    expires: '2026-03-11T03:59:59.999Z',
  },
  {
    id: '0007590000526',
    title: 'Bob Evans Original Mashed Potatoes',
    priceValue: 3.99,
    price: '$3.99',
    previousPrice: '$4.49',
    detail: 'Bob Evans • 24 oz',
    category: 'Deli',
    link: 'https://www.kroger.com/p/bob-evans-original-mashed-potatoes/0007590000526',
    image: 'https://www.kroger.com/product/images/large/front/0007590000526',
    sourceLabel: 'Top Deals',
    expires: '2026-03-25T03:59:59.999Z',
  },
  {
    id: '0001111022298',
    title: 'Private Selection Seedless Mini Cucumbers',
    priceValue: 3.49,
    price: '$3.49',
    previousPrice: '',
    detail: 'Private Selection • 16 oz',
    category: 'Produce',
    link: 'https://www.kroger.com/p/private-selection-seedless-mini-cucumbers/0001111022298',
    image: 'https://www.kroger.com/product/images/large/front/0001111022298',
    sourceLabel: 'Top Deals',
  },
  {
    id: '0020324300000',
    title: 'Kroger Natural Pork Baby Back Ribs',
    priceValue: 13.25,
    price: '$13.25',
    previousPrice: '',
    detail: '$4.49/lb',
    category: 'Meat & Seafood',
    link: 'https://www.kroger.com/p/kroger-natural-pork-baby-back-ribs/0020324300000',
    image: 'https://www.kroger.com/product/images/large/front/0020324300000',
    sourceLabel: 'Top Deals',
  },
  {
    id: '0001111091687',
    title: 'Private Selection Campari Tomatoes',
    priceValue: 4.29,
    price: '$4.29',
    previousPrice: '',
    detail: 'Private Selection • 16 oz',
    category: 'Produce',
    link: 'https://www.kroger.com/p/private-selection-campari-tomatoes/0001111091687',
    image: 'https://www.kroger.com/product/images/large/front/0001111091687',
    sourceLabel: 'Top Deals',
  },
  {
    id: '0000000004430',
    title: 'Fresh Ripe Whole Pineapple',
    priceValue: 2.99,
    price: '$2.99',
    previousPrice: '',
    detail: '1 ct',
    category: 'Produce',
    link: 'https://www.kroger.com/p/fresh-ripe-whole-pineapple/0000000004430',
    image: 'https://www.kroger.com/product/images/large/front/0000000004430',
    sourceLabel: 'Top Deals',
  },
]

export const stores = [
  {
    id: 'wegmans',
    name: 'Wegmans',
    theme: '#006341',
    sourceUrl: 'https://www.wegmans.com/shop/featured/Hot_Zone_Prices',
    sourceLabel: 'Hot Zone Prices',
    logoUrl: 'https://www.wegmans.com/_next/static/media/logo.b211fe25.svg',
  },
  {
    id: 'walmart',
    name: 'Walmart',
    theme: '#0071ce',
    sourceUrl: 'https://www.walmart.com/c/kp/groceries-deals',
    sourceLabel: 'Groceries Deals',
    logoUrl: 'https://i5.walmartimages.com/dfw/63fd9f59-14e2/9d304ce6-96de-4331-b8ec-c5191226d378/v1/spark-icon.svg',
  },
  {
    id: 'aldi',
    name: 'Aldi',
    theme: '#00539f',
    sourceUrl: 'https://www.aldi.us/weekly-specials/this-weeks-aldi-finds',
    sourceLabel: "This Week's ALDI Finds",
    logoUrl: 'https://dm.cms.aldi.cx/is/content/prod1amer/aldius-logo',
  },
  {
    id: 'lidl',
    name: 'Lidl',
    theme: '#0050aa',
    sourceUrl: 'https://www.lidl.com/',
    sourceLabel: 'myLidl Deals',
    logoUrl: 'https://www.lidl.com/assets/images/logo-lidl-header.svg',
  },
  {
    id: 'target',
    name: 'Target',
    theme: '#cc0000',
    sourceUrl: 'https://www.target.com/c/grocery-deals/-/N-k4uyq',
    sourceLabel: 'Grocery Deals',
    logoUrl: 'https://www.target.com/icons/light/BullseyeRed.svg',
  },
  {
    id: 'kroger',
    name: 'Kroger',
    theme: '#0f52a2',
    sourceUrl: 'https://www.kroger.com/pr/top-deals',
    sourceLabel: 'Top Deals',
    logoUrl:
      'https://www.kroger.com/content/v2/binary/image/banner/logowhite/imageset/kroger_svg_logo_link_white--kroger_svg_logo_link_white--freshcart-singlecolor.svg',
  },
]

async function readExistingFeed() {
  try {
    const raw = await fs.readFile(outputFile, 'utf8')
    const parsed = JSON.parse(raw)

    if (!parsed || !Array.isArray(parsed.stores)) {
      return null
    }

    return parsed
  } catch {
    return null
  }
}

async function readExistingCatalog() {
  try {
    const raw = await fs.readFile(catalogOutputFile, 'utf8')
    const parsed = JSON.parse(raw)

    if (!parsed || !Array.isArray(parsed.items)) {
      return null
    }

    return parsed
  } catch {
    return null
  }
}

function normalizeText(value = '') {
  return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
}

function slugify(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

function absoluteUrl(baseUrl, href) {
  if (!href) {
    return undefined
  }

  return new URL(href, baseUrl).toString()
}

function dedupeDeals(deals) {
  const seen = new Set()

  return deals.filter((deal) => {
    const key = `${deal.title}::${deal.price}`.toLowerCase()

    if (seen.has(key)) {
      return false
    }

    seen.add(key)
    return true
  })
}

function dealScore(deal) {
  let score = 0
  const haystack = `${deal.title} ${deal.detail ?? ''} ${deal.category ?? ''}`

  if (groceryKeywords.test(haystack)) {
    score += 5
  }

  if (deal.previousPrice) {
    score += 4
  }

  if (deal.savings) {
    score += 3
  }

  if (deal.expires) {
    score += 2
  }

  if (deal.price.startsWith('$')) {
    score += 1
  }

  return score
}

function prioritizeDeals(deals, maxItems = 10) {
  return [...deals]
    .sort((left, right) => dealScore(right) - dealScore(left) || left.title.localeCompare(right.title))
    .slice(0, maxItems)
}

function preferGroceryDeals(deals) {
  const filtered = deals.filter((deal) => {
    const haystack = `${deal.title} ${deal.detail ?? ''}`
    return groceryKeywords.test(haystack) && !mixedMerchandiseKeywords.test(haystack)
  })

  return filtered.length >= 4 ? filtered : deals
}

function normalizeCompactPrice(value) {
  const cleaned = value.replace(/[^0-9.]/g, '')

  if (!cleaned) {
    return ''
  }

  if (cleaned.includes('.')) {
    return cleaned
  }

  if (cleaned.length === 1) {
    return `0.0${cleaned}`
  }

  if (cleaned.length === 2) {
    return `0.${cleaned}`
  }

  return `${cleaned.slice(0, -2)}.${cleaned.slice(-2)}`
}

function buildStore(config, logoPath, fetchedAt, deals, extra = {}) {
  const normalizedDeals = prioritizeDeals(
    dedupeDeals(
      deals
        .filter((deal) => deal.title && deal.price)
        .map((deal, index) => ({
          id: `${config.id}-${slugify(deal.title)}-${index + 1}`,
          title: normalizeText(deal.title),
          price: normalizeText(deal.price),
          previousPrice: normalizeText(deal.previousPrice ?? ''),
          savings: normalizeText(deal.savings ?? ''),
          detail: normalizeText(deal.detail ?? ''),
          expires: normalizeText(deal.expires ?? ''),
          category: normalizeText(deal.category ?? ''),
          link: deal.link ? absoluteUrl(config.sourceUrl, deal.link) : undefined,
          image: deal.image ? absoluteUrl(config.sourceUrl, deal.image) : undefined,
        })),
    ),
    8,
  )

  return {
    id: config.id,
    name: config.name,
    theme: config.theme,
    logo: logoPath,
    sourceUrl: config.sourceUrl,
    sourceLabel: config.sourceLabel,
    fetchedAt,
    status: normalizedDeals.length > 0 ? 'ok' : 'partial',
    deals: normalizedDeals,
    ...extra,
  }
}

function buildFallbackWarning(currentWarning, previousStore) {
  const base = currentWarning || 'The live scrape failed during this build.'

  if (previousStore?.fetchedAt) {
    return `${base} Showing the last successful results from ${previousStore.fetchedAt}.`
  }

  return `${base} Showing the last successful stored results instead.`
}

function stripHtml(value = '') {
  const $ = cheerio.load(`<div>${String(value)}</div>`)
  return normalizeText($.text())
}

function formatDollarValue(value) {
  if (!Number.isFinite(value)) {
    return ''
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value)
}

function toPriceValue(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value !== 'string') {
    return null
  }

  const match = value.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/)

  if (!match) {
    return null
  }

  const parsed = Number(match[1])
  return Number.isFinite(parsed) ? parsed : null
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

function buildCatalogItems(config, sourceLabel, items) {
  return items
    .map((item, index) => {
      const title = normalizeText(item.title)
      const priceValue = toPriceValue(item.priceValue ?? item.price)

      if (!title || priceValue === null) {
        return null
      }

      return {
        id: item.id ? `${config.id}-${slugify(String(item.id))}` : `${config.id}-${slugify(title)}-${index + 1}`,
        storeId: config.id,
        sourceLabel,
        title,
        price: normalizeText(item.price || formatDollarValue(priceValue)),
        priceValue,
        detail: normalizeText(item.detail ?? ''),
        category: normalizeText(item.category ?? ''),
        link: item.link ? absoluteUrl(config.sourceUrl, item.link) : undefined,
        image: item.image ? absoluteUrl(config.sourceUrl, item.image) : undefined,
      }
    })
    .filter(Boolean)
}

async function downloadLogos() {
  await fs.mkdir(logosDir, { recursive: true })

  const entries = await Promise.all(
    stores.map(async (store) => {
      try {
        const response = await fetch(store.logoUrl, {
          headers: {
            'user-agent': userAgent,
            'accept-language': 'en-US,en;q=0.9',
          },
          signal: AbortSignal.timeout(20000),
        })

        if (!response.ok) {
          throw new Error(`Logo request failed with ${response.status}`)
        }

        const contentType = response.headers.get('content-type') ?? ''
        const extension = contentType.includes('svg') ? 'svg' : 'png'
        const localName = `${store.id}.${extension}`

        await fs.writeFile(path.join(logosDir, localName), Buffer.from(await response.arrayBuffer()))
        return [store.id, `/logos/${localName}`]
      } catch (error) {
        console.warn(`[logo] ${store.name}: ${error instanceof Error ? error.message : 'Unable to fetch logo'}`)
        return [store.id, store.logoUrl]
      }
    }),
  )

  return Object.fromEntries(entries)
}

async function newPage(browser) {
  return browser.newPage({
    userAgent,
    viewport: {
      width: 1440,
      height: 1200,
    },
  })
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length)
  let nextIndex = 0

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      results[currentIndex] = await mapper(items[currentIndex], currentIndex)
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length))
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}

async function fetchHtml(url) {
  let response

  try {
    response = await fetch(url, {
      headers: {
        'user-agent': userAgent,
        'accept-language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(45000),
    })
  } catch (error) {
    throw new Error(`${url}: ${error instanceof Error ? error.message : 'Request failed'}`)
  }

  if (!response.ok) {
    throw new Error(`${url}: request returned ${response.status}`)
  }

  return response.text()
}

function parseKrogerState(html) {
  const $ = cheerio.load(html)
  const script = $('script')
    .toArray()
    .map((element) => $(element).html() ?? '')
    .find((value) => value.includes('window.__INITIAL_STATE__ = JSON.parse('))

  if (!script) {
    return null
  }

  const context = { window: {} }
  vm.runInNewContext(script, context)
  return context.window.__INITIAL_STATE__ ?? null
}

function buildKrogerProductUrl(product) {
  return `https://www.kroger.com/p/${slugify(product.description || product.title || product.upc || 'product')}/${product.upc}`
}

function parseUsdAmount(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value !== 'string') {
    return null
  }

  const match = value.match(/USD\s*([0-9]+(?:\.[0-9]+)?)/i) ?? value.match(/\$([0-9]+(?:\.[0-9]+)?)/)

  if (!match) {
    return null
  }

  const parsed = Number(match[1])
  return Number.isFinite(parsed) ? parsed : null
}

function getKrogerProductImage(images = []) {
  return (
    images.find((image) => image?.perspective === 'front' && image?.size === 'large')?.url ??
    images.find((image) => image?.perspective === 'front' && image?.size === 'xlarge')?.url ??
    images.find((image) => image?.perspective === 'front')?.url ??
    images[0]?.url ??
    ''
  )
}

function buildKrogerListingProducts(state) {
  const inlineProducts = state?.calypso?.useCases?.getProducts?.['search-grid']?.response?.data?.products ?? []

  return inlineProducts
    .map((product) => {
      const item = product?.item ?? {}
      const fulfillment =
        product?.fulfillmentSummaries?.find((summary) => summary?.type === 'PICKUP') ??
        product?.fulfillmentSummaries?.[0] ??
        {}
      const upc = normalizeText(item.upc ?? product?.id ?? '')
      const title = normalizeText(item.description ?? '')
      const salePriceValue = parseUsdAmount(fulfillment?.sale?.price) ?? parseUsdAmount(product?.price?.storePrices?.promo?.price)
      const regularPriceValue =
        parseUsdAmount(fulfillment?.regular?.price) ?? parseUsdAmount(product?.price?.storePrices?.regular?.price)
      const priceValue = salePriceValue ?? regularPriceValue

      if (!upc || !title || priceValue === null) {
        return null
      }

      const promoDescription = normalizeText(
        fulfillment?.sale?.priceString ?? product?.price?.storePrices?.promo?.defaultDescription ?? '',
      )
      const detail = normalizeText(
        [item?.brand?.name ?? '', fulfillment?.sale?.pricePerUnitString ?? fulfillment?.regular?.pricePerUnitString ?? item?.customerFacingSize ?? '']
          .filter(Boolean)
          .join(' • '),
      )

      return {
        upc,
        description: title,
        title,
        priceValue,
        price: promoDescription || formatDollarValue(priceValue),
        previousPrice:
          salePriceValue !== null && regularPriceValue !== null && regularPriceValue > salePriceValue
            ? formatDollarValue(regularPriceValue)
            : '',
        detail,
        category: normalizeText(item?.categories?.[0]?.name ?? item?.familyTree?.department?.name ?? ''),
        link: buildKrogerProductUrl({ upc, description: title }),
        image: getKrogerProductImage(item?.images ?? []),
        expires:
          fulfillment?.sale?.expirationDate?.value ?? product?.price?.storePrices?.promo?.expirationDate?.value ?? '',
      }
    })
    .filter(Boolean)
}

function getKrogerPrimaryCategory($) {
  const breadcrumbs = $('nav.kds-Breadcrumb li a')
    .map((_, element) => normalizeText($(element).text()))
    .get()
    .filter(Boolean)

  return breadcrumbs.at(-1) ?? ''
}

async function scrapeKrogerListingPage(url) {
  const html = await fetchHtml(url)
  const state = parseKrogerState(html)
  const $ = cheerio.load(html)
  const inlineProducts = buildKrogerListingProducts(state)

  return {
    title:
      normalizeText($('main h1').first().text()) ||
      normalizeText($('title').first().text().replace(/\s*-\s*Kroger$/i, '')),
    products:
      inlineProducts.length > 0
        ? inlineProducts
        : state?.search?.searchAll?.response?.products?.map((product) => ({
            upc: product.upc ?? product.gtin13 ?? '',
            description: normalizeText(product.description ?? ''),
          })) ?? [],
  }
}

async function fetchKrogerProduct(product) {
  const url = buildKrogerProductUrl(product)
  const html = await fetchHtml(url)
  const $ = cheerio.load(html)
  const priceNode = $('data.kds-Price').first()
  const priceValue = toPriceValue(priceNode.attr('value') ?? '')
  const canonical = $('link[rel="canonical"]').attr('href') ?? url
  const image =
    $('meta[property="og:image"]').attr('content') ??
    $('[data-testid="main-image-container"] img').first().attr('src') ??
    ''
  const title =
    normalizeText($('[data-testid="product-details-name"]').first().text()) ||
    normalizeText(product.description)
  const previousPrice = normalizeText($('.kds-Price-original').first().text())
  const detail = normalizeText(
    [
      getKrogerPrimaryCategory($),
      $('[data-testid="product-details-upc"]').first().text(),
    ]
      .filter(Boolean)
      .join(' • '),
  )

  if (priceValue === null) {
    throw new Error(`Kroger PDP price missing for ${product.upc}`)
  }

  return {
    id: product.upc,
    title,
    priceValue,
    price: formatDollarValue(priceValue),
    previousPrice,
    detail,
    category: getKrogerPrimaryCategory($),
    link: canonical,
    image,
  }
}

async function collectKrogerDealSources() {
  let searchLinks = krogerDealSearchLinks

  try {
    const html = await fetchHtml('https://www.kroger.com/pr/top-deals')
    const $ = cheerio.load(html)
    const extractedLinks = [...new Set(
      $('a[href*="/search?"]')
        .map((_, element) => $(element).attr('href') ?? '')
        .get()
        .filter(Boolean),
    )]

    if (extractedLinks.length > 0) {
      searchLinks = extractedLinks
    }
  } catch (error) {
    console.warn(
      `[kroger] top deals source fallback: ${error instanceof Error ? error.message : 'Unable to load top deals page'}`,
    )
  }

  return searchLinks.map((href, index) => ({
    sourceLabel: index === 0 ? 'Top Deals' : 'Top Deals',
    url: absoluteUrl('https://www.kroger.com/pr/top-deals', href),
    maxItems: 8,
  }))
}

async function collectKrogerCatalogSources() {
  const dealSources = await collectKrogerDealSources()
  let categoryLinks = krogerGroceryCategoryLinks

  try {
    const html = await fetchHtml('https://www.kroger.com/d/grocery')
    const $ = cheerio.load(html)
    const extractedLinks = [...new Set(
      $('a[href^="/pl/"]')
        .map((_, element) => $(element).attr('href') ?? '')
        .get()
        .filter((href) => href && !href.includes('brandName=')),
    )]

    if (extractedLinks.length > 0) {
      categoryLinks = extractedLinks
    }
  } catch (error) {
    console.warn(
      `[kroger] grocery source fallback: ${error instanceof Error ? error.message : 'Unable to load grocery page'}`,
    )
    categoryLinks = []
  }

  return [
    ...categoryLinks.slice(0, 12).map((href) => ({
      sourceLabel: 'Grocery',
      url: absoluteUrl('https://www.kroger.com/d/grocery', href),
      maxItems: 16,
    })),
    ...dealSources.map((source) => ({
      ...source,
      maxItems: 10,
    })),
  ]
}

async function scrapeWegmans(browser, logoPath, fetchedAt) {
  const config = stores.find((store) => store.id === 'wegmans')
  const page = await newPage(browser)

  try {
    await page.goto(config.sourceUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 90000,
    })
    await page.waitForTimeout(5000)

    const extracted = await page.evaluate(() => {
      const normalize = (value = '') => value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
      return Array.from(document.querySelectorAll('button.tw\\:text-left')).map((tile) => {
        const title = normalize(tile.querySelector('[data-testid="-baseHeading"]')?.textContent ?? '')
        const price = normalize(tile.querySelector('[data-testid="layout-container"] .price b')?.textContent ?? '')
        const unit = normalize(tile.querySelector('[data-testid="layout-container"] .price-per-unit')?.textContent ?? '')
        const image = tile.querySelector('img')?.getAttribute('src') ?? ''
        const section = normalize(
          tile
            .closest('section')
            ?.querySelector('header [data-testid="-baseHeading"]')
            ?.textContent ?? '',
        )

        return {
          title,
          price,
          detail: unit ? `Unit ${unit.replace(/^\(|\)$/g, '')}` : '',
          category: section,
          image,
        }
      }).filter((deal) => deal.title && deal.price && !/^Hot Zone /i.test(deal.title))
    })

    return buildStore(config, logoPath, fetchedAt, extracted, {
      rangeLabel: 'Current Hot Zone grocery prices',
    })
  } finally {
    await page.close()
  }
}

async function scrapeAldi(browser, logoPath, fetchedAt) {
  const config = stores.find((store) => store.id === 'aldi')
  const page = await newPage(browser)

  try {
    await page.goto(config.sourceUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 90000,
    })
    await page.waitForTimeout(5000)

    const extracted = await page.evaluate(() => {
      const normalize = (value = '') => value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
      const bodyText = normalize(document.body.innerText)
      const rangeLabel = bodyText.match(/\b\d{2}\/\d{2}\/\d{4}\s*-\s*\d{2}\/\d{2}\/\d{4}\b/)?.[0] ?? ''

      const deals = Array.from(document.querySelectorAll('.product-tile')).map((card) => {
        const link = card.querySelector('a.base-link')
        const brand = normalize(card.querySelector('.product-tile__brandname')?.textContent ?? '')
        const title = normalize(card.querySelector('.product-tile__name')?.textContent ?? '')
        const unit = normalize(card.querySelector('.product-tile__unit-of-measurement')?.textContent ?? '')
        const price = normalize(card.querySelector('.product-tile__price')?.textContent ?? '')

        return {
          title,
          price,
          detail: [brand, unit].filter(Boolean).join(' • '),
          link: link?.getAttribute('href') ?? '',
          category: "ALDI Finds",
          image: card.querySelector('.product-tile__picture img')?.getAttribute('src') ?? '',
        }
      })

      return {
        rangeLabel,
        deals,
      }
    })

    return buildStore(config, logoPath, fetchedAt, preferGroceryDeals(extracted.deals), {
      rangeLabel: extracted.rangeLabel || "This week's ALDI Finds",
    })
  } finally {
    await page.close()
  }
}

async function scrapeLidl(browser, logoPath, fetchedAt) {
  const config = stores.find((store) => store.id === 'lidl')
  const page = await newPage(browser)

  try {
    await page.goto(config.sourceUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 90000,
    })
    await page.waitForTimeout(6000)

    const extracted = await page.evaluate(() => {
      const normalize = (value = '') => value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()

      return Array.from(document.querySelectorAll('a.clickable.link[href*="/products/"]')).map((link) => ({
        title: normalize(link.querySelector('h2')?.textContent ?? ''),
        price: normalize(link.querySelector('[class*="_price_"]')?.textContent ?? '').replace(/\*+$/g, ''),
        previousPrice: normalize(link.querySelector('[class*="_strike_"]')?.textContent ?? ''),
        savings: normalize(link.querySelector('.product-badge__text')?.textContent ?? ''),
        detail: '',
        link: link.getAttribute('href') ?? '',
        category: 'myLidl Deals',
        image: link.querySelector('img')?.getAttribute('src') ?? link.querySelector('img')?.getAttribute('data-src') ?? '',
      }))
    })

    return buildStore(config, logoPath, fetchedAt, preferGroceryDeals(extracted), {
      rangeLabel: 'Current myLidl deals',
    })
  } finally {
    await page.close()
  }
}

async function scrapeTarget(browser, logoPath, fetchedAt) {
  const config = stores.find((store) => store.id === 'target')
  const page = await newPage(browser)

  try {
    await page.goto(config.sourceUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 90000,
    })
    await page.waitForTimeout(5000)

    const extracted = await page.evaluate(() => {
      const normalize = (value = '') => value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
      const seen = new Set()

      return Array.from(document.querySelectorAll('img[data-test="carousel-tile-image"]'))
        .map((imageNode) => {
          const wrapper = imageNode.parentElement?.parentElement
          const detailArea = wrapper?.querySelector('div[data-test="@web/Price/PriceAndPromoMinimal"]')
          const title =
            normalize(wrapper?.querySelector('[data-test="product-title-md-lg"]')?.textContent ?? '') ||
            normalize(imageNode.getAttribute('alt') ?? '')
          const price = normalize(detailArea?.querySelector('span')?.textContent ?? '')
          const detail = normalize(
            detailArea?.querySelector('[data-test="@web/Price/PriceAndPromoMinimal/PromoDetails"]')?.textContent ?? '',
          )
          const link =
            wrapper?.querySelector('a[data-test="item-link"]')?.getAttribute('href') ??
            imageNode.closest('a[data-test="item-link"]')?.getAttribute('href') ??
            ''
          const image = imageNode.getAttribute('src') ?? ''
          const key = `${title}::${price}`

          if (!title || !price || seen.has(key)) {
            return null
          }

          seen.add(key)

          return {
            title,
            price,
            detail,
            category: 'Target Grocery Deals',
            image,
            link,
          }
        })
        .filter(Boolean)
    })

    return buildStore(config, logoPath, fetchedAt, extracted, {
      rangeLabel: 'Current grocery product deals',
    })
  } finally {
    await page.close()
  }
}

async function scrapeKroger(logoPath, fetchedAt) {
  const config = stores.find((store) => store.id === 'kroger')
  const sources = await collectKrogerDealSources()
  const listingProducts = []

  for (const source of sources) {
    let listing

    try {
      listing = await scrapeKrogerListingPage(source.url)
    } catch (error) {
      console.warn(`[kroger] ${source.url}: ${error instanceof Error ? error.message : 'Unable to load listing page'}`)
      continue
    }

    listingProducts.push(
      ...listing.products.slice(0, source.maxItems).map((product) => ({
        ...product,
        sourceLabel: source.sourceLabel,
        category: listing.title || source.sourceLabel,
      })),
    )
  }

  const dedupedProducts = [...new Map(listingProducts.map((product) => [product.upc, product])).values()]
  const productsToUse =
    dedupedProducts.length > 0
      ? dedupedProducts
      : krogerSeedProducts.map((product) => ({
          ...product,
          sourceLabel: 'Grocery',
          category: 'Kroger Grocery',
        }))
  const inlineProducts = productsToUse.filter((product) => product.priceValue !== undefined && product.title)
  const productsToEnrich = productsToUse.filter((product) => product.priceValue === undefined || !product.title)
  const enriched = (
    await mapWithConcurrency(productsToEnrich, 6, async (product) => {
      try {
        return await fetchKrogerProduct(product)
      } catch (error) {
        console.warn(
          `[kroger] ${product.upc}: ${error instanceof Error ? error.message : 'Unable to enrich product'}`,
        )
        return null
      }
    })
  ).filter(Boolean)
  const finalProducts = inlineProducts.length + enriched.length > 0 ? [...inlineProducts, ...enriched] : krogerStaticFallbackItems

  return buildStore(
    config,
    logoPath,
    fetchedAt,
    finalProducts.map((product) => ({
      title: product.title,
      price: product.price,
      previousPrice: product.previousPrice,
      detail: product.detail,
      expires: product.expires,
      link: product.link,
      image: product.image,
      category: product.category || 'Top Deals',
    })),
    {
      rangeLabel: 'Current Kroger top deals',
    },
  )
}

async function scrapeWalmart(logoPath, fetchedAt) {
  const config = stores.find((store) => store.id === 'walmart')
  const response = await fetch(config.sourceUrl, {
    headers: {
      'user-agent': userAgent,
      'accept-language': 'en-US,en;q=0.9',
    },
  })

  if (!response.ok) {
    throw new Error(`Walmart returned ${response.status}`)
  }

  const html = await response.text()
  const $ = cheerio.load(html)

  const deals = $('[data-testid="item-stack"] [data-item-id]')
    .map((_, element) => {
      const card = $(element)
      const title = normalizeText(card.find('[data-automation-id="product-title"]').first().text())
      const cardText = normalizeText(card.text())
      const priceText = normalizeText(card.find('[data-automation-id="product-price"]').first().text())
      const priceMatch =
        priceText.match(/current price Now \$(\d+(?:\.\d{2})?)/i)?.[1] ??
        cardText.match(/(?:Now|From)\s+\$(\d+(?:\.\d{2})?)/i)?.[1] ??
        cardText.match(/\$(\d+(?:\.\d{2})?)/)?.[1] ??
        priceText.match(/(?:Now|From)\$([0-9]+)/i)?.[1] ??
        ''
      const previousPrice = cardText.match(/Was\s*\$(\d+(?:\.\d{2})?)/i)?.[1] ?? ''
      const link = card.find('a[href*="/ip/"]').first().attr('href') ?? ''
      const unit = cardText.match(/\d+(?:\.\d+)?\s*(?:¢|c)\/(?:lb|oz|ea|each)\b/i)?.[0] ?? ''
      const savings =
        previousPrice && priceMatch
          ? `Save $${Math.max(Number(previousPrice) - Number(normalizeCompactPrice(priceMatch)), 0).toFixed(2)}`
          : ''

      return {
        title,
        price: priceMatch ? `$${normalizeCompactPrice(priceMatch)}` : '',
        previousPrice: previousPrice ? `$${previousPrice}` : '',
        savings,
        detail: unit,
        link,
        category: cardText.includes('Rollback') ? 'Rollback' : 'Groceries deal',
        image:
          card.find('img[data-testid="productTileImage"]').first().attr('src') ??
          card.find('img').first().attr('src') ??
          '',
      }
    })
    .get()

  return buildStore(config, logoPath, fetchedAt, deals, {
    rangeLabel: 'Current Walmart grocery deals',
  })
}

async function scrapeWegmansCatalog() {
  const config = stores.find((store) => store.id === 'wegmans')
  const endpoint =
    'https://qgppr19v8v-dsn.algolia.net/1/indexes/*/queries?x-algolia-agent=Algolia%20for%20JavaScript%20(5.37.0)%3B%20Search%20(5.37.0)%3B%20Browser&x-algolia-api-key=9a10b1401634e9a6e55161c3a60c200d&x-algolia-application-id=QGPPR19V8V'
  const hitsPerPage = 1000
  const items = []
  let pageNumber = 0
  let totalPages = 1

  while (pageNumber < totalPages) {
    const body = {
      requests: [
        {
          indexName: 'products',
          analytics: false,
          attributesToHighlight: [],
          clickAnalytics: false,
          enableRules: true,
          facets: ['*'],
          filters: 'storeNumber:41 AND excludeFromWeb:false AND isSoldAtStore:true AND fulfilmentType:instore',
          highlightPostTag: '__/ais-highlight__',
          highlightPreTag: '__ais-highlight__',
          hitsPerPage,
          maxValuesPerFacet: 1000,
          page: pageNumber,
          responseFields: ['hits', 'nbHits', 'nbPages', 'page', 'hitsPerPage'],
          ruleContexts: ['clp', 'departments', 'store-41', 'fulfillment-instore', 'anonymous'],
          userToken: 'anonymous-grobots',
        },
      ],
    }
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': userAgent,
        'accept-language': 'en-US,en;q=0.9',
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      throw new Error(`Wegmans catalog returned ${response.status}`)
    }

    const payload = await response.json()
    const result = payload.results?.[0]

    if (!result) {
      break
    }

    totalPages = result.nbPages ?? totalPages
    pageNumber += 1

    items.push(
      ...buildCatalogItems(
        config,
        'Shop Categories',
        result.hits
          .filter((hit) => (hit.price_inStore?.amount ?? hit.price_delivery?.amount) !== undefined && hit.isAvailable !== false)
          .map((hit) => ({
            id: hit.objectID ?? hit.productId,
            title: hit.productName ?? hit.webProductDescription,
            priceValue: hit.price_inStore?.amount ?? hit.price_delivery?.amount,
            price: formatDollarValue(hit.price_inStore?.amount ?? hit.price_delivery?.amount),
            detail: [hit.packSize, hit.price_inStore?.unitPrice ?? hit.price_delivery?.unitPrice].filter(Boolean).join(' • '),
            category: hit.categories?.lvl0 ?? hit.categoryNodes?.lvl0 ?? '',
            link: hit.slug ? `/shop/product/${hit.slug}` : '',
            image: hit.images?.[0] ?? '',
          })),
      ),
    )
  }

  return items
}

async function scrapeAldiCatalogPage(url, sourceLabel) {
  const config = stores.find((store) => store.id === 'aldi')
  const response = await fetch(url, {
    headers: {
      'user-agent': userAgent,
      'accept-language': 'en-US,en;q=0.9',
    },
  })

  if (!response.ok) {
    throw new Error(`ALDI catalog returned ${response.status}`)
  }

  const html = await response.text()
  const $ = cheerio.load(html)
  const items = buildCatalogItems(
    config,
    sourceLabel,
    $('.product-tile')
      .map((_, element) => {
        const card = $(element)
        const link = card.find('a.base-link').first()

        return {
          id: link.attr('href') ?? '',
          title: card.find('.product-tile__name').first().text(),
          price: card.find('.product-tile__price').first().text(),
          detail: [card.find('.product-tile__brandname').first().text(), card.find('.product-tile__unit-of-measurement').first().text()]
            .filter(Boolean)
            .join(' • '),
          category: sourceLabel,
          link: link.attr('href') ?? '',
          image: card.find('.product-tile__picture img').first().attr('src') ?? '',
        }
      })
      .get(),
  )
  const totalPages = Math.max(
    1,
    ...$('.base-pagination a')
      .map((_, element) => {
        const href = $(element).attr('href') ?? ''
        const page = href.match(/page=(\d+)/i)?.[1]
        return page ? Number(page) : 1
      })
      .get(),
  )

  return {
    items,
    totalPages,
  }
}

async function scrapeAldiCatalog() {
  const baseUrl = 'https://www.aldi.us/products'
  const productPage = await scrapeAldiCatalogPage(baseUrl, 'All Products')
  const items = [...productPage.items]

  for (let pageNumber = 2; pageNumber <= productPage.totalPages; pageNumber += 1) {
    const page = await scrapeAldiCatalogPage(`${baseUrl}?page=${pageNumber}`, 'All Products')
    items.push(...page.items)
  }

  const findsPage = await scrapeAldiCatalogPage(
    'https://www.aldi.us/weekly-specials/this-weeks-aldi-finds',
    "This Week's ALDI Finds",
  )
  items.push(...findsPage.items)

  return items
}

async function scrapeLidlCatalog(browser) {
  const config = stores.find((store) => store.id === 'lidl')
  const response = await fetch('https://mobileapi.lidl.com/v1/categories?includeProducts=true&sort=productAtoZ&storeId=US01053', {
    headers: {
      'user-agent': userAgent,
      'accept-language': 'en-US,en;q=0.9',
    },
  })

  if (!response.ok) {
    throw new Error(`Lidl catalog returned ${response.status}`)
  }

  const categories = await response.json()
  const items = buildCatalogItems(
    config,
    'Products',
    categories.flatMap((category) =>
      (category.products ?? []).map((product) => ({
        id: product.id ?? product.itemId,
        title: product.name,
        priceValue:
          product.priceInformation?.myLidlPrice?.currentPrice?.value ??
          product.priceInformation?.promotionPrice?.currentPrice?.value ??
          product.priceInformation?.currentPrice?.currentPrice?.value,
        detail: [
          product.description,
          product.priceInformation?.currentPrice?.currentPrice?.basePriceText,
        ]
          .filter(Boolean)
          .join(' • '),
        category: category.name?.en ?? 'Products',
        image: product.images?.[0]?.url ?? '',
      })),
    ),
  )

  const promoPages = [
    { url: 'https://www.lidl.com/mylidl-deals?category=all', sourceLabel: 'myLidl Deals' },
    { url: 'https://www.lidl.com/specials?category=all-current', sourceLabel: 'Specials' },
  ]

  for (const entry of promoPages) {
    const page = await newPage(browser)

    try {
      await page.goto(entry.url, {
        waitUntil: 'domcontentloaded',
        timeout: 90000,
      })
      await page.waitForTimeout(6000)

      const extracted = await page.evaluate((sourceLabel) => {
        const normalize = (value = '') => value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
        return Array.from(document.querySelectorAll('a.clickable.link[href*="/products/"]')).map((link) => ({
          id: link.getAttribute('href') ?? '',
          title: normalize(link.querySelector('h2')?.textContent ?? ''),
          price: normalize(link.querySelector('[class*="_price_"]')?.textContent ?? '').replace(/\*+$/g, ''),
          detail: normalize(link.querySelector('[class*="_strike_"]')?.textContent ?? ''),
          category: sourceLabel,
          link: link.getAttribute('href') ?? '',
          image: link.querySelector('img')?.getAttribute('src') ?? link.querySelector('img')?.getAttribute('data-src') ?? '',
        }))
      }, entry.sourceLabel)

      items.push(...buildCatalogItems(config, entry.sourceLabel, extracted))
    } finally {
      await page.close()
    }
  }

  return items
}

function buildTargetCatalogUrl(categoryId, offset, pagePath) {
  const url = new URL('https://redsky.target.com/redsky_aggregations/v1/web/plp_search_v2')
  const defaultParams = {
    default_purchasability_filter: 'true',
    include_sponsored: 'true',
    include_review_summarization: 'true',
    platform: 'desktop',
    pricing_store_id: '772',
    spellcheck: 'true',
    store_ids: '772,2175,2138,1857,2017',
    visitor_id: '019CC995BE1C0200A15D07904C0B0080',
    scheduled_delivery_store_id: '772',
    zip: '22407',
    key: '9f36aeafbe60771e321a7cc95a78140772ab3e96',
    channel: 'WEB',
    include_dmc_dmr: 'true',
    useragent: 'Mozilla/5.0',
  }

  for (const [key, value] of Object.entries(defaultParams)) {
    url.searchParams.set(key, value)
  }

  url.searchParams.set('category', categoryId)
  url.searchParams.set('count', '24')
  url.searchParams.set('offset', String(offset))
  url.searchParams.set('page', pagePath)
  return url.toString()
}

async function scrapeTargetCatalogByCategory(categoryId, pagePath, sourceLabel) {
  const config = stores.find((store) => store.id === 'target')
  const items = []
  let offset = 0
  let totalPages = 1
  let currentPage = 1

  while (currentPage <= totalPages) {
    const response = await fetch(buildTargetCatalogUrl(categoryId, offset, pagePath), {
      headers: {
        'user-agent': userAgent,
        'accept-language': 'en-US,en;q=0.9',
      },
    })

    if (!response.ok) {
      throw new Error(`Target catalog returned ${response.status}`)
    }

    const payload = await response.json()
    const products = payload.data?.search?.products ?? []
    const metadata = payload.data?.search?.search_response?.metadata

    if (products.length === 0) {
      break
    }

    totalPages = metadata?.total_pages ?? totalPages
    currentPage = metadata?.current_page ?? currentPage

    items.push(
      ...buildCatalogItems(
        config,
        sourceLabel,
        products.map((product) => ({
          id: product.tcin,
          title: stripHtml(product.item?.product_description?.title ?? product.item?.enrichment?.buy_url ?? ''),
          priceValue:
            product.price?.current_retail ??
            product.price?.formatted_current_price,
          detail: [
            stripHtml(product.item?.product_description?.bullet_descriptions?.[0] ?? ''),
            product.item?.primary_brand?.name,
          ]
            .filter(Boolean)
            .join(' • '),
          category: sourceLabel,
          link: product.item?.enrichment?.buy_url ?? (product.tcin ? `/p/-/A-${product.tcin}` : ''),
          image: product.item?.enrichment?.images?.primary_image_url ?? '',
        })),
      ),
    )

    if (currentPage >= totalPages) {
      break
    }

    offset += 24
    currentPage += 1
  }

  return items
}

async function scrapeTargetCatalog() {
  const items = await scrapeTargetCatalogByCategory('5xt1a', '/c/grocery/-/N-5xt1a', 'Grocery')
  items.push(
    ...(await scrapeTargetCatalogByCategory(
      'k4uyq',
      '/c/grocery-deals/-/N-k4uyq',
      'Grocery Deals',
    )),
  )
  return items
}

async function scrapeWalmartCatalog() {
  const config = stores.find((store) => store.id === 'walmart')
  const urls = [
    {
      url: 'https://www.walmart.com/c/kp/groceries-deals',
      sourceLabel: 'Groceries Deals',
    },
    {
      url: 'https://www.walmart.com/cp/food/976759?povid=GlobalNav_rWeb_Grocery_GroceryShopAll',
      sourceLabel: 'Food Shop All',
    },
  ]
  const items = []

  for (const source of urls) {
    const response = await fetch(source.url, {
      headers: {
        'user-agent': userAgent,
        'accept-language': 'en-US,en;q=0.9',
      },
    })

    if (!response.ok) {
      throw new Error(`Walmart catalog returned ${response.status}`)
    }

    const html = await response.text()
    const $ = cheerio.load(html)

    items.push(
      ...buildCatalogItems(
        config,
        source.sourceLabel,
        $('[data-item-id]')
          .map((_, element) => {
            const card = $(element)
            const cardText = normalizeText(card.text())
            const priceText = normalizeText(card.find('[data-automation-id="product-price"]').first().text())
            const priceMatch =
              priceText.match(/current price Now \$(\d+(?:\.\d{2})?)/i)?.[1] ??
              cardText.match(/(?:Now|From)\s+\$(\d+(?:\.\d{2})?)/i)?.[1] ??
              cardText.match(/\$(\d+(?:\.\d{2})?)/)?.[1] ??
              ''

            return {
              id: card.attr('data-item-id') ?? card.find('a[href*="/ip/"]').first().attr('href') ?? '',
              title: card.find('[data-automation-id="product-title"]').first().text(),
              price: priceMatch ? `$${normalizeCompactPrice(priceMatch)}` : '',
              detail:
                normalizeText(card.find('[data-automation-id="product-subtitle"]').first().text()) ||
                normalizeText(card.find('img').first().attr('alt') ?? ''),
              category: source.sourceLabel,
              link: card.find('a[href*="/ip/"]').first().attr('href') ?? '',
              image:
                card.find('img[data-testid="productTileImage"]').first().attr('src') ??
                card.find('img').first().attr('src') ??
                '',
            }
          })
          .get(),
      ),
    )
  }

  return items
}

async function scrapeKrogerCatalog() {
  const config = stores.find((store) => store.id === 'kroger')
  const sources = await collectKrogerCatalogSources()
  const sourceItems = []

  for (const source of sources) {
    let listing

    try {
      listing = await scrapeKrogerListingPage(source.url)
    } catch (error) {
      console.warn(
        `[kroger catalog] ${source.url}: ${error instanceof Error ? error.message : 'Unable to load listing page'}`,
      )
      continue
    }

    sourceItems.push(
      ...listing.products.slice(0, source.maxItems).map((product) => ({
        ...product,
        sourceLabel: source.sourceLabel,
        category: listing.title || source.sourceLabel,
      })),
    )
  }

  const dedupedProducts = [...new Map(sourceItems.map((product) => [product.upc, product])).values()]
  const productsToUse =
    dedupedProducts.length > 0
      ? dedupedProducts
      : krogerSeedProducts.map((product) => ({
          ...product,
          sourceLabel: 'Grocery',
          category: 'Kroger Grocery',
        }))
  const inlineProducts = productsToUse.filter((product) => product.priceValue !== undefined && product.title)
  const productsToEnrich = productsToUse.filter((product) => product.priceValue === undefined || !product.title)
  const enriched = (
    await mapWithConcurrency(productsToEnrich, 6, async (product) => {
      try {
        return {
          sourceLabel: product.sourceLabel,
          ...(await fetchKrogerProduct(product)),
        }
      } catch (error) {
        console.warn(
          `[kroger catalog] ${product.upc}: ${error instanceof Error ? error.message : 'Unable to enrich product'}`,
        )
        return null
      }
    })
  ).filter(Boolean)
  const finalProducts = inlineProducts.length + enriched.length > 0 ? [...inlineProducts, ...enriched] : krogerStaticFallbackItems

  const itemsBySource = new Map()

  for (const product of finalProducts) {
    const key = product.sourceLabel || 'Grocery'
    if (!itemsBySource.has(key)) {
      itemsBySource.set(key, [])
    }

    itemsBySource.get(key).push({
      id: product.id,
      title: product.title,
      priceValue: product.priceValue,
      price: product.price,
      detail: product.detail,
      category: product.category,
      link: product.link,
      image: product.image,
    })
  }

  return [...itemsBySource.entries()].flatMap(([sourceLabel, items]) => buildCatalogItems(config, sourceLabel, items))
}

export async function scrapeKrogerData() {
  const fetchedAt = new Date().toISOString()
  const logos = await downloadLogos()

  return {
    store: await scrapeKroger(logos.kroger ?? stores.find((store) => store.id === 'kroger').logoUrl, fetchedAt),
    catalogItems: await scrapeKrogerCatalog(),
    fetchedAt,
  }
}

async function scrapeBestPriceCatalog(browser) {
  const existingCatalog = await readExistingCatalog()
  const tasks = [
    ['wegmans', () => scrapeWegmansCatalog()],
    ['aldi', () => scrapeAldiCatalog()],
    ['lidl', () => scrapeLidlCatalog(browser)],
    ['target', () => scrapeTargetCatalog()],
    ['walmart', () => scrapeWalmartCatalog()],
    ['kroger', () => scrapeKrogerCatalog()],
  ]
  const allItems = []

  for (const [storeId, task] of tasks) {
    try {
      const items = await task()
      console.log(`[catalog] ${storeId}: ${items.length} items`)
      allItems.push(...items)
    } catch (error) {
      const previousItems = existingCatalog?.items?.filter((item) => item.storeId === storeId) ?? []
      console.warn(`[catalog] ${storeId}: ${error instanceof Error ? error.message : 'Unknown catalog failure'}`)

      if (previousItems.length > 0) {
        console.log(`[catalog] ${storeId}: using ${previousItems.length} cached items`)
        allItems.push(...previousItems)
      }
    }
  }

  return dedupeCatalogItems(allItems)
}

async function scrapeStore(config, browser, logoPath, fetchedAt) {
  try {
    if (config.id === 'wegmans') {
      return await scrapeWegmans(browser, logoPath, fetchedAt)
    }

    if (config.id === 'walmart') {
      return await scrapeWalmart(logoPath, fetchedAt)
    }

    if (config.id === 'aldi') {
      return await scrapeAldi(browser, logoPath, fetchedAt)
    }

    if (config.id === 'lidl') {
      return await scrapeLidl(browser, logoPath, fetchedAt)
    }

    if (config.id === 'target') {
      return await scrapeTarget(browser, logoPath, fetchedAt)
    }

    if (config.id === 'kroger') {
      return await scrapeKroger(logoPath, fetchedAt)
    }
  } catch (error) {
    console.warn(
      `[scrape] ${config.name}: ${error instanceof Error ? error.message : 'Unknown scrape failure'}`,
    )
  }

  return buildStore(config, logoPath, fetchedAt, [], {
    status: 'partial',
    warning: 'The official page changed or blocked this scrape. Open the source link for the latest offer list.',
  })
}

export async function scrapeAllStores() {
  await fs.mkdir(publicDir, { recursive: true })

  const fetchedAt = new Date().toISOString()
  const existingFeed = await readExistingFeed()
  const existingCatalog = await readExistingCatalog()
  const existingStores = new Map((existingFeed?.stores ?? []).map((store) => [store.id, store]))
  const logos = await downloadLogos()
  const browser = await chromium.launch({ headless: true })

  try {
    const results = []

    for (const store of stores) {
      const result = await scrapeStore(store, browser, logos[store.id] ?? store.logoUrl, fetchedAt)
      const previousStore = existingStores.get(store.id)
      const shouldUseFallback = result.deals.length === 0 && previousStore?.deals?.length > 0
      const finalStore = shouldUseFallback
        ? {
            ...previousStore,
            logo: logos[store.id] ?? previousStore.logo,
            sourceUrl: store.sourceUrl,
            sourceLabel: store.sourceLabel,
            theme: store.theme,
            warning: buildFallbackWarning(result.warning, previousStore),
          }
        : result

      results.push(finalStore)

      if (shouldUseFallback) {
        console.log(`[scrape] ${store.name}: using ${previousStore.deals.length} cached deals`)
      } else {
        console.log(`[scrape] ${store.name}: ${result.deals.length} deals`)
      }
    }

    const totalDeals = results.reduce((sum, store) => sum + store.deals.length, 0)
    const catalogItems = await scrapeBestPriceCatalog(browser)
    const dealCatalogItems = dedupeCatalogItems(
      results.flatMap((store) =>
        store.deals.map((deal) => ({
          id: `${store.id}-${slugify(deal.title)}-deal`,
          storeId: store.id,
          sourceLabel: store.sourceLabel,
          title: deal.title,
          price: deal.price,
          priceValue: toPriceValue(deal.price) ?? Number.POSITIVE_INFINITY,
          detail: deal.detail,
          category: deal.category,
          link: deal.link,
          image: deal.image,
        })),
      ),
    ).filter((item) => Number.isFinite(item.priceValue))

    const payload =
      totalDeals === 0
        ? existingFeed?.stores?.length
          ? existingFeed
          : null
        : {
            generatedAt: fetchedAt,
            stores: results,
          }

    if (!payload) {
      throw new Error('No deals were scraped from the configured stores.')
    }

    if (totalDeals === 0) {
      console.warn('[scrape] all live scrapes failed; preserved the existing stored feed')
    }

    await fs.writeFile(outputFile, `${JSON.stringify(payload, null, 2)}\n`)
    console.log(`[scrape] wrote ${outputFile}`)

    const finalCatalogItems = dedupeCatalogItems([...catalogItems, ...dealCatalogItems])

    if (finalCatalogItems.length > 0) {
      const catalogPayload = {
        generatedAt: fetchedAt,
        itemCount: finalCatalogItems.length,
        items: finalCatalogItems,
      }

      await fs.writeFile(catalogOutputFile, `${JSON.stringify(catalogPayload, null, 2)}\n`)
      console.log(`[catalog] wrote ${catalogOutputFile}`)
    } else if (existingCatalog?.items?.length) {
      await fs.writeFile(catalogOutputFile, `${JSON.stringify(existingCatalog, null, 2)}\n`)
      console.warn('[catalog] all live catalog scrapes failed; preserved the existing catalog feed')
    } else {
      throw new Error('No best-price catalog items were scraped from the configured stores.')
    }

    return payload
  } finally {
    await browser.close()
  }
}

const isDirectRun = process.argv[1] ? pathToFileURL(process.argv[1]).href === import.meta.url : false

if (isDirectRun) {
  scrapeAllStores().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}

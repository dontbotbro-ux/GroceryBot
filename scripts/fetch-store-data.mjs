import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import * as cheerio from 'cheerio'
import { chromium } from 'playwright'

const rootDir = process.cwd()
const publicDir = path.join(rootDir, 'public')
const logosDir = path.join(publicDir, 'logos')
const outputFile = path.join(publicDir, 'store-data.json')

const userAgent =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

const groceryKeywords =
  /avocado|bacon|banana|beef|bread|breakfast|candy|cereal|cheese|chicken|chips|coffee|cookie|cucumber|curry|drinks|egg|energy|fish|frozen|fruit|granola|grocery|ice cream|juice|lettuce|meal|meat|milk|momos|orange|pasta|pizza|popcorn|potato|pretzel|produce|ribs|salad|salmon|samosa|scallops|seafood|shrimp|snack|soda|spring mix|strawberries|tea|tomato|vegetable|water|watermelon|wings|yogurt/i

const mixedMerchandiseKeywords =
  /athletic|bin|box(es)?|camping|coir|garden|grid|ladies|landscape|mat|men'?s|pant|planter|sensory|shirt|storage|table/i

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
]

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
  const logos = await downloadLogos()
  const browser = await chromium.launch({ headless: true })

  try {
    const results = []

    for (const store of stores) {
      const result = await scrapeStore(store, browser, logos[store.id] ?? store.logoUrl, fetchedAt)
      results.push(result)
      console.log(`[scrape] ${store.name}: ${result.deals.length} deals`)
    }

    const totalDeals = results.reduce((sum, store) => sum + store.deals.length, 0)

    if (totalDeals === 0) {
      throw new Error('No deals were scraped from the configured stores.')
    }

    const payload = {
      generatedAt: fetchedAt,
      stores: results,
    }

    await fs.writeFile(outputFile, `${JSON.stringify(payload, null, 2)}\n`)
    console.log(`[scrape] wrote ${outputFile}`)
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

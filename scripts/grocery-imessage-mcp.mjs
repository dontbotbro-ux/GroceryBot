import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import * as z from 'zod/v4'
import { sendIMessage } from './lib/notifier.mjs'

const currentFile = fileURLToPath(import.meta.url)
const rootDir = path.resolve(path.dirname(currentFile), '..')
const storeFeedFile = path.join(rootDir, 'public', 'store-data.json')
const catalogFeedFile = path.join(rootDir, 'public', 'best-price-data.json')

function normalizeText(value = '') {
  return String(value).replace(/\s+/g, ' ').trim()
}

function normalizePhoneNumber(value = '') {
  const trimmed = String(value).trim()
  const hasLeadingPlus = trimmed.startsWith('+')
  const digits = trimmed.replace(/\D/g, '')
  return hasLeadingPlus ? `+${digits}` : digits
}

function tokenizeQuery(value = '') {
  return normalizeText(value)
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8')
  return JSON.parse(raw)
}

async function readStoreFeed() {
  return readJson(storeFeedFile)
}

async function readCatalogFeed() {
  return readJson(catalogFeedFile)
}

function matchTokens(haystack, tokens) {
  if (tokens.length === 0) {
    return true
  }

  const normalized = normalizeText(haystack).toLowerCase()
  return tokens.every((token) => normalized.includes(token))
}

function buildSummaryFromStoreFeed(feed, storeIds, dealsPerStore) {
  const selected = storeIds?.length ? new Set(storeIds) : null
  const sections = feed.stores
    .filter((store) => (selected ? selected.has(store.id) : true))
    .map((store) => {
      const deals = store.deals.slice(0, dealsPerStore)

      if (deals.length === 0) {
        return ''
      }

      return [store.name, ...deals.map((deal) => `- ${deal.title}: ${deal.price}`)].join('\n')
    })
    .filter(Boolean)

  if (sections.length === 0) {
    return `grobots deal summary\nUpdated ${feed.generatedAt}\n\nNo matching deals were available.`
  }

  return ['grobots deal summary', `Updated ${feed.generatedAt}`, '', ...sections].join('\n\n')
}

const server = new McpServer({
  name: 'grobots-local-imessage',
  version: '1.0.0',
})

server.registerTool(
  'query_grocery_database',
  {
    description: 'Query the local grobots grocery feeds on this Mac. Searches current store deals or the broader best-price catalog without sending data off-device.',
    inputSchema: {
      query: z.string().default('').describe('Search text such as "whole milk gallon", "eggs", or "bananas".'),
      source: z.enum(['deals', 'catalog']).default('catalog').describe('Which local feed to search.'),
      storeIds: z.array(z.string()).optional().describe('Optional store IDs to include, such as walmart or target.'),
      limit: z.number().int().min(1).max(50).default(10).describe('Maximum number of rows to return.'),
    },
    outputSchema: {
      source: z.enum(['deals', 'catalog']),
      generatedAt: z.string(),
      resultCount: z.number().int(),
      matches: z.array(
        z.object({
          storeId: z.string(),
          storeName: z.string(),
          title: z.string(),
          price: z.string(),
          detail: z.string(),
          category: z.string(),
          link: z.string().optional(),
        }),
      ),
    },
  },
  async ({ query, source, storeIds, limit }) => {
    const selected = storeIds?.length ? new Set(storeIds) : null
    const tokens = tokenizeQuery(query)

    if (source === 'deals') {
      const feed = await readStoreFeed()
      const matches = feed.stores
        .filter((store) => (selected ? selected.has(store.id) : true))
        .flatMap((store) =>
          store.deals
            .filter((deal) => matchTokens([deal.title, deal.detail, deal.category].filter(Boolean).join(' '), tokens))
            .map((deal) => ({
              storeId: store.id,
              storeName: store.name,
              title: deal.title,
              price: deal.price,
              detail: normalizeText(deal.detail ?? ''),
              category: normalizeText(deal.category ?? ''),
              link: deal.link,
            })),
        )
        .slice(0, limit)

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                source,
                generatedAt: feed.generatedAt,
                resultCount: matches.length,
                matches,
              },
              null,
              2,
            ),
          },
        ],
        structuredContent: {
          source,
          generatedAt: feed.generatedAt,
          resultCount: matches.length,
          matches,
        },
      }
    }

    const catalog = await readCatalogFeed()
    const storeFeed = await readStoreFeed()
    const storesById = new Map(storeFeed.stores.map((store) => [store.id, store.name]))
    const matches = catalog.items
      .filter((item) => (selected ? selected.has(item.storeId) : true))
      .filter((item) => matchTokens([item.title, item.detail, item.category, item.sourceLabel].filter(Boolean).join(' '), tokens))
      .slice(0, limit)
      .map((item) => ({
        storeId: item.storeId,
        storeName: storesById.get(item.storeId) ?? item.storeId,
        title: item.title,
        price: item.price,
        detail: normalizeText(item.detail ?? ''),
        category: normalizeText(item.category ?? item.sourceLabel ?? ''),
        link: item.link,
      }))

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              source,
              generatedAt: catalog.generatedAt,
              resultCount: matches.length,
              matches,
            },
            null,
            2,
          ),
        },
      ],
      structuredContent: {
        source,
        generatedAt: catalog.generatedAt,
        resultCount: matches.length,
        matches,
      },
    }
  },
)

server.registerTool(
  'send_grocery_imessage',
  {
    description: 'Send an iMessage from this Mac using the local Messages app. Can send a provided summary or build one from the local store feed.',
    inputSchema: {
      phoneNumber: z.string().describe('Recipient iMessage phone number, ideally in E.164 format such as +15555550123.'),
      summary: z.string().optional().describe('If provided, send this text as-is.'),
      storeIds: z.array(z.string()).optional().describe('Optional store IDs to include when auto-building a summary.'),
      dealsPerStore: z.number().int().min(1).max(8).default(3).describe('How many top deals per store to include when auto-building a summary.'),
    },
    outputSchema: {
      phoneNumber: z.string(),
      sent: z.boolean(),
      generatedAt: z.string(),
      summary: z.string(),
    },
  },
  async ({ phoneNumber, summary, storeIds, dealsPerStore }) => {
    const normalizedPhone = normalizePhoneNumber(phoneNumber)

    if (!normalizedPhone) {
      throw new Error('A valid phone number is required.')
    }

    const feed = await readStoreFeed()
    const finalSummary = normalizeText(summary) || buildSummaryFromStoreFeed(feed, storeIds, dealsPerStore)
    sendIMessage(normalizedPhone, finalSummary)

    return {
      content: [
        {
          type: 'text',
          text: `Sent grocery summary to ${normalizedPhone}.`,
        },
      ],
      structuredContent: {
        phoneNumber: normalizedPhone,
        sent: true,
        generatedAt: feed.generatedAt,
        summary: finalSummary,
      },
    }
  },
)

const transport = new StdioServerTransport()
await server.connect(transport)

import http from 'node:http'
import {
  buildSummary,
  buildStatusPayload,
  markLastError,
  previewSummary,
  readSettings,
  runNotifierDiagnostics,
  runSummaryJob,
  saveSettings,
  saveWatchlist,
  sendIMessage,
} from './lib/notifier.mjs'

const port = Number(process.env.GROBOTS_NOTIFIER_PORT || 8787)
const summaryPort = Number(process.env.GROBOTS_SUMMARY_PORT || 3000)

function buildCorsHeaders(request) {
  const origin = request.headers.origin ?? '*'

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Private-Network': 'true',
    Vary: 'Origin, Access-Control-Request-Private-Network',
  }
}

function sendJson(request, response, statusCode, payload) {
  response.writeHead(statusCode, {
    ...buildCorsHeaders(request),
    'Content-Type': 'application/json; charset=utf-8',
  })
  response.end(`${JSON.stringify(payload, null, 2)}\n`)
}

async function readBody(request) {
  const chunks = []

  for await (const chunk of request) {
    chunks.push(chunk)
  }

  if (chunks.length === 0) {
    return {}
  }

  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : {}
}

async function handleRequest(request, response) {
  if (!request.url) {
    sendJson(request, response, 400, { error: 'Missing request URL.' })
    return
  }

  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      ...buildCorsHeaders(request),
    })
    response.end()
    return
  }

  const url = new URL(request.url, `http://${request.headers.host}`)

  try {
    if (request.method === 'GET' && url.pathname === '/api/settings') {
      const settings = await readSettings()
      sendJson(request, response, 200, buildStatusPayload(settings))
      return
    }

    if (request.method === 'GET' && url.pathname === '/api/diagnostics') {
      const payload = await runNotifierDiagnostics()
      sendJson(request, response, 200, payload)
      return
    }

    if (request.method === 'POST' && url.pathname === '/api/settings') {
      const body = await readBody(request)
      const payload = await saveSettings(body)
      sendJson(request, response, 200, payload)
      return
    }

    if (request.method === 'POST' && url.pathname === '/api/watchlist') {
      const body = await readBody(request)
      const payload = await saveWatchlist(body.watchlistIds)
      sendJson(request, response, 200, payload)
      return
    }

    if (request.method === 'POST' && url.pathname === '/api/preview') {
      const body = await readBody(request)
      const payload = await previewSummary(body)
      sendJson(request, response, 200, payload)
      return
    }

    if (request.method === 'POST' && url.pathname === '/api/send-now') {
      const body = await readBody(request)
      const payload = await runSummaryJob(body)
      sendJson(request, response, 200, payload)
      return
    }

    if (request.method === 'POST' && url.pathname === '/api/send-message') {
      const body = await readBody(request)
      const phoneNumber = typeof body.phoneNumber === 'string' ? body.phoneNumber.trim() : ''
      const summary = typeof body.summary === 'string' ? body.summary.trim() : ''

      if (!phoneNumber) {
        sendJson(request, response, 400, { error: 'A phone number is required.' })
        return
      }

      if (!summary) {
        sendJson(request, response, 400, { error: 'A deal summary is required.' })
        return
      }

      sendIMessage(phoneNumber, summary)
      sendJson(request, response, 200, {
        ok: true,
        phoneNumber,
        sentAt: new Date().toISOString(),
      })
      return
    }

    if (request.method === 'POST' && url.pathname === '/send-summary') {
      const body = await readBody(request)
      const phoneNumber = typeof body.phoneNumber === 'string' ? body.phoneNumber.trim() : ''
      const summary = typeof body.summary === 'string' ? body.summary.trim() : ''

      if (!phoneNumber) {
        sendJson(request, response, 400, { error: 'A phone number is required.' })
        return
      }

      if (!summary) {
        sendJson(request, response, 400, { error: 'A deal summary is required.' })
        return
      }

      sendIMessage(phoneNumber, summary)
      sendJson(request, response, 200, {
        ok: true,
        phoneNumber,
        sentAt: new Date().toISOString(),
      })
      return
    }

    sendJson(request, response, 404, { error: 'Route not found.' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown notifier service error.'
    await markLastError(message)
    sendJson(request, response, 500, { error: message })
  }
}

const server = http.createServer(handleRequest)
server.listen(port, '127.0.0.1', () => {
  console.log(`[notifier] listening on http://127.0.0.1:${port}`)
})

if (summaryPort !== port) {
  const summaryServer = http.createServer(handleRequest)
  summaryServer.listen(summaryPort, '127.0.0.1', () => {
    console.log(`[notifier] summary endpoint listening on http://127.0.0.1:${summaryPort}`)
  })
}

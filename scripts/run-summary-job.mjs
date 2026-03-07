import { markLastError, runSummaryJob } from './lib/notifier.mjs'

try {
  const result = await runSummaryJob()
  console.log(`[summary-job] sent summary refreshed at ${result.feedGeneratedAt}`)
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown summary job failure.'
  await markLastError(message)
  console.error(message)
  process.exitCode = 1
}

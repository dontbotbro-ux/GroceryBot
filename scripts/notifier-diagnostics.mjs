import { runNotifierDiagnostics } from './lib/notifier.mjs'

const diagnostics = await runNotifierDiagnostics()
console.log(JSON.stringify(diagnostics, null, 2))

if (!diagnostics.ok) {
  process.exitCode = 1
}

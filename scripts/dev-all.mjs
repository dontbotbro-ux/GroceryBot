import path from 'node:path'
import { spawn } from 'node:child_process'

const rootDir = process.cwd()
const notifierPath = path.join(rootDir, 'scripts', 'notifier-service.mjs')
const viteCliPath = path.join(rootDir, 'node_modules', 'vite', 'bin', 'vite.js')

const children = [
  spawn(process.execPath, [notifierPath], {
    cwd: rootDir,
    stdio: 'inherit',
  }),
  spawn(process.execPath, [viteCliPath], {
    cwd: rootDir,
    stdio: 'inherit',
  }),
]

function shutdown(signal) {
  for (const child of children) {
    if (!child.killed) {
      child.kill(signal)
    }
  }
}

for (const child of children) {
  child.on('exit', (code) => {
    if (code && code !== 0) {
      shutdown('SIGTERM')
      process.exitCode = code
    }
  })
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

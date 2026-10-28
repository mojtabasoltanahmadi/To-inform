import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const children = [
  spawn(npm, ['run', 'dev'], { cwd: resolve(root, 'backend'), stdio: 'inherit' }),
  spawn(npm, ['run', 'dev'], { cwd: resolve(root, 'frontend'), stdio: 'inherit' }),
]

let stopping = false
function stop(signal = 'SIGTERM') {
  if (stopping) return
  stopping = true
  for (const child of children) {
    if (child.exitCode === null) child.kill(signal)
  }
}

for (const child of children) {
  child.on('error', (error) => {
    console.error(`Unable to start a development process: ${error.message}`)
    stop()
    process.exitCode = 1
  })
  child.on('exit', (code) => {
    if (!stopping && code !== 0) {
      process.exitCode = code || 1
      stop()
    }
  })
}

process.on('SIGINT', () => stop('SIGINT'))
process.on('SIGTERM', () => stop('SIGTERM'))

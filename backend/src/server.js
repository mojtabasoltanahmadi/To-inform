import { createApp } from './app.js'
import { config } from './config.js'
import { redisStore } from './storage/redisStore.js'

const app = createApp()
const server = app.listen(config.port, () => {
  console.log(`Notify API listening on http://localhost:${config.port}`)
})

try {
  await redisStore.connect()
  console.log('Connected to Redis.')
} catch (error) {
  console.error(`Redis is unavailable; API requests requiring storage will return 503: ${error.message}`)
}

async function shutdown() {
  server.close(async () => {
    if (redisStore.client.isOpen) await redisStore.client.quit()
    process.exit(0)
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

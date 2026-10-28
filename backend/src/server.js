import { createApp } from './app.js'
import { config } from './config.js'
import { redisStore } from './storage/redisStore.js'

const app = createApp()
const server = app.listen(config.port, () => {
  console.log(`Notify API listening on http://localhost:${config.port}`)
})

try {
  await redisStore.connect()
} catch (error) {
  // عدم اتصال اولیه نباید سرور اکسپرس را کرش کند
  console.log(`[cache] Redis در دسترس نیست؛ سرور بدون کش ادامه می‌دهد (degraded mode): ${error.message}`)
}

async function shutdown(signal) {
  console.log(`${signal} دریافت شد، در حال توقف امن سرویس...`)
  server.close(async () => {
    try {
      if (redisStore.client.isOpen) {
        await redisStore.client.quit()
      }
    } catch (err) {
      console.error(`خطا در هنگام قطع ردیس: ${err.message}`)
    }
    console.log('سرور متوقف شد.')
    process.exit(0)
  })
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
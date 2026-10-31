import { randomUUID } from 'node:crypto'
import { createClient } from 'redis'
import { config } from '../config.js'
import * as atlas from '../atlas.js'

const prefix = 'notify'
const client = createClient({
  url: config.redisUrl,
  socket: {
    reconnectStrategy(retries) {
      return Math.min(retries * 100, 3000)
    },
  },
})

let cacheUp = false

client.on('error', (error) => {
  console.log(`[cache] Redis connection error: ${error.message}`)
})

client.on('ready', () => {
  cacheUp = true
  console.log('Connected to Redis (cache)')
})

client.on('end', () => {
  cacheUp = false
  console.log('[cache] Redis connection closed — running in degraded mode')
})

const CACHE_TTL_USER = 300 // 5 دقیقه
const CACHE_TTL_TODOS = 60 // 1 دقیقه

const cache = {
  async get(key) {
    if (!cacheUp || !client.isReady) return null
    try {
      const raw = await client.get(key)
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  },
  async set(key, value, ttl) {
    if (!cacheUp || !client.isReady) return
    try {
      await client.set(key, JSON.stringify(value), { EX: ttl })
    } catch {
      // کش خطا داد عملیات اصلی نباید متوقف شود
    }
  },
  async del(...keys) {
    if (!cacheUp || !client.isReady) return
    const list = keys.flat().filter(Boolean)
    try {
      if (list.length) await client.del(list)
    } catch {
      // خطا در حذف کش لاگ نمی‌شود تا جریان اصلی قطع نشود
    }
  },
}

function parse(value) {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

export const redisStore = {
  client,
  get isCacheUp() {
    return cacheUp && client.isReady
  },
  connect() {
    if (!client.isOpen) return client.connect()
    return Promise.resolve()
  },
  async ping() {
    if (!cacheUp || !client.isReady) return false
    try {
      return (await client.ping()) === 'PONG'
    } catch {
      return false
    }
  },

  // -------------------------------------------------------------
  // کاربران (Users)
  // -------------------------------------------------------------
  async createUser(input) {
    const id = randomUUID()
    const user = {
      id,
      username: input.username,
      email: input.email,
      fullName: input.fullName,
      nationalId: input.nationalId,
      identityInfo: input.identityInfo || '',
      
      createdAt: new Date().toISOString(),
    }

    if (atlas.isConfigured()) {
      // بررسی تکراری نبودن ایمیل
      const existingEmail = await atlas.readByKey(atlas.NS_USERS, atlas.quoteKey(input.email.toLowerCase()))
      if (existingEmail.length > 0) return null

      try {
        await atlas.add(atlas.NS_USERS, [
          {
            id,
            keys: [input.username.toLowerCase(), input.email.toLowerCase()],
            body: JSON.stringify(user),
          },
        ])
        // کش کاربر را در ردیس ذخیره می‌کنیم
        await cache.set(`cache:user:${input.username.toLowerCase()}`, user, CACHE_TTL_USER)
        return user
      } catch (err) {
        if (err.status === 409 || err.code === 'DUPLICATE_KEY') return null
        throw err
      }
    }

    // حالت fallback اگر اطلس ست نبود (محلی)
    const script = `
      if redis.call('EXISTS', KEYS[2]) == 1 or redis.call('EXISTS', KEYS[3]) == 1 then
        return 0
      end
      redis.call('SET', KEYS[2], ARGV[1])
      redis.call('SET', KEYS[3], ARGV[1])
      redis.call('SET', KEYS[1], ARGV[2])
      redis.call('SADD', KEYS[4], ARGV[1])
      return 1
    `
    const created = await client.eval(script, {
      keys: [`notify:user:${id}`, `notify:username:${input.username.toLowerCase()}`, `notify:email:${input.email.toLowerCase()}`, `notify:users`],
      arguments: [id, JSON.stringify(user)],
    })
    return created === 1 ? user : null
  },

  async getUserByUsername(username) {
    const uName = username.toLowerCase()

    if (atlas.isConfigured()) {
      // ۱. بررسی کش (Cache-First)
      const cached = await cache.get(`cache:user:${uName}`)
      if (cached) return { ...cached, _cacheHit: true }

      // ۲. خواندن از اطلس
      const records = await atlas.readByKey(atlas.NS_USERS, atlas.quoteKey(uName))
      for (const record of records) {
        const user = parse(record.body)
        if ((user?.username || '').toLowerCase() === uName) {
          await cache.set(`cache:user:${uName}`, user, CACHE_TTL_USER)
          return { ...user, _cacheHit: false }
        }
      }
      return null
    }

    // حالت fallback
    const id = await client.get(`notify:username:${uName}`)
    if (!id) return null
    return parse(await client.get(`notify:user:${id}`))
  },

  async getPublicUserById(id) {
    if (atlas.isConfigured()) {
      const records = await atlas.readById(atlas.NS_USERS, [id])
      if (records.length > 0) {
        return parse(records[0].body)
      }
      return null
    }
    return parse(await client.get(`notify:user:${id}`))
  },

  // -------------------------------------------------------------
  // کارها / یادداشت‌ها (Todos / Notes)
  // -------------------------------------------------------------
  async listNotes(userId) {
    if (atlas.isConfigured()) {
      // ۱. بررسی کش
      const cached = await cache.get(`cache:todos:${userId}`)
      if (cached) return { notes: cached, cacheHit: true }

      // ۲. خواندن از اطلس
      const records = await atlas.readByKey(atlas.NS_TODOS, atlas.quoteKey(userId))
      const notes = []
      for (const r of records) {
        const item = parse(r.body)
        if (item && item.userId === userId) {
          notes.push(item)
        }
      }
      notes.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
      // ذخیره در کش
      await cache.set(`cache:todos:${userId}`, notes, CACHE_TTL_TODOS)
      return { notes, cacheHit: false }
    }

    // حالت fallback ردیس
    const ids = await client.sMembers(`notify:user:${userId}:notes`)
    if (!ids.length) return { notes: [], cacheHit: false }
    const values = await client.mGet(ids.map((id) => `notify:note:${id}`))
    const notes = values.map(parse).filter((n) => n && n.userId === userId)
    notes.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    return { notes, cacheHit: false }
  },

  async getNote(userId, id) {
    if (atlas.isConfigured()) {
      const records = await atlas.readById(atlas.NS_TODOS, [id])
      if (!records.length) return null
      const note = parse(records[0].body)
      return note?.userId === userId ? note : null
    }
    const note = parse(await client.get(`notify:note:${id}`))
    return note?.userId === userId ? note : null
  },

  async createNote(userId, input) {
    const now = new Date().toISOString()
    const note = { id: randomUUID(), userId, ...input, createdAt: now, updatedAt: now }

    if (atlas.isConfigured()) {
      await atlas.add(atlas.NS_TODOS, [
        {
          id: note.id,
          keys: [userId],
          body: JSON.stringify(note),
        },
      ])
      // Invalidate کش یادداشت‌های این کاربر
      await cache.del(`cache:todos:${userId}`)
      return note
    }

    await client.multi().set(`notify:note:${note.id}`, JSON.stringify(note)).sAdd(`notify:user:${userId}:notes`, note.id).exec()
    return note
  },

  async updateNote(userId, id, input) {
    const existing = await this.getNote(userId, id)
    if (!existing) return null

    const updated = {
      ...existing,
      ...input,
      updatedAt: new Date().toISOString(),
    }

    if (atlas.isConfigured()) {
      await atlas.modifyById(atlas.NS_TODOS, id, [userId], JSON.stringify(updated))
      // Invalidate کش
      await cache.del(`cache:todos:${userId}`)
      return updated
    }

    await client.set(`notify:note:${id}`, JSON.stringify(updated))
    return updated
  },

  async deleteNote(userId, id) {
    const existing = await this.getNote(userId, id)
    if (!existing) return false

    if (atlas.isConfigured()) {
      await atlas.removeById(atlas.NS_TODOS, [id])
      // Invalidate کش
      await cache.del(`cache:todos:${userId}`)
      return true
    }

    await client.del(`notify:note:${id}`)
    await client.sRem(`notify:user:${userId}:notes`, id)
    return true
  },
}

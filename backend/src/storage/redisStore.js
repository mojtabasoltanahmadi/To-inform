import { randomUUID } from 'node:crypto'
import { createClient } from 'redis'
import { config } from '../config.js'

const prefix = 'notify'
const client = createClient({
  url: config.redisUrl,
  socket: {
    reconnectStrategy(retries) {
      // استراتژی اتصال مجدد خودکار: تلاش مجدد با فاصله حداکثر ۳ ثانیه
      return Math.min(retries * 100, 3000)
    },
  },
})

let cacheUp = false

client.on('error', (error) => {
  // کش غیرحیاتی است؛ قطعی آن نباید باعث کرش سرور شود
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

const key = {
  user: (id) => `${prefix}:user:${id}`,
  users: `${prefix}:users`,
  username: (value) => `${prefix}:username:${value}`,
  email: (value) => `${prefix}:email:${value}`,
  note: (id) => `${prefix}:note:${id}`,
  userNotes: (id) => `${prefix}:user:${id}:notes`,
}

const updateNoteScript = `
  local raw = redis.call('GET', KEYS[1])
  if not raw then return nil end
  local decoded, note = pcall(cjson.decode, raw)
  if not decoded or type(note) ~= 'table' then return nil end
  if note['userId'] ~= ARGV[1] then return nil end
  local patchDecoded, patch = pcall(cjson.decode, ARGV[2])
  if not patchDecoded or type(patch) ~= 'table' then return nil end
  for field, value in pairs(patch) do
    note[field] = value
  end
  note['updatedAt'] = ARGV[3]
  local encoded = cjson.encode(note)
  redis.call('SET', KEYS[1], encoded)
  return encoded
`

const deleteNoteScript = `
  local raw = redis.call('GET', KEYS[1])
  if not raw then return 0 end
  local decoded, note = pcall(cjson.decode, raw)
  if not decoded or type(note) ~= 'table' or note['userId'] ~= ARGV[1] then return 0 end
  redis.call('DEL', KEYS[1])
  redis.call('SREM', KEYS[2], ARGV[2])
  return 1
`

function ensureReady() {
  if (!cacheUp || !client.isReady) {
    const error = new Error('سرویس نشست و کش در دسترس نیست، لطفاً بعداً تلاش کنید.')
    error.status = 503
    error.code = 'STORAGE_UNAVAILABLE'
    throw error
  }
}

function parse(value) {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    console.warn('Ignoring a malformed Redis record.')
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
  async createUser(input) {
    ensureReady()
    const id = randomUUID()
    const user = {
      id,
      username: input.username,
      email: input.email,
      fullName: input.fullName,
      nationalId: input.nationalId,
      identityInfo: input.identityInfo || '',
      passwordHash: input.passwordHash,
      createdAt: new Date().toISOString(),
    }
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
      keys: [key.user(id), key.username(input.username.toLowerCase()), key.email(input.email.toLowerCase()), key.users],
      arguments: [id, JSON.stringify(user)],
    })
    return created === 1 ? user : null
  },
  async getUserByUsername(username) {
    ensureReady()
    const id = await client.get(key.username(username.toLowerCase()))
    if (!id) return null
    return parse(await client.get(key.user(id)))
  },
  async getPublicUserById(id) {
    ensureReady()
    return parse(await client.get(key.user(id)))
  },
  async listNotes(userId) {
    ensureReady()
    const ids = await client.sMembers(key.userNotes(userId))
    if (!ids.length) return []

    const values = await client.mGet(ids.map(key.note))
    const notes = []
    const staleIds = []
    values.forEach((value, index) => {
      const note = parse(value)
      if (!note || note.userId !== userId) {
        staleIds.push(ids[index])
        return
      }
      notes.push(note)
    })
    if (staleIds.length) await client.sRem(key.userNotes(userId), staleIds)

    return notes.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
  },
  async getNote(userId, id) {
    ensureReady()
    const note = parse(await client.get(key.note(id)))
    return note?.userId === userId ? note : null
  },
  async createNote(userId, input) {
    ensureReady()
    const now = new Date().toISOString()
    const note = { id: randomUUID(), userId, ...input, createdAt: now, updatedAt: now }
    await client.multi().set(key.note(note.id), JSON.stringify(note)).sAdd(key.userNotes(userId), note.id).exec()
    return note
  },
  async updateNote(userId, id, input) {
    ensureReady()
    const result = await client.eval(updateNoteScript, {
      keys: [key.note(id)],
      arguments: [userId, JSON.stringify(input), new Date().toISOString()],
    })
    return parse(result)
  },
  async deleteNote(userId, id) {
    ensureReady()
    const deleted = await client.eval(deleteNoteScript, {
      keys: [key.note(id), key.userNotes(userId)],
      arguments: [userId, id],
    })
    return deleted === 1
  },
}
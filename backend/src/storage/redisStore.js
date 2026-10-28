import { randomUUID } from 'node:crypto'
import { createClient } from 'redis'
import { config } from '../config.js'

const prefix = 'notify'
const client = createClient({ url: config.redisUrl })
client.on('error', (error) => console.error('Redis connection error:', error.message))

const key = {
  user: (id) => `${prefix}:user:${id}`,
  users: `${prefix}:users`,
  username: (value) => `${prefix}:username:${value}`,
  email: (value) => `${prefix}:email:${value}`,
  note: (id) => `${prefix}:note:${id}`,
  userNotes: (id) => `${prefix}:user:${id}:notes`,
}

/*
 * Note mutations run as Lua scripts so that ownership and existence are checked in
 * the same atomic step as the write. Without this, a concurrent delete between the
 * read and the write could resurrect a deleted note (PATCH) or report a successful
 * delete twice (DELETE), and concurrent partial updates of different fields could
 * drop each other's changes.
 */
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
  if (!client.isReady) {
    const error = new Error('ذخیره‌ساز در دسترس نیست. اتصال Redis را بررسی کنید.')
    error.status = 503
    throw error
  }
}

function parse(value) {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    // A corrupted record must not take down every read that touches it.
    console.warn('Ignoring a malformed Redis record.')
    return null
  }
}

export const redisStore = {
  client,
  connect() {
    if (!client.isOpen) return client.connect()
    return Promise.resolve()
  },
  async ping() {
    if (!client.isReady) return false
    return (await client.ping()) === 'PONG'
  },
  async createUser(input) {
    ensureReady()
    const id = randomUUID()
    // Only persist known fields: the validated input still carries the plaintext
    // password, which must never reach the datastore.
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
      // Skip records that are gone, unreadable, or not owned by this user, and drop
      // their stale index entries so they do not slow every subsequent read.
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

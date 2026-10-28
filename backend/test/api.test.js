import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { after, before, test } from 'node:test'
import { createClient } from 'redis'
import { createApp } from '../src/app.js'
import { config } from '../src/config.js'
import { redisStore } from '../src/storage/redisStore.js'

const redis = createClient({ url: config.redisUrl })
let server
let baseUrl
const accounts = []
const noteIds = []

function uniqueUsername(label) {
  return `t_${label}_${randomUUID().replaceAll('-', '').slice(0, 10)}`
}

function accountPayload(username, overrides = {}) {
  return {
    username,
    password: 'LocalPass123',
    email: `${username}@example.test`,
    fullName: 'کاربر آزمایشی',
    nationalId: '1234567890',
    identityInfo: '',
    ...overrides,
  }
}

before(async () => {
  await redis.connect()
  await redisStore.connect()
  const app = createApp()
  server = app.listen(0)
  await once(server, 'listening')
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  for (const account of accounts) {
    if (!account.id) continue
    const ids = await redis.sMembers(`notify:user:${account.id}:notes`)
    const keys = [
      `notify:user:${account.id}`,
      `notify:user:${account.id}:notes`,
      `notify:username:${account.username.toLowerCase()}`,
      `notify:email:${account.email.toLowerCase()}`,
      ...[...new Set([...ids, ...noteIds])].map((id) => `notify:note:${id}`),
    ]
    await redis.del(keys)
    await redis.sRem('notify:users', account.id)
  }
  if (server) await new Promise((resolve) => server.close(resolve))
  if (redis.isOpen) await redis.quit()
  if (redisStore.client.isOpen) await redisStore.client.quit()
})

async function request(path, { method = 'GET', body, auth, rawBody } = {}) {
  const headers = {}
  if (body !== undefined || rawBody !== undefined) headers['Content-Type'] = 'application/json'
  if (auth) headers.Authorization = `Bearer ${auth}`
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    ...(rawBody !== undefined ? { body: rawBody } : body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  return { response, payload: response.status === 204 ? null : await response.json() }
}

async function register(label, overrides = {}) {
  const username = overrides.username || uniqueUsername(label)
  const payload = accountPayload(username, overrides)
  const result = await request('/api/auth/register', { method: 'POST', body: payload })
  if (result.response.status === 201) {
    const account = { id: result.payload.user.id, username, email: payload.email, token: result.payload.token }
    accounts.push(account)
    return account
  }
  return { username, email: payload.email, response: result.response, payload: result.payload }
}

async function createNote(account, overrides = {}) {
  const result = await request('/api/notes', {
    method: 'POST',
    auth: account.token,
    body: { title: 'یادداشت آزمایشی', content: 'توضیح', category: 'کاری', status: 'active', ...overrides },
  })
  assert.equal(result.response.status, 201)
  noteIds.push(result.payload.note.id)
  return result.payload.note
}

test('health reports the local Redis connection', async () => {
  const { response, payload } = await request('/api/health')
  assert.equal(response.status, 200)
  assert.equal(payload.status, 'ok')
  assert.equal(payload.redis, 'connected')
})

test('registration rejects malformed input with field errors', async () => {
  const missing = await request('/api/auth/register', { method: 'POST', body: {} })
  assert.equal(missing.response.status, 400)
  assert.equal(missing.payload.error.code, 'VALIDATION_ERROR')
  for (const field of ['username', 'password', 'email', 'fullName', 'nationalId']) {
    assert.ok(missing.payload.error.fields[field], `expected a validation error for ${field}`)
  }

  const cases = [
    { label: 'short username', body: { username: 'ab' } },
    { label: 'non-latin username', body: { username: 'نام کاربری' } },
    { label: 'short password', body: { password: '1234567' } },
    { label: 'invalid email', body: { email: 'not-an-email' } },
    { label: 'blank full name', body: { fullName: '   ' } },
    { label: 'wrong national id type', body: { nationalId: 1234567890 } },
    { label: 'short national id', body: { nationalId: '123' } },
    { label: 'oversized identity info', body: { identityInfo: 'x'.repeat(501) } },
    { label: 'array body', body: [] },
  ]
  for (const item of cases) {
    const result = await request('/api/auth/register', { method: 'POST', body: item.body })
    assert.equal(result.response.status, 400, item.label)
    assert.equal(result.payload.error.code, 'VALIDATION_ERROR', item.label)
  }

  const malformed = await request('/api/auth/register', { method: 'POST', rawBody: '{"username":' })
  assert.equal(malformed.response.status, 400)
  assert.equal(malformed.payload.error.code, 'INVALID_JSON')
})

test('registration stores a hashed password and never the plaintext', async () => {
  const account = await register('registration')
  assert.ok(account.token)

  const stored = JSON.parse(await redis.get(`notify:user:${account.id}`))
  assert.equal(stored.username, account.username)
  assert.ok(stored.passwordHash)
  assert.notEqual(stored.passwordHash, 'LocalPass123')
  assert.equal('password' in stored, false, 'plaintext password must not be persisted')
  assert.equal('passwordHash' in (await request('/api/auth/me', { auth: account.token })).payload.user, false)

  const duplicateUsername = await register('registration', { username: account.username.toUpperCase(), email: `other-${account.email}` })
  assert.equal(duplicateUsername.response.status, 409)
  assert.equal(duplicateUsername.payload.error.code, 'ACCOUNT_EXISTS')

  const duplicateEmail = await register('registration', { email: account.email.toUpperCase() })
  assert.equal(duplicateEmail.response.status, 409)
  assert.equal(duplicateEmail.payload.error.code, 'ACCOUNT_EXISTS')
})

test('login, session and token checks behave safely', async () => {
  const account = await register('login')

  const wrongPassword = await request('/api/auth/login', { method: 'POST', body: { username: account.username, password: 'WrongPass123' } })
  assert.equal(wrongPassword.response.status, 401)
  assert.equal(wrongPassword.payload.error.code, 'INVALID_CREDENTIALS')

  const unknownUser = await request('/api/auth/login', { method: 'POST', body: { username: uniqueUsername('missing'), password: 'LocalPass123' } })
  assert.equal(unknownUser.response.status, 401)

  const emptyLogin = await request('/api/auth/login', { method: 'POST', body: {} })
  assert.equal(emptyLogin.response.status, 400)

  const login = await request('/api/auth/login', { method: 'POST', body: { username: account.username, password: 'LocalPass123' } })
  assert.equal(login.response.status, 200)
  assert.ok(login.payload.token)

  const me = await request('/api/auth/me', { auth: login.payload.token })
  assert.equal(me.response.status, 200)
  assert.equal(me.payload.user.id, account.id)
  assert.equal(me.payload.user.email, account.email)

  assert.equal((await request('/api/auth/me')).response.status, 401)
  assert.equal((await request('/api/auth/me', { auth: 'not-a-token' })).response.status, 401)
  const wrongSignature = await request('/api/auth/me', { auth: `${login.payload.token}x` })
  assert.equal(wrongSignature.response.status, 401)
})

test('note CRUD is persisted in Redis and reflected in every read', async () => {
  const account = await register('crud')
  assert.equal((await request('/api/notes')).response.status, 401)
  assert.equal((await request('/api/notes', { method: 'POST', body: { title: 'بدون ورود' } })).response.status, 401)

  const first = await createNote(account, { title: 'یادداشت اول', content: 'متن اول', category: 'پروژه' })
  const raw = JSON.parse(await redis.get(`notify:note:${first.id}`))
  assert.equal(raw.title, 'یادداشت اول')
  assert.equal(raw.userId, account.id)
  assert.ok(await redis.sIsMember(`notify:user:${account.id}:notes`, first.id))

  const second = await createNote(account, { title: 'یادداشت دوم' })
  const listed = await request('/api/notes', { auth: account.token })
  assert.equal(listed.response.status, 200)
  assert.deepEqual(listed.payload.notes.map((note) => note.id), [second.id, first.id], 'newest note comes first')

  const fetched = await request(`/api/notes/${first.id}`, { auth: account.token })
  assert.equal(fetched.payload.note.title, 'یادداشت اول')

  const updated = await request(`/api/notes/${first.id}`, { method: 'PATCH', auth: account.token, body: { status: 'completed' } })
  assert.equal(updated.response.status, 200)
  assert.equal(updated.payload.note.status, 'completed')
  assert.equal(updated.payload.note.title, 'یادداشت اول', 'partial update must keep untouched fields')
  assert.equal(updated.payload.note.content, 'متن اول')
  assert.notEqual(updated.payload.note.updatedAt, first.updatedAt)

  const storedAfterUpdate = JSON.parse(await redis.get(`notify:note:${first.id}`))
  assert.equal(storedAfterUpdate.status, 'completed')

  const deleted = await request(`/api/notes/${first.id}`, { method: 'DELETE', auth: account.token })
  assert.equal(deleted.response.status, 204)
  assert.equal(await redis.get(`notify:note:${first.id}`), null)
  assert.equal(await redis.sIsMember(`notify:user:${account.id}:notes`, first.id), false)
  assert.equal((await request(`/api/notes/${first.id}`, { method: 'DELETE', auth: account.token })).response.status, 404)

  const remaining = await request('/api/notes', { auth: account.token })
  assert.deepEqual(remaining.payload.notes.map((note) => note.id), [second.id])
})

test('note input validation rejects unsafe records', async () => {
  const account = await register('validation')
  const invalidBodies = [
    { label: 'empty object', body: {} },
    { label: 'whitespace title', body: { title: '   ' } },
    { label: 'missing title', body: { content: 'بدون عنوان' } },
    { label: 'long title', body: { title: 'x'.repeat(121) } },
    { label: 'numeric title', body: { title: 42 } },
    { label: 'invalid category', body: { title: 'عنوان', category: 'ناموجود' } },
    { label: 'invalid status', body: { title: 'عنوان', status: 'done' } },
    { label: 'long content', body: { title: 'عنوان', content: 'x'.repeat(2001) } },
    { label: 'unexpected field', body: { title: 'عنوان', userId: randomUUID() } },
    { label: 'array body', body: [] },
  ]
  for (const item of invalidBodies) {
    const result = await request('/api/notes', { method: 'POST', auth: account.token, body: item.body })
    assert.equal(result.response.status, 400, item.label)
    assert.equal(result.payload.error.code, 'VALIDATION_ERROR', item.label)
  }
  assert.deepEqual((await request('/api/notes', { auth: account.token })).payload.notes, [])

  // Express rejects a JSON scalar before validation, which is still a safe 400.
  const scalar = await request('/api/notes', { method: 'POST', auth: account.token, body: 'title' })
  assert.equal(scalar.response.status, 400)
  assert.equal(scalar.payload.error.code, 'INVALID_JSON')

  const note = await createNote(account)
  const emptyPatch = await request(`/api/notes/${note.id}`, { method: 'PATCH', auth: account.token, body: {} })
  assert.equal(emptyPatch.response.status, 400)
  const invalidPatch = await request(`/api/notes/${note.id}`, { method: 'PATCH', auth: account.token, body: { status: 'unknown' } })
  assert.equal(invalidPatch.response.status, 400)
  const ownershipPatch = await request(`/api/notes/${note.id}`, { method: 'PATCH', auth: account.token, body: { userId: randomUUID() } })
  assert.equal(ownershipPatch.response.status, 400)

  for (const id of ['not-a-uuid', '00000000-0000-0000-0000-000000000000']) {
    assert.equal((await request(`/api/notes/${id}`, { auth: account.token })).response.status, 400)
    assert.equal((await request(`/api/notes/${id}`, { method: 'PATCH', auth: account.token, body: { title: 'x' } })).response.status, 400)
    assert.equal((await request(`/api/notes/${id}`, { method: 'DELETE', auth: account.token })).response.status, 400)
  }

  const oversized = await request('/api/notes', { method: 'POST', auth: account.token, body: { title: 'x'.repeat(21000) } })
  assert.equal(oversized.response.status, 413)
  assert.equal(oversized.payload.error.code, 'PAYLOAD_TOO_LARGE')
})

test('users cannot read, modify or delete another user\'s notes', async () => {
  const owner = await register('owner')
  const intruder = await register('intruder')
  const note = await createNote(owner, { title: 'یادداشت خصوصی' })

  assert.equal((await request(`/api/notes/${note.id}`, { auth: intruder.token })).response.status, 404)
  assert.equal((await request(`/api/notes/${note.id}`, { auth: owner.token })).response.status, 200)

  const patch = await request(`/api/notes/${note.id}`, { method: 'PATCH', auth: intruder.token, body: { title: 'تغییر غیرمجاز' } })
  assert.equal(patch.response.status, 404)

  const remove = await request(`/api/notes/${note.id}`, { method: 'DELETE', auth: intruder.token })
  assert.equal(remove.response.status, 404)

  const stillOwned = JSON.parse(await redis.get(`notify:note:${note.id}`))
  assert.equal(stillOwned.title, 'یادداشت خصوصی')
  assert.equal(stillOwned.userId, owner.id)

  const intruderList = await request('/api/notes', { auth: intruder.token })
  assert.deepEqual(intruderList.payload.notes, [])
  assert.ok(await redis.sIsMember(`notify:user:${owner.id}:notes`, note.id))
  assert.equal(await redis.sIsMember(`notify:user:${intruder.id}:notes`, note.id), false)
})

test('updating or deleting a missing note never recreates it', async () => {
  const account = await register('missing')
  const missingId = randomUUID()

  const patch = await request(`/api/notes/${missingId}`, { method: 'PATCH', auth: account.token, body: { title: 'بازسازی' } })
  assert.equal(patch.response.status, 404)
  assert.equal(await redis.get(`notify:note:${missingId}`), null)
  assert.equal(await redis.sIsMember(`notify:user:${account.id}:notes`, missingId), false)

  const note = await createNote(account)
  await request(`/api/notes/${note.id}`, { method: 'DELETE', auth: account.token })
  const latePatch = await request(`/api/notes/${note.id}`, { method: 'PATCH', auth: account.token, body: { title: 'پس از حذف' } })
  assert.equal(latePatch.response.status, 404)
  assert.equal(await redis.get(`notify:note:${note.id}`), null)
})

test('concurrent partial updates keep both changes', async () => {
  const account = await register('concurrency')
  const note = await createNote(account, { title: 'همزمان', content: 'متن اولیه' })

  const [contentUpdate, statusUpdate] = await Promise.all([
    request(`/api/notes/${note.id}`, { method: 'PATCH', auth: account.token, body: { content: 'متن تازه' } }),
    request(`/api/notes/${note.id}`, { method: 'PATCH', auth: account.token, body: { status: 'completed' } }),
  ])
  assert.equal(contentUpdate.response.status, 200)
  assert.equal(statusUpdate.response.status, 200)

  const stored = JSON.parse(await redis.get(`notify:note:${note.id}`))
  assert.equal(stored.content, 'متن تازه')
  assert.equal(stored.status, 'completed')
  assert.equal(stored.title, 'همزمان')
})

test('concurrent duplicate registrations create exactly one account', async () => {
  const username = uniqueUsername('race')
  const payload = accountPayload(username)
  const results = await Promise.all([
    request('/api/auth/register', { method: 'POST', body: payload }),
    request('/api/auth/register', { method: 'POST', body: payload }),
  ])
  const statuses = results.map((result) => result.response.status).sort()
  assert.deepEqual(statuses, [201, 409])

  const created = results.find((result) => result.response.status === 201)
  accounts.push({ id: created.payload.user.id, username, email: payload.email })
  assert.equal(await redis.sIsMember('notify:users', created.payload.user.id), true)
  assert.equal(await redis.get(`notify:username:${username.toLowerCase()}`), created.payload.user.id)
})

test('malformed Redis records do not break reads and are pruned', async () => {
  const account = await register('corrupt')
  const valid = await createNote(account, { title: 'یادداشت سالم' })

  const corruptId = randomUUID()
  noteIds.push(corruptId)
  await redis.set(`notify:note:${corruptId}`, '{ this is not json')
  await redis.sAdd(`notify:user:${account.id}:notes`, corruptId)

  const listed = await request('/api/notes', { auth: account.token })
  assert.equal(listed.response.status, 200)
  assert.deepEqual(listed.payload.notes.map((note) => note.id), [valid.id])
  assert.equal(await redis.sIsMember(`notify:user:${account.id}:notes`, corruptId), false, 'stale index entry is pruned')

  const direct = await request(`/api/notes/${corruptId}`, { auth: account.token })
  assert.equal(direct.response.status, 404)
})

test('a Redis outage returns 503 and recovers after reconnect', async () => {
  const account = await register('outage')
  const note = await createNote(account)

  await redisStore.client.quit()
  const unavailable = await request('/api/notes', { auth: account.token })
  assert.equal(unavailable.response.status, 503)
  assert.equal(unavailable.payload.error.code, 'STORAGE_UNAVAILABLE')
  assert.equal((await request('/api/health')).response.status, 503)

  await redisStore.connect()
  const recovered = await request('/api/notes', { auth: account.token })
  assert.equal(recovered.response.status, 200)
  assert.ok(recovered.payload.notes.some((item) => item.id === note.id))
})

test('notes survive a Redis reconnect (app restart model)', async () => {
  const account = await register('persistence')
  const note = await createNote(account, { title: 'پایدار در Redis' })

  await redisStore.client.quit()
  await redisStore.connect()

  const listed = await request('/api/notes', { auth: account.token })
  assert.equal(listed.response.status, 200)
  assert.ok(listed.payload.notes.some((item) => item.id === note.id))
  assert.equal(JSON.parse(await redis.get(`notify:note:${note.id}`)).title, 'پایدار در Redis')
})

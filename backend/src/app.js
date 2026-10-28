import bcrypt from 'bcryptjs'
import cors from 'cors'
import express from 'express'
import jwt from 'jsonwebtoken'
import { config } from './config.js'
import { requireAuth } from './middleware/auth.js'
import { redisStore } from './storage/redisStore.js'
import { isValidId, validateLogin, validateNote, validateRegistration } from './validation.js'

function publicUser(user) {
  const { id, username, email, fullName, nationalId, identityInfo, createdAt } = user
  return { id, username, email, fullName, nationalId, identityInfo, createdAt }
}

function issueToken(user) {
  return jwt.sign({}, config.jwtSecret, { subject: user.id, expiresIn: '12h' })
}

function sendError(res, status, code, message) {
  return res.status(status).json({ error: { code, message } })
}

export function createApp(store = redisStore) {
  const app = express()
  app.disable('x-powered-by')
  app.use(cors({ origin: config.corsOrigins }))
  app.use(express.json({ limit: '20kb' }))

  app.get('/api/health', async (req, res, next) => {
    try {
      const redis = await store.ping()
      return res.status(redis ? 200 : 503).json({ status: redis ? 'ok' : 'unavailable', redis: redis ? 'connected' : 'disconnected' })
    } catch (error) {
      return next(error)
    }
  })

  app.post('/api/auth/register', async (req, res, next) => {
    try {
      const input = validateRegistration(req.body)
      const passwordHash = await bcrypt.hash(input.password, 12)
      const user = await store.createUser({
        username: input.username,
        email: input.email,
        fullName: input.fullName,
        nationalId: input.nationalId,
        identityInfo: input.identityInfo,
        passwordHash,
      })
      if (!user) return sendError(res, 409, 'ACCOUNT_EXISTS', 'این نام کاربری یا ایمیل قبلاً ثبت شده است.')
      return res.status(201).json({ user: publicUser(user), token: issueToken(user) })
    } catch (error) {
      return next(error)
    }
  })

  app.post('/api/auth/login', async (req, res, next) => {
    try {
      const { username, password } = validateLogin(req.body)
      const user = await store.getUserByUsername(username)
      if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
        return sendError(res, 401, 'INVALID_CREDENTIALS', 'نام کاربری یا رمز عبور نادرست است.')
      }
      return res.json({ user: publicUser(user), token: issueToken(user) })
    } catch (error) {
      return next(error)
    }
  })

  app.get('/api/auth/me', requireAuth, async (req, res, next) => {
    try {
      const user = await store.getPublicUserById(req.userId)
      if (!user) return sendError(res, 401, 'UNAUTHORIZED', 'حساب کاربری پیدا نشد. دوباره وارد شوید.')
      return res.json({ user: publicUser(user) })
    } catch (error) {
      return next(error)
    }
  })

  app.get('/api/notes', requireAuth, async (req, res, next) => {
    try {
      return res.json({ notes: await store.listNotes(req.userId) })
    } catch (error) {
      return next(error)
    }
  })

  app.get('/api/notes/:id', requireAuth, async (req, res, next) => {
    try {
      if (!isValidId(req.params.id)) return sendError(res, 400, 'INVALID_ID', 'شناسهٔ یادداشت معتبر نیست.')
      const note = await store.getNote(req.userId, req.params.id)
      if (!note) return sendError(res, 404, 'NOT_FOUND', 'یادداشت پیدا نشد.')
      return res.json({ note })
    } catch (error) {
      return next(error)
    }
  })

  app.post('/api/notes', requireAuth, async (req, res, next) => {
    try {
      return res.status(201).json({ note: await store.createNote(req.userId, validateNote(req.body)) })
    } catch (error) {
      return next(error)
    }
  })

  app.patch('/api/notes/:id', requireAuth, async (req, res, next) => {
    try {
      if (!isValidId(req.params.id)) return sendError(res, 400, 'INVALID_ID', 'شناسهٔ یادداشت معتبر نیست.')
      const note = await store.updateNote(req.userId, req.params.id, validateNote(req.body, true))
      if (!note) return sendError(res, 404, 'NOT_FOUND', 'یادداشت پیدا نشد.')
      return res.json({ note })
    } catch (error) {
      return next(error)
    }
  })

  app.delete('/api/notes/:id', requireAuth, async (req, res, next) => {
    try {
      if (!isValidId(req.params.id)) return sendError(res, 400, 'INVALID_ID', 'شناسهٔ یادداشت معتبر نیست.')
      const deleted = await store.deleteNote(req.userId, req.params.id)
      if (!deleted) return sendError(res, 404, 'NOT_FOUND', 'یادداشت پیدا نشد.')
      return res.status(204).end()
    } catch (error) {
      return next(error)
    }
  })

  app.use((req, res) => sendError(res, 404, 'NOT_FOUND', 'مسیر درخواستی پیدا نشد.'))
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error)
    if (error.type === 'entity.parse.failed') return sendError(res, 400, 'INVALID_JSON', 'بدنهٔ درخواست JSON معتبر نیست.')
    if (error.type === 'entity.too.large') return sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'حجم درخواست بیش از حد مجاز است.')
    if (error.code === 'VALIDATION_ERROR') {
      return res.status(400).json({ error: { code: error.code, message: error.message, fields: error.fields } })
    }
    if (error.status === 503) return sendError(res, 503, 'STORAGE_UNAVAILABLE', error.message)
    if (error.code?.startsWith('ECONN') || ['ClientClosedError', 'SocketClosedUnexpectedlyError', 'ConnectionTimeoutError'].includes(error.name)) {
      return sendError(res, 503, 'STORAGE_UNAVAILABLE', 'ذخیره‌ساز موقتاً در دسترس نیست. اتصال Redis را بررسی کنید.')
    }
    console.error(`Unhandled API error on ${req.method} ${req.path}:`, error.name, error.message)
    return sendError(res, 500, 'INTERNAL_ERROR', 'خطای داخلی سرور رخ داد.')
  })
  return app
}

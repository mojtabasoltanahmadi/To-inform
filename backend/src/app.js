import * as publicServices from "./services/publicServices.js"
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
  return jwt.sign(
    {
      sub: user.id,
      username: user.username,
      nationalId: user.nationalId,
      email: user.email
    },
    config.jwtSecret,
    { expiresIn: "12h" }
  );
}

function sendError(res, status, code, message) {
  return res.status(status).json({ error: { code, message } })
}

export function createApp(store = redisStore) {
  const app = express()
  app.disable('x-powered-by')
  app.use(cors({ origin: true, credentials: true }))
  app.use(express.json({ limit: '20kb' }))

  const apiRouter = express.Router()

  apiRouter.get('/health', async (req, res, next) => {
    try {
      const redis = await store.ping()
      return res.status(redis ? 200 : 503).json({ status: redis ? 'ok' : 'unavailable', redis: redis ? 'connected' : 'disconnected' })
    } catch (error) {
      return next(error)
    }
  })

  apiRouter.post('/auth/register', async (req, res, next) => {
    try {
      const input = validateRegistration(req.body);
      
      // گام اول: ساخت رکورد کاربر در سرویس تصدیق اصالت مرکزی سازمان
      const authResult = await publicServices.addAuthUser({
        username: input.username,
        password: input.password
      });

      // گام دوم: ثبت مشخصات در سرویس اشخاص (Profile)
      await publicServices.addProfileReal({
        idNumber: input.nationalId,
        fullName: input.fullName,
        email: input.email
      });

      // گام سوم: ثبت کاربر حداقلی در دیت‌استور اطلس
      const user = await store.createUser({
        id: authResult?.entryId,
        username: input.username,
        email: input.email,
        fullName: input.fullName,
        nationalId: input.nationalId,
        identityInfo: input.identityInfo
      });

      if (!user) {
        return sendError(res, 409, "ACCOUNT_EXISTS", "این نام کاربری یا ایمیل قبلاً ثبت شده است.");
      }

      return res.status(201).json({ user: publicUser(user), token: issueToken(user) });
    } catch (error) {
      if (error.code === "ACCOUNT_EXISTS" || error.status === 409 || error.message?.includes("تکراری")) {
        return sendError(res, 409, "ACCOUNT_EXISTS", error.message);
      }
      return next(error);
    }
  })

  apiRouter.post('/auth/login', async (req, res, next) => {
    try {
      const { username, password } = validateLogin(req.body);
      
      // تصدیق اصالت از طریق وب‌سرویس مرکزی احراز هویت
      const authResult = await publicServices.authenticateUser({ username, password });

      // واکشی رکورد کاربر حداقلی از اطلس
      let user = await store.getUserByUsername(username);
      if (!user) {
        user = {
          id: authResult?.entryId || authResult?.userId,
          username: username,
          email: `${username}@partcorp.ir`,
          fullName: username,
          createdAt: new Date().toISOString()
        };
      }

      return res.json({ user: publicUser(user), token: issueToken(user) });
    } catch (error) {
      if (error.code === "INVALID_CREDENTIALS" || error.status === 401) {
        return sendError(res, 401, "INVALID_CREDENTIALS", error.message);
      }
      return next(error);
    }
  })

  apiRouter.get('/auth/me', requireAuth, async (req, res, next) => {
    try {
      const user = await store.getPublicUserById(req.userId)
      if (!user) return sendError(res, 401, 'UNAUTHORIZED', 'حساب کاربری پیدا نشد. دوباره وارد شوید.')
      return res.json({ user: publicUser(user) })
    } catch (error) {
      return next(error)
    }
  })

  apiRouter.get('/notes', requireAuth, async (req, res, next) => {
    try {
      const result = await store.listNotes(req.userId)
      if (result && typeof result === 'object' && 'notes' in result) {
        res.setHeader('X-Cache', result.cacheHit ? 'HIT' : 'MISS')
        return res.json({ notes: result.notes })
      }
      return res.json({ notes: result })
    } catch (error) {
      return next(error)
    }
  })

  apiRouter.get('/notes/:id', requireAuth, async (req, res, next) => {
    try {
      if (!isValidId(req.params.id)) return sendError(res, 400, 'INVALID_ID', 'شناسهٔ یادداشت معتبر نیست.')
      const note = await store.getNote(req.userId, req.params.id)
      if (!note) return sendError(res, 404, 'NOT_FOUND', 'یادداشت پیدا نشد.')
      return res.json({ note })
    } catch (error) {
      return next(error)
    }
  })

  apiRouter.post('/notes', requireAuth, async (req, res, next) => {
    try {
      return res.status(201).json({ note: await store.createNote(req.userId, validateNote(req.body)) })
    } catch (error) {
      return next(error)
    }
  })

  apiRouter.patch('/notes/:id', requireAuth, async (req, res, next) => {
    try {
      if (!isValidId(req.params.id)) return sendError(res, 400, 'INVALID_ID', 'شناسهٔ یادداشت معتبر نیست.')
      const note = await store.updateNote(req.userId, req.params.id, validateNote(req.body, true))
      if (!note) return sendError(res, 404, 'NOT_FOUND', 'یادداشت پیدا نشد.')
      return res.json({ note })
    } catch (error) {
      return next(error)
    }
  })

  apiRouter.delete('/notes/:id', requireAuth, async (req, res, next) => {
    try {
      if (!isValidId(req.params.id)) return sendError(res, 400, 'INVALID_ID', 'شناسهٔ یادداشت معتبر نیست.')
      const deleted = await store.deleteNote(req.userId, req.params.id)
      if (!deleted) return sendError(res, 404, 'NOT_FOUND', 'یادداشت پیدا نشد.')
      return res.status(204).end()
    } catch (error) {
      return next(error)
    }
  })

  // پشتیبانی همزمان از /api و /api/v1
  app.use('/api', apiRouter)
  app.use('/api/v1', apiRouter)

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

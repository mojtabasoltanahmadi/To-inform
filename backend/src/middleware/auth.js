import jwt from 'jsonwebtoken'
import { config } from '../config.js'
import { isValidId } from '../validation.js'

export function requireAuth(req, res, next) {
  const authorization = req.get('authorization') || ''
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
  if (!token) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'برای ادامه وارد حساب خود شوید.' } })

  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] })
    // Every note lookup is scoped by this identifier, so it must be a real user id.
    if (typeof payload.sub !== 'string' || !isValidId(payload.sub)) throw new Error('Invalid subject')
    req.userId = payload.sub
    return next()
  } catch {
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'نشست شما معتبر نیست. دوباره وارد شوید.' } })
  }
}


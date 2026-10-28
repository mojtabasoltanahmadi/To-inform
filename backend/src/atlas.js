import { config } from './config.js'

export const NS_USERS = process.env.ATLAS_NS_USERS || 'users'
export const NS_TODOS = process.env.ATLAS_NS_TODOS || 'todos'
const ATLAS_BASE_URL = (process.env.ATLAS_BASE_URL || 'http://atlas-v4-dev.partcorp.ir:8000').replace(/\/$/, '')
const ATLAS_PROJECT = process.env.ATLAS_PROJECT || 'ms-notify'
const ATLAS_TIMEOUT_MS = Number(process.env.ATLAS_TIMEOUT_MS) || 15000

export class AtlasError extends Error {
  constructor(message, { status = 500, code = 'INTERNAL_ERROR', details = null } = {}) {
    super(message)
    this.name = 'AtlasError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export function isConfigured() {
  return Boolean(ATLAS_BASE_URL && ATLAS_PROJECT)
}

export function quoteKey(token) {
  if (!token) return "''"
  const clean = String(token).replace(/'/g, '')
  return `'${clean}'`
}

async function request(action, namespace, body = {}) {
  if (!isConfigured()) {
    throw new AtlasError('سرویس اطلس پیکربندی نشده است.', { status: 500, code: 'NOT_CONFIGURED' })
  }

  const path = namespace
    ? `/service/atlas@4/${action}/${ATLAS_PROJECT}/${namespace}`
    : `/service/atlas@4/${action}/${ATLAS_PROJECT}`
  const url = `${ATLAS_BASE_URL}${path}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ATLAS_TIMEOUT_MS)

  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Database-Timeout': String(Math.floor(ATLAS_TIMEOUT_MS / 1000)),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new AtlasError('زمان پاسخ‌گویی اطلس به پایان رسید (Timeout).', { status: 500, code: 'CONNECTION' })
    }
    throw new AtlasError(`عدم برقراری ارتباط با اطلس: ${err.message}`, { status: 500, code: 'CONNECTION' })
  } finally {
    clearTimeout(timer)
  }

  const payload = await response.json().catch(() => null)
  const metaCode = payload?.meta?.code

  if (!response.ok || (metaCode && metaCode !== 200 && metaCode !== 'success')) {
    const status = response.status || 500
    const code = metaCode || payload?.data?.message?.en || 'UNKNOWN_ERROR'
    const message = payload?.data?.message?.fa || payload?.data?.message?.en || 'خطا در ارتباط با سرویس داده'

    if (status === 409 || metaCode === 409 || code === 'DUPLICATE_KEY' || code === 'DUPLICATE_NAMESPACE') {
      throw new AtlasError('رکورد یا کلید تکراری است.', { status: 409, code: 'DUPLICATE_KEY', details: payload })
    }
    if (status === 404 || metaCode === 404 || code === 'NOT_FOUND') {
      throw new AtlasError('منبع درخواستی در اطلس پیدا نشد.', { status: 404, code: 'NOT_FOUND', details: payload })
    }
    if (status === 400 || metaCode === 'validationError') {
      throw new AtlasError('قالب ورودی اطلس نامعتبر است.', { status: 400, code: 'VALIDATION_ERROR', details: payload })
    }

    throw new AtlasError(message, { status, code, details: payload })
  }

  return payload?.data
}

export async function ensureNamespaces() {
  const namespaces = [
    { namespace: NS_USERS, type: 'data', uniqueKeyIndex: 0 },
    { namespace: NS_TODOS, type: 'data' },
  ]

  for (const ns of namespaces) {
    try {
      await request('addNamespaceToProject', null, ns)
      console.log(`[atlas] فضای نام ${ns.namespace} بررسی/ایجاد شد.`)
    } catch (err) {
      if (err.status === 409 || err.code === 'DUPLICATE_KEY' || err.code === 'DUPLICATE_NAMESPACE') {
        console.log(`[atlas] فضای نام ${ns.namespace} از قبل موجود است.`)
      } else {
        console.warn(`[atlas] وضعیت فضای نام ${ns.namespace}: ${err.message}`)
      }
    }
  }
}

export async function add(namespace, records) {
  const res = await request('add', namespace, records)
  return res?.result || { success: [], failure: [] }
}

export async function readByKey(namespace, searchToken, options = {}) {
  const body = {
    searchToken,
    include: ['id', 'keys', 'body'],
    ...options,
  }
  const res = await request('readByKey', namespace, body)
  return res?.result || []
}

export async function readById(namespace, ids) {
  const list = Array.isArray(ids) ? ids : [ids]
  const res = await request('readById', namespace, {
    ids: list,
    include: ['id', 'keys', 'body'],
  })
  return res?.result || []
}

export async function modifyById(namespace, id, newKeys, newBody) {
  const res = await request('modifyById', namespace, {
    id,
    newKeys,
    newBody,
  })
  return res?.result?.success?.includes(id)
}

export async function removeById(namespace, ids) {
  const list = Array.isArray(ids) ? ids : [ids]
  const res = await request('removeById', namespace, { ids: list })
  return res?.result || { success: [], failure: [] }
}

export async function restoreById(namespace, ids) {
  const list = Array.isArray(ids) ? ids : [ids]
  const res = await request('restoreById', namespace, { ids: list })
  return res?.result || { success: [], failure: [] }
}

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api'
const TOKEN_KEY = 'notify-auth-token'

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY)
}

export function hasSession() {
  return Boolean(getToken())
}

export function setSession(token, remember = false) {
  clearSession()
  const storage = remember ? localStorage : sessionStorage
  storage.setItem(TOKEN_KEY, token)
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY)
  sessionStorage.removeItem(TOKEN_KEY)
}

export async function apiRequest(path, options = {}) {
  const headers = new Headers(options.headers)
  headers.set('Accept', 'application/json')
  if (options.body !== undefined) headers.set('Content-Type', 'application/json')

  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)

  let response
  try {
    response = await fetch(`${API_BASE}${path}`, { ...options, headers })
  } catch {
    throw new Error('ارتباط با سرور برقرار نشد. اتصال API را بررسی کنید.')
  }

  const payload = response.status === 204 ? null : await response.json().catch(() => null)
  if (!response.ok) {
    const error = new Error(payload?.error?.message || 'درخواست با خطا روبه‌رو شد.')
    error.status = response.status
    error.fields = payload?.error?.fields
    throw error
  }
  return payload
}

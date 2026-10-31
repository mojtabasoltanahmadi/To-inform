const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL || "https://gateway-v3-dev.apipart.ir";
const API_BASE = GATEWAY_URL
  ? `${GATEWAY_URL.replace(/\/$/, "")}/api/v1`
  : (import.meta.env.VITE_API_BASE_URL || "/api/v1");

const GATEWAY_SYSTEM = import.meta.env.VITE_GATEWAY_SYSTEM || "notify-soltanahmadi";
const TOKEN_KEY = "notify-auth-token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY);
}

export function hasSession() {
  return Boolean(getToken());
}

export function setSession(token, remember = false) {
  clearSession();
  const storage = remember ? localStorage : sessionStorage;
  storage.setItem(TOKEN_KEY, token);
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
}

export async function apiRequest(path, options = {}) {
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  if (options.body !== undefined) headers.set("Content-Type", "application/json");

  if (GATEWAY_SYSTEM) {
    headers.set("gateway-system", GATEWAY_SYSTEM);
  }

  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch {
    throw new Error("ارتباط با گیت‌وی برقرار نشد.");
  }

  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.error?.message || payload?.message?.fa || payload?.data?.message?.fa || "درخواست با خطا مواجه شد.");
    error.status = response.status;
    error.fields = payload?.error?.fields;
    throw error;
  }
  return payload;
}

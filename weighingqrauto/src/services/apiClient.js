import {ensureReachableBaseUrl} from './serverConfig';

const DEFAULT_TIMEOUT_MS = 10000;

// Distinguishes "can't reach the backend" from "backend rejected the
// request" so screens can show the right message instead of a generic
// failure (see LoginScreen / RegisterScreen).
export class ApiError extends Error {
  constructor(type, message, status) {
    super(message);
    this.name = 'ApiError';
    this.type = type; // 'network' | 'auth' | 'client' | 'server'
    this.status = status;
  }
}

const NETWORK_ERROR_MESSAGE = 'Server unreachable — check WiFi and server.';

// Authenticated API client used by every screen that needs to talk to the
// backend. It resolves the current server URL at CALL TIME via
// ensureReachableBaseUrl() (cached URL health-check -> LAN re-discovery if
// needed) so it always targets the current backend, never a frozen IP, and
// automatically attaches the JWT when one is supplied.
export async function apiFetch(path, {method = 'GET', body, token, timeoutMs = DEFAULT_TIMEOUT_MS, isForm = false} = {}) {
  let baseUrl;
  try {
    baseUrl = await ensureReachableBaseUrl();
  } catch (_) {
    throw new ApiError('network', NETWORK_ERROR_MESSAGE);
  }

  const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const headers = {};
  if (!isForm) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      throw new ApiError('network', 'Server timeout — check WiFi and server.');
    }
    throw new ApiError('network', NETWORK_ERROR_MESSAGE);
  }
  clearTimeout(timer);

  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    // non-JSON response, fall through to status handling below
  }

  if (res.status === 401) {
    throw new ApiError('auth', data?.message || 'Invalid email or password.', 401);
  }
  if (res.status >= 500) {
    throw new ApiError('server', data?.message || 'Server error. Please try again.', res.status);
  }
  if (!res.ok || (data && data.success === false)) {
    throw new ApiError('client', data?.message || 'Request failed.', res.status);
  }

  return data;
}

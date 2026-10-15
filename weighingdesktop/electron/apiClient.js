// The only place the desktop app talks to the outside world: JSON over HTTP
// to the existing backend. It runs in Electron's main process (never the
// renderer), so requests carry no browser Origin header and the backend's
// CORS rules are unaffected. There is no database access of any kind here.

// Generous on purpose: a hosted backend that has been idle can take most of
// a minute to answer its first request. A machine that is simply offline
// fails immediately (no connection), so this does not slow that case down.
const DEFAULT_TIMEOUT_MS = 60000;

// kind: 'network' — no usable answer from the server (offline, DNS, timeout,
//                    connection refused). Always worth retrying later.
//       'http'    — the server answered with a non-2xx status.
class ApiError extends Error {
  constructor({ kind, status = 0, code = null, message, data = null, retryAfterMs = null }) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.code = code;
    this.data = data;
    this.retryAfterMs = retryAfterMs;
  }

  // Transient: the same request may well succeed later without any change.
  get retryable() {
    return this.kind === 'network' || this.status === 429 || this.status >= 500;
  }
}

function parseRetryAfterMs(header) {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(date - Date.now(), 0);
}

function createApiClient({ baseUrl, getToken = () => null, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const origin = String(baseUrl || '').replace(/\/+$/, '');

  async function request(method, path, { body, query, auth = true, timeoutMs: requestTimeoutMs } = {}) {
    const url = new URL(`${origin}${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
      }
    }

    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth) {
      const token = getToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs || timeoutMs);
    let response;
    try {
      response = await fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      throw new ApiError({ kind: 'network', message: 'Cannot reach the server.' });
    } finally {
      clearTimeout(timer);
    }

    let data = null;
    try {
      data = await response.json();
    } catch (_) {
      // Non-JSON body (e.g. a proxy error page) — handled by status below.
    }

    if (!response.ok) {
      throw new ApiError({
        kind: 'http',
        status: response.status,
        code: data && typeof data.code === 'string' ? data.code : null,
        message: data && typeof data.message === 'string' ? data.message : `Request failed (${response.status}).`,
        data,
        retryAfterMs: parseRetryAfterMs(response.headers.get('retry-after')),
      });
    }

    return { status: response.status, data };
  }

  return {
    baseUrl: origin,
    get: (path, options) => request('GET', path, options),
    post: (path, body, options) => request('POST', path, { ...options, body }),
    put: (path, body, options) => request('PUT', path, { ...options, body }),
  };
}

module.exports = { createApiClient, ApiError };

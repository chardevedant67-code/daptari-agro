import {ensureReachableBaseUrl} from './serverConfig';

// Every request in this file resolves its base URL through the same LAN
// discovery / cached-URL health-check that login/register already use (see
// serverConfig.js's `ensureReachableBaseUrl`), instead of reading the
// `BASE_URL` binding from '../config' directly.
//
// Why this matters: that binding starts at a hardcoded emulator-only default
// and is only ever refreshed as a *side effect* of something calling
// `ensureReachableBaseUrl()` — previously only apiClient.js (login/register/
// profile) did that. A session restored from storage on app relaunch never
// goes through login, so this file's calls (Home, Analytics, QR scan, the
// whole weighing flow) could run before discovery ever ran once, silently
// stuck on an address that only means something inside the Android
// emulator — never a real phone. Resolving it here, per request, guarantees
// discovery has actually run and found a reachable server first.
async function apiUrl(path) {
  const base = await ensureReachableBaseUrl();
  return `${base}${path}`;
}

// Turns a raw fetch/network failure into a real, specific message instead of
// React Native's generic "Network request failed" — never hides the actual
// problem, just names it. Non-network errors (a real "packet not found",
// an already-filled packet, etc.) pass through with their original message
// and any `status`/`code`/`packet` the backend attached, unchanged.
// Logged for debugging (method + path + message only — never a token,
// secret, or request body).
function describeNetworkError(err, context) {
  const isNetworkError = err instanceof TypeError || err.message === 'Network request failed';
  const message = isNetworkError
    ? 'Unable to connect to server — check the connection to the backend and that it is running'
    : err.message;
  console.warn(`[api] ${context} failed: ${err.message}`);
  const wrapped = new Error(message);
  if (err.status) wrapped.status = err.status;
  if (err.code)   wrapped.code   = err.code;
  if (err.packet) wrapped.packet = err.packet;
  return wrapped;
}

async function withNetworkErrors(context, fn) {
  try {
    return await fn();
  } catch (err) {
    throw describeNetworkError(err, context);
  }
}

// Resolves a scanned QR's uniqueId to its SeedPacket record (with batch info
// populated). Function name kept as-is to avoid touching every call site —
// it now queries the real SeedPacket collection that Admin-generated QR
// codes actually belong to (server/routes/packetRoutes.js), not the
// unrelated/orphaned Product collection the old /p/api/:productId route used.
export const fetchProductByScan = (uniqueId, token) =>
  withNetworkErrors(`GET /api/packets/${uniqueId}`, async () => {
    const url = await apiUrl(`/api/packets/${uniqueId}`);
    const res = await fetch(url, token ? {headers: {Authorization: `Bearer ${token}`}} : undefined);
    const data = await res.json();
    if (!data.success) throw new Error(data.message || 'Packet not found');
    return data.packet;
  });

export const fetchLatestProduct = () =>
  withNetworkErrors('GET /p/api/latest', async () => {
    const url = await apiUrl('/p/api/latest');
    const res = await fetch(url);
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    return data.product;
  });

// ── Weighing session flow (SeedBatch → SeedPacket → WeightSession) ──
// Reuses the existing session endpoints in server/routes/sessionRoutes.js —
// nothing new was added on the backend for these, they already worked.

// Turns a failed session-flow response into a real Error that preserves the
// backend's machine-readable `code` (e.g. 'PACKET_ALREADY_FILLED'), the HTTP
// `status`, and — when the backend includes one — the fresh `packet` it
// already looked up, so a caller can react specifically instead of treating
// every failure as the same generic message.
async function throwOnFailure(res, fallbackMessage) {
  const data = await res.json();
  if (!data.success) {
    const error = new Error(data.message || fallbackMessage);
    error.status = res.status;
    if (data.code) error.code = data.code;
    if (data.packet) error.packet = data.packet;
    throw error;
  }
  return data;
}

// Looks up any unfinished (status: 'active') session already tied to this
// packet, so a rescanned empty packet can resume its existing flow instead
// of silently starting a duplicate one. Returns the raw history-shaped
// entries from GET /api/sessions (each with a `.measurement` object) —
// normally 0 or 1; more than 1 means pre-existing duplicate data the caller
// must not guess between.
export const findActiveSessionForPacket = (uniqueId, token) =>
  withNetworkErrors('GET /api/sessions (active lookup)', async () => {
    const url = await apiUrl(`/api/sessions?packetUniqueId=${encodeURIComponent(uniqueId)}&status=active&limit=5`);
    const res = await fetch(url, token ? {headers: {Authorization: `Bearer ${token}`}} : undefined);
    const data = await res.json();
    if (!data.success) throw new Error(data.message || 'Could not check for an existing session');
    return data.sessions;
  });

// Starts a new weighing session. `token` (the logged-in user's JWT, if any)
// is optional — the backend records it as the operator when present.
// `uniqueId` (the scanned packet's ID) is also optional, but when provided
// lets the backend refuse to start a session for a packet that's already
// been filled — a defense-in-depth check, since the screen itself already
// checks packet.status right after the scan and never calls this for an
// already-filled packet under normal use.
export const createWeighSession = (token, uniqueId) =>
  withNetworkErrors('POST /api/sessions', async () => {
    const headers = {'Content-Type': 'application/json'};
    if (token) headers.Authorization = `Bearer ${token}`;
    const url = await apiUrl('/api/sessions');
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(uniqueId ? {uniqueId} : {}),
    });
    const data = await throwOnFailure(res, 'Could not start session');
    return data.sessionId;
  });

// `uniqueId` + `phase` ('before'|'after') tell the backend which Cloudinary
// folder (seed-passport/<phase>/<uniqueId>/) this photo belongs to. Without
// them the backend falls back to local-disk-only storage.
// `token` (the logged-in user's JWT) is now required by the backend — every
// session mutation route only accepts the session's own operator.
export const uploadSessionPhoto = (token, sessionId, photoUri, {uniqueId, phase} = {}) =>
  withNetworkErrors(`POST /api/sessions/${sessionId}/photo`, async () => {
    const filename = photoUri.split('/').pop();
    const ext      = filename.split('.').pop()?.toLowerCase() || 'jpg';
    const mime     = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    const fd = new FormData();
    fd.append('photo', {uri: photoUri, name: filename, type: mime});
    if (uniqueId) fd.append('uniqueId', uniqueId);
    if (phase)    fd.append('phase', phase);

    const url = await apiUrl(`/api/sessions/${sessionId}/photo`);
    const res = await fetch(url, {
      method: 'POST',
      // No Content-Type — fetch sets the multipart boundary automatically;
      // Authorization is the only header this request needs to add.
      headers: {Authorization: `Bearer ${token}`},
      body: fd,
    });
    const data = await throwOnFailure(res, 'Photo upload failed');
    return data; // { success, photoUrl, beforePhotoUrl, afterPhotoUrl }
  });

export const saveBeforeWeight = (token, sessionId, weight) =>
  withNetworkErrors(`POST /api/sessions/${sessionId}/before-weight`, async () => {
    const url = await apiUrl(`/api/sessions/${sessionId}/before-weight`);
    const res = await fetch(url, {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token}`},
      body: JSON.stringify({weight}),
    });
    return throwOnFailure(res, 'Could not save before weight');
  });

export const saveAfterWeight = (token, sessionId, weight) =>
  withNetworkErrors(`POST /api/sessions/${sessionId}/after-weight`, async () => {
    const url = await apiUrl(`/api/sessions/${sessionId}/after-weight`);
    const res = await fetch(url, {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token}`},
      body: JSON.stringify({weight}),
    });
    return throwOnFailure(res, 'Could not save after weight'); // { success, afterWeight, afterTime, difference } — difference computed server-side
  });

// Links the completed session onto the scanned SeedPacket — this is the
// actual "save the measurement" step; the packet document is what
// ProductDetailScreen/HistoryScreen read back afterwards.
export const linkSessionToPacket = (token, sessionId, uniqueId) =>
  withNetworkErrors(`POST /api/sessions/${sessionId}/link/${uniqueId}`, async () => {
    const url = await apiUrl(`/api/sessions/${sessionId}/link/${uniqueId}`);
    const res = await fetch(url, {method: 'POST', headers: {Authorization: `Bearer ${token}`}});
    const data = await throwOnFailure(res, 'Could not save measurement');
    return data.packet;
  });

// List of saved measurements (filled packets) for the History screen.
export const fetchPacketHistory = (token) =>
  withNetworkErrors('GET /api/packets', async () => {
    const url = await apiUrl('/api/packets');
    const res = await fetch(url, token ? {headers: {Authorization: `Bearer ${token}`}} : undefined);
    const data = await res.json();
    if (!data.success) throw new Error(data.message || 'Could not load history');
    return data.packets;
  });

// Real WeightSession history for Home/Analytics — same GET /api/sessions
// endpoint the Admin panel's Weighing History/Reports pages already use, so
// there is exactly one place that reads session history across the whole
// project. Returns the full response (not just `.sessions`) because
// `pagination.total` is a server-side count independent of `limit` — the
// only correct way to show an all-time total without being capped by
// however many rows were actually fetched.
export const fetchSessions = (params = {}, token) =>
  withNetworkErrors('GET /api/sessions', async () => {
    const qs = new URLSearchParams(params).toString();
    const url = await apiUrl(`/api/sessions${qs ? `?${qs}` : ''}`);
    const res = await fetch(url, token ? {headers: {Authorization: `Bearer ${token}`}} : undefined);
    const data = await res.json();
    if (!data.success) throw new Error(data.message || 'Could not load measurements');
    return data; // { success, sessions, pagination }
  });

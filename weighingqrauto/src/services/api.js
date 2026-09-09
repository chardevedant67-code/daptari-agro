import {BASE_URL} from '../config';

// Resolves a scanned QR's uniqueId to its SeedPacket record (with batch info
// populated). Function name kept as-is to avoid touching every call site —
// it now queries the real SeedPacket collection that Admin-generated QR
// codes actually belong to (server/routes/packetRoutes.js), not the
// unrelated/orphaned Product collection the old /p/api/:productId route used.
export const fetchProductByScan = async (uniqueId) => {
  try {
    const res = await fetch(`${BASE_URL}/api/packets/${uniqueId}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.message || 'Packet not found');
    return data.packet;
  } catch (err) {
    if (err.message === 'Network request failed') {
      throw new Error('Server unreachable — phone & PC must be on same WiFi');
    }
    throw err;
  }
};

export const fetchLatestProduct = async () => {
  const res = await fetch(`${BASE_URL}/p/api/latest`);
  const data = await res.json();
  if (!data.success) throw new Error(data.message);
  return data.product;
};

// ── Weighing session flow (SeedBatch → SeedPacket → WeightSession) ──
// Reuses the existing session endpoints in server/routes/sessionRoutes.js —
// nothing new was added on the backend for these, they already worked.

// Starts a new weighing session. `token` (the logged-in user's JWT, if any)
// is optional — the backend records it as the operator when present.
export const createWeighSession = async (token) => {
  const headers = {'Content-Type': 'application/json'};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}/api/sessions`, {method: 'POST', headers});
  const data = await res.json();
  if (!data.success) throw new Error(data.message || 'Could not start session');
  return data.sessionId;
};

export const uploadSessionPhoto = async (sessionId, photoUri) => {
  const filename = photoUri.split('/').pop();
  const ext      = filename.split('.').pop()?.toLowerCase() || 'jpg';
  const mime     = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  const fd = new FormData();
  fd.append('photo', {uri: photoUri, name: filename, type: mime});

  const res = await fetch(`${BASE_URL}/api/sessions/${sessionId}/photo`, {
    method: 'POST',
    body: fd, // no Content-Type — fetch sets the multipart boundary automatically
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || 'Photo upload failed');
  return data.photoUrl;
};

export const saveBeforeWeight = async (sessionId, weight) => {
  const res = await fetch(`${BASE_URL}/api/sessions/${sessionId}/before-weight`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({weight}),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || 'Could not save before weight');
  return data;
};

export const saveAfterWeight = async (sessionId, weight) => {
  const res = await fetch(`${BASE_URL}/api/sessions/${sessionId}/after-weight`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({weight}),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || 'Could not save after weight');
  return data; // { success, afterWeight, afterTime, difference } — difference computed server-side
};

// Links the completed session onto the scanned SeedPacket — this is the
// actual "save the measurement" step; the packet document is what
// ProductDetailScreen/HistoryScreen read back afterwards.
export const linkSessionToPacket = async (sessionId, uniqueId) => {
  const res = await fetch(`${BASE_URL}/api/sessions/${sessionId}/link/${uniqueId}`, {method: 'POST'});
  const data = await res.json();
  if (!data.success) throw new Error(data.message || 'Could not save measurement');
  return data.packet;
};

// List of saved measurements (filled packets) for the History screen.
export const fetchPacketHistory = async () => {
  const res = await fetch(`${BASE_URL}/api/packets`);
  const data = await res.json();
  if (!data.success) throw new Error(data.message || 'Could not load history');
  return data.packets;
};

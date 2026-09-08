import {BASE_URL} from '../config';

export const fetchProductByScan = async (productId) => {
  try {
    const res = await fetch(`${BASE_URL}/p/api/${productId}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.message || 'Product not found');
    return data.product;
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

// Fetch latest weight record for a product (for Product Info view)
export const fetchLatestRecord = async (productId) => {
  try {
    const res = await fetch(`${BASE_URL}/p/api/record/latest/${productId}`);
    const data = await res.json();
    return data.record || null;
  } catch (_) {
    return null;
  }
};

// Fetch latest weight pushed by scale machine
export const fetchLatestWeight = async () => {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${BASE_URL}/p/api/weight/latest`, {signal: controller.signal});
    clearTimeout(timer);
    const data = await res.json();
    if (!data.success) return null;
    return data; // { weight, unit, machineId }
  } catch (_) {
    return null;
  }
};

// Save weigh record from mobile — photo + weight linked together
export const saveWeighRecord = async ({productId, actualWeight, nominalWeight, photoUri}) => {
  const fd = new FormData();
  fd.append('productId',     productId);
  fd.append('actualWeight',  String(actualWeight));
  fd.append('nominalWeight', String(nominalWeight || actualWeight));

  // Attach photo if available
  if (photoUri) {
    const filename = photoUri.split('/').pop();
    const ext      = filename.split('.').pop()?.toLowerCase() || 'jpg';
    const mime     = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    fd.append('photo', { uri: photoUri, name: filename, type: mime });
  }

  const res = await fetch(`${BASE_URL}/p/api/weigh-record`, {
    method: 'POST',
    body: fd,
    // Don't set Content-Type — fetch sets multipart boundary automatically
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || 'Save failed');
  return data.record;
};

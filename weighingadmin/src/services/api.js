import axios from 'axios';

// Backend origin — VITE_API_URL lets a production build (Render, etc.) point
// at its real deployed backend; local dev keeps working unchanged since the
// var is unset there and this falls back to the same localhost:5001 as before.
export const API_ORIGIN = import.meta.env.VITE_API_URL || 'http://localhost:5001';

const api = axios.create({
  baseURL: `${API_ORIGIN}/api`,
  headers: { 'Content-Type': 'application/json' },
});

// Attach token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Auto logout on 401
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('admin');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

// ── Auth ──────────────────────────────────────────
export const authAPI = {
  login:  (data) => api.post('/auth/login', data),
  me:     ()     => api.get('/auth/me'),
  logout: ()     => api.post('/auth/logout'),
  // Always resolves with the same generic { success, message } shape
  // regardless of whether the email belongs to an account — never branch
  // UI behavior on its content beyond showing it.
  forgotPassword: (email)            => api.post('/auth/forgot-password', { email }),
  resetPassword:  (token, password)  => api.post('/auth/reset-password', { token, password }),
};

// ── Products ──────────────────────────────────────
export const productAPI = {
  create:  (data)         => api.post('/products', data),
  getAll:  (params)       => api.get('/products', { params }),
  getOne:  (id)           => api.get(`/products/${id}`),
  update:  (id, data)     => api.put(`/products/${id}`, data),
  delete:  (id)           => api.delete(`/products/${id}`),
  qrUrl:   (id)           => `${API_ORIGIN}/api/products/${id}/qr`,
};

// ── Records ───────────────────────────────────────
export const recordAPI = {
  getAll:  (params) => api.get('/records', { params }),
  create:  (data)   => api.post('/records', data),
  delete:  (id)     => api.delete(`/records/${id}`),
};

// ── Machines ──────────────────────────────────────
export const machineAPI = {
  getAll:  (params) => api.get('/machines', { params }),
  create:  (data)   => api.post('/machines', data),
  update:  (id, d)  => api.put(`/machines/${id}`, d),
  delete:  (id)     => api.delete(`/machines/${id}`),
};

// ── Dashboard ─────────────────────────────────────
export const dashboardAPI = {
  stats: () => api.get('/dashboard/stats'),
};

// ── Weighing Sessions (current system: SeedBatch → SeedPacket → WeightSession) ──
// Real weighing/measurement history — GET /api/sessions (added in Step 4).
// Never reads the legacy WeightRecord collection.
export const sessionAPI = {
  getAll: (params) => api.get('/sessions', { params }),
  // Complete filtered dataset for CSV/Excel export — same filters as
  // getAll, but never paginated (backend returns every matching session).
  exportAll: (params) => api.get('/sessions', { params: { ...params, export: 'csv' } }),
};

// ── Batches ───────────────────────────────────────
export const batchAPI = {
  create:   (data) => api.post('/batches', data),
  getAll:   ()     => api.get('/batches'),
  getOne:   (id)   => api.get(`/batches/${id}`),
  qrList:   (id)   => api.get(`/batches/${id}/qr-list`),
  qrBaseUrl: ()    => API_ORIGIN,
  // Product Inventory filtering (Seed/Batch/Warehouse) — reads real
  // SeedBatch/SeedPacket data only, never the legacy Product collection.
  inventory: (params) => api.get('/batches/inventory', { params }),
};

// ── Admin ─────────────────────────────────────────
export const adminAPI = {
  getAll:         ()       => api.get('/admin/all'),
  create:         (data)   => api.post('/admin/create', data),
  update:         (id, d)  => api.put(`/admin/${id}`, d),
  delete:         (id)     => api.delete(`/admin/${id}`),
  changePassword: (data)   => api.put('/admin/change-password', data),
  // E.1 — self-deactivation. Targets the authenticated caller only (the
  // backend never accepts an id for this) — requires currentPassword
  // re-confirmation, same shape as changePassword.
  deactivateSelf: (currentPassword) => api.put('/admin/deactivate-self', { currentPassword }),
};

// ── User / Operator management ───────────────────
// Admin-protected (superadmin), targets the real User collection that
// WeightSession/SeedPacket.operator reference — separate from adminAPI
// above, which manages Admin/back-office accounts.
export const userAdminAPI = {
  getAll:      ()               => api.get('/user/admin/all'),
  create:      (data)           => api.post('/user/admin/create', data),
  update:      (id, d)          => api.put(`/user/admin/${id}`, d),
  delete:      (id)             => api.delete(`/user/admin/${id}`),
  // Admin-mediated recovery for a locked-out operator (Step 9A Option 1 —
  // mobile Users have no self-service reset flow).
  setPassword: (id, password)   => api.put(`/user/admin/${id}/password`, { password }),
};

export default api;

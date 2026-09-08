import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:5001/api',
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
};

// ── Products ──────────────────────────────────────
export const productAPI = {
  create:  (data)         => api.post('/products', data),
  getAll:  (params)       => api.get('/products', { params }),
  getOne:  (id)           => api.get(`/products/${id}`),
  update:  (id, data)     => api.put(`/products/${id}`, data),
  delete:  (id)           => api.delete(`/products/${id}`),
  qrUrl:   (id)           => `http://localhost:5001/api/products/${id}/qr`,
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

// ── Batches ───────────────────────────────────────
export const batchAPI = {
  create:   (data) => api.post('/batches', data),
  getAll:   ()     => api.get('/batches'),
  getOne:   (id)   => api.get(`/batches/${id}`),
  qrList:   (id)   => api.get(`/batches/${id}/qr-list`),
  qrBaseUrl: ()    => 'http://localhost:5001',
};

// ── Admin ─────────────────────────────────────────
export const adminAPI = {
  getAll:         ()       => api.get('/admin/all'),
  create:         (data)   => api.post('/admin/create', data),
  update:         (id, d)  => api.put(`/admin/${id}`, d),
  delete:         (id)     => api.delete(`/admin/${id}`),
  changePassword: (data)   => api.put('/admin/change-password', data),
};

export default api;

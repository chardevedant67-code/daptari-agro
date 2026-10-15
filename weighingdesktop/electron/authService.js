const { ApiError } = require('./apiClient');

// Authentication against the EXISTING backend endpoints only:
//   POST /api/auth/login            Admin-collection login
//   GET  /api/auth/me               who am I / what is my role right now
//   POST /api/auth/logout
//   POST /api/auth/forgot-password  Admin password-reset email
//   POST /api/user/register         public sign-up (creates a mobile operator)
// There are no local accounts, no built-in credentials and no offline login.
//
// Desktop records are readable by Admin-collection accounts only and
// writable by superadmin only — enforced by the backend. `canManage` below
// only decides which controls the UI shows; it is always taken from what the
// server reports for the account, never chosen locally.

const SUPERADMIN = 'superadmin';

function toSession(admin, verified) {
  return {
    admin: { id: String(admin.id), name: admin.name, email: admin.email, role: admin.role },
    canManage: admin.role === SUPERADMIN,
    // false only when the server could not be reached to confirm the stored
    // session (offline launch). The backend still decides on every request.
    verified,
  };
}

function createAuthService({ api, tokenStore, onSessionChange = () => {} }) {
  let stored = null;   // { token, admin }
  let session = null;  // toSession(...)

  function setSession(next, token) {
    session = next;
    if (next) {
      stored = { token: token || stored.token, admin: next.admin };
      tokenStore.save(stored);
    } else {
      stored = null;
      tokenStore.clear();
    }
    onSessionChange(session);
    return session;
  }

  return {
    getToken: () => (stored ? stored.token : null),
    getSession: () => session,

    async login(email, password) {
      const { data } = await api.post('/api/auth/login', { email, password }, { auth: false });
      if (!data || !data.token || !data.admin) {
        throw new ApiError({ kind: 'http', status: 502, message: 'Unexpected response from the server.' });
      }
      stored = { token: data.token, admin: null };
      return setSession(toSession(data.admin, true), data.token);
    },

    // Re-reads the account from the server. This is how a role change or a
    // deactivation made elsewhere reaches a running desktop app.
    async refresh() {
      if (!stored) return null;
      try {
        const { data } = await api.get('/api/auth/me');
        return setSession(toSession(data.admin, true));
      } catch (err) {
        if (err instanceof ApiError && err.kind === 'http' && err.status === 401) {
          return setSession(null);
        }
        throw err;
      }
    },

    // App launch: reuse the remembered session if the server still accepts
    // it. Offline, fall back to the remembered profile (unverified) so the
    // already-downloaded records can be viewed and edits queued; nothing is
    // sent until the server has confirmed the account again.
    async restore() {
      const saved = tokenStore.load();
      if (!saved || !saved.token || !saved.admin) return null;
      stored = saved;
      try {
        return await this.refresh();
      } catch (err) {
        if (err instanceof ApiError && err.retryable) {
          session = toSession(saved.admin, false);
          onSessionChange(session);
          return session;
        }
        return setSession(null);
      }
    },

    async logout() {
      if (stored) {
        try { await api.post('/api/auth/logout', {}); } catch (_) { /* signing out locally regardless */ }
      }
      return setSession(null);
    },

    // The session is no longer valid server-side (401 on a data request).
    expire() {
      return setSession(null);
    },

    // Public sign-up creates a mobile operator account. Such an account has
    // no access to desktop records, so its token is deliberately discarded
    // and the caller stays signed out.
    async register(name, email, password) {
      await api.post('/api/user/register', { name, email, password }, { auth: false });
      return {
        message: 'Account created. This is an operator account for the mobile app — it cannot open desktop records. '
          + 'Ask a Superadmin for an Admin account to sign in here.',
      };
    },

    async forgotPassword(email) {
      const { data } = await api.post('/api/auth/forgot-password', { email }, { auth: false });
      return { message: (data && data.message) || 'If an account exists for this email, a password reset link has been sent.' };
    },
  };
}

module.exports = { createAuthService };

const fs = require('fs');

// Where the signed-in session (backend JWT + the account's public profile)
// is kept between app launches. Both stores share one tiny interface:
// load() -> { token, admin } | null, save(session), clear().

// Encrypted at rest with the operating system's own secret store (DPAPI on
// Windows, via Electron's safeStorage), so the token on disk is only
// readable by the same Windows user. If OS encryption is unavailable the
// session is simply kept in memory for this run and never written out.
function createSafeTokenStore({ safeStorage, filePath }) {
  let memory = null;

  return {
    load() {
      if (memory) return memory;
      try {
        if (!safeStorage.isEncryptionAvailable() || !fs.existsSync(filePath)) return null;
        const parsed = JSON.parse(safeStorage.decryptString(fs.readFileSync(filePath)));
        if (!parsed || typeof parsed.token !== 'string') return null;
        memory = parsed;
        return memory;
      } catch (_) {
        // Unreadable or written by another user/machine — treat as signed out.
        return null;
      }
    },
    save(session) {
      memory = session;
      try {
        if (safeStorage.isEncryptionAvailable()) {
          fs.writeFileSync(filePath, safeStorage.encryptString(JSON.stringify(session)));
        }
      } catch (_) {
        // Still signed in for this run; just not remembered next launch.
      }
    },
    clear() {
      memory = null;
      try { fs.rmSync(filePath, { force: true }); } catch (_) {}
    },
  };
}

function createMemoryTokenStore() {
  let memory = null;
  return {
    load: () => memory,
    save: (session) => { memory = session; },
    clear: () => { memory = null; },
  };
}

module.exports = { createSafeTokenStore, createMemoryTokenStore };

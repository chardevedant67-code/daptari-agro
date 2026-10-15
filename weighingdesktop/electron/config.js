const fs = require('fs');
const path = require('path');

// The desktop app's entire configuration is where the backend is and where
// to put its files. It holds no database address and no credentials — the
// only secret it ever has is the signed-in user's own token (tokenStore.js).
//
//   DESKTOP_API_URL        backend origin. Defaults to a LOCAL backend, so a
//                          build never talks to a deployed server unless it
//                          has been pointed at one deliberately.
//   DESKTOP_WORKBOOK_DIR   folder for Seed_Management.xlsx (default: Documents)
//   DESKTOP_USER_DATA_DIR  folder for the app's own state (default: Electron's)
//
// Read from the process environment first, then from a `.env` file next to
// package.json (see .env.example).
const DEFAULT_API_URL = 'http://localhost:5001';
const KEYS = ['DESKTOP_API_URL', 'DESKTOP_WORKBOOK_DIR', 'DESKTOP_USER_DATA_DIR'];

function readEnvFile(filePath) {
  const values = {};
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (_) {
    return values;
  }
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/);
    if (!match || !KEYS.includes(match[1])) continue;
    values[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return values;
}

// The installed app: its backend address is fixed when the installer is
// built (production.config.json, packaged inside the app). Environment
// variables and .env files are ignored, and there is no fallback — a
// missing, non-https or local address stops the app instead.
function loadPackagedConfig(appRoot) {
  let apiUrl = '';
  try {
    const file = JSON.parse(fs.readFileSync(path.join(appRoot, 'production.config.json'), 'utf8'));
    apiUrl = String(file.apiUrl || '').replace(/\/+$/, '');
  } catch (_) { /* reported below */ }
  let parsed = null;
  try { parsed = new URL(apiUrl); } catch (_) { /* reported below */ }
  const local = parsed && /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/i.test(parsed.hostname);
  if (!parsed || parsed.protocol !== 'https:' || local) {
    throw new Error('This installation has no valid server address. Reinstall the app or contact your administrator.');
  }
  return { apiUrl, workbookDir: null, userDataDir: null };
}

function loadConfig({ env = process.env, appRoot = path.join(__dirname, '..'), packaged = false } = {}) {
  if (packaged) return loadPackagedConfig(appRoot);
  const fromFile = readEnvFile(path.join(appRoot, '.env'));
  const pick = (key) => (env[key] && env[key].trim()) || fromFile[key] || '';

  const apiUrl = (pick('DESKTOP_API_URL') || DEFAULT_API_URL).replace(/\/+$/, '');
  let parsed;
  try {
    parsed = new URL(apiUrl);
  } catch (_) {
    throw new Error(`DESKTOP_API_URL is not a valid URL: ${apiUrl}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('DESKTOP_API_URL must start with http:// or https://');
  }

  return {
    apiUrl,
    workbookDir: pick('DESKTOP_WORKBOOK_DIR') || null,
    userDataDir: pick('DESKTOP_USER_DATA_DIR') || null,
  };
}

module.exports = { loadConfig, DEFAULT_API_URL };

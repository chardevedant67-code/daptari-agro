// Pure rules for the two download links. Shared by the page (main.js) and
// the build checks (scripts/check.mjs), so a link the checks reject can
// never be shown as a working download.

export const PLATFORMS = {
  android: {extension: '.apk', label: 'Android APK'},
  windows: {extension: '.exe', label: 'Windows installer'},
};

const LOCAL_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/i;

function parse(url, base) {
  try {
    return new URL(url, base);
  } catch (_) {
    return null;
  }
}

// What a platform's download should look like on the page.
//   {state: 'ready', href}        a usable link
//   {state: 'unconfigured'}       no URL set yet
//   {state: 'invalid', problem}   a URL is set but breaks a rule
// `base` resolves relative URLs ("/downloads/x.apk"); `otherUrl` is the
// other platform's URL, which must never be the same file.
export function resolveDownload(platform, entry, otherUrl = '', base = 'https://example.invalid/') {
  const rule = PLATFORMS[platform];
  if (!rule) return {state: 'invalid', problem: `Unknown platform "${platform}".`};
  const raw = entry && typeof entry.url === 'string' ? entry.url.trim() : '';
  if (!raw) return {state: 'unconfigured'};

  const url = parse(raw, base);
  if (!url) return {state: 'invalid', problem: 'The download URL is not a valid address.'};
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOCAL_HOST.test(url.hostname))) {
    return {state: 'invalid', problem: 'The download URL must use https.'};
  }
  if (!decodeURIComponent(url.pathname).toLowerCase().endsWith(rule.extension)) {
    return {state: 'invalid', problem: `The ${rule.label} URL must point to a ${rule.extension} file.`};
  }
  const other = otherUrl && otherUrl.trim() ? parse(otherUrl.trim(), base) : null;
  if (other && other.href === url.href) {
    return {state: 'invalid', problem: 'The Android and Windows downloads point to the same file.'};
  }
  return {state: 'ready', href: url.href};
}

// Every problem in a whole DOWNLOADS object, for the build checks.
export function validateDownloads(downloads) {
  const problems = [];
  for (const platform of Object.keys(PLATFORMS)) {
    const entry = downloads && downloads[platform];
    if (!entry) {
      problems.push({platform, level: 'error', message: 'missing from the configuration'});
      continue;
    }
    const other = platform === 'android' ? downloads.windows : downloads.android;
    const result = resolveDownload(platform, entry, other && other.url);
    if (result.state === 'invalid') problems.push({platform, level: 'error', message: result.problem});
    if (result.state === 'unconfigured') {
      problems.push({platform, level: 'warning', message: 'no download URL configured yet — the page shows "not available yet"'});
    }
    if (!/\.(apk|exe)$/i.test(entry.fileName || '') || !(entry.fileName || '').toLowerCase().endsWith(PLATFORMS[platform].extension)) {
      problems.push({platform, level: 'error', message: `fileName must end in ${PLATFORMS[platform].extension}`});
    }
    if (!/^[0-9a-f]{64}$/.test(entry.sha256 || '')) problems.push({platform, level: 'error', message: 'sha256 must be 64 hex characters'});
    if (!Number.isInteger(entry.sizeBytes) || entry.sizeBytes <= 0) problems.push({platform, level: 'error', message: 'sizeBytes must be a positive integer'});
  }
  return problems;
}

// 327258922 -> "312 MB" (binary megabytes, as Windows and Android show them).
export function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

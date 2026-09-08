import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@server_url';
const DEFAULT_URLS = [
  'http://192.168.31.141:5001',
  'http://10.0.2.2:5001',        // Android emulator
  'http://localhost:5001',        // iOS simulator
];
export const DEFAULT_SERVER_URL = DEFAULT_URLS[0];
const TIMEOUT_MS = 6000;
const DISCOVERY_TIMEOUT_MS = 2000;
const DISCOVERY_BATCH_SIZE = 20;

let _currentUrl = DEFAULT_URLS[0];
let _listeners = [];
let _initPromise = null;

const normalizeUrl = (url = '') => {
  const trimmed = String(url).trim().replace(/\s+/g, '');
  if (!trimmed) {
    return '';
  }

  try {
    const parsed = new URL(trimmed);
    return parsed.origin;
  } catch (_) {
    return trimmed.replace(/\/+$/, '');
  }
};

const parseUrl = (url) => {
  try {
    return new URL(normalizeUrl(url));
  } catch (_) {
    return null;
  }
};

const isPrivateIpv4Host = (host = '') => {
  const octets = host.split('.').map(Number);
  if (octets.length !== 4 || octets.some(Number.isNaN)) {
    return false;
  }

  if (octets[0] === 10) {
    return true;
  }

  if (octets[0] === 192 && octets[1] === 168) {
    return true;
  }

  return octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31;
};

const buildSubnetCandidates = (urls = []) => {
  const discovered = [];

  urls.forEach(url => {
    const parsed = parseUrl(url);
    if (!parsed || !isPrivateIpv4Host(parsed.hostname)) {
      return;
    }

    const octets = parsed.hostname.split('.');
    const base = `${octets[0]}.${octets[1]}.${octets[2]}`;
    const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');

    for (let host = 1; host <= 254; host += 1) {
      discovered.push(`${parsed.protocol}//${base}.${host}:${port}`);
    }
  });

  return discovered;
};

export const getBaseUrl = () => _currentUrl;

const notifyUrlChange = (url) => {
  _listeners.forEach(fn => fn(url));
};

const updateBaseUrl = async (url, {persist = true} = {}) => {
  const clean = normalizeUrl(url);
  _currentUrl = clean;
  if (persist) {
    await AsyncStorage.setItem(STORAGE_KEY, clean);
  }
  notifyUrlChange(clean);
  return clean;
};

export const setBaseUrl = async (url) => {
  return updateBaseUrl(url);
};

export const onUrlChange = (fn) => {
  _listeners.push(fn);
  return () => { _listeners = _listeners.filter(l => l !== fn); };
};

const buildCandidates = (candidates = []) => {
  const directCandidates = [...candidates, _currentUrl, ...DEFAULT_URLS]
    .map(normalizeUrl)
    .filter(Boolean);

  return [...new Set(
    [...directCandidates, ...buildSubnetCandidates(directCandidates)],
  )];
};

const buildProbeTargets = (url) => {
  const clean = normalizeUrl(url);
  return [`${clean}/api/health`, clean];
};

export const getHealthCheckUrl = (url = _currentUrl) => `${normalizeUrl(url)}/api/health`;

export async function probe(url, timeoutMs = TIMEOUT_MS) {
  for (const target of buildProbeTargets(url)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(target, {signal: controller.signal});
      clearTimeout(timer);
      if (res.ok || res.status < 500) {
        return true;
      }
    } catch (_) {
      clearTimeout(timer);
    }
  }
  return false;
}

export const checkServerConnection = async (url = _currentUrl) => {
  return probe(url);
};

export const autoDiscover = async (candidates) => {
  const all = buildCandidates(candidates);

  for (let index = 0; index < all.length; index += DISCOVERY_BATCH_SIZE) {
    const batch = all.slice(index, index + DISCOVERY_BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async url => ({
        url,
        ok: await probe(url, DISCOVERY_TIMEOUT_MS),
      })),
    );

    const match = results.find(result => result.ok);
    if (match) {
      await setBaseUrl(match.url);
      return match.url;
    }
  }

  return null;
};

export const initServerConfig = async () => {
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    if (saved) {
      await updateBaseUrl(saved, {persist: false});
      const found = await autoDiscover([saved]);
      if (found) {
        return found;
      }
      await AsyncStorage.removeItem(STORAGE_KEY);
    }
  } catch (_) {}

  const found = await autoDiscover([]);
  if (found) {
    return found;
  }

  return _currentUrl;
};

export const ensureServerConfigReady = async () => {
  if (!_initPromise) {
    _initPromise = initServerConfig().finally(() => {
      _initPromise = null;
    });
  }
  return _initPromise;
};

export const ensureReachableBaseUrl = async (candidates = []) => {
  await ensureServerConfigReady();

  const currentUrl = getBaseUrl();
  if (await probe(currentUrl)) {
    return currentUrl;
  }

  const found = await autoDiscover(candidates);
  return found || currentUrl;
};

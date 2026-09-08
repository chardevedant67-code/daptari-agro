import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@server_url';
const DEFAULT_URLS = [
  'http://192.168.0.181:5001',    // Current machine IP (most reliable for physical device)
  'http://192.168.31.141:5001',   // Previous machine IP fallback
  'http://localhost:5001',
  'http://10.0.2.2:5001',
];
export const DEFAULT_SERVER_URL = DEFAULT_URLS[0];
const TIMEOUT_MS = 10000;
const DISCOVERY_TIMEOUT_MS = 2000;
const DISCOVERY_BATCH_SIZE = 5;

let _currentUrl = DEFAULT_URLS[0];
let _listeners = [];
let _initPromise = null;

const normalizeUrl = (url = '') => {
  const trimmed = String(url).trim().replace(/\s+/g, '');
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    return parsed.origin;
  } catch (_) {
    return trimmed.replace(/\/+$/, '');
  }
};

export const getBaseUrl = () => _currentUrl;

const notifyUrlChange = (url) => { _listeners.forEach(fn => fn(url)); };

const updateBaseUrl = async (url, {persist = true} = {}) => {
  const clean = normalizeUrl(url);
  console.log('[ServerConfig] Updating URL to:', clean);
  _currentUrl = clean;
  if (persist) {
    try { await AsyncStorage.setItem(STORAGE_KEY, clean); } catch (_) {}
  }
  notifyUrlChange(clean);
  return clean;
};

export const setBaseUrl = async (url) => updateBaseUrl(url);

export const onUrlChange = (fn) => {
  _listeners.push(fn);
  return () => { _listeners = _listeners.filter(l => l !== fn); };
};

export async function probe(url, timeoutMs = TIMEOUT_MS) {
  const target = `${normalizeUrl(url)}/api/health`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    console.log('[ServerConfig] Probing:', target);
    const res = await fetch(target, {signal: controller.signal});
    clearTimeout(timer);
    if (res.ok) {
      console.log('[ServerConfig] Probe success:', target);
      return true;
    }
    console.log('[ServerConfig] Probe failed (status):', target, res.status);
  } catch (err) {
    clearTimeout(timer);
    console.log('[ServerConfig] Probe error:', target, err.message);
  }
  return false;
}

export const autoDiscover = async (candidates = []) => {
  const all = [...new Set([...candidates, ...DEFAULT_URLS])].map(normalizeUrl).filter(Boolean);
  console.log('[ServerConfig] Starting discovery across:', all);
  
  for (const url of all) {
    if (await probe(url, DISCOVERY_TIMEOUT_MS)) {
      await setBaseUrl(url);
      return url;
    }
  }
  return null;
};

export const initServerConfig = async () => {
  if (_initPromise) return _initPromise;
  
  _initPromise = (async () => {
    try {
      const saved = await AsyncStorage.getItem(STORAGE_KEY);
      if (saved) {
        console.log('[ServerConfig] Found saved URL:', saved);
        if (await probe(saved)) {
          _currentUrl = saved;
          return saved;
        }
      }
    } catch (_) {}

    const found = await autoDiscover().catch(() => null);
    if (found) return found;
    
    console.log('[ServerConfig] Discovery failed, falling back to:', DEFAULT_SERVER_URL);
    _currentUrl = DEFAULT_SERVER_URL;
    return _currentUrl;
  })();

  return _initPromise;
};

export const ensureServerConfigReady = async () => {
  return initServerConfig();
};

export const ensureReachableBaseUrl = async (candidates = []) => {
  await ensureServerConfigReady();
  if (await probe(_currentUrl)) return _currentUrl;
  const found = await autoDiscover(candidates);
  return found || _currentUrl;
};

import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import {__setConfigBaseUrl} from '../config';

// ────────────────────────────────────────────────────────────────────────
// Dynamic LAN server discovery.
//
// There is intentionally NO hardcoded permanent backend IP here. The
// laptop running the backend can be on any private subnet (192.168.x.x,
// 10.x.x.x, 172.16-31.x.x) and its IP can change at any time (DHCP lease
// renewal, switching networks, etc). This module:
//
//   1. Remembers the last known-good server URL (AsyncStorage).
//   2. On every resolution request, health-checks that cached URL first.
//   3. If it's gone, scans the phone's OWN current WiFi subnet (via
//      NetInfo) for a server answering on the same port, plus a couple of
//      safe emulator/simulator fallbacks.
//   4. Never scans the public internet — only RFC1918 private ranges,
//      and only the phone's actual local subnet.
//   5. Never sends credentials during discovery — only an unauthenticated
//      GET against /api/health (falling back to a bare GET on /).
// ────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = '@server_url';

// Non-LAN fallbacks only — these are development-environment addresses
// (emulator/simulator loopbacks), not a real backend IP, so they are safe
// to keep as static seeds.
const DEFAULT_URLS = [
  'http://10.0.2.2:5001',   // Android emulator -> host loopback
  'http://localhost:5001',  // iOS simulator / same-device dev server
];
export const DEFAULT_SERVER_URL = DEFAULT_URLS[0];
const DEFAULT_PORT = '5001';

const TIMEOUT_MS = 6000;
const DISCOVERY_PROBE_TIMEOUT_MS = 1200;
const DISCOVERY_BATCH_SIZE = 32;
const DISCOVERY_MAX_DURATION_MS = 15000; // never freeze the login screen

let _currentUrl = DEFAULT_URLS[0];
let _listeners = [];
let _initPromise = null;

__setConfigBaseUrl(_currentUrl);

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

const parseUrl = url => {
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

// ── Phone's own subnet (real LAN discovery target) ──────────────────────

// Reads the phone's current WiFi IPv4 address via NetInfo so discovery
// scans the network the phone is ACTUALLY on, instead of a subnet that
// happened to work on some previous WiFi network.
const getDeviceSubnetBase = async () => {
  try {
    const state = await NetInfo.fetch();
    const ip = state?.details?.ipAddress;
    if (!ip || typeof ip !== 'string' || !isPrivateIpv4Host(ip)) {
      return null;
    }
    const octets = ip.split('.');
    return `${octets[0]}.${octets[1]}.${octets[2]}`;
  } catch (_) {
    return null;
  }
};

const buildSubnetCandidates = (base, port) => {
  const candidates = [];
  for (let host = 1; host <= 254; host += 1) {
    candidates.push(`http://${base}.${host}:${port}`);
  }
  return candidates;
};

const buildSubnetCandidatesFromUrls = (urls = []) => {
  const discovered = [];

  urls.forEach(url => {
    const parsed = parseUrl(url);
    if (!parsed || !isPrivateIpv4Host(parsed.hostname)) {
      return;
    }

    const octets = parsed.hostname.split('.');
    const base = `${octets[0]}.${octets[1]}.${octets[2]}`;
    const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
    discovered.push(...buildSubnetCandidates(base, port));
  });

  return discovered;
};

export const getBaseUrl = () => _currentUrl;

const notifyUrlChange = url => {
  _listeners.forEach(fn => fn(url));
};

const updateBaseUrl = async (url, {persist = true} = {}) => {
  const clean = normalizeUrl(url);
  _currentUrl = clean;
  __setConfigBaseUrl(clean);
  if (persist) {
    await AsyncStorage.setItem(STORAGE_KEY, clean);
  }
  notifyUrlChange(clean);
  return clean;
};

export const setBaseUrl = async url => {
  return updateBaseUrl(url);
};

export const onUrlChange = fn => {
  _listeners.push(fn);
  return () => {
    _listeners = _listeners.filter(l => l !== fn);
  };
};

// Builds the ordered list of URLs to probe: the phone's own subnet first
// (most likely to be correct "right now"), then the current/previous known
// URL's subnet (covers "server didn't move, phone did"), then dev fallbacks.
const buildCandidates = async (candidates = []) => {
  const seedUrls = [...candidates, _currentUrl]
    .map(normalizeUrl)
    .filter(Boolean);

  const ownSubnetBase = await getDeviceSubnetBase();
  const ownSubnetCandidates = ownSubnetBase
    ? buildSubnetCandidates(ownSubnetBase, DEFAULT_PORT)
    : [];

  const seededSubnetCandidates = buildSubnetCandidatesFromUrls(seedUrls);

  return [
    ...new Set([
      ...seedUrls,
      ...ownSubnetCandidates,
      ...seededSubnetCandidates,
      ...DEFAULT_URLS,
    ]),
  ];
};

const buildProbeTargets = url => {
  const clean = normalizeUrl(url);
  return [`${clean}/api/health`, clean];
};

export const getHealthCheckUrl = (url = _currentUrl) => `${normalizeUrl(url)}/api/health`;

export async function probe(url, timeoutMs = TIMEOUT_MS) {
  for (const target of buildProbeTargets(url)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // GET only — discovery never sends credentials or any request body.
      const res = await fetch(target, {method: 'GET', signal: controller.signal});
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

const runDiscovery = async candidates => {
  const all = await buildCandidates(candidates);

  for (let index = 0; index < all.length; index += DISCOVERY_BATCH_SIZE) {
    const batch = all.slice(index, index + DISCOVERY_BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async url => ({
        url,
        ok: await probe(url, DISCOVERY_PROBE_TIMEOUT_MS),
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

export const autoDiscover = async (candidates = []) => {
  // Bound total discovery time so the Login/Register screen never appears
  // frozen — if nothing answers within the window, report "not found" and
  // let the caller fall back to manual entry.
  return Promise.race([
    runDiscovery(candidates),
    new Promise(resolve => setTimeout(() => resolve(null), DISCOVERY_MAX_DURATION_MS)),
  ]);
};

export const initServerConfig = async () => {
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    if (saved) {
      await updateBaseUrl(saved, {persist: false});
      if (await probe(saved)) {
        return saved;
      }
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

// The single entry point login/register/the API client should call: cached
// URL if it still answers, otherwise a fresh LAN discovery — always
// returning the best URL currently known even if discovery fails.
export const ensureReachableBaseUrl = async (candidates = []) => {
  await ensureServerConfigReady();

  const currentUrl = getBaseUrl();
  if (await probe(currentUrl)) {
    return currentUrl;
  }

  const found = await autoDiscover(candidates);
  return found || currentUrl;
};

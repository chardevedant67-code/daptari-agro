// BASE_URL is resolved at RUNTIME by the LAN server-discovery system
// (see src/services/serverConfig.js). It is a live binding that gets
// updated automatically whenever a working server is found or the cached
// server URL changes — it is never a frozen/hardcoded LAN IP.
//
// Do NOT rely on this value before discovery has had a chance to run.
// Code paths that must be correct on the very first request (login,
// register, the shared API client) should call `ensureReachableBaseUrl()`
// from serverConfig.js directly instead of reading this binding.
export let BASE_URL = 'http://localhost:5001';

// Internal: called by serverConfig.js whenever the resolved server URL
// changes, so every existing `import {BASE_URL} from '../config'` consumer
// keeps working without having to be rewritten to call getBaseUrl().
export const __setConfigBaseUrl = url => {
  BASE_URL = url;
};

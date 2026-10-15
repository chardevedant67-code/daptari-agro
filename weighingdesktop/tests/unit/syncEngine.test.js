const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createSyncEngine } = require('../../electron/syncEngine');
const { createRecordStore } = require('../../electron/recordStore');
const { createOutbox } = require('../../electron/outbox');
const { ApiError } = require('../../electron/apiClient');

function memoryFile(initial) {
  const file = {
    saved: initial,
    read: () => (file.saved === undefined ? undefined : JSON.parse(JSON.stringify(file.saved))),
    write: (value) => { file.saved = JSON.parse(JSON.stringify(value)); },
  };
  return file;
}

const network = () => new ApiError({ kind: 'network', message: 'Cannot reach the server.' });
const http = (status, extra = {}) => new ApiError({ kind: 'http', status, message: extra.message || `HTTP ${status}`, ...extra });

function serverRecord(recordId, version, fields = {}) {
  return { recordId, packetUniqueId: null, version, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: `2026-01-01T00:00:0${version}.000Z`, ...fields };
}

// A scriptable stand-in for the backend. `server` is its database.
function harness({ role = 'superadmin' } = {}) {
  const server = new Map();
  const calls = [];
  const h = {
    server,
    calls,
    role,
    offline: false,
    failNext: null,          // (method, path) => ApiError | null, consumed once it returns one
    workbookWrites: [],
    workbookBusy: false,
    packets: 0,            // seed packets the server says exist
    linked: 0,             // …of which already have a desktop record
    scheduled: [],
    changes: 0,
  };

  function guard(method, path) {
    calls.push(`${method} ${path}`);
    if (h.offline) throw network();
    if (h.failNext) {
      const err = h.failNext(method, path);
      if (err) { h.failNext = null; throw err; }
    }
  }

  const api = {
    async get(path, { query } = {}) {
      guard('GET', path);
      if (path === '/api/desktop-records') {
        h.lastQuery = query;
        if (h.routesMissing) throw http(404, { message: 'Route /api/desktop-records not found' });
        return { status: 200, data: { success: true, records: [...server.values()], hasMore: false, nextCursor: server.size ? (h.nextCursorOverride || { since: '2026-01-01T00:00:09.000Z', afterId: 'a'.repeat(24) }) : null } };
      }
      if (path === '/api/desktop-records/summary') {
        if (h.summary === 'missing') throw http(404, { message: 'Route /api/desktop-records/summary not found' });
        return { status: 200, data: { success: true, records: server.size, packets: h.packets, packetsNotImported: Math.max(h.packets - h.linked, 0), ...(h.summary || {}) } };
      }
      throw http(404);
    },
    async post(path, body) {
      guard('POST', path);
      if (path === '/api/desktop-records') {
        if (h.routesMissing) throw http(404, { message: 'Route /api/desktop-records not found' });
        if (h.role !== 'superadmin') throw http(403, { message: 'Access denied' });
        if (server.has(body.recordId)) return { status: 200, data: { success: true, created: false, record: server.get(body.recordId) } };
        const record = serverRecord(body.recordId, 1, body.fields);
        server.set(body.recordId, record);
        return { status: 201, data: { success: true, created: true, record } };
      }
      if (path === '/api/desktop-records/import-packets') {
        return { status: 200, data: { success: true, totalPackets: 2, created: 2, skipped: 0 } };
      }
      throw http(404);
    },
    async put(path, body) {
      guard('PUT', path);
      const recordId = decodeURIComponent(path.split('/').pop());
      if (h.routesMissing) throw http(404, { message: `Route ${path} not found` });
      if (h.role !== 'superadmin') throw http(403, { message: 'Access denied' });
      const current = server.get(recordId);
      if (!current) throw http(404, { message: 'Record not found' });
      if (current.version !== body.baseVersion) {
        throw http(409, { code: 'VERSION_CONFLICT', message: 'changed', data: { record: current } });
      }
      const record = { ...current, ...body.fields, version: current.version + 1, updatedAt: `2026-01-01T00:00:0${current.version + 1}.000Z` };
      server.set(recordId, record);
      return { status: 200, data: { success: true, record } };
    },
  };

  let session = { admin: { id: 'a1', name: 'A', email: 'a@x.io', role: h.role }, canManage: h.role === 'superadmin', verified: true };
  const auth = {
    getSession: () => session,
    async refresh() {
      if (h.offline) throw network();
      if (h.sessionGone) { session = null; return null; }
      session = { ...session, admin: { ...session.admin, role: h.role }, canManage: h.role === 'superadmin' };
      return session;
    },
    expire() { session = null; h.expired = true; },
  };

  const store = createRecordStore({ file: memoryFile() });
  const outbox = createOutbox({ file: memoryFile([]) });
  const workbook = {
    filePath: 'X:/Seed_Management.xlsx',
    async write(records) {
      if (h.workbookBusy) { const e = new Error('open'); e.busy = true; throw e; }
      h.workbookWrites.push(records.map((r) => ({ ...r })));
      return { written: true, meta: { signature: String(h.workbookWrites.length) } };
    },
  };
  const timers = {
    setTimeout: (fn, ms) => { const t = { fn, ms }; h.scheduled.push(t); return t; },
    clearTimeout: (t) => { const i = h.scheduled.indexOf(t); if (i !== -1) h.scheduled.splice(i, 1); },
  };

  h.store = store;
  h.outbox = outbox;
  h.engine = createSyncEngine({ api, auth, store, outbox, workbook, timers, now: () => (h.clock === undefined ? Date.now() : h.clock), config: { retryBaseMs: 5000, retryMaxMs: 300000, intervalMs: 300000, workbookRetryMs: 30000 }, onChange: () => { h.changes += 1; } });
  h.lastWorkbook = () => h.workbookWrites[h.workbookWrites.length - 1];
  h.lastDelay = () => h.scheduled[h.scheduled.length - 1].ms;
  return h;
}

describe('sync engine — a change is saved only when the backend says so', () => {
  it('create: pending -> POST -> confirmed record enters cache and workbook, outbox empties', async () => {
    const h = harness();
    await h.engine.start();
    h.outbox.enqueueCreate('r1', { crop: 'Maize' });
    assert.equal(h.engine.getStatus().state, 'pending');
    assert.equal(h.store.get('r1'), null, 'nothing cached before the backend confirms');

    const status = await h.engine.syncNow();
    assert.equal(status.state, 'synced');
    assert.equal(h.outbox.size(), 0);
    assert.equal(h.store.get('r1').version, 1);
    assert.deepEqual(h.lastWorkbook().map((r) => r.recordId), ['r1']);
  });

  it('offline: the change stays pending, is NOT in the cache or workbook, and a retry is scheduled', async () => {
    const h = harness();
    await h.engine.start();
    h.offline = true;
    h.outbox.enqueueCreate('r1', { crop: 'Maize' });

    const status = await h.engine.syncNow();
    assert.equal(status.state, 'offline');
    assert.equal(status.pending, 1);
    assert.equal(h.outbox.size(), 1);
    assert.equal(h.store.get('r1'), null);
    assert.deepEqual(h.lastWorkbook(), [], 'workbook must not contain the unconfirmed record');
    assert.equal(h.lastDelay(), 5000);
    assert.ok(status.nextRetryAt);
  });

  it('back online: the queued change is sent exactly once and becomes synced', async () => {
    const h = harness();
    await h.engine.start();
    h.offline = true;
    h.outbox.enqueueCreate('r1', { crop: 'Maize' });
    await h.engine.syncNow();
    await h.engine.syncNow();

    h.offline = false;
    const status = await h.engine.syncNow();
    assert.equal(status.state, 'synced');
    assert.equal(h.server.size, 1);
    assert.equal(h.calls.filter((c) => c === 'POST /api/desktop-records').length, 1);
    assert.deepEqual(h.lastWorkbook().map((r) => r.recordId), ['r1']);
  });

  it('a response lost after the server saved a create does not duplicate on retry', async () => {
    const h = harness();
    await h.engine.start();
    h.outbox.enqueueCreate('r1', { crop: 'Maize' });
    // The server stores it, but the client never hears back.
    h.server.set('r1', serverRecord('r1', 1, { crop: 'Maize' }));
    h.failNext = (method, path) => (method === 'POST' && path === '/api/desktop-records' ? network() : null);
    await h.engine.syncNow();
    assert.equal(h.outbox.size(), 1);

    await h.engine.syncNow();
    assert.equal(h.outbox.size(), 0);
    assert.equal(h.server.size, 1);
  });

  it('a response lost after the server saved an update is recognised, not shown as a conflict', async () => {
    const h = harness();
    h.server.set('r1', serverRecord('r1', 1, { crop: 'Maize', gene: '' }));
    await h.engine.start();
    h.outbox.enqueueUpdate('r1', 1, { gene: 'Rf1' });
    // First attempt reached the server (version is now 2) but timed out client-side.
    h.server.set('r1', serverRecord('r1', 2, { crop: 'Maize', gene: 'Rf1' }));

    const status = await h.engine.syncNow();
    assert.equal(status.conflicts, 0);
    assert.equal(h.outbox.size(), 0);
    assert.equal(h.store.get('r1').version, 2);
  });
});

describe('sync engine — retry and backoff', () => {
  it('backs off 5s, 10s, 20s … capped at 5 minutes, and resets after a success', async () => {
    const h = harness();
    await h.engine.start();
    h.offline = true;
    const delays = [];
    for (let i = 0; i < 8; i += 1) { await h.engine.syncNow(); delays.push(h.lastDelay()); }
    assert.deepEqual(delays, [5000, 10000, 20000, 40000, 80000, 160000, 300000, 300000]);

    h.offline = false;
    await h.engine.syncNow();
    assert.equal(h.lastDelay(), 300000, 'routine interval after success');
    h.offline = true;
    await h.engine.syncNow();
    assert.equal(h.lastDelay(), 5000, 'backoff restarted');
  });

  it('honours Retry-After on 429 and keeps the change queued', async () => {
    const h = harness();
    await h.engine.start();
    h.outbox.enqueueCreate('r1', { crop: 'Maize' });
    h.failNext = (method) => (method === 'POST' ? http(429, { retryAfterMs: 42000 }) : null);
    const status = await h.engine.syncNow();
    assert.equal(status.state, 'error');
    assert.equal(h.outbox.size(), 1);
    assert.equal(h.outbox.nextSendable().state, 'pending');
    assert.equal(h.lastDelay(), 42000);
  });

  it('a 5xx is retried later, never turned into a permanent error', async () => {
    const h = harness();
    await h.engine.start();
    h.outbox.enqueueCreate('r1', { crop: 'Maize' });
    h.failNext = (method) => (method === 'POST' ? http(500) : null);
    await h.engine.syncNow();
    assert.equal(h.outbox.nextSendable().state, 'pending');
    await h.engine.syncNow();
    assert.equal(h.outbox.size(), 0);
  });

  it('a 400 from the server is not retried — it waits for the user with the server message', async () => {
    const h = harness();
    await h.engine.start();
    h.outbox.enqueueCreate('r1', { crop: 'Maize' });
    h.failNext = (method) => (method === 'POST' ? http(400, { message: 'yield1 must be a number' }) : null);
    const status = await h.engine.syncNow();
    assert.equal(status.errors, 1);
    assert.equal(status.state, 'attention');
    assert.equal(h.outbox.list()[0].message, 'yield1 must be a number');
    const postsBefore = h.calls.filter((c) => c.startsWith('POST')).length;
    await h.engine.syncNow();
    assert.equal(h.calls.filter((c) => c.startsWith('POST')).length, postsBefore);
    assert.equal(h.store.get('r1'), null);
  });

  it('a rejected record does not block other records', async () => {
    const h = harness();
    await h.engine.start();
    h.outbox.enqueueCreate('bad', { crop: 'X' });
    h.outbox.enqueueCreate('good', { crop: 'Y' });
    h.failNext = (method) => (method === 'POST' ? http(400, { message: 'nope' }) : null);
    await h.engine.syncNow();
    assert.equal(h.store.get('good').version, 1);
    assert.equal(h.outbox.size(), 1);
  });
});

describe('sync engine — version conflicts', () => {
  it('409: my change is kept as a conflict, the server record is cached, nothing is overwritten', async () => {
    const h = harness();
    h.server.set('r1', serverRecord('r1', 1, { crop: 'Maize', gene: '' }));
    await h.engine.start();
    h.outbox.enqueueUpdate('r1', 1, { gene: 'Mine' });
    h.server.set('r1', serverRecord('r1', 2, { crop: 'Maize', gene: 'Theirs' }));

    const status = await h.engine.syncNow();
    assert.equal(status.state, 'conflict');
    assert.equal(status.conflicts, 1);
    assert.equal(h.server.get('r1').gene, 'Theirs');
    assert.equal(h.store.get('r1').gene, 'Theirs');
    const op = h.outbox.list()[0];
    assert.equal(op.state, 'conflict');
    assert.equal(op.conflictRecord.version, 2);
    assert.equal(h.lastWorkbook()[0].gene, 'Theirs');
  });

  it('keep mine: re-sent on top of the server version and saved', async () => {
    const h = harness();
    h.server.set('r1', serverRecord('r1', 1, { gene: '' }));
    await h.engine.start();
    h.outbox.enqueueUpdate('r1', 1, { gene: 'Mine' });
    h.server.set('r1', serverRecord('r1', 2, { gene: 'Theirs' }));
    await h.engine.syncNow();

    h.outbox.resolveConflict('r1', 'mine');
    const status = await h.engine.syncNow();
    assert.equal(status.state, 'synced');
    assert.equal(h.server.get('r1').gene, 'Mine');
    assert.equal(h.server.get('r1').version, 3);
  });

  it('use server: my change is dropped and the server value stands', async () => {
    const h = harness();
    h.server.set('r1', serverRecord('r1', 1, { gene: '' }));
    await h.engine.start();
    h.outbox.enqueueUpdate('r1', 1, { gene: 'Mine' });
    h.server.set('r1', serverRecord('r1', 2, { gene: 'Theirs' }));
    await h.engine.syncNow();

    h.outbox.resolveConflict('r1', 'server');
    const status = await h.engine.syncNow();
    assert.equal(status.state, 'synced');
    assert.equal(h.server.get('r1').gene, 'Theirs');
    assert.equal(h.server.get('r1').version, 2);
  });
});

describe('sync engine — authorization', () => {
  it('a non-superadmin never sends writes; queued changes stay queued', async () => {
    const h = harness({ role: 'admin' });
    await h.engine.start();
    h.outbox.enqueueCreate('r1', { crop: 'Maize' });
    await h.engine.syncNow();
    assert.equal(h.calls.some((c) => c.startsWith('POST') || c.startsWith('PUT')), false);
    assert.equal(h.outbox.size(), 1);
    assert.equal(h.server.size, 0);
  });

  it('403 mid-session (demoted): stops pushing, re-reads the role, still pulls', async () => {
    const h = harness();
    await h.engine.start();
    h.outbox.enqueueCreate('r1', { crop: 'Maize' });
    h.outbox.enqueueCreate('r2', { crop: 'Rice' });
    h.server.set('other', serverRecord('other', 1, { crop: 'Seen' }));
    h.failNext = (method) => {
      if (method !== 'POST') return null;
      h.role = 'admin'; // demoted on the server
      return http(403, { message: 'Access denied' });
    };
    const status = await h.engine.syncNow();
    assert.equal(h.calls.filter((c) => c.startsWith('POST')).length, 1, 'no further writes after the 403');
    assert.equal(status.lastError, 'Only a Superadmin can save changes.');
    assert.equal(h.store.get('other').crop, 'Seen', 'reading still works');
    assert.equal(h.store.get('r1'), null);
    assert.equal(h.outbox.size(), 2, 'nothing is silently discarded');
  });

  it('401: the session is expired and nothing is treated as saved', async () => {
    const h = harness();
    await h.engine.start();
    h.outbox.enqueueCreate('r1', { crop: 'Maize' });
    h.failNext = (method) => (method === 'POST' ? http(401, { message: 'Token invalid or expired' }) : null);
    await h.engine.syncNow();
    assert.equal(h.expired, true);
    assert.equal(h.outbox.size(), 1);
    assert.equal(h.outbox.nextSendable().state, 'pending');
  });
});

describe('sync engine — what an empty table means', () => {
  it('first download in progress is reported as loading, not as "no records"', async () => {
    const h = harness();
    let seenWhileRunning = null;
    h.failNext = (method, path) => { if (path === '/api/desktop-records' && !seenWhileRunning) seenWhileRunning = h.engine.getStatus(); return null; };
    await h.engine.start();
    assert.equal(seenWhileRunning.loading, true);
    assert.equal(seenWhileRunning.state, 'syncing');
    assert.equal(h.engine.getStatus().loading, false);
  });

  it('a server without the desktop-records routes is an explicit "not deployed" error, never an empty result', async () => {
    const h = harness();
    h.routesMissing = true;
    const status = await h.engine.start();
    assert.equal(status.state, 'error');
    assert.equal(status.lastErrorKind, 'not-deployed');
    assert.match(status.lastError, /has not been deployed/);
    assert.equal(status.lastSyncAt, null, 'must not look like a successful sync');
    assert.equal(status.serverRecordCount, null);
    assert.equal(status.packetsNotImported, null);
    assert.ok(status.nextRetryAt, 'keeps retrying');
    assert.equal(h.workbookWrites.length, 0, 'no workbook is written from a failed first sync');

    // Once the backend has been deployed, the same app recovers by itself.
    h.routesMissing = false;
    h.server.set('r1', serverRecord('r1', 1, { crop: 'Maize' }));
    const healed = await h.engine.syncNow();
    assert.equal(healed.state, 'synced');
    assert.equal(healed.lastErrorKind, null);
    assert.equal(healed.recordCount, 1);
  });

  it('a failed sync keeps the cached records and says why; it does not clear the table', async () => {
    const h = harness();
    h.server.set('r1', serverRecord('r1', 1, { crop: 'Maize' }));
    await h.engine.start();
    h.failNext = (method, path) => (path === '/api/desktop-records' ? http(500, { message: 'Internal server error' }) : null);
    const status = await h.engine.syncNow();
    assert.equal(status.state, 'error');
    assert.equal(status.lastErrorKind, 'server');
    assert.equal(status.lastError, 'Internal server error');
    assert.equal(status.recordCount, 1);
    assert.ok(status.lastSyncAt, 'the time of the last good sync is kept');
  });

  it('offline is reported as offline', async () => {
    const h = harness();
    h.offline = true;
    const status = await h.engine.start();
    assert.equal(status.state, 'offline');
    assert.equal(status.lastErrorKind, 'offline');
    assert.equal(status.lastSyncAt, null);
  });

  it('reports how many existing packets have not been imported', async () => {
    const h = harness({ role: 'admin' });
    h.packets = 12;
    h.linked = 0;
    const status = await h.engine.start();
    assert.equal(status.state, 'synced');
    assert.equal(status.recordCount, 0);
    assert.equal(status.serverRecordCount, 0);
    assert.equal(status.packetCount, 12);
    assert.equal(status.packetsNotImported, 12);
  });

  it('the record count reported by the server is exposed next to what was downloaded', async () => {
    const h = harness();
    for (let i = 0; i < 7; i += 1) h.server.set('r' + i, serverRecord('r' + i, 1));
    const status = await h.engine.start();
    assert.equal(status.recordCount, 7);
    assert.equal(status.serverRecordCount, 7);
  });

  it('if the counts cannot be read they are "unknown" (null), and the sync itself still succeeds', async () => {
    const h = harness();
    h.server.set('r1', serverRecord('r1', 1));
    h.summary = 'missing';
    const status = await h.engine.start();
    assert.equal(status.state, 'synced');
    assert.equal(status.recordCount, 1);
    assert.equal(status.packetsNotImported, null);
    assert.equal(status.serverRecordCount, null);
  });

  it('nonsense counts from the server are treated as unknown', async () => {
    const h = harness();
    h.summary = { packetsNotImported: -4 };
    const status = await h.engine.start();
    assert.equal(status.packetsNotImported, null);
  });
  it('no workbook is written until the server has answered once — a failed first sync cannot blank an existing file', async () => {
    const h = harness();
    h.offline = true;
    await h.engine.start();
    await h.engine.syncNow();
    assert.equal(h.workbookWrites.length, 0);

    h.offline = false;
    h.server.set('r1', serverRecord('r1', 1, { crop: 'Maize' }));
    await h.engine.syncNow();
    assert.deepEqual(h.lastWorkbook().map((r) => r.recordId), ['r1']);

    // From then on the workbook is kept in step even while offline.
    h.offline = true;
    const writes = h.workbookWrites.length;
    await h.engine.syncNow();
    assert.equal(h.workbookWrites.length, writes + 1);
    assert.deepEqual(h.lastWorkbook().map((r) => r.recordId), ['r1']);
  });

  it('a Superadmin change made against a server without the routes stays pending, untouched, and is saved after deployment', async () => {
    const h = harness();
    h.routesMissing = true;
    await h.engine.start();
    h.outbox.enqueueCreate('r1', { crop: 'Maize' });
    const status = await h.engine.syncNow();
    assert.equal(status.lastErrorKind, 'not-deployed');
    assert.equal(status.pending, 1);
    assert.equal(status.errors, 0, 'not marked as a rejected change');
    assert.equal(h.outbox.nextSendable().state, 'pending');
    assert.equal(h.server.size, 0);

    h.routesMissing = false;
    const healed = await h.engine.syncNow();
    assert.equal(healed.state, 'synced');
    assert.equal(h.server.get('r1').crop, 'Maize');
    assert.equal(h.outbox.size(), 0);
  });

  it('an update to a record the server no longer has is still a real error, not "not deployed"', async () => {
    const h = harness();
    h.server.set('r1', serverRecord('r1', 1, { crop: 'Maize' }));
    await h.engine.start();
    h.outbox.enqueueUpdate('r1', 1, { gene: 'Rf1' });
    h.server.delete('r1');
    const status = await h.engine.syncNow();
    assert.equal(status.errors, 1);
    assert.notEqual(status.lastErrorKind, 'not-deployed');
    assert.equal(h.outbox.list()[0].message, 'Record not found');
  });
});

describe('sync engine — pulling and the workbook', () => {
  it('a full sync replaces the cache with exactly what the backend returned', async () => {
    const h = harness();
    h.store.replaceAll([serverRecord('stale', 1, { crop: 'Gone' })]);
    h.server.set('r1', serverRecord('r1', 1, { crop: 'Maize' }));
    await h.engine.start({ full: true });
    assert.equal(h.store.get('stale'), null);
    assert.equal(h.store.get('r1').crop, 'Maize');
    assert.equal(h.lastQuery.since, undefined);
  });

  it('later syncs ask only for changes since the cursor (with a small overlap)', async () => {
    const h = harness();
    h.server.set('r1', serverRecord('r1', 1, { crop: 'Maize' }));
    await h.engine.start({ full: true });
    await h.engine.syncNow();
    assert.equal(h.lastQuery.since, '2026-01-01T00:00:04.000Z');
    assert.equal(h.lastQuery.afterId, undefined);
  });

  it('after one overlap re-read the exact cursor is used, so an idle sync asks for nothing it already has', async () => {
    const h = harness();
    h.clock = 1000000;
    h.server.set('r1', serverRecord('r1', 1, { crop: 'Maize' }));
    await h.engine.start({ full: true });
    assert.equal(h.store.getCursor().settled, false);

    // Too soon after the cursor was reached: the overlap is used, and it is
    // not yet considered done.
    h.clock += 1000;
    await h.engine.syncNow();
    assert.equal(h.lastQuery.since, '2026-01-01T00:00:04.000Z');
    assert.equal(h.lastQuery.afterId, undefined);
    assert.equal(h.store.getCursor().settled, false);

    // Later: one more overlap re-read, which settles the cursor…
    h.clock += 6000;
    await h.engine.syncNow();
    assert.equal(h.lastQuery.since, '2026-01-01T00:00:04.000Z');
    assert.equal(h.store.getCursor().settled, true);

    // …and from then on the exact position is asked for.
    await h.engine.syncNow();
    assert.equal(h.lastQuery.since, '2026-01-01T00:00:09.000Z');
    assert.equal(h.lastQuery.afterId, 'a'.repeat(24));
    assert.equal(h.store.count(), 1);
  });

  it('when the position moves, the overlap re-read is due again', async () => {
    const h = harness();
    h.clock = 1000000;
    h.server.set('r1', serverRecord('r1', 1));
    await h.engine.start({ full: true });
    h.clock += 6000;
    await h.engine.syncNow();
    assert.equal(h.store.getCursor().settled, true);

    h.nextCursorOverride = { since: '2026-01-01T00:00:30.000Z', afterId: 'b'.repeat(24) };
    await h.engine.syncNow();
    const cursor = h.store.getCursor();
    assert.equal(cursor.since, '2026-01-01T00:00:30.000Z');
    assert.equal(cursor.settled, false);

    await h.engine.syncNow();
    assert.equal(h.lastQuery.since, '2026-01-01T00:00:25.000Z');
    assert.equal(h.lastQuery.afterId, undefined);
  });

  it('a full sync that finds the server empty forgets the old position', async () => {
    const h = harness();
    h.server.set('r1', serverRecord('r1', 1));
    await h.engine.start({ full: true });
    assert.ok(h.store.getCursor());
    h.server.clear();
    await h.engine.syncNow({ full: true });
    assert.equal(h.store.getCursor(), null);
    assert.equal(h.store.count(), 0);
  });

  it('a download that fails on a later page stores nothing from it and is not reported as synced', async () => {
    const page1 = { records: [serverRecord('r1', 1), serverRecord('r2', 1)], hasMore: true, nextCursor: { since: '2026-01-01T00:00:01.000Z', afterId: '1'.repeat(24) } };
    const page2 = { records: [serverRecord('r3', 1)], hasMore: false, nextCursor: { since: '2026-01-01T00:00:02.000Z', afterId: '2'.repeat(24) } };
    let failSecondPage = true;
    let listCalls = 0;
    const workbookWrites = [];
    const store = createRecordStore({ file: memoryFile() });
    const engine = createSyncEngine({
      api: {
        get: async (p, { query } = {}) => {
          if (p !== '/api/desktop-records') return { status: 200, data: { success: true, records: 3, packets: 3, packetsNotImported: 0 } };
          listCalls += 1;
          if (query.afterId) {
            if (failSecondPage) throw http(500, { message: 'Internal server error' });
            return { status: 200, data: { success: true, ...page2 } };
          }
          return { status: 200, data: { success: true, ...page1 } };
        },
      },
      auth: { getSession: () => ({ canManage: false }), refresh: async () => ({ canManage: false }), expire() {} },
      store,
      outbox: createOutbox({ file: memoryFile([]) }),
      workbook: { filePath: 'x', write: async (records) => { workbookWrites.push(records.length); return { written: true, meta: {} }; } },
      timers: { setTimeout: () => ({}), clearTimeout() {} },
    });

    const failed = await engine.start({ full: true });
    assert.equal(failed.state, 'error');
    assert.equal(failed.lastSyncAt, null, 'not a completed sync');
    assert.equal(failed.recordCount, 0, 'the first page was not kept on its own');
    assert.equal(store.getCursor(), null);
    assert.deepEqual(workbookWrites, [], 'and nothing was written to Excel');

    failSecondPage = false;
    const ok = await engine.syncNow({ full: true });
    assert.equal(ok.state, 'synced');
    assert.equal(ok.recordCount, 3);
    assert.equal(ok.serverRecordCount, 3);
    assert.deepEqual(workbookWrites, [3]);
    assert.ok(listCalls >= 4);
  });

  it('follows hasMore across pages using the returned cursor', async () => {
    const pages = [
      { records: [serverRecord('r1', 1)], hasMore: true, nextCursor: { since: '2026-01-01T00:00:01.000Z', afterId: '1'.repeat(24) } },
      { records: [serverRecord('r2', 1)], hasMore: false, nextCursor: { since: '2026-01-01T00:00:02.000Z', afterId: '2'.repeat(24) } },
    ];
    const queries = [];
    const store = createRecordStore({ file: memoryFile() });
    const engine = createSyncEngine({
      api: {
        get: async (p, { query } = {}) => {
          if (p !== '/api/desktop-records') return { status: 200, data: { success: true, records: 2, packets: 0, packetsNotImported: 0 } };
          queries.push(query);
          return { status: 200, data: { success: true, ...pages[queries.length - 1] } };
        },
      },
      auth: { getSession: () => ({ canManage: false }), refresh: async () => ({ canManage: false }), expire() {} },
      store,
      outbox: createOutbox({ file: memoryFile([]) }),
      workbook: { filePath: 'x', write: async () => ({ written: true, meta: {} }) },
      timers: { setTimeout: () => ({}), clearTimeout() {} },
    });
    await engine.start({ full: true });
    assert.equal(queries.length, 2);
    assert.deepEqual(queries[1], { limit: 200, since: '2026-01-01T00:00:01.000Z', afterId: '1'.repeat(24) });
    assert.equal(store.count(), 2);
    assert.equal(store.getCursor().since, pages[1].nextCursor.since);
    assert.equal(store.getCursor().afterId, pages[1].nextCursor.afterId);
  });

  it('workbook open in Excel: sync still succeeds, the problem is reported and retried in 30s', async () => {
    const h = harness();
    h.server.set('r1', serverRecord('r1', 1, { crop: 'Maize' }));
    h.workbookBusy = true;
    const status = await h.engine.start();
    assert.equal(status.state, 'synced');
    assert.match(status.workbookError, /open in another program/);
    assert.equal(h.lastDelay(), 30000);

    h.workbookBusy = false;
    const healed = await h.engine.syncNow();
    assert.equal(healed.workbookError, null);
    assert.deepEqual(h.lastWorkbook().map((r) => r.recordId), ['r1']);
  });

  it('only one sync runs at a time; a request during a run triggers one follow-up run', async () => {
    const h = harness();
    await h.engine.start();
    const before = h.calls.filter((c) => c === 'GET /api/desktop-records').length;
    const a = h.engine.syncNow();
    const b = h.engine.syncNow();
    const c = h.engine.syncNow();
    assert.equal(a, b);
    assert.equal(b, c);
    await a;
    assert.equal(h.calls.filter((x) => x === 'GET /api/desktop-records').length - before, 2);
  });

  it('after stop() nothing more is scheduled or sent', async () => {
    const h = harness();
    await h.engine.start();
    h.engine.stop();
    const callsBefore = h.calls.length;
    await h.engine.syncNow();
    h.engine.kick();
    assert.equal(h.calls.length, callsBefore);
    assert.equal(h.scheduled.length, 0);
  });
});

const { ApiError } = require('./apiClient');

// Keeps three things in step, always in this direction:
//
//   outbox ──push──▶ backend (MongoDB) ──pull──▶ local record cache ──▶ Excel
//
// Existing seed packets need nothing from this side: the backend adds them
// to what it lists by itself, so they simply arrive with the first pull.
//
// A change is only ever marked saved by a successful backend response, and
// only records the backend returned are written to the cache and workbook.
// Nothing is ever read from the workbook.

const DEFAULTS = {
  intervalMs: 5 * 60 * 1000,      // routine re-sync
  retryBaseMs: 5 * 1000,          // first retry after a transient failure
  retryMaxMs: 5 * 60 * 1000,      // backoff ceiling
  workbookRetryMs: 30 * 1000,     // workbook was open in Excel — try again
  kickDelayMs: 400,               // lets a burst of edits coalesce into one push
  pageSize: 200,
  // A delta pull re-reads this much before its cursor, so a write that was
  // stamped just before the cursor but committed just after it is not missed.
  cursorOverlapMs: 5000,
};

const NOT_ALLOWED = 'Only a Superadmin can save changes.';
const NOT_DEPLOYED = 'This server does not provide desktop records yet — the backend update has not been deployed.';

function createSyncEngine({
  api,
  auth,
  store,
  outbox,
  workbook,
  config = {},
  timers = { setTimeout, clearTimeout },
  now = () => Date.now(),
  onChange = () => {},
}) {
  const cfg = { ...DEFAULTS, ...config };

  const state = {
    syncing: false,
    online: null,          // null until the first attempt finishes
    lastSyncAt: null,
    lastError: null,
    // Why the last sync failed: 'offline' | 'not-deployed' | 'forbidden' | 'server'
    lastErrorKind: null,
    // Counts reported by the server after the last successful sync (null =
    // not known): { records, packets, packetsNotImported }
    serverSummary: null,
    failures: 0,
    nextRetryAt: null,
    workbookError: null,
    workbookWrittenAt: null,
  };

  let running = null;
  let rerun = null;        // options for a sync requested while one was running
  let timer = null;
  let stopped = true;

  function getStatus() {
    const counts = outbox.counts();
    let label;
    if (state.syncing) label = 'syncing';
    else if (state.online === false) label = 'offline';
    else if (state.lastError) label = 'error';
    else if (counts.conflict) label = 'conflict';
    else if (counts.error) label = 'attention';
    else if (counts.pending) label = 'pending';
    else if (state.lastSyncAt) label = 'synced';
    else label = 'idle';
    return {
      state: label,
      online: state.online,
      lastSyncAt: state.lastSyncAt,
      // First download still in progress: nothing can be said yet about
      // what the server holds.
      loading: state.syncing && !state.lastSyncAt,
      lastError: state.lastError,
      lastErrorKind: state.lastErrorKind,
      nextRetryAt: state.nextRetryAt,
      pending: counts.pending,
      conflicts: counts.conflict,
      errors: counts.error,
      recordCount: store.count(),
      serverRecordCount: state.serverSummary ? state.serverSummary.records : null,
      packetCount: state.serverSummary ? state.serverSummary.packets : null,
      packetsNotImported: state.serverSummary ? state.serverSummary.packetsNotImported : null,
      workbookPath: workbook.filePath,
      workbookError: state.workbookError,
      workbookWrittenAt: state.workbookWrittenAt,
    };
  }

  function schedule(delayMs) {
    if (timer) timers.clearTimeout(timer);
    timer = null;
    if (stopped) return;
    timer = timers.setTimeout(() => { timer = null; syncNow().catch(() => {}); }, delayMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
  }

  // ── push ────────────────────────────────────────────────────────────

  // True when the server's record already holds every value this change
  // wanted to write — i.e. an earlier attempt did go through and only its
  // response was lost.
  function alreadyApplied(op, serverRecord) {
    return Object.keys(op.fields).every((key) => serverRecord[key] === op.fields[key]);
  }

  async function sendOp(op) {
    if (op.type === 'create') {
      const { data } = await api.post('/api/desktop-records', { recordId: op.recordId, fields: op.fields });
      return data.record;
    }

    let baseVersion = op.baseVersion;
    if (baseVersion === null || baseVersion === undefined) {
      const confirmed = store.get(op.recordId);
      if (!confirmed) {
        throw new ApiError({ kind: 'http', status: 404, message: 'Record not found' });
      }
      baseVersion = confirmed.version;
    }
    const { data } = await api.put(`/api/desktop-records/${encodeURIComponent(op.recordId)}`, { baseVersion, fields: op.fields });
    return data.record;
  }

  async function pushOutbox() {
    for (let op = outbox.nextSendable(); op; op = outbox.nextSendable()) {
      outbox.markInFlight(op.opId);
      try {
        const record = await sendOp(op);
        if (!record || record.recordId !== op.recordId) {
          throw new ApiError({ kind: 'http', status: 502, message: 'Unexpected response from the server.' });
        }
        // Confirmed by the backend: only now does it enter the cache (and so
        // the workbook) and leave the outbox.
        store.upsertMany([record]);
        outbox.complete(op.opId);
        onChange();
      } catch (err) {
        if (!(err instanceof ApiError)) { outbox.release(op.opId); throw err; }

        if (err.retryable || err.status === 401) {
          outbox.release(op.opId);
          throw err;
        }

        // 404 because the server has no desktop-records routes at all (an
        // older backend) — as opposed to "this record does not exist",
        // which only an update can get and which the server words
        // differently. Nothing is wrong with the change itself, so it stays
        // queued exactly as it is.
        if (err.status === 404 && (op.type === 'create' || /^Route .* not found$/.test(err.message))) {
          outbox.release(op.opId);
          err.notDeployed = true;
          throw err;
        }

        if (err.status === 409 && err.data && err.data.record) {
          const serverRecord = err.data.record;
          store.upsertMany([serverRecord]);
          if (alreadyApplied(op, serverRecord)) {
            outbox.complete(op.opId);
          } else {
            outbox.fail(op.opId, {
              state: 'conflict',
              message: 'This record was changed by someone else.',
              conflictRecord: serverRecord,
            });
          }
          onChange();
          continue;
        }

        if (err.status === 403) {
          // The account is no longer a Superadmin. Nothing else in the
          // outbox can succeed either, so stop here; the changes stay queued.
          outbox.fail(op.opId, { state: 'error', message: NOT_ALLOWED });
          onChange();
          const forbidden = new Error(NOT_ALLOWED);
          forbidden.forbidden = true;
          throw forbidden;
        }

        // 400/404/anything else the server rejected outright: retrying the
        // same request cannot help, so it waits for the user.
        outbox.fail(op.opId, { state: 'error', message: err.message });
        onChange();
      }
    }
  }

  // ── pull ────────────────────────────────────────────────────────────

  // The stored cursor is { since, afterId, setAt, settled }:
  //   since/afterId — position of the newest record downloaded so far
  //   setAt         — when (local clock) that position was reached
  //   settled       — an overlap re-read has already been done for it
  //
  // Why the overlap exists: a write that the server time-stamped just before
  // the cursor but committed just after our read would sit behind the cursor
  // for ever. So the sync after a cursor moves re-reads the last
  // `cursorOverlapMs` before it. That re-read is needed once — once it has
  // run at least `cursorOverlapMs` after the cursor was reached, any such
  // write has long since landed — and from then on the exact cursor is used,
  // so an idle sync downloads nothing instead of the last batch again.
  const sameCursor = (a, b) => Boolean(a) === Boolean(b) && (!a || (a.since === b.since && a.afterId === b.afterId));

  async function pull({ full }) {
    const startCursor = full ? null : store.getCursor();
    const startedAt = now();
    const collected = [];
    let query = { limit: cfg.pageSize };
    let overlapped = false;
    if (startCursor && startCursor.settled) {
      query = { ...query, since: startCursor.since, afterId: startCursor.afterId };
    } else if (startCursor) {
      overlapped = true;
      const since = new Date(new Date(startCursor.since).getTime() - cfg.cursorOverlapMs);
      query = { ...query, since: since.toISOString() };
    }

    let lastCursor = null;
    // Bounded: each page moves the cursor strictly forward.
    for (;;) {
      let data;
      try {
        ({ data } = await api.get('/api/desktop-records', { query }));
      } catch (err) {
        // The server answered, but has no such route: an older backend.
        if (err instanceof ApiError && err.status === 404) err.notDeployed = true;
        throw err;
      }
      if (!data || !Array.isArray(data.records)) {
        throw new ApiError({ kind: 'http', status: 502, message: 'Unexpected response from the server.' });
      }
      collected.push(...data.records);
      if (data.nextCursor) lastCursor = data.nextCursor;
      if (!data.hasMore || !data.nextCursor) break;
      query = { limit: cfg.pageSize, since: data.nextCursor.since, afterId: data.nextCursor.afterId };
    }

    if (full || !startCursor) store.replaceAll(collected);
    else store.upsertMany(collected);

    const endCursor = lastCursor || startCursor;
    if (!sameCursor(endCursor, startCursor) || !endCursor) {
      // Moved on (or nothing on the server at all): a fresh position.
      store.setCursor(endCursor ? { since: endCursor.since, afterId: endCursor.afterId, setAt: startedAt, settled: false } : null);
    } else if (overlapped && startedAt - (startCursor.setAt || 0) >= cfg.cursorOverlapMs) {
      store.setCursor({ ...startCursor, settled: true });
    }
  }

  // How much the server holds, for the "not imported yet" notice and as a
  // cross-check on what was downloaded. Informational: if it cannot be
  // read, the counts are shown as unknown rather than failing the sync.
  async function readSummary() {
    try {
      const { data } = await api.get('/api/desktop-records/summary');
      const valid = data && [data.records, data.packets, data.packetsNotImported].every((n) => Number.isInteger(n) && n >= 0);
      state.serverSummary = valid
        ? { records: data.records, packets: data.packets, packetsNotImported: data.packetsNotImported }
        : null;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) throw err;
      state.serverSummary = null;
    }
  }

  // ── workbook ────────────────────────────────────────────────────────

  async function writeWorkbook() {
    // Until the server has answered successfully at least once there is
    // nothing confirmed to write — and an existing workbook must not be
    // replaced by an empty one just because a first sync failed.
    if (!store.getMeta('everSynced')) return;
    try {
      const result = await workbook.write(store.all(), store.getMeta('workbook'));
      if (result.meta) store.setMeta('workbook', result.meta);
      if (result.written) state.workbookWrittenAt = new Date(now()).toISOString();
      state.workbookError = null;
    } catch (err) {
      state.workbookError = err && err.busy
        ? 'Seed_Management.xlsx is open in another program. Close it and the file will be updated.'
        : `Could not write Seed_Management.xlsx: ${err.message}`;
    }
  }

  // ── one sync run ────────────────────────────────────────────────────

  async function runOnce({ full }) {
    state.syncing = true;
    state.nextRetryAt = null;
    onChange();

    let delay = cfg.intervalMs;
    try {
      // Who am I, right now, according to the server? A role change or a
      // deactivation made elsewhere takes effect here.
      const session = await auth.refresh();
      if (!session) {
        state.online = true;
        state.lastError = null;
        state.lastErrorKind = null;
        return;
      }

      let forbidden = false;
      if (session.canManage) {
        try {
          await pushOutbox();
        } catch (err) {
          if (!err.forbidden) throw err;
          forbidden = true;
          await auth.refresh();
        }
      }

      await pull({ full });
      if (!store.getMeta('everSynced')) store.setMeta('everSynced', true);
      await readSummary();

      state.online = true;
      state.failures = 0;
      state.lastError = forbidden ? NOT_ALLOWED : null;
      state.lastErrorKind = forbidden ? 'forbidden' : null;
      state.lastSyncAt = new Date(now()).toISOString();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        state.online = true;
        state.lastError = null;
        state.lastErrorKind = null;
        auth.expire();
        return;
      }
      const transient = err instanceof ApiError && err.retryable;
      state.online = !(err instanceof ApiError && err.kind === 'network');
      if (err.notDeployed) {
        state.lastError = NOT_DEPLOYED;
        state.lastErrorKind = 'not-deployed';
      } else {
        state.lastError = err instanceof ApiError ? err.message : `Sync failed: ${err.message}`;
        state.lastErrorKind = state.online ? 'server' : 'offline';
      }
      state.failures += 1;
      const backoff = Math.min(cfg.retryBaseMs * 2 ** (state.failures - 1), cfg.retryMaxMs);
      delay = transient && err.retryAfterMs ? Math.max(err.retryAfterMs, cfg.retryBaseMs) : backoff;
      state.nextRetryAt = new Date(now() + delay).toISOString();
    } finally {
      // The workbook always reflects the confirmed cache — also after a
      // failed sync, so an earlier "file was open" problem heals by itself.
      if (auth.getSession()) {
        await writeWorkbook();
        if (state.workbookError) delay = Math.min(delay, cfg.workbookRetryMs);
      }
      state.syncing = false;
      onChange();
      schedule(delay);
    }
  }

  // Single-flight: a request made while a sync is running is honoured by
  // one more run straight after it, never by two overlapping ones.
  function syncNow(options = {}) {
    if (stopped) return Promise.resolve(getStatus());
    if (running) {
      rerun = { full: Boolean(options.full) || Boolean(rerun && rerun.full) };
      return running;
    }
    running = (async () => {
      try {
        let next = { full: Boolean(options.full) };
        while (next && !stopped) {
          rerun = null;
          await runOnce(next);
          next = rerun;
        }
      } finally {
        running = null;
      }
      return getStatus();
    })();
    return running;
  }

  return {
    getStatus,
    syncNow,

    start({ full = true } = {}) {
      stopped = false;
      state.lastError = null;
      state.lastErrorKind = null;
      state.failures = 0;
      return syncNow({ full });
    },

    stop() {
      stopped = true;
      rerun = null;
      if (timer) timers.clearTimeout(timer);
      timer = null;
      state.syncing = false;
      state.online = null;
      state.lastSyncAt = null;
      state.lastError = null;
      state.lastErrorKind = null;
      state.serverSummary = null;
      state.nextRetryAt = null;
    },

    // A local change was queued — push it soon, letting a burst coalesce.
    kick() {
      if (stopped) return;
      if (running) { rerun = rerun || { full: false }; return; }
      schedule(cfg.kickDelayMs);
    },
  };
}

module.exports = { createSyncEngine, DEFAULTS };

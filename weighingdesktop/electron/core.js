const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { createApiClient, ApiError } = require('./apiClient');
const { createAuthService } = require('./authService');
const { createRecordStore } = require('./recordStore');
const { createOutbox } = require('./outbox');
const { createSyncEngine } = require('./syncEngine');
const { createWorkbookWriter } = require('./workbookWriter');
const { COLUMNS, HIDDEN_COLUMNS, PACKET_DERIVED_FIELDS, normalizeFields, isEmptyRecord, blankFields } = require('../shared/columns');

// The whole application minus the window: everything the two screens do
// goes through this object. It has no dependency on Electron, so the same
// code that runs inside the app is what the end-to-end tests drive.
function createCore({ apiUrl, dataDir, workbookDir, tokenStore, fetchImpl, syncConfig, onEvent = () => {} }) {
  // Cache and outbox are kept per backend, so pointing the app at a
  // different server can never mix that server's records with another's.
  const serverKey = crypto.createHash('sha256').update(apiUrl).digest('hex').slice(0, 16);
  const stateDir = path.join(dataDir, 'servers', serverKey);
  fs.mkdirSync(stateDir, { recursive: true });

  let auth;
  const api = createApiClient({ baseUrl: apiUrl, getToken: () => (auth ? auth.getToken() : null), fetchImpl });
  const store = createRecordStore({ filePath: path.join(stateDir, 'records.json') });
  const outbox = createOutbox({ filePath: path.join(stateDir, 'outbox.json') });
  const workbook = createWorkbookWriter({ dir: workbookDir });

  let engine;
  const emitData = () => onEvent('data', { rows: getRows(), status: engine.getStatus() });

  auth = createAuthService({
    api,
    tokenStore,
    onSessionChange: (session) => {
      if (!session && engine) engine.stop();
      onEvent('session', session);
    },
  });

  engine = createSyncEngine({ api, auth, store, outbox, workbook, config: syncConfig, onChange: emitData });

  // What the table shows: every confirmed record, with any unsent local
  // change laid over it and labelled. `syncState` is 'synced' only for rows
  // that are exactly what the backend last returned.
  function getRows() {
    const rows = new Map();
    for (const record of store.all()) {
      rows.set(record.recordId, { ...record, linked: Boolean(record.packetUniqueId), syncState: 'synced', syncMessage: null, conflictRecord: null });
    }
    const rank = { synced: 0, pending: 1, error: 2, conflict: 3 };
    for (const op of outbox.list()) {
      let row = rows.get(op.recordId);
      if (!row) {
        row = { ...blankFields(), recordId: op.recordId, packetUniqueId: null, version: 0, createdAt: op.queuedAt, updatedAt: op.queuedAt, linked: false, syncState: 'synced', syncMessage: null, conflictRecord: null };
        rows.set(op.recordId, row);
      }
      Object.assign(row, op.fields);
      if (rank[op.state] > rank[row.syncState]) {
        row.syncState = op.state;
        row.syncMessage = op.message;
        row.conflictRecord = op.conflictRecord;
      }
    }
    return [...rows.values()].sort((a, b) => {
      const byCreated = String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
      return byCreated !== 0 ? byCreated : String(a.recordId).localeCompare(String(b.recordId));
    });
  }

  // UI-side gate only — it decides which controls work, nothing more. The
  // backend independently refuses every write that is not from a Superadmin.
  function requireManager() {
    const session = auth.getSession();
    if (!session) throw new Error('You are signed out.');
    if (!session.canManage) throw new Error('Only a Superadmin can add or edit records.');
  }

  function friendly(err) {
    if (err instanceof ApiError) return err.message;
    return err && err.message ? err.message : 'Something went wrong.';
  }

  return {
    apiUrl,
    workbookPath: workbook.filePath,
    getColumns: () => ({ columns: COLUMNS, hidden: HIDDEN_COLUMNS, packetDerived: PACKET_DERIVED_FIELDS }),
    getSession: () => auth.getSession(),
    getRows,
    getStatus: () => engine.getStatus(),
    friendly,

    async restore() {
      const session = await auth.restore();
      if (session) engine.start({ full: true });
      return session;
    },

    async login(email, password) {
      const session = await auth.login(email, password);
      // Not awaited: the screen opens at once and fills as records arrive.
      engine.start({ full: true });
      return session;
    },

    register: (name, email, password) => auth.register(name, email, password),
    forgotPassword: (email) => auth.forgotPassword(email),
    logout: () => auth.logout(),

    createRecord(input) {
      requireManager();
      const { fields, error } = normalizeFields(input);
      if (error) throw new Error(error);
      if (isEmptyRecord(fields)) throw new Error('Enter at least one value before saving.');
      const recordId = crypto.randomUUID();
      outbox.enqueueCreate(recordId, fields);
      emitData();
      engine.kick();
      return recordId;
    },

    updateRecord(recordId, input) {
      requireManager();
      const row = getRows().find((r) => r.recordId === recordId);
      if (!row) throw new Error('This record no longer exists.');

      const { fields, error } = normalizeFields(input);
      if (error) throw new Error(error);
      if (row.linked) {
        for (const field of PACKET_DERIVED_FIELDS) delete fields[field];
      }
      // Only genuine changes are queued.
      for (const key of Object.keys(fields)) {
        if (fields[key] === row[key]) delete fields[key];
      }
      if (!Object.keys(fields).length) return false;
      if (isEmptyRecord({ ...row, ...fields })) throw new Error('A record cannot be completely empty.');

      const confirmed = store.get(recordId);
      outbox.enqueueUpdate(recordId, confirmed ? confirmed.version : null, fields);
      emitData();
      engine.kick();
      return true;
    },

    resolveConflict(recordId, choice) {
      requireManager();
      const done = outbox.resolveConflict(recordId, choice === 'mine' ? 'mine' : 'server');
      emitData();
      if (done) engine.kick();
      return done;
    },

    retryRecord(recordId) {
      requireManager();
      const done = outbox.retry(recordId);
      emitData();
      if (done) engine.kick();
      return done;
    },

    discardChange(recordId) {
      requireManager();
      const done = outbox.discard(recordId);
      emitData();
      return done;
    },

    syncNow: (options) => engine.syncNow(options),

    dispose() {
      engine.stop();
    },
  };
}

module.exports = { createCore };

const crypto = require('crypto');
const { createJsonFile } = require('./recordStore');

// Changes a Superadmin has made that the backend has NOT yet confirmed.
// Persisted on every change, so they survive going offline, closing the app
// or a crash. An entry leaves the outbox in exactly two ways: the backend
// confirms it, or the user explicitly discards it.
//
// op = {
//   opId, type: 'create' | 'update', recordId, fields,
//   baseVersion,   // update only: the record version the edit was based on.
//                  // null = "whatever the previous op for this record ends
//                  // up producing" (an edit made while that op was in flight)
//   state: 'pending' | 'conflict' | 'error',
//   message,       // why it is in conflict/error
//   conflictRecord,// conflict only: the record as the server now has it
//   attempts, queuedAt, inFlight,
// }
function createOutbox({ filePath, file = createJsonFile(filePath, () => []) }) {
  const loaded = file.read();
  const ops = Array.isArray(loaded) ? loaded : [];
  // Anything marked in-flight was interrupted by the app closing. Sending it
  // again is safe: creates are idempotent by recordId, and a repeated update
  // is recognised by the sync engine if the first attempt had gone through.
  for (const op of ops) op.inFlight = false;

  const save = () => file.write(ops);
  const find = (opId) => ops.find((op) => op.opId === opId);
  const forRecord = (recordId) => ops.filter((op) => op.recordId === recordId);

  function newOp(type, recordId, fields, baseVersion) {
    return {
      opId: crypto.randomUUID(),
      type,
      recordId,
      fields: { ...fields },
      baseVersion,
      state: 'pending',
      message: null,
      conflictRecord: null,
      attempts: 0,
      queuedAt: new Date().toISOString(),
      inFlight: false,
    };
  }

  return {
    list: () => ops.map((op) => ({ ...op, fields: { ...op.fields } })),
    forRecord: (recordId) => forRecord(recordId).map((op) => ({ ...op, fields: { ...op.fields } })),
    size: () => ops.length,

    enqueueCreate(recordId, fields) {
      ops.push(newOp('create', recordId, fields, null));
      save();
    },

    // Further edits to a record that already has an unsent change are folded
    // into that change (one request, original baseVersion) instead of
    // queuing one request per keystroke/cell.
    enqueueUpdate(recordId, baseVersion, fields) {
      const existing = forRecord(recordId);
      const last = existing[existing.length - 1];
      if (last && !last.inFlight) {
        Object.assign(last.fields, fields);
        if (last.state === 'error') {
          // The user has corrected it — worth sending again.
          last.state = 'pending';
          last.message = null;
        }
      } else {
        ops.push(newOp('update', recordId, fields, last ? null : baseVersion));
      }
      save();
    },

    // The next change to send: oldest first, but a record that is waiting
    // on the user (conflict/error) holds back only its own later changes,
    // never other records.
    nextSendable() {
      const blocked = new Set();
      for (const op of ops) {
        if (blocked.has(op.recordId)) continue;
        if (op.state !== 'pending' || op.inFlight) { blocked.add(op.recordId); continue; }
        return { ...op, fields: { ...op.fields } };
      }
      return null;
    },

    markInFlight(opId) {
      const op = find(opId);
      if (op) { op.inFlight = true; op.attempts += 1; save(); }
    },

    // Transient failure (offline, 5xx, 429): stays queued, unchanged.
    release(opId) {
      const op = find(opId);
      if (op) { op.inFlight = false; save(); }
    },

    // The backend confirmed it.
    complete(opId) {
      const index = ops.findIndex((op) => op.opId === opId);
      if (index !== -1) { ops.splice(index, 1); save(); }
    },

    fail(opId, { state, message, conflictRecord = null }) {
      const op = find(opId);
      if (!op) return;
      op.inFlight = false;
      op.state = state;
      op.message = message;
      op.conflictRecord = conflictRecord;
      save();
    },

    // 'mine'   — keep my change: re-base it on the server's current version
    //            and send it again.
    // 'server' — take the server's record: drop my change(s) to this record.
    resolveConflict(recordId, choice) {
      const mine = forRecord(recordId);
      const conflicted = mine.find((op) => op.state === 'conflict');
      if (!conflicted) return false;
      if (choice === 'mine') {
        conflicted.baseVersion = conflicted.conflictRecord ? conflicted.conflictRecord.version : conflicted.baseVersion;
        conflicted.state = 'pending';
        conflicted.message = null;
        conflicted.conflictRecord = null;
      } else {
        for (const op of mine) ops.splice(ops.indexOf(op), 1);
      }
      save();
      return true;
    },

    retry(recordId) {
      let changed = false;
      for (const op of forRecord(recordId)) {
        if (op.state === 'error') { op.state = 'pending'; op.message = null; changed = true; }
      }
      if (changed) save();
      return changed;
    },

    // Explicit user decision to drop unsent changes to one record.
    discard(recordId) {
      const mine = forRecord(recordId).filter((op) => !op.inFlight);
      for (const op of mine) ops.splice(ops.indexOf(op), 1);
      if (mine.length) save();
      return mine.length > 0;
    },

    counts() {
      const byRecord = new Map();
      const rank = { pending: 1, error: 2, conflict: 3 };
      for (const op of ops) {
        const current = byRecord.get(op.recordId);
        if (!current || rank[op.state] > rank[current]) byRecord.set(op.recordId, op.state);
      }
      const counts = { pending: 0, error: 0, conflict: 0 };
      for (const state of byRecord.values()) counts[state] += 1;
      return counts;
    },
  };
}

module.exports = { createOutbox };

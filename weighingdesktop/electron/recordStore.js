const fs = require('fs');
const path = require('path');

// Small JSON-file persistence used by the record cache and the outbox.
// Writes go to a temp file that is then renamed over the real one, so a
// crash or power loss mid-write can never leave a half-written file behind.
function createJsonFile(filePath, fallback) {
  return {
    read() {
      try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch (_) {
        return fallback();
      }
    },
    write(value) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const tmp = `${filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(value));
      fs.renameSync(tmp, filePath);
    },
  };
}

// Local copy of records the backend has CONFIRMED — every entry here came
// out of a successful backend response, nothing else is ever put in. It
// exists so the table can be shown while offline; the workbook is written
// from it. Unconfirmed local changes live in the outbox, never here.
function createRecordStore({ filePath, file = createJsonFile(filePath, () => ({})) }) {
  const state = file.read() || {};
  if (!state.records || typeof state.records !== 'object') state.records = {};
  if (!state.meta || typeof state.meta !== 'object') state.meta = {};
  if (state.cursor === undefined) state.cursor = null;

  const save = () => file.write(state);

  return {
    all: () => Object.values(state.records),
    get: (recordId) => state.records[recordId] || null,
    count: () => Object.keys(state.records).length,

    // Adds/replaces confirmed records. Returns how many actually changed.
    upsertMany(records) {
      let changed = 0;
      for (const record of records) {
        const current = state.records[record.recordId];
        if (!current || current.version !== record.version || current.updatedAt !== record.updatedAt) {
          state.records[record.recordId] = record;
          changed += 1;
        }
      }
      if (changed) save();
      return changed;
    },

    // A full download is authoritative: whatever the backend did not return
    // is dropped from the local copy.
    replaceAll(records) {
      state.records = {};
      for (const record of records) state.records[record.recordId] = record;
      save();
    },

    getCursor: () => state.cursor,
    setCursor(cursor) { state.cursor = cursor; save(); },

    getMeta: (key) => state.meta[key],
    setMeta(key, value) { state.meta[key] = value; save(); },
  };
}

module.exports = { createJsonFile, createRecordStore };

const express = require('express');
const router  = express.Router();
const mongoose = require('mongoose');
const { rateLimit } = require('express-rate-limit');
const DesktopSeedRecord = require('../models/DesktopSeedRecord');
const SeedPacket = require('../models/SeedPacket');
const { protect } = require('../middleware/authMiddleware');
const { allowRoles } = require('../middleware/roleMiddleware');
const { sendServerError } = require('../utils/errorResponse');

const { DATA_FIELDS, PACKET_DERIVED_FIELDS, BATCH_DETAIL_FIELDS, TEXT_MAX_LENGTH } = DesktopSeedRecord;
const FIELD_TYPES = new Map(DATA_FIELDS.map(({ field, type }) => [field, type]));

// Every route here requires `protect` — a real, active account in the Admin
// collection, resolved from the database on each request. A mobile User
// (operator) token never resolves against Admin.findById, so `protect`
// rejects it with 401 exactly like any other unknown identity: publicly
// signed-up operators can neither read nor write desktop records.
//
// Reads are open to every Admin-collection role. Every write additionally
// requires allowRoles('superadmin') — the role is read from the Admin
// document `protect` just loaded, never from the token or the request.
router.use(protect);

// Keyed by the authenticated Admin's own id (same key strategy as
// rateLimiter.js's adminChangePasswordLimiter), so it must run after
// `protect`. Defined here rather than in rateLimiter.js so that shared file
// stays untouched. Sized for a desktop client flushing a queue of offline
// edits, not for interactive abuse protection.
const desktopRecordLimiter = rateLimit({
  standardHeaders: true,
  legacyHeaders: false,
  windowMs: 60 * 1000,
  limit: 300,
  keyGenerator: (req) => String(req.admin._id),
  handler: (_req, res) => {
    res.status(429).json({
      success: false,
      code: 'RATE_LIMITED',
      message: 'Too many requests. Please try again later.',
    });
  },
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OBJECT_ID_RE = /^[a-f\d]{24}$/i;

// Never exposes _id/__v/createdBy/updatedBy — only what the desktop client
// needs to display a row and to present the right version on its next update.
function toPublic(doc) {
  const out = {
    recordId:       doc.recordId,
    packetUniqueId: doc.packetUniqueId || null,
    version:        doc.version,
  };
  for (const { field, type } of DATA_FIELDS) {
    const value = doc[field];
    out[field] = type === 'number'
      ? (typeof value === 'number' ? value : null)
      : (typeof value === 'string' ? value : '');
  }
  out.createdAt = doc.createdAt;
  out.updatedAt = doc.updatedAt;
  return out;
}

// Validates and normalizes a client-supplied `fields` object against the 23
// known columns. Only plain strings / finite numbers / null are accepted, so
// an object or array (e.g. { $ne: null }) can never reach a Mongo update as
// an operator. Unknown keys are rejected rather than silently dropped.
function parseFields(fields) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    return { error: 'fields must be an object' };
  }
  const clean = {};
  for (const key of Object.keys(fields)) {
    const type = FIELD_TYPES.get(key);
    if (!type) return { error: `Unknown field: ${key}` };
    const value = fields[key];
    if (type === 'number') {
      if (value === null || value === '') { clean[key] = null; continue; }
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return { error: `${key} must be a number` };
      }
      clean[key] = value;
    } else {
      if (value === null) { clean[key] = ''; continue; }
      if (typeof value !== 'string') return { error: `${key} must be text` };
      const trimmed = value.trim();
      if (trimmed.length > TEXT_MAX_LENGTH) {
        return { error: `${key} must be at most ${TEXT_MAX_LENGTH} characters` };
      }
      clean[key] = trimmed;
    }
  }
  return { clean };
}

function hasAnyValue(clean) {
  return Object.values(clean).some((v) => v !== null && v !== '');
}

// ── existing seed packets → desktop records ───────────────────────────────
//
// Every existing SeedPacket is represented by exactly one desktop record
// (`PKT-<uniqueId>`). Those records are created here, by the server, from
// data it already holds — never from anything a client sends — and only ever
// by INSERTING the ones that are missing:
//   * SeedPacket / SeedBatch are only read.
//   * A record that already exists is never touched, so whatever a
//     Superadmin has since typed into it is not overwritten by packet/batch
//     values, however often this runs.
//   * The unique indexes on recordId and packetUniqueId make it safe to run
//     repeatedly and concurrently: a duplicate is rejected by MongoDB and
//     counted as "already there".
const PACKET_SCAN_BATCH = 1000;

const BATCH_SELECT = ['seedType', 'crop', 'year', 'warehouse', 'rack', 'shelf', ...BATCH_DETAIL_FIELDS].join(' ');

const cleanText = (value) => (typeof value === 'string' && value.trim().length <= TEXT_MAX_LENGTH ? value.trim() : '');

// The seed-management details saved with the batch, for the columns that
// have one. A column is set only when the batch really holds a value of the
// right type; everything else — every column of a batch created before these
// details existed — is left out and so stays at its blank default.
function batchDetails(batch) {
  const out = {};
  if (!batch) return out;
  for (const field of BATCH_DETAIL_FIELDS) {
    const value = batch[field];
    if (FIELD_TYPES.get(field) === 'number') {
      if (typeof value === 'number' && Number.isFinite(value)) out[field] = value;
    } else if (cleanText(value)) {
      out[field] = cleanText(value);
    }
  }
  return out;
}

// PACKET_DERIVED_FIELDS plus the batch's saved details are copied. Crop is
// the batch's own Crop when one was entered, otherwise its seed name as
// before. Weight is left at its blank default on purpose — its mapping is
// unconfirmed — as is every column the batch has no value for.
function recordFromPacket(packet, createdBy) {
  const batch = packet.batchId && typeof packet.batchId === 'object' ? packet.batchId : null;
  return {
    recordId:       `PKT-${packet.uniqueId}`,
    packetUniqueId: packet.uniqueId,
    version:        1,
    ...batchDetails(batch),
    crop:           batch ? (cleanText(batch.crop) || (typeof batch.seedType === 'string' ? batch.seedType.trim() : '')) : '',
    year:           batch && typeof batch.year === 'number' ? batch.year : null,
    warehouse:      batch && typeof batch.warehouse === 'string' ? batch.warehouse.trim() : '',
    rackShelf:      batch ? [batch.rack, batch.shelf].map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean).join('-') : '',
    createdBy,
    updatedBy:      createdBy,
  };
}

// Inserts what it can and reports how many went in. ordered:false keeps
// inserting past a duplicate — only a pure duplicate-key outcome (someone
// else created those records first) is tolerated; anything else is a real
// failure.
async function insertIgnoringDuplicates(docs) {
  try {
    const inserted = await DesktopSeedRecord.insertMany(docs, { ordered: false });
    return inserted.length;
  } catch (err) {
    const writeErrors = err && Array.isArray(err.writeErrors) ? err.writeErrors : null;
    const onlyDuplicates = writeErrors
      ? writeErrors.every((w) => (w.code || (w.err && w.err.code)) === 11000)
      : Boolean(err && err.code === 11000);
    if (!onlyDuplicates) throw err;
    return Array.isArray(err.insertedDocs) ? err.insertedDocs.length : 0;
  }
}

// Walks all packets in _id order, a bounded batch at a time (never the whole
// collection in memory), and creates the desktop records that are missing.
async function importMissingPackets(createdBy) {
  let totalPackets = 0;
  let created = 0;
  let lastId = null;
  for (;;) {
    const packets = await SeedPacket.find(lastId ? { _id: { $gt: lastId } } : {})
      .sort({ _id: 1 })
      .limit(PACKET_SCAN_BATCH)
      .select('uniqueId batchId')
      .populate('batchId', BATCH_SELECT)
      .lean();
    if (!packets.length) break;
    totalPackets += packets.length;
    lastId = packets[packets.length - 1]._id;

    const uniqueIds = packets.map((p) => p.uniqueId).filter((id) => typeof id === 'string' && id);
    const existing = await DesktopSeedRecord.find({ packetUniqueId: { $in: uniqueIds } })
      .select('packetUniqueId')
      .lean();
    const have = new Set(existing.map((r) => r.packetUniqueId));
    const docs = packets
      .filter((p) => typeof p.uniqueId === 'string' && p.uniqueId && !have.has(p.uniqueId))
      .map((p) => recordFromPacket(p, createdBy));
    if (docs.length) created += await insertIgnoringDuplicates(docs);

    if (packets.length < PACKET_SCAN_BATCH) break;
  }
  return { totalPackets, created };
}

// Runs before every listing so that existing packets are simply there — no
// manual import step. To keep the common case cheap it remembers, per server
// process, the state of the packet collection (its size and its newest _id,
// both O(1) lookups) at the last complete pass, and does nothing while that
// is unchanged. A new batch changes it, and the next listing picks it up.
// Concurrent requests share one pass.
const packetSync = { doneFor: null, running: null };

async function packetCollectionState() {
  const [count, newest] = await Promise.all([
    SeedPacket.estimatedDocumentCount(),
    SeedPacket.findOne().sort({ _id: -1 }).select('_id').lean(),
  ]);
  return `${count}:${newest ? newest._id : ''}`;
}

async function ensurePacketRecords() {
  // A pass that was already under way may have started before the newest
  // packets existed, so its result is re-checked rather than trusted.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const state = await packetCollectionState();
    if (packetSync.doneFor === state) return;
    if (!packetSync.running) {
      packetSync.running = importMissingPackets(null)
        .then(() => { packetSync.doneFor = state; })
        .finally(() => { packetSync.running = null; });
    }
    await packetSync.running;
  }
}

// GET /api/desktop-records — any Admin-collection account.
// Existing seed packets are made available automatically (see above), then:
// Keyset pagination ordered by (updatedAt, _id): pass back the previous
// response's nextCursor as ?since=&afterId= to continue. The same cursor,
// kept by the client after the last page, is "everything changed since my
// last sync". Unlike skip/limit, a record updated mid-listing can never be
// skipped — it just moves later in the order and is returned again.
router.get('/', desktopRecordLimiter, async (req, res) => {
  try {
    const { since, afterId } = req.query;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 500);

    const filter = {};
    if (since !== undefined) {
      const sinceDate = typeof since === 'string' ? new Date(since) : new Date(NaN);
      if (isNaN(sinceDate)) {
        return res.status(400).json({ success: false, message: 'since must be an ISO date' });
      }
      if (afterId !== undefined) {
        if (typeof afterId !== 'string' || !OBJECT_ID_RE.test(afterId)) {
          return res.status(400).json({ success: false, message: 'afterId is invalid' });
        }
        filter.$or = [
          { updatedAt: { $gt: sinceDate } },
          { updatedAt: sinceDate, _id: { $gt: new mongoose.Types.ObjectId(afterId) } },
        ];
      } else {
        filter.updatedAt = { $gt: sinceDate };
      }
    } else if (afterId !== undefined) {
      return res.status(400).json({ success: false, message: 'afterId requires since' });
    }

    // Existing packets first. If this fails the request fails: a listing that
    // might be missing packets is never returned as if it were complete.
    await ensurePacketRecords();

    // One extra document is fetched only to learn whether another page exists.
    const docs = await DesktopSeedRecord.find(filter)
      .sort({ updatedAt: 1, _id: 1 })
      .limit(limit + 1)
      .lean();

    const hasMore = docs.length > limit;
    const page = hasMore ? docs.slice(0, limit) : docs;
    const last = page[page.length - 1];

    res.json({
      success: true,
      records: page.map(toPublic),
      hasMore,
      nextCursor: last
        ? { since: new Date(last.updatedAt).toISOString(), afterId: String(last._id) }
        : null,
    });
  } catch (err) {
    sendServerError(res, err, 'desktopRecordRoutes');
  }
});

// GET /api/desktop-records/summary — any Admin-collection account.
// Three counts and nothing else: desktop records, seed packets, and seed
// packets that have no desktop record yet. This is what lets a client tell
// "existing packets have not been imported yet" apart from "the database is
// empty", and check that it has downloaded every record. Read-only.
router.get('/summary', desktopRecordLimiter, async (req, res) => {
  try {
    const [records, linkedRecords, packets] = await Promise.all([
      DesktopSeedRecord.countDocuments({}),
      DesktopSeedRecord.countDocuments({ packetUniqueId: { $type: 'string' } }),
      SeedPacket.countDocuments({}),
    ]);
    res.json({
      success: true,
      records,
      packets,
      packetsNotImported: Math.max(packets - linkedRecords, 0),
    });
  } catch (err) {
    sendServerError(res, err, 'desktopRecordRoutes');
  }
});

// POST /api/desktop-records — superadmin only. Creates a record under a
// client-generated recordId. Idempotent: repeating the same request (a
// retry after a lost response) returns the already-stored record with
// created:false instead of inserting a second one — the unique index on
// recordId is the atomic guard.
router.post('/', desktopRecordLimiter, allowRoles('superadmin'), async (req, res) => {
  try {
    const { recordId, fields } = req.body || {};

    // `PKT-…` ids are reserved for import-packets; a desktop-created record
    // must carry a UUID, so it can never claim (or collide with) a packet's.
    if (typeof recordId !== 'string' || !UUID_RE.test(recordId)) {
      return res.status(400).json({ success: false, message: 'recordId must be a UUID' });
    }

    const { clean, error } = parseFields(fields);
    if (error) return res.status(400).json({ success: false, message: error });
    if (!hasAnyValue(clean)) {
      return res.status(400).json({ success: false, message: 'Record is empty' });
    }

    const normalizedId = recordId.toLowerCase();
    try {
      const doc = await DesktopSeedRecord.create({
        ...clean,
        recordId:  normalizedId,
        version:   1,
        createdBy: req.admin._id,
        updatedBy: req.admin._id,
      });
      return res.status(201).json({ success: true, created: true, record: toPublic(doc) });
    } catch (err) {
      if (err && err.code === 11000) {
        const existing = await DesktopSeedRecord.findOne({ recordId: normalizedId }).lean();
        if (existing) {
          return res.json({ success: true, created: false, record: toPublic(existing) });
        }
      }
      throw err;
    }
  } catch (err) {
    sendServerError(res, err, 'desktopRecordRoutes');
  }
});

// POST /api/desktop-records/import-packets — superadmin only. Runs the same
// pass on demand and reports what it did. No longer needed for normal use —
// listing does it automatically — but kept so a Superadmin can force a full
// pass and see the counts. Same guarantees: packets/batches only read,
// existing records never changed, duplicates impossible.
//
// Registered ahead of /:recordId below so "import-packets" is never
// swallowed as a recordId value.
router.post('/import-packets', desktopRecordLimiter, allowRoles('superadmin'), async (req, res) => {
  try {
    const { totalPackets, created } = await importMissingPackets(req.admin._id);
    res.json({ success: true, totalPackets, created, skipped: totalPackets - created });
  } catch (err) {
    sendServerError(res, err, 'desktopRecordRoutes');
  }
});

// PUT /api/desktop-records/:recordId — superadmin only. The caller must
// present the version it last saw (baseVersion). The update itself is a
// single findOneAndUpdate filtered on that version, so two concurrent
// editors can never both win: the loser gets 409 VERSION_CONFLICT together
// with the record as it now stands, and nothing of theirs is written.
router.put('/:recordId', desktopRecordLimiter, allowRoles('superadmin'), async (req, res) => {
  try {
    const { recordId } = req.params;
    const { baseVersion, fields } = req.body || {};

    if (!Number.isInteger(baseVersion) || baseVersion < 1) {
      return res.status(400).json({ success: false, message: 'baseVersion must be a positive integer' });
    }

    const { clean, error } = parseFields(fields);
    if (error) return res.status(400).json({ success: false, message: error });

    const existing = await DesktopSeedRecord.findOne({ recordId }).lean();
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Record not found' });
    }

    const conflict = (current) => res.status(409).json({
      success: false,
      code: 'VERSION_CONFLICT',
      message: 'This record was changed by someone else.',
      record: toPublic(current),
    });

    if (existing.version !== baseVersion) return conflict(existing);

    // Packet-linked records keep the values copied from their batch.
    if (existing.packetUniqueId) {
      for (const field of PACKET_DERIVED_FIELDS) delete clean[field];
    }

    const merged = { ...existing, ...clean };
    if (!hasAnyValue(Object.fromEntries(DATA_FIELDS.map(({ field }) => [field, merged[field] ?? null])))) {
      return res.status(400).json({ success: false, message: 'Record is empty' });
    }

    const updated = await DesktopSeedRecord.findOneAndUpdate(
      { recordId, version: baseVersion },
      { $set: { ...clean, updatedBy: req.admin._id }, $inc: { version: 1 } },
      { returnDocument: 'after', runValidators: true }
    ).lean();

    if (!updated) {
      // Lost a race between the read above and this write.
      const current = await DesktopSeedRecord.findOne({ recordId }).lean();
      if (!current) return res.status(404).json({ success: false, message: 'Record not found' });
      return conflict(current);
    }

    res.json({ success: true, record: toPublic(updated) });
  } catch (err) {
    sendServerError(res, err, 'desktopRecordRoutes');
  }
});

module.exports = router;

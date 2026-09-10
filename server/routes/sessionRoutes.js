const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const multer   = require('multer');
const jwt      = require('jsonwebtoken');
const router   = express.Router();
const WeightSession = require('../models/WeightSession');
const SeedPacket    = require('../models/SeedPacket');
const LiveWeight    = require('../models/LiveWeight');
const { uploadSeedPacketPhoto } = require('../utils/cloudinaryUpload');

// This flow stays intentionally unauthenticated (kiosk-style field use), but
// if the mobile app sends a logged-in user's JWT we record who weighed the
// packet. A missing/invalid token is not an error — operator stays null.
async function getOperatorId(req) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  try {
    const decoded = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET);
    return decoded.id || null;
  } catch (_) {
    return null;
  }
}

// Photo upload config
const photoDir = path.join(__dirname, '..', 'uploads', 'session-photos');
if (!fs.existsSync(photoDir)) fs.mkdirSync(photoDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, photoDir),
    filename:    (_req, file, cb) => cb(null, `sess_${Date.now()}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
});

// POST /api/sessions — start new session
// If the caller already knows which packet this is for (uniqueId in the
// body), the backend is the authoritative check for whether that packet has
// already been filled — a new session is refused rather than relying on the
// Android UI alone to stop the flow. `uniqueId` is optional and backward
// compatible: omitting it preserves the exact previous behavior.
router.post('/', async (req, res) => {
  try {
    const operator = await getOperatorId(req);
    // deviceId is optional and only ever stored if a real caller sends one —
    // never generated here.
    const { deviceId, uniqueId } = req.body;

    if (uniqueId) {
      const existingPacket = await SeedPacket.findOne({ uniqueId })
        .populate('batchId', 'seedType batchNumber batchName seedCode batchCode month year warehouse rack shelf')
        .populate('operator', 'name');
      if (existingPacket && existingPacket.status === 'filled') {
        // Read-only check — the existing packet/measurement is never
        // modified, and its permanent QR/uniqueId is untouched.
        return res.status(409).json({
          success: false,
          code: 'PACKET_ALREADY_FILLED',
          message: 'This packet has already been weighed.',
          packet: existingPacket,
        });
      }

      // Resume support: an unfinished weighing flow for this same packet may
      // already have an active session — reuse it instead of creating a
      // second one. The unique partial index on (status:'active',
      // packetUniqueId) below is the real, atomic guard against two clients
      // racing on the same empty packet; this lookup just avoids the
      // round-trip through a duplicate-key error in the common case.
      const activeSessions = await WeightSession.find({ packetUniqueId: uniqueId, status: 'active' });
      if (activeSessions.length > 1) {
        // Pre-existing duplicate data from before this guard existed — never
        // guess which one is "the" session to resume.
        return res.status(409).json({
          success: false,
          code: 'MULTIPLE_ACTIVE_SESSIONS',
          message: 'Multiple active sessions exist for this packet — cannot safely resume.',
        });
      }
      if (activeSessions.length === 1) {
        return res.json({
          success: true,
          code: 'ACTIVE_SESSION_EXISTS',
          sessionId: activeSessions[0]._id,
          session: activeSessions[0],
        });
      }
    }

    try {
      const session = await WeightSession.create({
        status: 'active',
        operator,
        deviceId: deviceId || null,
        packetUniqueId: uniqueId || null,
      });
      res.status(201).json({ success: true, sessionId: session._id, session });
    } catch (createErr) {
      // Two clients raced to create the first active session for this same
      // packet — the unique partial index rejected the loser. Rather than
      // surfacing that as a 500, resume onto whichever session actually won.
      if (createErr.code === 11000 && uniqueId) {
        const winner = await WeightSession.findOne({ packetUniqueId: uniqueId, status: 'active' });
        if (winner) {
          return res.json({ success: true, code: 'ACTIVE_SESSION_EXISTS', sessionId: winner._id, session: winner });
        }
      }
      throw createErr;
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/sessions/:id/photo — upload seed photo
// Body fields `uniqueId` + `phase` ('before'|'after') route the photo to
// Cloudinary (seed-passport/<phase>/<uniqueId>/). When both are present,
// Cloudinary is required for this request to succeed — a failure is
// returned as a real error (never a fake local-path "success"), so the
// caller can show it and let the user retry.
// If either field is omitted (older/back-compat callers), behavior is
// unchanged from before: the photo is just kept on local disk.
router.post('/:id/photo', upload.single('photo'), async (req, res) => {
  try {
    const session = await WeightSession.findById(req.params.id);
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
    if (!req.file)  return res.status(400).json({ success: false, message: 'No photo uploaded' });

    const { uniqueId, phase } = req.body;
    const wantsCloudinary = Boolean(uniqueId) && (phase === 'before' || phase === 'after');

    // The mobile app already sends uniqueId here today — capture it onto the
    // session as soon as it's known, so even an abandoned/never-linked
    // session records which packet it was for. Set once; never overwritten
    // by a later, different scan on the same session.
    if (uniqueId && !session.packetUniqueId) {
      session.packetUniqueId = uniqueId;
    }

    if (wantsCloudinary) {
      let secureUrl;
      try {
        secureUrl = await uploadSeedPacketPhoto(req.file.path, { uniqueId, phase });
      } catch (cloudErr) {
        return res.status(502).json({ success: false, message: `Photo upload failed: ${cloudErr.message}` });
      }
      if (!secureUrl) {
        return res.status(503).json({ success: false, message: 'Photo storage is not configured yet' });
      }
      if (phase === 'before') session.beforePhotoUrl = secureUrl;
      if (phase === 'after')  session.afterPhotoUrl  = secureUrl;
      session.photoUrl = secureUrl; // keep legacy field in sync for existing UI

      // The photo now lives permanently on Cloudinary (secureUrl above) — the
      // local multer temp file was only ever a staging copy for the upload
      // and would otherwise accumulate on disk forever. Best-effort only:
      // a failed cleanup must never fail the request, since the photo is
      // already safely stored.
      fs.unlink(req.file.path, () => {});
    } else {
      session.photoUrl = `/uploads/session-photos/${req.file.filename}`;
    }

    await session.save();

    res.json({
      success: true,
      photoUrl: session.photoUrl,
      beforePhotoUrl: session.beforePhotoUrl,
      afterPhotoUrl: session.afterPhotoUrl,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/sessions/:id/before-weight — capture before weight from latest IoT reading
router.post('/:id/before-weight', async (req, res) => {
  try {
    const session = await WeightSession.findById(req.params.id);
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });

    // Try IoT reading first, fallback to body
    let weight = req.body.weight;
    if (!weight) {
      const iot = await LiveWeight.findOne().sort({ createdAt: -1 });
      if (iot) weight = iot.weight;
    }

    if (weight == null) return res.status(400).json({ success: false, message: 'No weight available' });

    session.beforeWeight = Number(weight);
    session.beforeTime   = new Date();
    // deviceId is optional and only stored if the caller actually sends one.
    if (req.body.deviceId) session.deviceId = req.body.deviceId;
    await session.save();

    res.json({ success: true, beforeWeight: session.beforeWeight, beforeTime: session.beforeTime });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/sessions/:id/after-weight — capture after weight from latest IoT reading
router.post('/:id/after-weight', async (req, res) => {
  try {
    const session = await WeightSession.findById(req.params.id);
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });

    let weight = req.body.weight;
    if (!weight) {
      const iot = await LiveWeight.findOne().sort({ createdAt: -1 });
      if (iot) weight = iot.weight;
    }

    if (weight == null) return res.status(400).json({ success: false, message: 'No weight available' });

    session.afterWeight = Number(weight);
    session.afterTime   = new Date();
    // deviceId is optional and only stored if the caller actually sends one.
    if (req.body.deviceId) session.deviceId = req.body.deviceId;
    // Difference is computed and persisted here (server-side), not left to
    // the mobile UI, so the saved record is authoritative.
    if (session.beforeWeight != null) {
      session.difference = session.afterWeight - session.beforeWeight;
    }
    await session.save();

    res.json({
      success: true,
      afterWeight: session.afterWeight,
      afterTime: session.afterTime,
      difference: session.difference,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/sessions/:id/link/:uniqueId — bind session to QR packet
router.post('/:id/link/:uniqueId', async (req, res) => {
  try {
    const session = await WeightSession.findById(req.params.id);
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
    if (session.status === 'linked') return res.status(400).json({ success: false, message: 'Session already linked' });

    const packet = await SeedPacket.findOne({ uniqueId: req.params.uniqueId });
    if (!packet) return res.status(404).json({ success: false, message: 'Packet not found' });
    // Existing protection, unchanged — only the machine-readable `code` is
    // new, for consistency with the same check now also done at session
    // creation (POST /). Status, message, and control flow are untouched.
    if (packet.status === 'filled') {
      return res.status(400).json({
        success: false,
        code: 'PACKET_ALREADY_FILLED',
        message: 'Packet already has data',
      });
    }

    // If neither photo step happened, packetUniqueId was never captured on
    // the session (see POST /:id/photo above) — backfill it here so every
    // completed measurement reliably records its packet ID for history.
    if (!session.packetUniqueId) session.packetUniqueId = req.params.uniqueId;

    // Push session data into packet
    packet.photoUrl       = session.photoUrl;
    packet.beforePhotoUrl = session.beforePhotoUrl;
    packet.afterPhotoUrl  = session.afterPhotoUrl;
    packet.beforeWeight = session.beforeWeight;
    packet.beforeTime   = session.beforeTime;
    packet.afterWeight  = session.afterWeight;
    packet.afterTime    = session.afterTime;
    packet.difference   = session.difference;
    packet.operator     = session.operator;
    packet.deviceId     = session.deviceId;
    packet.sessionId    = session._id;
    packet.status       = 'filled';
    packet.linkedAt     = new Date();
    await packet.save();

    session.status       = 'linked';
    session.linkedPacket = packet._id;
    await session.save();

    const populated = await SeedPacket.findById(packet._id)
      .populate('batchId', 'seedType batchNumber batchName seedCode batchCode month year warehouse rack shelf')
      .populate('operator', 'name');

    res.json({ success: true, message: 'Data linked to QR', packet: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/sessions/:id/cancel — abandon an unfinished session.
// The session document is NEVER deleted — it just moves to 'cancelled' so
// abandoned flows stop looking "active" without erasing the record. A
// linked (historical) session can never be cancelled, reset, or reused, and
// cancelling never touches the SeedPacket — an empty packet must remain
// exactly as scannable/resumable as before.
router.post('/:id/cancel', async (req, res) => {
  try {
    const session = await WeightSession.findById(req.params.id);
    if (!session) {
      return res.status(404).json({ success: false, code: 'SESSION_NOT_FOUND', message: 'Session not found' });
    }
    if (session.status === 'linked') {
      return res.status(400).json({ success: false, code: 'SESSION_ALREADY_LINKED', message: 'Cannot cancel a session that is already linked' });
    }
    if (session.status === 'cancelled') {
      // Idempotent — cancelling twice is a safe no-op, not an error.
      return res.json({ success: true, code: 'SESSION_ALREADY_CANCELLED', message: 'Session already cancelled', session });
    }

    session.status = 'cancelled';
    await session.save();
    res.json({ success: true, message: 'Session cancelled', session });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/sessions/:id — get session state
router.get('/:id', async (req, res) => {
  try {
    const session = await WeightSession.findById(req.params.id)
      .populate('linkedPacket', 'uniqueId status')
      .populate('operator', 'name');
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
    res.json({ success: true, session });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/sessions — real weighing history, sourced only from WeightSession
// (never the legacy WeightRecord collection). Every session ever created is
// preserved here permanently — completing one only mutates its status to
// 'linked', it is never deleted, overwritten, or merged with another.
//
// Filters (all optional):
//   status          — 'active' | 'linked' | 'cancelled'
//   packetUniqueId  — exact match on the session's own packet reference
//   batchId         — sessions whose packet belongs to this SeedBatch
//   from, to        — ISO date range on createdAt (inclusive)
// Pagination (optional, backward compatible): page (default 1),
// limit (default 200 — the previous hardcoded cap, max 500).
// Sort: newest first by createdAt (the real session timestamp; never fabricated).
router.get('/', async (req, res) => {
  try {
    const { status, packetUniqueId, batchId, from, to } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (packetUniqueId) filter.packetUniqueId = packetUniqueId;

    if (batchId) {
      // WeightSession doesn't store batchId directly (no duplicated batch
      // fields) — resolve it via the real SeedPacket relationship instead.
      const packetsInBatch = await SeedPacket.find({ batchId }).select('_id uniqueId');
      const packetIds  = packetsInBatch.map(p => p._id);
      const uniqueIds  = packetsInBatch.map(p => p.uniqueId);
      filter.$or = [
        { linkedPacket: { $in: packetIds } },
        { packetUniqueId: { $in: uniqueIds } },
      ];
    }

    if (from || to) {
      const range = {};
      if (from) {
        const fromDate = new Date(from);
        if (!isNaN(fromDate)) range.$gte = fromDate;
      }
      if (to) {
        const toDate = new Date(to);
        if (!isNaN(toDate)) range.$lte = toDate;
      }
      if (Object.keys(range).length) filter.createdAt = range;
    }

    const page  = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 200, 1), 500);
    const skip  = (page - 1) * limit;

    const [sessions, total] = await Promise.all([
      WeightSession.find(filter)
        .populate({
          path: 'linkedPacket',
          select: 'uniqueId status batchId',
          populate: { path: 'batchId', select: 'batchName batchNumber seedType month year warehouse rack shelf' },
        })
        .populate('operator', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      WeightSession.countDocuments(filter),
    ]);

    // Shaped for a future Admin consumer: grouped, predictable, and never
    // exposes raw internal fields (e.g. __v) that carry no real information.
    const history = sessions.map((s) => {
      const packet = s.linkedPacket || null;
      const batch  = packet && packet.batchId ? packet.batchId : null;
      return {
        measurement: {
          sessionId: s._id,
          packetUniqueId: s.packetUniqueId,
          beforeWeight: s.beforeWeight,
          afterWeight: s.afterWeight,
          difference: s.difference,
          beforePhotoUrl: s.beforePhotoUrl,
          afterPhotoUrl: s.afterPhotoUrl,
          beforeTime: s.beforeTime,
          afterTime: s.afterTime,
          status: s.status,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        },
        packet: packet ? {
          uniqueId: packet.uniqueId,
          status:   packet.status,
          batchId:  batch ? batch._id : (packet.batchId || null),
        } : null,
        batch: batch ? {
          batchName:   batch.batchName,
          batchNumber: batch.batchNumber,
          seedType:    batch.seedType,
          month:       batch.month,
          year:        batch.year,
          warehouse:   batch.warehouse,
          rack:        batch.rack,
          shelf:       batch.shelf,
        } : null,
        operator: s.operator ? { id: s.operator._id, name: s.operator.name } : null,
        // deviceId is only ever a value a real client sent — null means no
        // device info exists for this measurement, never a fabricated one.
        device: { deviceId: s.deviceId || null },
      };
    });

    res.json({
      success: true,
      sessions: history,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 0 },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;

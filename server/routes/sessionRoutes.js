const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const multer   = require('multer');
const router   = express.Router();
const WeightSession = require('../models/WeightSession');
const SeedPacket    = require('../models/SeedPacket');
const LiveWeight    = require('../models/LiveWeight');
const { uploadSeedPacketPhoto } = require('../utils/cloudinaryUpload');
const { protectUser } = require('../middleware/userAuthMiddleware');
const { protectAdminOrUser } = require('../middleware/authMiddleware');
const { sessionCreateLimiter, sessionMutationLimiter } = require('../middleware/rateLimiter');

// Every mutation route below requires `protectUser` — a real, active User
// account (verified against the User collection, not just a JWT signed with
// the shared secret). This is what makes an Admin token unusable here: an
// Admin's id doesn't resolve against User.findById, so protectUser rejects
// it with 401 exactly like any other unknown identity. `req.user._id` is
// then the only source of `operator` — never a client-supplied value.
//
// A session's `operator`, once set, also defines who owns it: any of these
// routes acting on an existing session first confirms it belongs to the
// caller (or has no owner yet) before allowing the mutation, so User A can
// never act on User B's session just by knowing/guessing its id.
function isOwnedByOtherUser(session, userId) {
  return Boolean(session.operator) && String(session.operator) !== String(userId);
}
const SESSION_FORBIDDEN = { success: false, code: 'SESSION_FORBIDDEN', message: 'This session belongs to a different operator.' };

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
router.post('/', protectUser, sessionCreateLimiter, async (req, res) => {
  try {
    // The authenticated User is the only source of `operator` — a
    // client-supplied operator field, if any were ever sent, is never read.
    const operator = req.user._id;
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
        const existing = activeSessions[0];
        // Resuming must only ever hand back the caller's own session — an
        // active session already owned by a different operator is never
        // silently taken over.
        if (isOwnedByOtherUser(existing, req.user._id)) {
          return res.status(403).json(SESSION_FORBIDDEN);
        }
        return res.json({
          success: true,
          code: 'ACTIVE_SESSION_EXISTS',
          sessionId: existing._id,
          session: existing,
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
          if (isOwnedByOtherUser(winner, req.user._id)) {
            return res.status(403).json(SESSION_FORBIDDEN);
          }
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
router.post('/:id/photo', protectUser, sessionMutationLimiter, upload.single('photo'), async (req, res) => {
  try {
    const session = await WeightSession.findById(req.params.id);
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
    if (isOwnedByOtherUser(session, req.user._id)) return res.status(403).json(SESSION_FORBIDDEN);
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
router.post('/:id/before-weight', protectUser, sessionMutationLimiter, async (req, res) => {
  try {
    const session = await WeightSession.findById(req.params.id);
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
    if (isOwnedByOtherUser(session, req.user._id)) return res.status(403).json(SESSION_FORBIDDEN);

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
router.post('/:id/after-weight', protectUser, sessionMutationLimiter, async (req, res) => {
  try {
    const session = await WeightSession.findById(req.params.id);
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
    if (isOwnedByOtherUser(session, req.user._id)) return res.status(403).json(SESSION_FORBIDDEN);

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
router.post('/:id/link/:uniqueId', protectUser, sessionMutationLimiter, async (req, res) => {
  const { uniqueId } = req.params;
  try {
    const packet = await SeedPacket.findOne({ uniqueId });
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

    // Atomically claim the session in a single findOneAndUpdate: it must
    // still be 'active', owned by this operator (or not yet owned), and
    // either not yet tied to any packet (never captured via the photo step —
    // backfilled here, same as before) or already tied to exactly this one.
    // MongoDB guarantees a findOneAndUpdate's match-and-write happens as one
    // atomic step per document, so of any number of requests racing to link
    // this same session, exactly one can ever flip status 'active' ->
    // 'linked' here — every other one gets `claimed === null` back having
    // mutated nothing.
    const claimed = await WeightSession.findOneAndUpdate(
      {
        _id: req.params.id,
        status: 'active',
        operator: { $in: [null, req.user._id] },
        $or: [{ packetUniqueId: null }, { packetUniqueId: uniqueId }],
      },
      { $set: { status: 'linked', packetUniqueId: uniqueId } },
    );

    if (!claimed) {
      // The atomic claim above didn't match — re-read (read-only, nothing is
      // mutated here) purely to report a specific reason why.
      const current = await WeightSession.findById(req.params.id);
      if (!current) return res.status(404).json({ success: false, message: 'Session not found' });
      if (isOwnedByOtherUser(current, req.user._id)) return res.status(403).json(SESSION_FORBIDDEN);
      if (current.status === 'cancelled') {
        return res.status(400).json({ success: false, code: 'SESSION_CANCELLED', message: 'Cannot link a cancelled session' });
      }
      if (current.status === 'linked') {
        return res.status(400).json({ success: false, message: 'Session already linked' });
      }
      if (current.packetUniqueId && current.packetUniqueId !== uniqueId) {
        return res.status(400).json({ success: false, code: 'PACKET_MISMATCH', message: 'This session belongs to a different packet' });
      }
      return res.status(409).json({ success: false, message: 'Could not link session — please try again' });
    }

    // `claimed` is the pre-update document (Mongoose's findOneAndUpdate
    // default), so it still carries the measurement fields recorded before
    // this claim (beforeWeight/afterWeight/photos) — exactly what the packet
    // needs below.
    const session = claimed;

    try {
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

      await WeightSession.updateOne({ _id: session._id }, { $set: { linkedPacket: packet._id } });
    } catch (packetErr) {
      // The session was already atomically claimed above; if writing the
      // packet fails, undo the claim so the session goes back to 'active'
      // instead of being stuck 'linked' with no packet actually filled.
      await WeightSession.updateOne(
        { _id: session._id, status: 'linked' },
        { $set: { status: 'active', packetUniqueId: session.packetUniqueId ?? null } },
      );
      throw packetErr;
    }

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
router.post('/:id/cancel', protectUser, sessionMutationLimiter, async (req, res) => {
  try {
    const session = await WeightSession.findById(req.params.id);
    if (!session) {
      return res.status(404).json({ success: false, code: 'SESSION_NOT_FOUND', message: 'Session not found' });
    }
    if (isOwnedByOtherUser(session, req.user._id)) return res.status(403).json(SESSION_FORBIDDEN);
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

// GET /api/sessions/:id — get session state.
// Admins may look up any session; an operator (User token) may only look up
// a session that is their own (or ownerless), same rule the mutation routes
// above already enforce via isOwnedByOtherUser.
router.get('/:id', protectAdminOrUser, async (req, res) => {
  try {
    // Ownership must be checked against the raw `operator` ObjectId — doing
    // it after .populate('operator', ...) below would compare a populated
    // sub-document against req.user._id and always read as "owned by
    // someone else", so the check runs first and the populates happen only
    // once the caller is confirmed allowed to see this session.
    const session = await WeightSession.findById(req.params.id);
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
    if (req.user && isOwnedByOtherUser(session, req.user._id)) {
      return res.status(403).json(SESSION_FORBIDDEN);
    }
    await session.populate('linkedPacket', 'uniqueId status');
    await session.populate('operator', 'name');
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
// export=csv (optional): reuses this exact same filter, but returns every
// matching session unpaginated (no skip/limit ceiling) for a complete
// CSV/Excel export — normal (non-export) requests are entirely unaffected
// by this branch and keep the 500-per-request ceiling as before.
// Sort: newest first by createdAt, then by _id as a tiebreaker so two
// sessions sharing a createdAt millisecond still sort deterministically —
// required for stable pagination across pages.
router.get('/', protectAdminOrUser, async (req, res) => {
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

    const isExport = req.query.export === 'csv';
    const page  = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 200, 1), 500);
    const skip  = (page - 1) * limit;

    let sessionsQuery = WeightSession.find(filter)
      .populate({
        path: 'linkedPacket',
        select: 'uniqueId status batchId',
        populate: { path: 'batchId', select: 'batchName batchNumber seedType month year warehouse rack shelf' },
      })
      .populate('operator', 'name')
      .sort({ createdAt: -1, _id: -1 });
    // Only the normal paginated path is bounded — export intentionally
    // retrieves every matching document for the active filters.
    if (!isExport) sessionsQuery = sessionsQuery.skip(skip).limit(limit);

    const [sessions, total] = await Promise.all([
      sessionsQuery,
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

    // Export mode returns the same shape as the normal response — every
    // matching row is already in `history` since no skip/limit was applied
    // above — so the frontend needs no special-case handling to consume it.
    if (isExport) {
      return res.json({
        success: true,
        sessions: history,
        pagination: { page: 1, limit: total, total, totalPages: total > 0 ? 1 : 0 },
      });
    }

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

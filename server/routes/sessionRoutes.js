const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const multer   = require('multer');
const jwt      = require('jsonwebtoken');
const router   = express.Router();
const WeightSession = require('../models/WeightSession');
const SeedPacket    = require('../models/SeedPacket');
const LiveWeight    = require('../models/LiveWeight');

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
router.post('/', async (req, res) => {
  try {
    const operator = await getOperatorId(req);
    const session = await WeightSession.create({ status: 'active', operator });
    res.status(201).json({ success: true, sessionId: session._id, session });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/sessions/:id/photo — upload seed photo
router.post('/:id/photo', upload.single('photo'), async (req, res) => {
  try {
    const session = await WeightSession.findById(req.params.id);
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
    if (!req.file)  return res.status(400).json({ success: false, message: 'No photo uploaded' });

    session.photoUrl = `/uploads/session-photos/${req.file.filename}`;
    await session.save();

    res.json({ success: true, photoUrl: session.photoUrl });
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
    if (packet.status === 'filled') return res.status(400).json({ success: false, message: 'Packet already has data' });

    // Push session data into packet
    packet.photoUrl     = session.photoUrl;
    packet.beforeWeight = session.beforeWeight;
    packet.beforeTime   = session.beforeTime;
    packet.afterWeight  = session.afterWeight;
    packet.afterTime    = session.afterTime;
    packet.difference   = session.difference;
    packet.operator     = session.operator;
    packet.sessionId    = session._id;
    packet.status       = 'filled';
    packet.linkedAt     = new Date();
    await packet.save();

    session.status       = 'linked';
    session.linkedPacket = packet._id;
    await session.save();

    const populated = await SeedPacket.findById(packet._id)
      .populate('batchId', 'seedType batchNumber batchName seedCode batchCode')
      .populate('operator', 'name');

    res.json({ success: true, message: 'Data linked to QR', packet: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/sessions/:id — get session state
router.get('/:id', async (req, res) => {
  try {
    const session = await WeightSession.findById(req.params.id);
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
    res.json({ success: true, session });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;

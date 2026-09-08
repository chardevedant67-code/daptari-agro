const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const multer   = require('multer');
const router   = express.Router();
const WeightSession = require('../models/WeightSession');
const SeedPacket    = require('../models/SeedPacket');
const LiveWeight    = require('../models/LiveWeight');

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
    const session = await WeightSession.create({ status: 'active' });
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
    await session.save();

    res.json({ success: true, afterWeight: session.afterWeight, afterTime: session.afterTime });
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
    packet.sessionId    = session._id;
    packet.status       = 'filled';
    packet.linkedAt     = new Date();
    await packet.save();

    session.status       = 'linked';
    session.linkedPacket = packet._id;
    await session.save();

    const populated = await SeedPacket.findById(packet._id).populate('batchId', 'seedType batchNumber batchName seedCode batchCode');

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

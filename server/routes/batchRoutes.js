const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const router   = express.Router();
const QRCode   = require('qrcode');
const SeedBatch  = require('../models/SeedBatch');
const SeedPacket = require('../models/SeedPacket');
const { protect } = require('../middleware/authMiddleware');

const QR_DIR = path.join(__dirname, '..', 'uploads', 'qr');

// POST /api/batches — create batch + bulk QR generation
router.post('/', protect, async (req, res) => {
  try {
    const { batchName, seedType, seedCategory, seedCode, batchNumber, batchCode, count, month, year, warehouse, rack, shelf } = req.body;

    if (!seedCode || !batchCode || !count) {
      return res.status(400).json({ success: false, message: 'seedCode, batchCode, count required' });
    }

    const total = parseInt(count);
    if (isNaN(total) || total < 1 || total > 5000) {
      return res.status(400).json({ success: false, message: 'count must be 1–5000' });
    }

    // Optional storage/period fields — validated only when provided, never required
    const parsedMonth = (month !== undefined && month !== null && month !== '') ? parseInt(month) : null;
    if (parsedMonth !== null && (isNaN(parsedMonth) || parsedMonth < 1 || parsedMonth > 12)) {
      return res.status(400).json({ success: false, message: 'month must be 1–12' });
    }
    const parsedYear = (year !== undefined && year !== null && year !== '') ? parseInt(year) : null;
    if (parsedYear !== null && isNaN(parsedYear)) {
      return res.status(400).json({ success: false, message: 'year must be a number' });
    }

    const SC = seedCode.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const BC = batchCode.toUpperCase().replace(/[^A-Z0-9]/g, '');

    // Batch QR folder
    const batchFolder = path.join(QR_DIR, `${SC}${BC}`);
    if (!fs.existsSync(batchFolder)) fs.mkdirSync(batchFolder, { recursive: true });

    const batch = await SeedBatch.create({
      batchName: batchName || `${seedType} ${batchNumber}`,
      seedType, seedCategory: seedCategory || '', seedCode: SC, batchNumber, batchCode: BC,
      count: total, createdBy: req.admin._id,
      month: parsedMonth, year: parsedYear,
      warehouse: warehouse || '', rack: rack || '', shelf: shelf || '',
    });

    // Generate all QR PNGs in parallel (much faster than sequential)
    const packetDefs = Array.from({ length: total }, (_, i) => {
      const serial   = String(i + 1).padStart(3, '0');
      const uniqueId = `PRD-${SC}${BC}-${serial}`;
      const fileName = `${uniqueId}.png`;
      const filePath = path.join(batchFolder, fileName);
      return { uniqueId, fileName, filePath };
    });

    const serverIp  = process.env.SERVER_IP || '192.168.0.181';
    const serverPort = process.env.PORT || 5001;
    const baseUrl   = `http://${serverIp}:${serverPort}`;

    await Promise.all(packetDefs.map(({ uniqueId, filePath }) =>
      QRCode.toFile(filePath, `${baseUrl}/scan/${uniqueId}`, {  // URL so phone opens a page on scan
        type: 'png', width: 400, margin: 2,
        color: { dark: '#1a227f', light: '#ffffff' },
      })
    ));

    const packets = packetDefs.map(({ uniqueId, fileName }) => ({
      uniqueId,
      batchId:   batch._id,
      qrCodeUrl: `/uploads/qr/${SC}${BC}/${fileName}`,
      status:    'empty',
    }));

    const created = await SeedPacket.insertMany(packets);
    batch.packets = created.map(p => p._id);
    await batch.save();

    res.status(201).json({
      success: true,
      message: `${total} QR codes generated`,
      batch: {
        _id:       batch._id,
        batchName: batch.batchName,
        seedType:  batch.seedType,
        seedCategory: batch.seedCategory,
        seedCode:  batch.seedCode,
        batchNumber: batch.batchNumber,
        batchCode: batch.batchCode,
        count:     batch.count,
        month:     batch.month,
        year:      batch.year,
        warehouse: batch.warehouse,
        rack:      batch.rack,
        shelf:     batch.shelf,
        createdAt: batch.createdAt,
      },
      packets: created.map(p => ({ uniqueId: p.uniqueId, qrCodeUrl: p.qrCodeUrl })),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/batches — list all batches
router.get('/', protect, async (req, res) => {
  try {
    const batches = await SeedBatch.find()
      .populate('createdBy', 'name')
      .sort({ createdAt: -1 });

    // Real filled-packet count per batch, from SeedPacket only (never
    // WeightSession/WeightRecord). One aggregation covers every batch, so
    // this stays a single extra query regardless of how many batches exist.
    const filledCounts = await SeedPacket.aggregate([
      { $match: { status: 'filled' } },
      { $group: { _id: '$batchId', filledCount: { $sum: 1 } } },
    ]);
    const filledMap = new Map(filledCounts.map(f => [String(f._id), f.filledCount]));

    const withCounts = batches.map(b => {
      const obj = b.toObject();
      obj.filledCount = filledMap.get(String(b._id)) || 0;
      return obj;
    });

    res.json({ success: true, batches: withCounts });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/batches/:id — batch + all packets
router.get('/:id', protect, async (req, res) => {
  try {
    const batch = await SeedBatch.findById(req.params.id).populate('createdBy', 'name');
    if (!batch) return res.status(404).json({ success: false, message: 'Batch not found' });

    // Populate operator so Admin sees a real name instead of a raw ObjectId
    // (Step 14) — read-only, no document is modified.
    const packets = await SeedPacket.find({ batchId: batch._id })
      .populate('operator', 'name')
      .sort({ uniqueId: 1 });
    res.json({ success: true, batch, packets });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/batches/:id/qr-list — just QR urls for download
router.get('/:id/qr-list', protect, async (req, res) => {
  try {
    const packets = await SeedPacket.find({ batchId: req.params.id })
      .select('uniqueId qrCodeUrl status')
      .sort({ uniqueId: 1 });
    res.json({ success: true, packets });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;

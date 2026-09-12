const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const router   = express.Router();
const QRCode   = require('qrcode');
const SeedBatch  = require('../models/SeedBatch');
const SeedPacket = require('../models/SeedPacket');
const { protect } = require('../middleware/authMiddleware');

const QR_DIR = path.join(__dirname, '..', 'uploads', 'qr');

// Public base URL that gets encoded into every packet's QR code (the
// /scan/:uniqueId destination a phone opens on scan) — NOT the qrCodeUrl
// path the PNG is stored at, which is unrelated and untouched by this.
//
// Production (NODE_ENV=production) must set PUBLIC_BASE_URL explicitly
// (e.g. https://your-backend.onrender.com) — there is intentionally no
// LAN-IP fallback here, so a missing value fails the request loudly instead
// of silently baking an unreachable address into printed QR labels.
// Local/dev keeps working exactly as before via SERVER_IP+PORT (or plain
// localhost if neither is set) — PUBLIC_BASE_URL can also be set locally to
// point at something else (e.g. a tunnel) if ever wanted.
function resolveQrBaseUrl() {
  const configured = process.env.PUBLIC_BASE_URL;
  if (configured) {
    if (!/^https?:\/\//i.test(configured)) {
      throw new Error('PUBLIC_BASE_URL must start with http:// or https://');
    }
    return configured.replace(/\/+$/, ''); // no accidental double slash below
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('PUBLIC_BASE_URL is not configured — refusing to generate a QR code with an unreachable URL');
  }

  const port = process.env.PORT || 5001;
  const host = process.env.SERVER_IP || 'localhost';
  return `http://${host}:${port}`;
}

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

    // Resolved before any write — a misconfigured PUBLIC_BASE_URL in
    // production must fail here, not after a SeedBatch is already saved.
    const baseUrl = resolveQrBaseUrl();

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

// GET /api/batches/inventory — Product Inventory page data: real packets
// (one row per QR packet) joined with their batch, filtered by seed/batch/
// warehouse (AND logic, all optional), plus the dropdown options and the
// category counts for the stat cards. SeedBatch/SeedPacket are the sole
// source of truth here — the legacy Product collection is never touched.
router.get('/inventory', protect, async (req, res) => {
  try {
    const { seedType, batchNumber, warehouse, search } = req.query;

    const limit = 10;
    const requestedPage = parseInt(req.query.page, 10);
    const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const skip = (page - 1) * limit;

    // Dropdown options — always real, distinct values from SeedBatch.
    // Batch options narrow to the selected seed, per spec; seed options
    // always list every seed so switching seed never hides itself.
    const seedOptions = (await SeedBatch.distinct('seedType')).filter(Boolean).sort((a, b) => a.localeCompare(b));
    const batchOptionFilter = seedType ? { seedType } : {};
    const batchOptions = (await SeedBatch.distinct('batchNumber', batchOptionFilter)).filter(Boolean).sort((a, b) => a.localeCompare(b));
    const warehouseOptions = ['Warehouse A', 'Warehouse B', 'Warehouse C'];

    const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const batchMatch = {};
    if (seedType)    batchMatch.seedType = seedType;
    if (batchNumber) batchMatch.batchNumber = batchNumber;
    // Warehouse is a fixed 3-option field (Warehouse A/B/C) — matched
    // case-insensitively since older batches were free-typed before this
    // dropdown existed (e.g. "warehouse b"). Seed/batch stay exact matches
    // against the literal values their own dropdowns list.
    if (warehouse)   batchMatch.warehouse = new RegExp(`^${escapeRegex(warehouse)}$`, 'i');

    const pipeline = [
      { $match: batchMatch },
      { $lookup: { from: SeedPacket.collection.name, localField: '_id', foreignField: 'batchId', as: 'packets' } },
      { $unwind: '$packets' },
      { $project: {
          _id:       '$packets._id',
          id:        '$packets.uniqueId',
          qrCodeUrl: '$packets.qrCodeUrl',
          name:      '$seedType',
          category:  '$seedCategory',
          batch:     '$batchNumber',
          location:  '$warehouse',
          createdAt: '$packets.createdAt',
      } },
    ];
    if (search) {
      const rx = new RegExp(search, 'i');
      pipeline.push({ $match: { $or: [{ id: rx }, { name: rx }, { batch: rx }] } });
    }

    // Counts reflect every matching packet (not just the displayed page),
    // so the stat cards are always correct for the active filter combination.
    const countsAgg = await SeedBatch.aggregate([
      ...pipeline,
      { $group: {
          _id: null,
          totalProducts: { $sum: 1 },
          organicCount:  { $sum: { $cond: [{ $eq: ['$category', 'Organic'] }, 1, 0] } },
          hybridCount:   { $sum: { $cond: [{ $eq: ['$category', 'Hybrid'] }, 1, 0] } },
          heirloomModifiedCount: { $sum: { $cond: [{ $in: ['$category', ['Heirloom', 'Modified']] }, 1, 0] } },
      } },
    ]);
    const counts = countsAgg[0] || { totalProducts: 0, organicCount: 0, hybridCount: 0, heirloomModifiedCount: 0 };
    const totalPages = Math.ceil(counts.totalProducts / limit);

    // Pagination is applied only to the rows returned for the table — the
    // counts above (and totalPages) are computed from the full matching
    // set beforehand, so cards always reflect every page, not just this one.
    const products = await SeedBatch.aggregate([
      ...pipeline,
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: limit },
    ]);

    res.json({
      success: true,
      products,
      totalProducts: counts.totalProducts,
      organicCount: counts.organicCount,
      hybridCount: counts.hybridCount,
      heirloomModifiedCount: counts.heirloomModifiedCount,
      seedOptions,
      batchOptions,
      warehouseOptions,
      pagination: { page, limit, total: counts.totalProducts, totalPages },
    });
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

// GET /api/batches/:id — batch + all packets
// Kept below the fixed-path routes above (inventory, qr-list) so those
// literal segments never get swallowed by this param route.
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

module.exports = router;

const express = require('express');
const router = express.Router();
const Product = require('../models/Product');
const Machine = require('../models/Machine');
const WeightRecord = require('../models/WeightRecord');
const Admin = require('../models/Admin');
const SeedBatch = require('../models/SeedBatch');
const SeedPacket = require('../models/SeedPacket');
const WeightSession = require('../models/WeightSession');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

// GET /api/dashboard/stats
router.get('/stats', async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      totalProducts, totalMachines, todayWeighings, activeUsers, recentRecords, machines,
      totalBatches, totalPackets, filledPackets, totalMeasurements,
    ] = await Promise.all([
      Product.countDocuments(),
      Machine.countDocuments(),
      WeightRecord.countDocuments({ createdAt: { $gte: today } }),
      Admin.countDocuments({ isActive: true }),
      WeightRecord.find()
        .populate('product', 'productName')
        .populate('machine', 'machineId')
        .populate('operator', 'name')
        .sort({ createdAt: -1 })
        .limit(5),
      Machine.find().sort({ machineId: 1 }).limit(6),

      // Current system (SeedBatch → SeedPacket → WeightSession) — never
      // Product/Machine/WeightRecord. Each is a direct countDocuments on its
      // own collection (no populate/joins), so a packet with several
      // historical WeightSessions still counts once, and a batch's
      // `packets[]` array is never traversed/summed for this.
      SeedBatch.countDocuments(),
      SeedPacket.countDocuments(),
      SeedPacket.countDocuments({ status: 'filled' }),
      // Only 'linked' sessions are completed measurements — 'active'
      // (in-progress) and 'cancelled' (abandoned) sessions are real
      // WeightSession documents too, but must not inflate this count.
      WeightSession.countDocuments({ status: 'linked' }),
    ]);

    // `status` is an exhaustive two-value enum ('empty' | 'filled'), so this
    // subtraction is exact for the real data — not a guess or hardcoded split.
    const pendingPackets = totalPackets - filledPackets;

    res.json({
      success: true,
      stats: { totalProducts, totalMachines, todayWeighings, activeUsers },
      recentRecords,
      machines,
      // Real current-system metrics, sourced only from SeedBatch/SeedPacket/
      // WeightSession. `stats` above remains legacy (Product/Machine/
      // WeightRecord/Admin) and is left as-is for backward compatibility.
      currentSystem: {
        totalBatches,
        totalPackets,
        filledPackets,
        completedPackets: filledPackets,
        pendingPackets,
        totalMeasurements,
        totalWeightSessions: totalMeasurements,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;

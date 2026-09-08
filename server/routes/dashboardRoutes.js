const express = require('express');
const router = express.Router();
const Product = require('../models/Product');
const Machine = require('../models/Machine');
const WeightRecord = require('../models/WeightRecord');
const Admin = require('../models/Admin');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

// GET /api/dashboard/stats
router.get('/stats', async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [totalProducts, totalMachines, todayWeighings, activeUsers, recentRecords, machines] = await Promise.all([
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
    ]);

    res.json({
      success: true,
      stats: { totalProducts, totalMachines, todayWeighings, activeUsers },
      recentRecords,
      machines,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;

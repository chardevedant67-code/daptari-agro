const express = require('express');
const router  = express.Router();
const SeedPacket = require('../models/SeedPacket');
const { protectUser } = require('../middleware/userAuthMiddleware');

// GET /api/packets — saved measurements (filled packets), most recent first.
// Used by the Android History screen. Reads real SeedPacket documents only.
router.get('/', protectUser, async (req, res) => {
  try {
    const packets = await SeedPacket.find({ status: 'filled' })
      .populate('batchId', 'seedType batchNumber batchName seedCode batchCode month year warehouse rack shelf')
      .populate('operator', 'name')
      .sort({ linkedAt: -1 })
      .limit(200);

    res.json({ success: true, packets });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/packets/:uniqueId — full packet info (used when QR scanned)
router.get('/:uniqueId', protectUser, async (req, res) => {
  try {
    const packet = await SeedPacket.findOne({ uniqueId: req.params.uniqueId })
      .populate('batchId', 'seedType batchNumber batchName seedCode batchCode count createdAt month year warehouse rack shelf');

    if (!packet) return res.status(404).json({ success: false, message: 'Packet not found' });

    res.json({ success: true, packet });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;

const express = require('express');
const router  = express.Router();
const SeedPacket = require('../models/SeedPacket');

// GET /api/packets/:uniqueId — full packet info (used when QR scanned in future)
router.get('/:uniqueId', async (req, res) => {
  try {
    const packet = await SeedPacket.findOne({ uniqueId: req.params.uniqueId })
      .populate('batchId', 'seedType batchNumber batchName seedCode batchCode count createdAt');

    if (!packet) return res.status(404).json({ success: false, message: 'Packet not found' });

    res.json({ success: true, packet });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;

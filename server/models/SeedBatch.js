const mongoose = require('mongoose');

const SeedBatchSchema = new mongoose.Schema({
  batchName:   { type: String, required: true },
  seedType:    { type: String, required: true },
  // Seed classification (Organic/Hybrid/Open Pollinated/Heirloom/Conventional) —
  // optional and separate from seedType (which holds the seed name, e.g. "Soybean").
  seedCategory: { type: String, default: '' },
  seedCode:    { type: String, required: true, uppercase: true, maxlength: 4 },
  batchNumber: { type: String, required: true },
  batchCode:   { type: String, required: true, uppercase: true },
  count:       { type: Number, required: true, min: 1 },

  // Storage location (optional — not required so existing batches remain valid)
  month:       { type: Number, min: 1, max: 12, default: null },
  year:        { type: Number, default: null },
  warehouse:   { type: String, default: '' },
  rack:        { type: String, default: '' },
  shelf:       { type: String, default: '' },

  packets:     [{ type: mongoose.Schema.Types.ObjectId, ref: 'SeedPacket' }],
  createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
}, { timestamps: true });

module.exports = mongoose.model('SeedBatch', SeedBatchSchema);

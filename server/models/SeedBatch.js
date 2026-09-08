const mongoose = require('mongoose');

const SeedBatchSchema = new mongoose.Schema({
  batchName:   { type: String, required: true },
  seedType:    { type: String, required: true },
  seedCode:    { type: String, required: true, uppercase: true, maxlength: 4 },
  batchNumber: { type: String, required: true },
  batchCode:   { type: String, required: true, uppercase: true },
  count:       { type: Number, required: true, min: 1 },
  packets:     [{ type: mongoose.Schema.Types.ObjectId, ref: 'SeedPacket' }],
  createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
}, { timestamps: true });

module.exports = mongoose.model('SeedBatch', SeedBatchSchema);

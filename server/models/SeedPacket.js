const mongoose = require('mongoose');

const SeedPacketSchema = new mongoose.Schema({
  uniqueId:     { type: String, required: true, unique: true },
  batchId:      { type: mongoose.Schema.Types.ObjectId, ref: 'SeedBatch', required: true },
  qrCodeUrl:    { type: String, default: '' },
  status:       { type: String, enum: ['empty', 'filled'], default: 'empty' },

  // Filled after session linked
  photoUrl:     { type: String, default: '' },
  beforeWeight: { type: Number, default: null },
  beforeTime:   { type: Date,   default: null },
  afterWeight:  { type: Number, default: null },
  afterTime:    { type: Date,   default: null },
  linkedAt:     { type: Date,   default: null },
  sessionId:    { type: mongoose.Schema.Types.ObjectId, ref: 'WeightSession', default: null },
}, { timestamps: true });

module.exports = mongoose.model('SeedPacket', SeedPacketSchema);

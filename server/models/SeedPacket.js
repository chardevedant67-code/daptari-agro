const mongoose = require('mongoose');

const SeedPacketSchema = new mongoose.Schema({
  uniqueId:     { type: String, required: true, unique: true },
  batchId:      { type: mongoose.Schema.Types.ObjectId, ref: 'SeedBatch', required: true },
  qrCodeUrl:    { type: String, default: '' },
  status:       { type: String, enum: ['empty', 'filled'], default: 'empty' },

  // Filled after session linked
  photoUrl:       { type: String, default: '' },
  // Cloudinary secure_url per phase (seed-passport/before|after/<uniqueId>).
  // photoUrl above is kept as-is for existing UI compatibility.
  beforePhotoUrl: { type: String, default: '' },
  afterPhotoUrl:  { type: String, default: '' },
  beforeWeight: { type: Number, default: null },
  beforeTime:   { type: Date,   default: null },
  afterWeight:  { type: Number, default: null },
  afterTime:    { type: Date,   default: null },
  difference:   { type: Number, default: null },
  operator:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  // Which physical weighing device produced this measurement, if the session
  // that filled this packet had one. Never fabricated — mirrors
  // WeightSession.deviceId at link time; stays null otherwise.
  deviceId:     { type: String, default: null },
  linkedAt:     { type: Date,   default: null },
  sessionId:    { type: mongoose.Schema.Types.ObjectId, ref: 'WeightSession', default: null },
}, { timestamps: true });

// Supports: SeedBatch.aggregate's $group/$lookup on batchId (batchRoutes.js
// filled-count + inventory queries), and the direct SeedPacket.find({batchId})
// calls in batchRoutes.js (qr-list, batch detail) and sessionRoutes.js
// (GET /api/sessions?batchId= resolution) — five real query/aggregation
// sites, none previously covered by any index (uniqueId's unique index is
// unrelated to this field).
SeedPacketSchema.index({ batchId: 1 });

module.exports = mongoose.model('SeedPacket', SeedPacketSchema);

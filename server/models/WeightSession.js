const mongoose = require('mongoose');

const WeightSessionSchema = new mongoose.Schema({
  status:       { type: String, enum: ['active', 'linked'], default: 'active' },
  photoUrl:     { type: String, default: '' },
  beforeWeight: { type: Number, default: null },
  beforeTime:   { type: Date,   default: null },
  afterWeight:  { type: Number, default: null },
  afterTime:    { type: Date,   default: null },
  difference:   { type: Number, default: null },
  operator:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  linkedPacket: { type: mongoose.Schema.Types.ObjectId, ref: 'SeedPacket', default: null },
}, { timestamps: true });

module.exports = mongoose.model('WeightSession', WeightSessionSchema);

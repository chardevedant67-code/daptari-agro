const mongoose = require('mongoose');

const WeightSessionSchema = new mongoose.Schema({
  // 'cancelled' = an abandoned/unfinished flow the user explicitly gave up
  // on, or that lost the race to another session for the same packet.
  // Never deleted, never auto-reset to 'active' — see POST /:id/cancel.
  status:       { type: String, enum: ['active', 'linked', 'cancelled'], default: 'active' },

  // Best-effort packet reference, captured as soon as it's known (e.g. when a
  // photo is uploaded with a uniqueId) so an in-progress/abandoned session
  // still records which packet it was for. `linkedPacket` below remains the
  // authoritative ObjectId link, set only once the session actually completes.
  packetUniqueId: { type: String, default: null },

  // Which physical weighing device produced this measurement, if the caller
  // provides one. Never fabricated — stays null until a real client/device
  // sends a value; hardware integration itself is out of scope for now.
  deviceId:       { type: String, default: null },

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
  linkedPacket: { type: mongoose.Schema.Types.ObjectId, ref: 'SeedPacket', default: null },
}, { timestamps: true });

// Only one ACTIVE session may exist per physical packet at a time — this is
// the atomic guard against two operators racing on the same empty packet.
// Scoped (via partialFilterExpression) to status:'active' with a real
// packetUniqueId, so it never restricts 'linked'/'cancelled' sessions —
// multiple historical linked sessions per packet remain fully possible if
// the data already contains them. Verified safe against production data
// before adding (no existing active session currently has a duplicate
// packetUniqueId).
WeightSessionSchema.index(
  { packetUniqueId: 1 },
  { unique: true, partialFilterExpression: { status: 'active', packetUniqueId: { $type: 'string' } } }
);

module.exports = mongoose.model('WeightSession', WeightSessionSchema);

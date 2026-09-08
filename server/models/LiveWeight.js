const mongoose = require('mongoose');

const LiveWeightSchema = new mongoose.Schema(
  {
    weight:    { type: Number, required: true },
    unit:      { type: String, default: 'kg' },
    machineId: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('LiveWeight', LiveWeightSchema);

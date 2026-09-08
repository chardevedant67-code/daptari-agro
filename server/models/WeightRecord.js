const mongoose = require('mongoose');

const WeightRecordSchema = new mongoose.Schema(
  {
    product:      { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    machine:      { type: mongoose.Schema.Types.ObjectId, ref: 'Machine', required: true },
    operator:     { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    actualWeight: { type: Number, required: true },
    nominalWeight:{ type: Number, required: true },
    unit:         { type: String, default: 'kg' },
    status: {
      type: String,
      enum: ['PASS', 'FAIL', 'WARN'],
      default: function () {
        const diff = Math.abs(this.actualWeight - this.nominalWeight);
        const pct = (diff / this.nominalWeight) * 100;
        if (pct <= 2) return 'PASS';
        if (pct <= 5) return 'WARN';
        return 'FAIL';
      },
    },
    notes:    { type: String, default: '' },
    photoUrl: { type: String, default: '' },
  },
  { timestamps: true }
);

// Auto-calculate status before save
WeightRecordSchema.pre('save', function () {
  const diff = Math.abs(this.actualWeight - this.nominalWeight);
  const pct = (diff / this.nominalWeight) * 100;
  if (pct <= 2)      this.status = 'PASS';
  else if (pct <= 5) this.status = 'WARN';
  else               this.status = 'FAIL';
});

module.exports = mongoose.model('WeightRecord', WeightRecordSchema);

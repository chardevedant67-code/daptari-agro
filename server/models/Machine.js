const mongoose = require('mongoose');

const MachineSchema = new mongoose.Schema(
  {
    machineId:  { type: String, required: true, unique: true, trim: true },
    name:       { type: String, required: true, trim: true },
    line:       { type: String, required: true },
    location:   { type: String, required: true },
    category:   { type: String, enum: ['packing', 'sorting', 'filling', 'other'], default: 'packing' },
    status:     { type: String, enum: ['Running', 'Standby', 'Maintenance', 'Fault'], default: 'Standby' },
    efficiency: { type: Number, default: 0, min: 0, max: 100 },
    runtime:    { type: Number, default: 0 },
    isActive:   { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Machine', MachineSchema);

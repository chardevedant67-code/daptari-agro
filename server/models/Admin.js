const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const AdminSchema = new mongoose.Schema(
  {
    name:     { type: String, required: true, trim: true },
    email:    { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, minlength: 6, select: false },
    role:     { type: String, enum: ['superadmin', 'admin', 'operator'], default: 'admin' },
    avatar:   { type: String, default: '' },
    isActive: { type: Boolean, default: true },
    lastLogin:{ type: Date },
  },
  { timestamps: true }
);

// Hash password before save
AdminSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 10);
});

// Compare password
AdminSchema.methods.matchPassword = async function (entered) {
  return await bcrypt.compare(entered, this.password);
};

module.exports = mongoose.model('Admin', AdminSchema);

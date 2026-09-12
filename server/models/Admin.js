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

    // Password reset (Step 9B) — all optional/additive, unset for every
    // existing document. Only a SHA-256 hash of the reset token is ever
    // stored, never the raw token. Cleared back to undefined on successful
    // reset (or overwritten by a fresh request) — that clearing is what
    // makes a token one-time-use, no separate "used" flag needed.
    resetPasswordTokenHash:  { type: String, select: false },
    resetPasswordExpiresAt:  { type: Date },
    // Sessions/JWTs issued before this timestamp are rejected by
    // authMiddleware.js — this is what invalidates old tokens after a
    // password reset, since the JWT payload itself carries no version claim.
    passwordChangedAt:       { type: Date },
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

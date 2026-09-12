const crypto = require('crypto');
const Admin = require('../models/Admin');
const { sendPasswordResetEmail } = require('../utils/emailService');

// Prefer 60 minutes per Step 9A/9B — no existing project convention argues
// for a shorter window.
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

// Identical response for an existing active Admin, an existing inactive
// Admin, and a nonexistent email — never reveal which case occurred
// (Step 9A Section 7/I: anti account-enumeration).
const GENERIC_MESSAGE = 'If an account exists for this email, a password reset link has been sent.';

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

// POST /api/auth/forgot-password — public.
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (typeof email === 'string' && email.trim()) {
      const normalizedEmail = email.toLowerCase().trim();
      const admin = await Admin.findOne({ email: normalizedEmail });

      if (admin && admin.isActive) {
        const appUrl = process.env.APP_PUBLIC_URL;
        if (!appUrl) {
          // Server misconfiguration — never surface this to the client (a
          // different failure mode here would itself reveal the account
          // exists). No token is generated/stored in this case.
          console.error('Password reset unavailable: APP_PUBLIC_URL is not configured');
        } else {
          const rawToken = crypto.randomBytes(32).toString('hex');
          admin.resetPasswordTokenHash = hashToken(rawToken);
          admin.resetPasswordExpiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
          await admin.save({ validateBeforeSave: false });

          const resetUrl = `${appUrl}/reset-password?token=${rawToken}`;
          try {
            await sendPasswordResetEmail({ to: admin.email, resetUrl });
          } catch (emailErr) {
            // Provider failure must never leak to the client or change the
            // response — log a safe summary only (never the token/url/body).
            console.error('Password reset email failed to send:', emailErr.message);
          }
        }
      }
      // Inactive account or unknown email: fall through with no token
      // created — same generic response as the success path below.
    }

    return res.json({ success: true, message: GENERIC_MESSAGE });
  } catch (err) {
    console.error('forgotPassword error:', err.message);
    // Stay generic even on an unexpected error — preserves the
    // anti-enumeration guarantee.
    return res.json({ success: true, message: GENERIC_MESSAGE });
  }
};

// POST /api/auth/reset-password — public, consumes a one-time reset token.
const resetPassword = async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || typeof token !== 'string') {
      return res.status(400).json({ success: false, message: 'Reset token is required' });
    }
    if (!password || typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }

    const admin = await Admin.findOne({
      resetPasswordTokenHash: hashToken(token),
      resetPasswordExpiresAt: { $gt: new Date() },
    });

    if (!admin) {
      return res.status(400).json({ success: false, message: 'Invalid or expired reset token' });
    }

    // Re-hashed by Admin's own pre('save') hook, same as every other
    // password write in this project (change-password, reset-admin.js).
    admin.password = password;
    admin.resetPasswordTokenHash = undefined;
    admin.resetPasswordExpiresAt = undefined;
    // Invalidates every JWT issued before this instant — see
    // middleware/authMiddleware.js.
    admin.passwordChangedAt = new Date();
    await admin.save();

    return res.json({ success: true, message: 'Password has been reset successfully' });
  } catch (err) {
    console.error('resetPassword error:', err.message);
    return res.status(500).json({ success: false, message: 'Could not reset password' });
  }
};

module.exports = { forgotPassword, resetPassword };

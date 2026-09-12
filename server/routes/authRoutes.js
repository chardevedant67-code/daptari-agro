const express = require('express');
const router = express.Router();
const { login, getMe, logout } = require('../controllers/authController');
const { forgotPassword, resetPassword } = require('../controllers/passwordResetController');
const { protect } = require('../middleware/authMiddleware');
const {
  adminLoginLimiter,
  forgotPasswordEmailLimiter,
  forgotPasswordIpLimiter,
  resetPasswordLimiter,
} = require('../middleware/rateLimiter');

router.post('/login', adminLoginLimiter, login);
router.get('/me', protect, getMe);
router.post('/logout', protect, logout);

// Public — the caller is not authenticated during password recovery, so
// these must never sit behind `protect` (Step 9B, Admin-only self-service).
router.post('/forgot-password', forgotPasswordEmailLimiter, forgotPasswordIpLimiter, forgotPassword);
router.post('/reset-password', resetPasswordLimiter, resetPassword);

module.exports = router;

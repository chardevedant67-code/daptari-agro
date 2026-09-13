const express = require('express');
const router = express.Router();
const { getAllAdmins, createAdmin, updateAdmin, deleteAdmin, changePassword } = require('../controllers/adminController');
const { protect } = require('../middleware/authMiddleware');
const { allowRoles } = require('../middleware/roleMiddleware');
const { adminChangePasswordLimiter } = require('../middleware/rateLimiter');

router.use(protect);

router.get('/all',             allowRoles('superadmin'), getAllAdmins);
router.post('/create',         allowRoles('superadmin'), createAdmin);
// Rate-limited (B-12) — without this, a stolen/leaked JWT could be used to
// brute-force this account's actual password via the currentPassword check
// below, with no throttling at all (see rateLimiter.js's own comment).
router.put('/change-password', adminChangePasswordLimiter, changePassword);
router.put('/:id',             allowRoles('superadmin'), updateAdmin);
router.delete('/:id',          allowRoles('superadmin'), deleteAdmin);

module.exports = router;

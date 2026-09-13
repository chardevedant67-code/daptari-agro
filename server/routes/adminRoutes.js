const express = require('express');
const router = express.Router();
const { getAllAdmins, createAdmin, updateAdmin, deleteAdmin, changePassword, deactivateSelf } = require('../controllers/adminController');
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
// E.1 — self-deactivation. Registered ahead of /:id below (same reason
// /change-password already is) so "deactivate-self" is never swallowed as
// an :id value. No allowRoles restriction — like change-password, this is a
// self-service action available to every Admin role, not just superadmin;
// ownership is enforced entirely by targeting only req.admin._id inside
// deactivateSelf, never a client-supplied id.
router.put('/deactivate-self', deactivateSelf);
router.put('/:id',             allowRoles('superadmin'), updateAdmin);
router.delete('/:id',          allowRoles('superadmin'), deleteAdmin);

module.exports = router;

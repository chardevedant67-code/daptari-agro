const express = require('express');
const router = express.Router();
const { register, login, getMe } = require('../controllers/userAuthController');
const { protectUser } = require('../middleware/userAuthMiddleware');
const { protect } = require('../middleware/authMiddleware');
const { allowRoles } = require('../middleware/roleMiddleware');
const { listUsers, createUser, updateUser, deleteUser, setUserPassword } = require('../controllers/userAdminController');
const { userLoginLimiter, userRegisterLimiter } = require('../middleware/rateLimiter');

// Public — mobile app self-service. Unrelated to and unchanged by the
// Admin-protected routes below.
router.post('/register', userRegisterLimiter, register);
router.post('/login',    userLoginLimiter, login);

// Protected (mobile app user must be logged in)
router.get('/me', protectUser, getMe);

// Admin-protected field-operator management (superadmin only) — manages the
// real User collection that WeightSession.operator/SeedPacket.operator
// actually reference. Separate from Admin/back-office accounts, which stay
// under /api/admin/*. An ordinary mobile User JWT cannot call these: `protect`
// requires an Admin JWT, not a User one.
router.get('/admin/all',     protect, allowRoles('superadmin'), listUsers);
router.post('/admin/create', protect, allowRoles('superadmin'), createUser);
router.put('/admin/:id',     protect, allowRoles('superadmin'), updateUser);
router.delete('/admin/:id',  protect, allowRoles('superadmin'), deleteUser);
router.put('/admin/:id/password', protect, allowRoles('superadmin'), setUserPassword);

module.exports = router;

const express = require('express');
const router = express.Router();
const { getAllAdmins, createAdmin, updateAdmin, deleteAdmin, changePassword } = require('../controllers/adminController');
const { protect } = require('../middleware/authMiddleware');
const { allowRoles } = require('../middleware/roleMiddleware');

router.use(protect);

router.get('/all',             allowRoles('superadmin'), getAllAdmins);
router.post('/create',         allowRoles('superadmin'), createAdmin);
router.put('/change-password', changePassword);
router.put('/:id',             allowRoles('superadmin'), updateAdmin);
router.delete('/:id',          allowRoles('superadmin'), deleteAdmin);

module.exports = router;

const Admin = require('../models/Admin');
const { sendServerError } = require('../utils/errorResponse');

// GET /api/admin/all — superadmin only
const getAllAdmins = async (req, res) => {
  try {
    const admins = await Admin.find().select('-password').sort({ createdAt: -1 });
    res.json({ success: true, count: admins.length, admins });
  } catch (err) {
    sendServerError(res, err, 'adminController');
  }
};

// POST /api/admin/create — superadmin only
const createAdmin = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    const exists = await Admin.findOne({ email });
    if (exists) {
      return res.status(400).json({ success: false, message: 'Email already registered' });
    }

    const admin = await Admin.create({ name, email, password, role });

    res.status(201).json({
      success: true,
      message: 'Admin created successfully',
      admin: { id: admin._id, name: admin.name, email: admin.email, role: admin.role },
    });
  } catch (err) {
    sendServerError(res, err, 'adminController');
  }
};

// PUT /api/admin/:id — superadmin only
const updateAdmin = async (req, res) => {
  try {
    const { name, role, isActive } = req.body;
    const admin = await Admin.findByIdAndUpdate(
      req.params.id,
      { name, role, isActive },
      { new: true, runValidators: true }
    ).select('-password');

    if (!admin) {
      return res.status(404).json({ success: false, message: 'Admin not found' });
    }

    res.json({ success: true, message: 'Admin updated', admin });
  } catch (err) {
    sendServerError(res, err, 'adminController');
  }
};

// DELETE /api/admin/:id — superadmin only
const deleteAdmin = async (req, res) => {
  try {
    if (req.params.id === req.admin._id.toString()) {
      return res.status(400).json({ success: false, message: 'Cannot delete your own account' });
    }

    const admin = await Admin.findByIdAndDelete(req.params.id);
    if (!admin) {
      return res.status(404).json({ success: false, message: 'Admin not found' });
    }

    res.json({ success: true, message: 'Admin deleted' });
  } catch (err) {
    sendServerError(res, err, 'adminController');
  }
};

// PUT /api/admin/change-password — any admin (own password)
const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    const admin = await Admin.findById(req.admin._id).select('+password');
    if (!(await admin.matchPassword(currentPassword))) {
      return res.status(401).json({ success: false, message: 'Current password is incorrect' });
    }

    admin.password = newPassword;
    // Invalidates every JWT issued before this instant — see
    // middleware/authMiddleware.js. Matches passwordResetController.js's
    // resetPassword, which already sets this; self-service change-password
    // was the one Admin password-mutation path missing it.
    admin.passwordChangedAt = new Date();
    await admin.save();

    res.json({ success: true, message: 'Password changed successfully' });
  } catch (err) {
    sendServerError(res, err, 'adminController');
  }
};

module.exports = { getAllAdmins, createAdmin, updateAdmin, deleteAdmin, changePassword };

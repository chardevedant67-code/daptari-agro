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

// PUT /api/admin/deactivate-self — any authenticated Admin, own account only
// (E.1). The target is always req.admin._id (set by `protect` from the
// verified JWT) — never req.params or req.body — so this can never touch
// another admin's account regardless of what a caller sends. Requires
// currentPassword re-confirmation, same as changePassword: unlike that
// route, this one needs no other secret to succeed, so without this check a
// stolen/leaked JWT alone would be enough to deactivate the real owner's
// account as pure sabotage (same threat model B-12 already addressed for
// change-password).
const deactivateSelf = async (req, res) => {
  try {
    const { currentPassword } = req.body;

    if (typeof currentPassword !== 'string' || !currentPassword) {
      return res.status(400).json({ success: false, message: 'Current password is required' });
    }

    const admin = await Admin.findById(req.admin._id).select('+password');
    if (!(await admin.matchPassword(currentPassword))) {
      return res.status(401).json({ success: false, message: 'Current password is incorrect' });
    }

    // Sole-active-superadmin safeguard: prevents the last superadmin from
    // locking the whole system out of every allowRoles('superadmin') route
    // (create/list/delete other admins, etc.) with no way back in short of
    // direct DB access. Only evaluated for superadmins — every other role
    // deactivates freely.
    if (admin.role === 'superadmin') {
      const otherActiveSuperadmins = await Admin.countDocuments({
        role: 'superadmin',
        isActive: true,
        _id: { $ne: admin._id },
      });
      if (otherActiveSuperadmins === 0) {
        return res.status(400).json({
          success: false,
          message: 'You are the only active superadmin — promote another admin to superadmin before deactivating this account.',
        });
      }
    }

    // Only isActive changes — password/passwordChangedAt are untouched.
    // `protect` already rejects every future request for this account
    // (isActive is checked live against the DB on every request, not just
    // at login), so no separate token-invalidation step is needed here.
    admin.isActive = false;
    await admin.save();

    res.json({ success: true, message: 'Account deactivated' });
  } catch (err) {
    sendServerError(res, err, 'adminController');
  }
};

module.exports = { getAllAdmins, createAdmin, updateAdmin, deleteAdmin, changePassword, deactivateSelf };

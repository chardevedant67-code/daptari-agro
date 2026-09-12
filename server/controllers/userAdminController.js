const User          = require('../models/User');
const WeightSession = require('../models/WeightSession');
const SeedPacket    = require('../models/SeedPacket');
const { sendServerError } = require('../utils/errorResponse');

// The User model's own roles (mobile/field accounts) — never Admin's roles
// (admin/superadmin). Admin-account management stays under /api/admin/*.
const ALLOWED_ROLES = ['operator', 'supervisor'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Never return password/hash — only the safe fields the Operators UI needs.
const publicUser = (u) => ({
  _id: u._id,
  name: u.name,
  email: u.email,
  role: u.role,
  isActive: u.isActive,
  lastLogin: u.lastLogin,
  createdAt: u.createdAt,
  updatedAt: u.updatedAt,
});

// GET /api/user/admin/all — superadmin only
const listUsers = async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    res.json({ success: true, count: users.length, users: users.map(publicUser) });
  } catch (err) {
    sendServerError(res, err, 'userAdminController');
  }
};

// POST /api/user/admin/create — superadmin only
// Password hashing is handled entirely by User's own pre('save') hook —
// never hashed manually here.
const createUser = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({ success: false, message: 'Name, email, password and role are required' });
    }
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ success: false, message: 'A valid email is required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }
    if (!ALLOWED_ROLES.includes(role)) {
      return res.status(400).json({ success: false, message: `role must be one of: ${ALLOWED_ROLES.join(', ')}` });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const exists = await User.findOne({ email: normalizedEmail });
    if (exists) {
      return res.status(409).json({ success: false, message: 'Email already registered' });
    }

    const user = await User.create({ name, email: normalizedEmail, password, role });
    res.status(201).json({ success: true, message: 'Operator created', user: publicUser(user) });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: 'Email already registered' });
    }
    sendServerError(res, err, 'userAdminController');
  }
};

// PUT /api/user/admin/:id — superadmin only
// Builds an explicit patch of only the fields an Admin may edit — _id,
// password (hash), and timestamps can never be overwritten through this
// endpoint even if a caller sends them in the body.
const updateUser = async (req, res) => {
  try {
    const { name, email, role, isActive } = req.body;

    if (role !== undefined && !ALLOWED_ROLES.includes(role)) {
      return res.status(400).json({ success: false, message: `role must be one of: ${ALLOWED_ROLES.join(', ')}` });
    }
    if (email !== undefined && !EMAIL_RE.test(email)) {
      return res.status(400).json({ success: false, message: 'A valid email is required' });
    }

    const patch = {};
    if (name !== undefined)     patch.name = name;
    if (email !== undefined)    patch.email = email.toLowerCase().trim();
    if (role !== undefined)     patch.role = role;
    if (isActive !== undefined) patch.isActive = isActive;

    const user = await User.findByIdAndUpdate(req.params.id, patch, { new: true, runValidators: true }).select('-password');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({ success: true, message: 'Operator updated', user: publicUser(user) });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: 'Email already registered' });
    }
    sendServerError(res, err, 'userAdminController');
  }
};

// DELETE /api/user/admin/:id — superadmin only
// Historical WeightSession/SeedPacket.operator references must never be
// broken or cascade-deleted — an operator with weighing history can only be
// deactivated (PUT .../isActive=false), never physically deleted.
const deleteUser = async (req, res) => {
  try {
    const [sessionCount, packetCount] = await Promise.all([
      WeightSession.countDocuments({ operator: req.params.id }),
      SeedPacket.countDocuments({ operator: req.params.id }),
    ]);

    if (sessionCount > 0 || packetCount > 0) {
      return res.status(409).json({
        success: false,
        message: 'This operator has historical weighing records and cannot be deleted — deactivate the account instead.',
        sessionCount,
        packetCount,
      });
    }

    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({ success: true, message: 'Operator deleted' });
  } catch (err) {
    sendServerError(res, err, 'userAdminController');
  }
};

// PUT /api/user/admin/:id/password — superadmin only. Step 9A/Option 1:
// mobile Users have no self-service reset flow, so a locked-out operator's
// password is set here by a superadmin instead. Loads the document and
// assigns + saves (never findByIdAndUpdate) so User's own pre('save') hook
// re-hashes it, exactly like Admin's changePassword/reset-admin.js.
const setUserPassword = async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    user.password = password;
    // Invalidates every JWT issued before this instant — see
    // middleware/userAuthMiddleware.js and authMiddleware.js's
    // protectAdminOrUser (User branch).
    user.passwordChangedAt = new Date();
    await user.save();

    res.json({ success: true, message: 'Password updated' });
  } catch (err) {
    sendServerError(res, err, 'userAdminController');
  }
};

module.exports = { listUsers, createUser, updateUser, deleteUser, setUserPassword };

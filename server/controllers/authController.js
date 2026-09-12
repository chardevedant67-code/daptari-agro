const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');

// Bounded fallbacks ('7d'/'30d') so a missing JWT_EXPIRE/JWT_EXPIRE_LONG can
// never result in expiresIn being undefined — jsonwebtoken treats that as
// "never expires". An explicitly configured env value always wins.
const signToken = (id, rememberMe) => {
  const expire = rememberMe
    ? (process.env.JWT_EXPIRE_LONG || '30d')
    : (process.env.JWT_EXPIRE || '7d');
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: expire });
};

// POST /api/auth/login
const login = async (req, res) => {
  try {
    const { email, password, rememberMe } = req.body;

    // email/password must be plain strings before anything downstream (the
    // Mongo query in particular) ever sees them — an object/array (e.g.
    // { $ne: null }) would otherwise reach Admin.findOne() as a query
    // operator instead of a value. Rejected the same way a missing email
    // already was, so this never leaks whether an email exists.
    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }

    const normalizedEmail = email.trim();
    const admin = await Admin.findOne({ email: normalizedEmail }).select('+password');

    if (!admin || !(await admin.matchPassword(password))) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    if (!admin.isActive) {
      return res.status(403).json({ success: false, message: 'Account is deactivated' });
    }

    admin.lastLogin = new Date();
    await admin.save({ validateBeforeSave: false });

    const token = signToken(admin._id, rememberMe);

    res.json({
      success: true,
      token,
      admin: {
        id: admin._id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
        avatar: admin.avatar,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/auth/me
const getMe = async (req, res) => {
  try {
    const admin = await Admin.findById(req.admin._id);
    res.json({
      success: true,
      admin: {
        id: admin._id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
        avatar: admin.avatar,
        lastLogin: admin.lastLogin,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/auth/logout
const logout = (req, res) => {
  res.json({ success: true, message: 'Logged out successfully' });
};

module.exports = { login, getMe, logout };

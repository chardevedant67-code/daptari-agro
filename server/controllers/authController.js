const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');

const signToken = (id, rememberMe) => {
  const expire = rememberMe ? process.env.JWT_EXPIRE_LONG : process.env.JWT_EXPIRE;
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: expire });
};

// POST /api/auth/login
const login = async (req, res) => {
  try {
    const { email, password, rememberMe } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }

    const admin = await Admin.findOne({ email }).select('+password');

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

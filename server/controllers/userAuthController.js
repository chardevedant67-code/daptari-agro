const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { sendServerError } = require('../utils/errorResponse');

const signToken = (id) =>
  jwt.sign({ id, type: 'user' }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '7d',
  });

const userPublic = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/user/register
const register = async (req, res) => {
  try {
    const { name, email, password } = req.body || {};

    // name/email/password must be plain strings before anything downstream
    // (the Mongo query in particular) ever sees them — an object/array (e.g.
    // { $regex: 'a' } or { $ne: null }) would otherwise reach
    // User.findOne() below as a query operator instead of a value. Mirrors
    // the same guard authController.js's Admin login already uses.
    if (typeof name !== 'string' || typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ success: false, message: 'Name, email and password are required' });
    }

    const trimmedName = name.trim();
    const normalizedEmail = email.trim().toLowerCase();

    if (!trimmedName || !normalizedEmail || !password) {
      return res.status(400).json({ success: false, message: 'Name, email and password are required' });
    }

    if (!EMAIL_RE.test(normalizedEmail)) {
      return res.status(400).json({ success: false, message: 'Enter a valid email address' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }

    // Normalized (lowercased/trimmed) so this duplicate check actually
    // matches what the schema's own `lowercase: true` will store — an
    // unnormalized check here previously let two case-variant emails both
    // pass this lookup and only collide later at User.create() as a raw,
    // unfriendly Mongo E11000 error.
    const exists = await User.findOne({ email: normalizedEmail });
    if (exists) {
      return res.status(400).json({ success: false, message: 'Email already registered' });
    }

    const user = await User.create({ name: trimmedName, email: normalizedEmail, password });
    const token = signToken(user._id);

    res.status(201).json({ success: true, token, user: userPublic(user) });
  } catch (err) {
    sendServerError(res, err, 'userAuthController');
  }
};

// POST /api/user/login
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() }).select('+password');
    if (!user || !(await user.matchPassword(password))) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    if (!user.isActive) {
      return res.status(403).json({ success: false, message: 'Account is deactivated' });
    }

    user.lastLogin = new Date();
    await user.save({ validateBeforeSave: false });

    const token = signToken(user._id);
    res.json({ success: true, token, user: userPublic(user) });
  } catch (err) {
    sendServerError(res, err, 'userAuthController');
  }
};

// GET /api/user/me
const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    res.json({ success: true, user: userPublic(user) });
  } catch (err) {
    sendServerError(res, err, 'userAuthController');
  }
};

module.exports = { register, login, getMe };

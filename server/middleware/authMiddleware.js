const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');
const User  = require('../models/User');

const protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({ success: false, message: 'Not authorized — no token' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.admin = await Admin.findById(decoded.id);

    if (!req.admin || !req.admin.isActive) {
      return res.status(401).json({ success: false, message: 'Account not found or inactive' });
    }

    // A password reset invalidates every token issued before it. jwt.sign
    // always stamps `iat` (seconds since epoch) unless told not to, so no
    // change to token creation was needed to support this check.
    if (req.admin.passwordChangedAt && decoded.iat * 1000 < req.admin.passwordChangedAt.getTime()) {
      return res.status(401).json({ success: false, message: 'Session expired — please log in again' });
    }

    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Token invalid or expired' });
  }
};

// Accepts either a valid Admin token or a valid User (operator) token — for
// read routes that legitimate callers reach from both the Admin Dashboard
// and the mobile app (e.g. GET /api/sessions). User tokens carry
// `type: 'user'` (see userAuthController.signToken); Admin tokens don't.
// Whichever principal is resolved is attached exactly as `protect`/
// `protectUser` already do (`req.admin` or `req.user`), so downstream
// handlers can tell them apart the same way they always could.
const protectAdminOrUser = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({ success: false, message: 'Not authorized — no token' });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Token invalid or expired' });
  }

  try {
    if (decoded.type === 'user') {
      const user = await User.findById(decoded.id);
      if (!user || !user.isActive) {
        return res.status(401).json({ success: false, message: 'Account not found or inactive' });
      }
      req.user = user;
      return next();
    }

    const admin = await Admin.findById(decoded.id);
    if (!admin || !admin.isActive) {
      return res.status(401).json({ success: false, message: 'Account not found or inactive' });
    }
    if (admin.passwordChangedAt && decoded.iat * 1000 < admin.passwordChangedAt.getTime()) {
      return res.status(401).json({ success: false, message: 'Session expired — please log in again' });
    }
    req.admin = admin;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Token invalid or expired' });
  }
};

module.exports = { protect, protectAdminOrUser };

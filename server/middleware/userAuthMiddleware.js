const jwt = require('jsonwebtoken');
const User = require('../models/User');

const protectUser = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({ success: false, message: 'Not authorized — no token' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id);

    if (!req.user || !req.user.isActive) {
      return res.status(401).json({ success: false, message: 'Account not found or inactive' });
    }

    // A password change/reset invalidates every token issued before it.
    // jwt.sign always stamps `iat` (seconds since epoch) unless told not to,
    // so no change to token creation was needed to support this check —
    // mirrors authMiddleware.js's `protect` (Admin) exactly.
    if (req.user.passwordChangedAt && decoded.iat * 1000 < req.user.passwordChangedAt.getTime()) {
      return res.status(401).json({ success: false, message: 'Session expired — please log in again' });
    }

    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Token invalid or expired' });
  }
};

module.exports = { protectUser };

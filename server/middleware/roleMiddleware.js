const allowRoles = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.admin.role)) {
      return res.status(403).json({
        success: false,
        message: `Access denied — requires role: ${roles.join(' or ')}`,
      });
    }
    next();
  };
};

module.exports = { allowRoles };

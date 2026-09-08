const express = require('express');
const router = express.Router();
const { register, login, getMe } = require('../controllers/userAuthController');
const { protectUser } = require('../middleware/userAuthMiddleware');

// Public
router.post('/register', register);
router.post('/login',    login);

// Protected (mobile app user must be logged in)
router.get('/me', protectUser, getMe);

module.exports = router;

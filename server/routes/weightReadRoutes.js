// POST /api/weight-read - read the weight on a weighing-machine display photo.
//
// The mobile app's Capture Photo flow sends the photo here (field `photo`,
// JPEG/PNG/WebP, up to 8 MB); the server asks the vision model and answers
//   200 {success: true, status: 'ok', value: '1.70', unit: 'kg' | 'g' | null, display_text, model, ms}
//   200 {success: true, status: 'unclear', value: null, unit: null, display_text, reason, model, ms}
//   400 / 413 bad or missing photo, 401 not logged in, 429 too many requests,
//   502 / 504 the model could not be reached, 503 not configured.
// Nothing is stored: the photo stays in memory for this request only, and no
// weight is saved here - the app shows the reading for the user to confirm.
const express = require('express');
const multer = require('multer');
const { rateLimit } = require('express-rate-limit');
const { protectUser } = require('../middleware/userAuthMiddleware');
const { readWeightImage, WeightReadError } = require('../utils/qwenWeightReader');

const router = express.Router();

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED.includes(file.mimetype)) return cb(null, true);
    req.weightPhotoRejectReason = 'Only JPEG, PNG or WebP photos can be read.';
    return cb(null, false);
  },
});

// Each reading is a paid model call: per operator, generous for real use.
const weightReadLimiter = rateLimit({
  standardHeaders: true,
  legacyHeaders: false,
  windowMs: 60 * 1000,
  limit: 15,
  keyGenerator: (req) => String(req.user._id),
  handler: (_req, res) => res.status(429).json({
    success: false,
    code: 'RATE_LIMITED',
    message: 'Too many readings in a short time. Please wait a moment and try again.',
  }),
});

// multer's own errors (file too large, unexpected field) as the API's JSON errors
function receivePhoto(req, res, next) {
  upload.single('photo')(req, res, (err) => {
    if (!err) return next();
    const tooBig = err.code === 'LIMIT_FILE_SIZE';
    return res.status(tooBig ? 413 : 400).json({
      success: false,
      code: tooBig ? 'PHOTO_TOO_LARGE' : 'BAD_PHOTO',
      message: tooBig ? 'The photo is too large. Please retake it.' : 'The photo could not be received.',
    });
  });
}

router.post('/', protectUser, weightReadLimiter, receivePhoto, async (req, res) => {
  if (!req.file || !req.file.buffer || !req.file.buffer.length) {
    return res.status(400).json({
      success: false,
      code: 'NO_PHOTO',
      message: req.weightPhotoRejectReason || 'No photo was received.',
    });
  }
  const t0 = Date.now();
  try {
    const reading = await readWeightImage(req.file.buffer, req.file.mimetype === 'image/jpg' ? 'image/jpeg' : req.file.mimetype);
    const ms = Date.now() - t0;
    // Logged: outcome and timing only - never the photo or the key.
    console.log(`[weight-read] user=${req.user._id} status=${reading.status} ${reading.status === 'ok' ? `value=${reading.value}${reading.unit || ''}` : `reason=${reading.reason}`} ${ms}ms`);
    return res.json({ success: true, ...reading, ms });
  } catch (err) {
    if (err instanceof WeightReadError) {
      console.warn(`[weight-read] user=${req.user._id} ${err.code} ${Date.now() - t0}ms`);
      return res.status(err.status).json({ success: false, code: err.code, message: err.message });
    }
    console.error('[weight-read] unexpected error:', err && err.message);
    return res.status(500).json({ success: false, code: 'WEIGHT_READ_FAILED', message: 'The weight could not be read. Please try again.' });
  }
});

module.exports = router;

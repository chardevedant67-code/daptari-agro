const express = require('express');
const router = express.Router();
const { streamQrFile } = require('../utils/qrStorage');

const OBJECT_ID_RE = /^[a-f\d]{24}$/i;

// GET /api/qr/:fileId — public, read-only PNG stream from the dedicated
// 'qr' GridFS bucket. Mirrors the previous /uploads/qr static file's public,
// unauthenticated behavior (Admin/scan consumers never sent auth headers for
// the QR image itself) — only the storage backend changed.
router.get('/:fileId', async (req, res) => {
  const { fileId } = req.params;
  if (!OBJECT_ID_RE.test(fileId)) {
    return res.status(400).json({ success: false, message: 'Invalid QR id' });
  }

  try {
    const stream = await streamQrFile(fileId);
    if (!stream) {
      return res.status(404).json({ success: false, message: 'QR not found' });
    }
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    stream.on('error', () => {
      if (!res.headersSent) res.status(404).json({ success: false, message: 'QR not found' });
    });
    stream.pipe(res);
  } catch (_err) {
    res.status(500).json({ success: false, message: 'Could not load QR' });
  }
});

module.exports = router;

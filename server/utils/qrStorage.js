const mongoose = require('mongoose');

const BUCKET_NAME = 'qr';
const OBJECT_ID_RE = /^[a-f\d]{24}$/i;

let _bucket = null;

// Lazily created once the mongoose connection is open. Every other
// model/query in this codebase already assumes an open connection at
// request time, so no extra readiness check is added here either.
function getQrBucket() {
  if (!_bucket) {
    _bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: BUCKET_NAME });
  }
  return _bucket;
}

// Uploads a QR PNG buffer to the dedicated 'qr' GridFS bucket under a
// deterministic filename. Any existing file with the same filename is
// removed first so re-running generation for the same id never accumulates
// orphan files (idempotent, duplicate-safe).
async function uploadQrPng(buffer, filename, metadata = {}) {
  const bucket = getQrBucket();

  const existing = await bucket.find({ filename }).toArray();
  await Promise.all(existing.map(f => bucket.delete(f._id).catch(() => {})));

  return new Promise((resolve, reject) => {
    const uploadStream = bucket.openUploadStream(filename, {
      contentType: 'image/png',
      metadata: { ...metadata, type: 'qr' },
    });
    uploadStream.on('error', reject);
    uploadStream.on('finish', () => resolve(String(uploadStream.id)));
    uploadStream.end(buffer);
  });
}

// Returns a readable download stream for fileId, or null if it isn't a
// valid id / doesn't exist in the qr bucket — never touches any other bucket.
async function streamQrFile(fileId) {
  if (!OBJECT_ID_RE.test(fileId)) return null;
  const bucket = getQrBucket();
  const _id = new mongoose.Types.ObjectId(fileId);
  const files = await bucket.find({ _id }).toArray();
  if (!files.length) return null;
  return bucket.openDownloadStream(_id);
}

// Best-effort cleanup for a partially-completed operation (e.g. one QR in a
// batch uploaded successfully but a sibling upload or the DB write failed).
async function deleteQrFile(fileId) {
  try {
    await getQrBucket().delete(new mongoose.Types.ObjectId(fileId));
  } catch (_err) {
    // Nothing more we can safely do — this is best-effort orphan avoidance,
    // the caller's own error is what actually surfaces the failure.
  }
}

module.exports = { uploadQrPng, streamQrFile, deleteQrFile, getQrBucket };

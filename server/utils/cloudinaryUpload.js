const { cloudinary, isCloudinaryConfigured } = require('../config/cloudinary');

// Fixed signed/server-side upload preset for all seed packet photos.
const UPLOAD_PRESET = 'seed_passport';

/**
 * Uploads a seed packet photo (already saved to local disk by multer) to
 * Cloudinary under seed-passport/<phase>/<uniqueId>/, server-side, using
 * the API secret from .env — never exposed to the client.
 *
 * Returns the Cloudinary secure_url, or null if Cloudinary isn't
 * configured yet or the caller didn't supply a valid uniqueId + phase
 * (before/after). Callers must treat null as "keep using the existing
 * local file" rather than an error.
 */
async function uploadSeedPacketPhoto(localFilePath, { uniqueId, phase } = {}) {
  if (!isCloudinaryConfigured()) return null;
  if (!uniqueId) return null;
  if (phase !== 'before' && phase !== 'after') return null;

  const result = await cloudinary.uploader.upload(localFilePath, {
    folder: `seed-passport/${phase}/${uniqueId}`,
    upload_preset: UPLOAD_PRESET,
  });

  return result.secure_url;
}

module.exports = { uploadSeedPacketPhoto, UPLOAD_PRESET };

const cloudinary = require('cloudinary').v2;

// Cloudinary is optional until real credentials are provided — every field
// is empty in .env for now. Callers must check isCloudinaryConfigured()
// before attempting an upload; nothing here throws just because the
// credentials are missing.
const isCloudinaryConfigured = () => Boolean(
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
);

if (isCloudinaryConfigured()) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure:     true,
  });
}

module.exports = { cloudinary, isCloudinaryConfigured };

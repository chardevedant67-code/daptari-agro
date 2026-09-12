// Central place for turning an unexpected (non-validation) error into a
// safe client response. The real error — including its stack — is always
// logged server-side only; the client only ever sees a generic message, so
// MongoDB/Cloudinary/filesystem/driver internals never leak in a response.
// This is deliberately NOT for intentional, curated 4xx messages (e.g.
// "Email already registered", "Invalid email or password") — those already
// say nothing unsafe and are untouched everywhere they exist.

function logServerError(context, err) {
  console.error(`[${context}]`, err);
}

function sendServerError(res, err, context) {
  logServerError(context, err);
  return res.status(500).json({ success: false, message: 'Internal server error' });
}

module.exports = { logServerError, sendServerError };

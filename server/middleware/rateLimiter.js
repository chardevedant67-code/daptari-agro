const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

// Shared 429 shape across every limiter here, matching the project's
// existing { success, message, code } error convention used throughout the
// rest of the API (see sessionRoutes.js's PACKET_ALREADY_FILLED/
// SESSION_FORBIDDEN, etc.).
function rateLimitHandler(_req, res) {
  res.status(429).json({
    success: false,
    code: 'RATE_LIMITED',
    message: 'Too many requests. Please try again later.',
  });
}

// standardHeaders is what actually makes express-rate-limit set the
// Retry-After header on a 429 (it does so only when standardHeaders or
// legacyHeaders is on) — legacyHeaders is left off since standardHeaders
// alone is sufficient. Both skip* flags are left false explicitly (not just
// by omission) so every attempt — successful or failed — counts toward its
// limit, which matters most for the login limiters below.
const BASE = {
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  skipFailedRequests: false,
  handler: rateLimitHandler,
};

// A) POST /api/auth/login — Admin login. Keyed by IP: an Admin logs in from
// a handful of places, so IP alone is a standard brute-force threshold.
const adminLoginLimiter = rateLimit({
  ...BASE,
  windowMs: 15 * 60 * 1000,
  limit: 10,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
});

// B) POST /api/user/login — Mobile User login. Keyed by IP + normalized
// email, not IP alone: this project's own CORS config already documents
// many field devices sharing one LAN/gateway IP (192.168.x.x/10.x.x.x are
// trusted as whole ranges), so an IP-only limit would let one bad login on
// one device lock out every other operator on the same WiFi. Email is
// trimmed + lowercased before use; the password is never read here.
function normalizedEmailKey(req) {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  // A malformed/missing email is still a request the limiter must handle
  // without crashing — falls back to an IP-only bucket for that case.
  return email ? `${ipKeyGenerator(req.ip)}:${email}` : ipKeyGenerator(req.ip);
}
const userLoginLimiter = rateLimit({
  ...BASE,
  windowMs: 15 * 60 * 1000,
  limit: 10,
  keyGenerator: normalizedEmailKey,
});

// C) POST /api/user/register — keyed by IP. Registration is rare/one-time
// per operator, so a stricter ceiling guards against spam/enumeration.
const userRegisterLimiter = rateLimit({
  ...BASE,
  windowMs: 60 * 60 * 1000,
  limit: 5,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
});

// D) POST /api/sessions — session creation. Keyed by the authenticated
// User's own id, never IP — a shared kiosk/LAN IP must not throttle one
// operator's real usage. Requires `protectUser` to run first (see
// sessionRoutes.js) so `req.user` exists; an Admin token is never accepted
// there at all, so an Admin id can never end up as this key.
const sessionCreateLimiter = rateLimit({
  ...BASE,
  windowMs: 60 * 1000,
  limit: 30,
  keyGenerator: (req) => String(req.user._id),
});

// E) The five session-mutation routes (photo / before-weight / after-weight
// / link / cancel) share this ONE limiter instance — and therefore one
// shared 60-per-minute budget across the whole group, not 60/minute per
// individual route. Same key strategy as D.
const sessionMutationLimiter = rateLimit({
  ...BASE,
  windowMs: 60 * 1000,
  limit: 60,
  keyGenerator: (req) => String(req.user._id),
});

// F) POST /api/auth/forgot-password — Admin password-reset request (Step
// 9B). Two limiters run in sequence: this one is keyed by normalized email
// (same helper as userLoginLimiter) so one targeted email can't be flooded
// from many IPs...
const forgotPasswordEmailLimiter = rateLimit({
  ...BASE,
  windowMs: 60 * 60 * 1000,
  limit: 5,
  keyGenerator: normalizedEmailKey,
});

// ...and this one is a coarser IP ceiling so one source can't sweep through
// many different email addresses either.
const forgotPasswordIpLimiter = rateLimit({
  ...BASE,
  windowMs: 60 * 60 * 1000,
  limit: 20,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
});

// G) POST /api/auth/reset-password — Admin reset-token consumption. Keyed
// by IP only: the token itself (256 bits of randomness) is the real secret
// here, not the requester's email, so this just blunts raw guessing volume
// — matches adminLoginLimiter's shape.
const resetPasswordLimiter = rateLimit({
  ...BASE,
  windowMs: 15 * 60 * 1000,
  limit: 10,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
});

module.exports = {
  adminLoginLimiter,
  userLoginLimiter,
  userRegisterLimiter,
  sessionCreateLimiter,
  sessionMutationLimiter,
  forgotPasswordEmailLimiter,
  forgotPasswordIpLimiter,
  resetPasswordLimiter,
};

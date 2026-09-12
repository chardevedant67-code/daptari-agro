// Fails fast with a clear, unambiguous error if a required environment
// variable is missing — used by one-off bootstrap/reset scripts so a
// missing credential aborts before any MongoDB connection is attempted,
// instead of silently falling back to a hardcoded default. Pure function,
// no side effects — safe to require/test in isolation.
function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

module.exports = { requireEnv };

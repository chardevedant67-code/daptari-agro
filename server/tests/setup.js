// Loaded first by every test file (require('./setup') at the top). Sets
// safe, fake, test-only environment values BEFORE any production module is
// required — none of these ever touch the real server/.env file, and no
// test in this suite calls dotenv.config() or connects to a real database.
// Individual tests that spawn server.js as a child process (startupReadiness)
// pass their own explicit env overrides on top of this and never rely on
// `delete` (which would let dotenv silently backfill real secrets from disk
// inside that child) — see the comment in that file for why.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-not-real';
process.env.NODE_ENV = 'test';

module.exports = {};

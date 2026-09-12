require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const mongoose = require('mongoose');
const connectDB = require('./config/db');
const { requireEnv } = require('./utils/requireEnv');
const app = express();

// Fail fast if JWT_SECRET is missing: without this, the server would still
// boot and pass health checks, but every login/auth request would throw the
// moment jwt.sign()/jwt.verify() is actually called (see authController.js,
// userAuthController.js, authMiddleware.js, userAuthMiddleware.js). Checked
// before connectDB() so a misconfigured deploy never even opens a DB
// connection.
requireEnv('JWT_SECRET');
// Same reasoning as JWT_SECRET above — without this, mongoose.connect()
// would still be attempted with `undefined`, surfacing as an opaque driver
// parse error instead of a clear, immediate startup failure.
requireEnv('MONGO_URI');

// Render sits its own reverse proxy in front of this service — without this,
// req.ip would resolve to that proxy's address for every request, making
// any IP-based rate limiting either non-functional or a single shared
// bucket for all traffic. Must be set before any middleware reads req.ip.
app.set('trust proxy', 1);

// Custom URL rewriting and logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} - Origin: ${req.get('origin') || 'no-origin'} - Agent: ${req.get('user-agent')}`);
  if (req.originalUrl === '/api%20/health') {
    req.url = '/api/health';
  }
  next();
});


// Captured (not fire-and-forget) so app.listen() below can wait for a
// confirmed connection before accepting any HTTP traffic — previously the
// server could start accepting requests before Mongo was actually
// connected. connectDB() itself still process.exit(1)s on failure
// (unchanged), so this promise only ever resolves on success.
const dbReady = connectDB();

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
  : [];

// The localhost/192.168.x.x/10.x.x.x auto-trust below is a development
// convenience only — it must never apply in production, where a browser
// origin may be accepted ONLY via an explicit, exact match in
// ALLOWED_ORIGINS. Native mobile/server-to-server requests send no Origin
// header at all (`!origin`) and are unaffected by this either way.
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

app.use(cors({
  origin: (origin, callback) => {
    if (
      !origin ||
      ALLOWED_ORIGINS.includes(origin) ||
      (!IS_PRODUCTION && (
        /^https?:\/\/localhost:\d+$/.test(origin) ||
        /^http:\/\/192\.168\.\d+\.\d+:\d+$/.test(origin) ||
        /^http:\/\/10\.\d+\.\d+\.\d+:\d+$/.test(origin)
      ))
    ) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));
app.use(express.json());
app.use(morgan('dev'));


app.use('/uploads', express.static(path.join(__dirname, 'uploads')));


app.use('/api/auth',      require('./routes/authRoutes'));
app.use('/api/user',      require('./routes/userRoutes'));
app.use('/api/admin',     require('./routes/adminRoutes'));
app.use('/api/products',  require('./routes/productRoutes'));
app.use('/api/machines',  require('./routes/machineRoutes'));
app.use('/api/records',   require('./routes/recordRoutes'));
app.use('/api/dashboard', require('./routes/dashboardRoutes'));
app.use('/api/batches',   require('./routes/batchRoutes'));
app.use('/api/sessions',  require('./routes/sessionRoutes'));
app.use('/api/packets',   require('./routes/packetRoutes'));
app.use('/api/qr',        require('./routes/qrRoutes'));
app.use('/p',             require('./routes/scanRoutes'));
app.use('/scan',          require('./routes/publicScanRoutes'));

app.get('/api/health', (req, res) => {
  console.log(`Health check route hit for: ${req.originalUrl}`);
  res.json({ success: true, status: 'ok', version: '1.0.0' });
});

// Separate, additive readiness probe — /api/health above is intentionally
// left unchanged (liveness only: "the Node process is up") since existing
// consumers depend on that exact contract. This one actually reflects
// MongoDB connection state (1 = connected), for anything — e.g. Render's
// healthCheckPath — that needs to know the backend can truly serve
// DB-backed requests, not just that the process is running. Public,
// unauthenticated, no internals exposed on either branch.
app.get('/api/ready', (req, res) => {
  const dbConnected = mongoose.connection.readyState === 1;
  if (dbConnected) {
    return res.json({ success: true, status: 'ready', db: 'connected' });
  }
  return res.status(503).json({ success: false, status: 'not_ready', db: 'disconnected' });
});



app.get('/', (req, res) => {
  res.json({ success: true, message: ' INDUSCORE API is running', version: '1.0.0' });
});


app.use((req, res) => {
  console.log(`404 Not Found: ${req.originalUrl}`);
  res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found` });
});


app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

const PORT = process.env.PORT || 5000;
const HOST = '0.0.0.0';

let httpServer;

// Only start accepting HTTP traffic once MongoDB is actually connected —
// see the `dbReady` comment above. connectDB() already process.exit(1)s on
// its own failure, so nothing here needs a .catch(); this only ever runs
// after a confirmed successful connection.
dbReady.then(() => {
  httpServer = app.listen(PORT, HOST, () => {
    console.log(` Server running on http://localhost:${PORT}`);
    console.log(` Phone scan URL: http://${process.env.SERVER_IP || 'localhost'}:${PORT}/p/{productId}`);
  });
});

// Graceful shutdown for Render restarts/redeploys (SIGTERM) and local
// Ctrl+C (SIGINT): stop accepting new connections, let in-flight requests
// finish, close the MongoDB connection cleanly, then exit. A short forced-
// exit timer guards against something hanging indefinitely.
let shuttingDown = false;
function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received — shutting down gracefully...`);

  const forceExitTimer = setTimeout(() => {
    console.error('Graceful shutdown timed out — forcing exit.');
    process.exit(1);
  }, 10000);
  forceExitTimer.unref();

  const closeServer = httpServer
    ? new Promise((resolve) => httpServer.close(resolve))
    : Promise.resolve();

  closeServer
    .then(() => mongoose.connection.close())
    .then(() => {
      console.log('Shutdown complete.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Error during shutdown:', err.message);
      process.exit(1);
    });
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Never continue running in a corrupted/unknown state — log clearly (never
// secrets, never req/res bodies, just the error itself) and exit so Render
// restarts the process fresh. This matches Node's own safe default for
// both cases; the explicit handlers just give a clearer, grep-able log
// line before that exit instead of relying on Node's raw default output.
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled Rejection:', reason);
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught Exception:', err);
  process.exit(1);
});

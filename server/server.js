require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
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


connectDB();

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
app.listen(PORT, HOST, () => {
  console.log(` Server running on http://localhost:${PORT}`);
  console.log(` Phone scan URL: http://${process.env.SERVER_IP || 'localhost'}:${PORT}/p/{productId}`);

});

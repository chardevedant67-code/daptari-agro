require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const connectDB = require('./config/db');
const app = express();

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
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : [];

app.use(cors({
  origin: (origin, callback) => {
    if (
      !origin ||
      ALLOWED_ORIGINS.includes(origin) ||
      /^https?:\/\/localhost:\d+$/.test(origin) ||
      /^http:\/\/192\.168\.\d+\.\d+:\d+$/.test(origin) ||
      /^http:\/\/10\.\d+\.\d+\.\d+:\d+$/.test(origin)
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

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Allow all origins in dev, restrict in production
const allowedOrigins = process.env.CLIENT_URL
  ? process.env.CLIENT_URL.split(',').map(o => o.trim())
  : ['http://localhost:3000', 'http://localhost:4000'];

const io = new Server(server, {
  cors: { origin: '*', credentials: false },
  pingTimeout: 60000,
});

app.set('io', io);

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: '*', credentials: false }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
if (process.env.NODE_ENV !== 'production') app.use(morgan('dev'));

// Rate limiting
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, max: 50, message: { error: 'Too many requests' } }));
app.use('/api', rateLimit({ windowMs: 1 * 60 * 1000, max: 300, message: { error: 'Too many requests' } }));

// Analytics middleware
const { trackView, cleanSessions } = require('./middleware/analytics');
app.use(trackView);
// Clean stale sessions every 2 minutes
setInterval(cleanSessions, 2 * 60 * 1000);

// Static files
app.use(express.static(path.join(__dirname, '../public')));
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/posts', require('./routes/posts'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/tags', require('./routes/tags'));
app.use('/api/search', require('./routes/search'));
app.use('/api/attachments', require('./routes/attachments'));
app.use('/api/friends', require('./routes/friends'));
app.use('/api/roles', require('./routes/roles'));
app.use('/api/admin', require('./routes/admin'));
app.use('/', require('./routes/pages'));

// ─── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// ─── SPA fallback ──────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ─── Error handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  if (err.code === '23505') return res.status(409).json({ error: 'Already exists' });
  if (err.code === '23503') return res.status(400).json({ error: 'Referenced record not found' });
  res.status(err.status || 500).json({ error: process.env.NODE_ENV === 'development' ? err.message : 'Server error' });
});

// ─── Socket.io ─────────────────────────────────────────────────────────────────
require('./socket')(io);

// ─── Start ──────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT) || 4000;
server.listen(PORT, () => {
  console.log('\n🚀 ResearchSocial server running!');
  console.log(`   App:    http://localhost:${PORT}`);
  console.log(`   Admin:  http://localhost:${PORT}/admin`);
  console.log(`   API:    http://localhost:${PORT}/api\n`);
});

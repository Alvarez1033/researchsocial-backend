const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { query } = require('../db/pool');
const { generateTokens, requireAuth } = require('../middleware/auth');

const router = express.Router();

const COLORS = ['#818cf8','#34d399','#f87171','#a78bfa','#fbbf24','#38bdf8','#4ade80','#fb923c','#e879f9','#2dd4bf'];

// POST /api/auth/register
router.post('/register', [
  body('handle').trim().isLength({ min: 3, max: 30 }).matches(/^[a-zA-Z0-9_]+$/).withMessage('Handle must be 3-30 alphanumeric characters'),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('name').trim().isLength({ min: 2, max: 100 }),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { handle, email, password, name, affiliation, title } = req.body;

    // Check uniqueness
    const existing = await query('SELECT id FROM users WHERE handle = $1 OR email = $2', [handle, email]);
    if (existing.rows.length) {
      const conflict = existing.rows[0];
      return res.status(409).json({ error: 'Handle or email already taken' });
    }

    // Check registration allowed
    const setting = await query("SELECT value FROM site_settings WHERE key = 'allow_registration'");
    if (setting.rows.length && setting.rows[0].value === 'false') {
      return res.status(403).json({ error: 'Registration is currently closed' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

    const result = await query(`
      INSERT INTO users (handle, email, password_hash, name, affiliation, title, color, initials)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, handle, name, email, role, status, is_verified, avatar_url, color, initials
    `, [handle, email, passwordHash, name, affiliation || null, title || null, color, initials]);

    const user = result.rows[0];
    const { accessToken, refreshToken } = generateTokens(user.id);

    // Store refresh token
    await query('UPDATE users SET refresh_token = $1 WHERE id = $2', [refreshToken, user.id]);

    res.status(201).json({ user, accessToken, refreshToken });
  } catch (err) { next(err); }
});

// POST /api/auth/login
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, password } = req.body;
    const result = await query('SELECT * FROM users WHERE email = $1', [email]);
    if (!result.rows.length) return res.status(401).json({ error: 'Invalid email or password' });

    const user = result.rows[0];

    if (user.status === 'banned') return res.status(403).json({ error: 'Account banned' });
    if (user.status === 'suspended') return res.status(403).json({ error: 'Account suspended', reason: user.suspension_reason });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

    const { accessToken, refreshToken } = generateTokens(user.id);
    await query('UPDATE users SET refresh_token = $1, last_seen_at = NOW() WHERE id = $2', [refreshToken, user.id]);

    const { password_hash, refresh_token, ...safeUser } = user;
    res.json({ user: safeUser, accessToken, refreshToken });
  } catch (err) { next(err); }
});

// POST /api/auth/refresh
router.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(401).json({ error: 'Refresh token required' });

    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const result = await query('SELECT id, refresh_token, status FROM users WHERE id = $1', [decoded.userId]);
    if (!result.rows.length || result.rows[0].refresh_token !== refreshToken) {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    const user = result.rows[0];
    if (user.status === 'banned' || user.status === 'suspended') {
      return res.status(403).json({ error: 'Account restricted' });
    }

    const tokens = generateTokens(user.id);
    await query('UPDATE users SET refresh_token = $1 WHERE id = $2', [tokens.refreshToken, user.id]);
    res.json(tokens);
  } catch (err) {
    if (err.name === 'TokenExpiredError') return res.status(401).json({ error: 'Refresh token expired, please log in again' });
    next(err);
  }
});

// POST /api/auth/logout
router.post('/logout', requireAuth, async (req, res, next) => {
  try {
    await query('UPDATE users SET refresh_token = NULL WHERE id = $1', [req.user.id]);
    res.json({ message: 'Logged out' });
  } catch (err) { next(err); }
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const result = await query(`
      SELECT id, handle, name, email, bio, title, affiliation, location, website,
             avatar_url, color, initials, role, status, is_verified, open_to_collab,
             interests, followers_count, following_count, papers_count, citations_count,
             last_seen_at, created_at
      FROM users WHERE id = $1
    `, [req.user.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

// POST /api/auth/admin-setup — create first superadmin (requires setup key)
router.post('/admin-setup', async (req, res, next) => {
  try {
    const { setupKey, handle, email, password, name } = req.body;
    if (setupKey !== process.env.ADMIN_SETUP_KEY) return res.status(403).json({ error: 'Invalid setup key' });

    const existing = await query("SELECT id FROM users WHERE role = 'superadmin'");
    if (existing.rows.length) return res.status(409).json({ error: 'Superadmin already exists' });

    const passwordHash = await bcrypt.hash(password, 12);
    const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

    const result = await query(`
      INSERT INTO users (handle, email, password_hash, name, color, initials, role, is_verified, email_verified)
      VALUES ($1, $2, $3, $4, '#818cf8', $5, 'superadmin', true, true)
      RETURNING id, handle, name, email, role
    `, [handle, email, passwordHash, name, initials]);

    res.status(201).json({ message: 'Superadmin created', user: result.rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;

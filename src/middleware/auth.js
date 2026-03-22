const jwt = require('jsonwebtoken');
const { query } = require('../db/pool');
const { hasPermission, roleLevel } = require('../config/roles');

// Verify JWT from Authorization header or cookie
async function requireAuth(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) return res.status(401).json({ error: 'Authentication required' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const result = await query(
      'SELECT id, handle, name, email, role, status, is_verified, avatar_url, color, initials, timeout_until FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (!result.rows.length) return res.status(401).json({ error: 'User not found' });

    const user = result.rows[0];

    // Check user status
    if (user.status === 'banned' || user.status === 'suspended') {
      return res.status(403).json({ error: 'Account suspended', reason: 'Your account has been suspended. Contact support.' });
    }
    if (user.status === 'timed_out' && user.timeout_until && new Date(user.timeout_until) > new Date()) {
      return res.status(403).json({ error: 'Account timed out', until: user.timeout_until });
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') return res.status(401).json({ error: 'Token expired' });
    if (err.name === 'JsonWebTokenError') return res.status(401).json({ error: 'Invalid token' });
    next(err);
  }
}

// Optional auth — attaches user if token present, but doesn't block
async function optionalAuth(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) return next();
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const result = await query('SELECT id, handle, name, role, status, avatar_url, color, initials FROM users WHERE id = $1', [decoded.userId]);
    if (result.rows.length) req.user = result.rows[0];
  } catch (_) {}
  next();
}

// Role guards — now use permission-based system
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

// Permission-based guards
function requirePerm(permission) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (!hasPermission(req.user.role, permission)) {
      return res.status(403).json({ error: 'Insufficient permissions', required: permission });
    }
    next();
  };
}

// Legacy level-based guards (kept for compatibility)
const requireMod = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  if (!hasPermission(req.user.role, 'admin.moderation')) return res.status(403).json({ error: 'Moderator access required' });
  next();
};
const requireAdmin = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  if (!hasPermission(req.user.role, 'admin.settings')) return res.status(403).json({ error: 'Admin access required' });
  next();
};
const requireSuperAdmin = requireRole('superadmin');
const requireSupport = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  if (!hasPermission(req.user.role, 'admin.access')) return res.status(403).json({ error: 'Staff access required' });
  next();
};

function extractToken(req) {
  if (req.headers.authorization?.startsWith('Bearer ')) {
    return req.headers.authorization.slice(7);
  }
  if (req.cookies?.access_token) return req.cookies.access_token;
  return null;
}

function generateTokens(userId) {
  const accessToken = jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '15m'
  });
  const refreshToken = jwt.sign({ userId }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d'
  });
  return { accessToken, refreshToken };
}

module.exports = { requireAuth, optionalAuth, requireRole, requirePerm, requireMod, requireAdmin, requireSuperAdmin, requireSupport, generateTokens, extractToken };

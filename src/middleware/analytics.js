const crypto = require('crypto');
const { query } = require('../db/pool');

// Track every page view automatically
async function trackView(req, res, next) {
  // Only track non-API, non-static requests
  if (req.path.startsWith('/api') || req.path.startsWith('/uploads') || req.path.match(/\.(js|css|png|ico|svg|jpg|woff)$/)) {
    return next();
  }

  try {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    const ipHash = crypto.createHash('sha256').update(ip + process.env.JWT_SECRET).digest('hex').slice(0, 32);
    const sessionId = req.cookies?.rs_session || null;
    const userId = req.user?.id || null;

    // Fire and forget — don't block the request
    query(
      `INSERT INTO page_views (path, user_id, session_id, ip_hash, referrer, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [req.path, userId, sessionId, ipHash, req.headers.referer || null, req.headers['user-agent']?.slice(0, 200) || null]
    ).catch(() => {}); // silently ignore analytics errors
  } catch (_) {}

  next();
}

// Update active session (called by Socket.io on connect/heartbeat)
async function updateSession(sessionId, userId, path) {
  if (!sessionId) return;
  try {
    await query(`
      INSERT INTO active_sessions (session_id, user_id, path, last_seen)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (session_id) DO UPDATE SET last_seen = NOW(), path = $3, user_id = COALESCE($2, active_sessions.user_id)
    `, [sessionId, userId || null, path || '/']);
  } catch (_) {}
}

// Clean up stale sessions (older than 5 minutes = offline)
async function cleanSessions() {
  try {
    await query("DELETE FROM active_sessions WHERE last_seen < NOW() - INTERVAL '5 minutes'");
  } catch (_) {}
}

// Get analytics summary for admin dashboard
async function getAnalyticsSummary() {
  try {
    const [views, uniq, online, topPages, dailyViews] = await Promise.all([
      query("SELECT COUNT(*) FROM page_views WHERE created_at > NOW() - INTERVAL '24h'"),
      query("SELECT COUNT(DISTINCT ip_hash) FROM page_views WHERE created_at > NOW() - INTERVAL '24h'"),
      query("SELECT COUNT(*) FROM active_sessions WHERE last_seen > NOW() - INTERVAL '5 minutes'"),
      query(`
        SELECT path, COUNT(*) as views
        FROM page_views
        WHERE created_at > NOW() - INTERVAL '7d'
        GROUP BY path ORDER BY views DESC LIMIT 10
      `),
      query(`
        SELECT DATE(created_at) as date, COUNT(*) as views, COUNT(DISTINCT ip_hash) as unique_visitors
        FROM page_views
        WHERE created_at > NOW() - INTERVAL '30d'
        GROUP BY DATE(created_at) ORDER BY date ASC
      `)
    ]);

    return {
      views_24h: parseInt(views.rows[0].count),
      unique_visitors_24h: parseInt(uniq.rows[0].count),
      online_now: parseInt(online.rows[0].count),
      top_pages: topPages.rows,
      daily_views: dailyViews.rows,
    };
  } catch (err) {
    return { views_24h: 0, unique_visitors_24h: 0, online_now: 0, top_pages: [], daily_views: [] };
  }
}

module.exports = { trackView, updateSession, cleanSessions, getAnalyticsSummary };

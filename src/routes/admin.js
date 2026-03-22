const express = require('express');
const { query } = require('../db/pool');
const { requireAuth, requireMod, requireAdmin } = require('../middleware/auth');
const { getAnalyticsSummary } = require('../middleware/analytics');

const router = express.Router();

// All admin routes require auth + mod role minimum
router.use(requireAuth, requireMod);

// ─── DASHBOARD STATS ─────────────────────────────────────────────────────────
router.get('/stats', async (req, res, next) => {
  try {
    const [users, posts, messages, pending, reports] = await Promise.all([
      query("SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24h') as today, COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7d') as week FROM users"),
      query("SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status = 'pending') as pending, COUNT(*) FILTER (WHERE status = 'approved') as approved, COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24h') as today FROM posts"),
      query("SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24h') as today FROM messages"),
      query("SELECT COUNT(*) as count FROM posts WHERE status = 'pending'"),
      query("SELECT COUNT(*) as count FROM users WHERE status IN ('muted', 'timed_out', 'suspended')")
    ]);

    // User growth over last 30 days
    const growth = await query(`
      SELECT DATE(created_at) as date, COUNT(*) as count
      FROM users
      WHERE created_at > NOW() - INTERVAL '30d'
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `);

    // Post engagement over last 30 days
    const postActivity = await query(`
      SELECT DATE(created_at) as date, COUNT(*) as count
      FROM posts WHERE status = 'approved' AND created_at > NOW() - INTERVAL '30d'
      GROUP BY DATE(created_at) ORDER BY date ASC
    `);

    // Top tags
    const topTags = await query(`
      SELECT t.name, t.slug, COUNT(pt.post_id) as count
      FROM tags t LEFT JOIN post_tags pt ON pt.tag_id = t.id
      GROUP BY t.id ORDER BY count DESC LIMIT 10
    `);

    // Most active users
    const topUsers = await query(`
      SELECT u.handle, u.name, u.avatar_url, u.color, u.initials, u.is_verified,
             COUNT(p.id) as post_count,
             COALESCE(SUM(p.likes_count), 0) as total_likes
      FROM users u LEFT JOIN posts p ON p.author_id = u.id AND p.status = 'approved'
      GROUP BY u.id ORDER BY post_count DESC LIMIT 10
    `);

    // Analytics
    const analytics = await getAnalyticsSummary();

    res.json({
      users: users.rows[0],
      posts: posts.rows[0],
      messages: messages.rows[0],
      pending_posts: parseInt(pending.rows[0].count),
      moderated_users: parseInt(reports.rows[0].count),
      user_growth: growth.rows,
      post_activity: postActivity.rows,
      top_tags: topTags.rows,
      top_users: topUsers.rows,
      analytics,
    });
  } catch (err) { next(err); }
});

// ─── USER MANAGEMENT ─────────────────────────────────────────────────────────
router.get('/users', async (req, res, next) => {
  try {
    const { page = 1, limit = 25, search, role, status } = req.query;
    const offset = (page - 1) * limit;
    const params = [];
    const conditions = [];

    if (search) { params.push(`%${search}%`); conditions.push(`(u.name ILIKE $${params.length} OR u.handle ILIKE $${params.length} OR u.email ILIKE $${params.length})`); }
    if (role) { params.push(role); conditions.push(`u.role = $${params.length}`); }
    if (status) { params.push(status); conditions.push(`u.status = $${params.length}`); }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const countRes = await query(`SELECT COUNT(*) FROM users u ${where}`, params);
    params.push(parseInt(limit), offset);

    const result = await query(`
      SELECT u.id, u.handle, u.name, u.email, u.role, u.status, u.is_verified,
             u.avatar_url, u.color, u.initials, u.affiliation, u.timeout_until,
             u.suspension_reason, u.followers_count, u.created_at, u.last_seen_at,
             COUNT(DISTINCT p.id) as post_count
      FROM users u
      LEFT JOIN posts p ON p.author_id = u.id
      ${where}
      GROUP BY u.id
      ORDER BY u.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    res.json({ users: result.rows, total: parseInt(countRes.rows[0].count), page: parseInt(page), pages: Math.ceil(parseInt(countRes.rows[0].count) / limit) });
  } catch (err) { next(err); }
});

// GET /api/admin/users/:id
router.get('/users/:id', async (req, res, next) => {
  try {
    const result = await query(`
      SELECT u.*, COUNT(DISTINCT p.id) as post_count,
             COUNT(DISTINCT m.id) as message_count
      FROM users u
      LEFT JOIN posts p ON p.author_id = u.id
      LEFT JOIN messages m ON m.sender_id = u.id
      WHERE u.id = $1
      GROUP BY u.id
    `, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'User not found' });

    const logs = await query('SELECT * FROM moderation_log WHERE target_id = $1 ORDER BY created_at DESC LIMIT 20', [req.params.id]);
    res.json({ ...result.rows[0], moderation_history: logs.rows });
  } catch (err) { next(err); }
});

// POST /api/admin/users/:id/moderate
router.post('/users/:id/moderate', requireAdmin, async (req, res, next) => {
  try {
    const { action, reason, duration_hours } = req.body;
    const validActions = ['mute', 'unmute', 'timeout', 'suspend', 'unsuspend', 'ban', 'unban', 'verify', 'unverify', 'set_role'];
    if (!validActions.includes(action)) return res.status(400).json({ error: 'Invalid action' });

    const target = await query('SELECT id, handle, role FROM users WHERE id = $1', [req.params.id]);
    if (!target.rows.length) return res.status(404).json({ error: 'User not found' });

    // Prevent modifying higher-ranked users
    const roleRank = { user: 0, moderator: 1, admin: 2, superadmin: 3 };
    if (roleRank[target.rows[0].role] >= roleRank[req.user.role]) {
      return res.status(403).json({ error: 'Cannot moderate a user with equal or higher role' });
    }

    let updateSql, updateParams;
    switch (action) {
      case 'mute':
        updateSql = "UPDATE users SET status = 'muted' WHERE id = $1";
        updateParams = [req.params.id]; break;
      case 'unmute':
        updateSql = "UPDATE users SET status = 'active' WHERE id = $1";
        updateParams = [req.params.id]; break;
      case 'timeout':
        const until = new Date(Date.now() + (duration_hours || 24) * 3600000);
        updateSql = "UPDATE users SET status = 'timed_out', timeout_until = $2 WHERE id = $1";
        updateParams = [req.params.id, until]; break;
      case 'suspend':
        updateSql = "UPDATE users SET status = 'suspended', suspension_reason = $2 WHERE id = $1";
        updateParams = [req.params.id, reason || 'Suspended by admin']; break;
      case 'unsuspend':
        updateSql = "UPDATE users SET status = 'active', suspension_reason = NULL WHERE id = $1";
        updateParams = [req.params.id]; break;
      case 'ban':
        updateSql = "UPDATE users SET status = 'banned', suspension_reason = $2 WHERE id = $1";
        updateParams = [req.params.id, reason || 'Banned']; break;
      case 'unban':
        updateSql = "UPDATE users SET status = 'active', suspension_reason = NULL WHERE id = $1";
        updateParams = [req.params.id]; break;
      case 'verify':
        updateSql = "UPDATE users SET is_verified = true WHERE id = $1";
        updateParams = [req.params.id]; break;
      case 'unverify':
        updateSql = "UPDATE users SET is_verified = false WHERE id = $1";
        updateParams = [req.params.id]; break;
      case 'set_role':
        const { new_role } = req.body;
        if (!['user','moderator','admin'].includes(new_role)) return res.status(400).json({ error: 'Invalid role' });
        updateSql = "UPDATE users SET role = $2 WHERE id = $1";
        updateParams = [req.params.id, new_role]; break;
    }

    await query(updateSql, updateParams);
    await query('INSERT INTO moderation_log (admin_id, target_type, target_id, action, reason) VALUES ($1, $2, $3, $4, $5)',
      [req.user.id, 'user', req.params.id, action, reason || null]);

    res.json({ success: true, action });
  } catch (err) { next(err); }
});

// ─── POST MODERATION ─────────────────────────────────────────────────────────
router.get('/posts', async (req, res, next) => {
  try {
    const { page = 1, limit = 25, status, type } = req.query;
    const offset = (page - 1) * limit;
    const params = [];
    const conditions = [];

    if (status) { params.push(status); conditions.push(`p.status = $${params.length}`); }
    if (type) { params.push(type); conditions.push(`p.type = $${params.length}`); }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const countRes = await query(`SELECT COUNT(*) FROM posts p ${where}`, params);
    params.push(parseInt(limit), offset);

    const result = await query(`
      SELECT p.id, p.title, p.type, p.status, p.likes_count, p.comments_count,
             p.is_pinned, p.is_featured, p.moderation_note, p.created_at,
             u.handle as author_handle, u.name as author_name, u.avatar_url as author_avatar,
             u.color as author_color, u.initials as author_initials
      FROM posts p JOIN users u ON u.id = p.author_id
      ${where}
      ORDER BY p.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    res.json({ posts: result.rows, total: parseInt(countRes.rows[0].count), page: parseInt(page) });
  } catch (err) { next(err); }
});

// POST /api/admin/posts/:id/moderate
router.post('/posts/:id/moderate', async (req, res, next) => {
  try {
    const { action, note } = req.body;
    const validActions = ['approve', 'reject', 'ghost', 'pin', 'unpin', 'feature', 'unfeature'];
    if (!validActions.includes(action)) return res.status(400).json({ error: 'Invalid action' });

    const post = await query('SELECT id, author_id FROM posts WHERE id = $1', [req.params.id]);
    if (!post.rows.length) return res.status(404).json({ error: 'Post not found' });

    let updateSql;
    switch (action) {
      case 'approve':
        updateSql = "UPDATE posts SET status = 'approved', moderated_by = $2, moderated_at = NOW(), moderation_note = $3 WHERE id = $1";
        // Notify author
        await query(`INSERT INTO notifications (user_id, type, title, body, link) VALUES ($1, 'post_approved', 'Your post was approved!', $2, $3)`,
          [post.rows[0].author_id, note || 'Your post is now live.', `/post/${req.params.id}`]);
        break;
      case 'reject':
        updateSql = "UPDATE posts SET status = 'rejected', moderated_by = $2, moderated_at = NOW(), moderation_note = $3 WHERE id = $1";
        await query(`INSERT INTO notifications (user_id, type, title, body, link) VALUES ($1, 'post_rejected', 'Your post was not approved', $2, $3)`,
          [post.rows[0].author_id, note || 'Please review and resubmit.', `/post/${req.params.id}`]);
        break;
      case 'ghost':
        updateSql = "UPDATE posts SET status = 'ghosted', moderated_by = $2, moderated_at = NOW(), moderation_note = $3 WHERE id = $1";
        break;
      case 'pin': updateSql = "UPDATE posts SET is_pinned = true, moderated_by = $2, moderated_at = NOW(), moderation_note = $3 WHERE id = $1"; break;
      case 'unpin': updateSql = "UPDATE posts SET is_pinned = false, moderated_by = $2, moderated_at = NOW(), moderation_note = $3 WHERE id = $1"; break;
      case 'feature': updateSql = "UPDATE posts SET is_featured = true, moderated_by = $2, moderated_at = NOW(), moderation_note = $3 WHERE id = $1"; break;
      case 'unfeature': updateSql = "UPDATE posts SET is_featured = false, moderated_by = $2, moderated_at = NOW(), moderation_note = $3 WHERE id = $1"; break;
    }

    await query(updateSql, [req.params.id, req.user.id, note || null]);
    await query('INSERT INTO moderation_log (admin_id, target_type, target_id, action, reason) VALUES ($1, $2, $3, $4, $5)',
      [req.user.id, 'post', req.params.id, action, note || null]);

    res.json({ success: true, action });
  } catch (err) { next(err); }
});

// ─── TAGS ────────────────────────────────────────────────────────────────────
router.get('/tags', async (req, res, next) => {
  try {
    const result = await query(`
      SELECT t.*, COUNT(pt.post_id) as actual_post_count,
             u.handle as created_by_handle
      FROM tags t
      LEFT JOIN post_tags pt ON pt.tag_id = t.id
      LEFT JOIN users u ON u.id = t.created_by
      GROUP BY t.id, u.handle
      ORDER BY actual_post_count DESC
    `);
    res.json(result.rows);
  } catch (err) { next(err); }
});

router.post('/tags', requireAdmin, async (req, res, next) => {
  try {
    const { name, category, color, description, is_featured } = req.body;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const result = await query(`
      INSERT INTO tags (name, slug, category, color, description, is_featured, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *
    `, [name, slug, category || null, color || '#818cf8', description || null, is_featured || false, req.user.id]);
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
});

router.patch('/tags/:id', requireAdmin, async (req, res, next) => {
  try {
    const { name, category, color, description, is_featured } = req.body;
    const result = await query(`
      UPDATE tags SET name = COALESCE($2, name), category = COALESCE($3, category),
        color = COALESCE($4, color), description = COALESCE($5, description),
        is_featured = COALESCE($6, is_featured)
      WHERE id = $1 RETURNING *
    `, [req.params.id, name, category, color, description, is_featured]);
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

router.delete('/tags/:id', requireAdmin, async (req, res, next) => {
  try {
    await query('DELETE FROM tags WHERE id = $1', [req.params.id]);
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// ─── SITE SETTINGS ───────────────────────────────────────────────────────────
router.get('/settings', requireAdmin, async (req, res, next) => {
  try {
    const result = await query('SELECT * FROM site_settings ORDER BY key');
    res.json(result.rows);
  } catch (err) { next(err); }
});

router.patch('/settings/:key', requireAdmin, async (req, res, next) => {
  try {
    const { value } = req.body;
    const result = await query(`
      INSERT INTO site_settings (key, value, updated_by, updated_at) VALUES ($1, $2, $3, NOW())
      ON CONFLICT (key) DO UPDATE SET value = $2, updated_by = $3, updated_at = NOW()
      RETURNING *
    `, [req.params.key, JSON.stringify(value), req.user.id]);
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

// ─── MODERATION LOG ───────────────────────────────────────────────────────────
router.get('/log', async (req, res, next) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;
    const result = await query(`
      SELECT ml.*, u.handle as admin_handle, u.name as admin_name, u.avatar_url as admin_avatar
      FROM moderation_log ml JOIN users u ON u.id = ml.admin_id
      ORDER BY ml.created_at DESC
      LIMIT $1 OFFSET $2
    `, [parseInt(limit), offset]);
    const count = await query('SELECT COUNT(*) FROM moderation_log');
    res.json({ logs: result.rows, total: parseInt(count.rows[0].count) });
  } catch (err) { next(err); }
});

// ─── ADMIN CHAT ───────────────────────────────────────────────────────────────
router.get('/chat', async (req, res, next) => {
  try {
    const result = await query(`
      SELECT am.*, u.handle, u.name, u.avatar_url, u.color, u.initials, u.role
      FROM admin_messages am JOIN users u ON u.id = am.sender_id
      ORDER BY am.created_at DESC LIMIT 100
    `);
    res.json(result.rows.reverse());
  } catch (err) { next(err); }
});

router.post('/chat', async (req, res, next) => {
  try {
    const { body } = req.body;
    if (!body?.trim()) return res.status(400).json({ error: 'Message required' });
    const result = await query(`
      INSERT INTO admin_messages (sender_id, body) VALUES ($1, $2) RETURNING *
    `, [req.user.id, body.trim()]);
    const msg = { ...result.rows[0], handle: req.user.handle, name: req.user.name, avatar_url: req.user.avatar_url, color: req.user.color, initials: req.user.initials, role: req.user.role };
    req.app.get('io')?.to('admin-chat').emit('admin_message', msg);
    res.status(201).json(msg);
  } catch (err) { next(err); }
});

module.exports = router;

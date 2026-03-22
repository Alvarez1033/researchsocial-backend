const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { query } = require('../db/pool');
const { requireAuth, optionalAuth } = require('../middleware/auth');

const router = express.Router();

// File upload config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(process.cwd(), process.env.UPLOAD_DIR || 'uploads', 'avatars');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `avatar_${req.user.id}_${Date.now()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 5242880 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    cb(null, allowed.test(path.extname(file.originalname).toLowerCase()) && allowed.test(file.mimetype));
  }
});

// ─── GET /api/users — list users (public, paginated) ─────────────────────────
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const { page = 1, limit = 20, search, interests } = req.query;
    const offset = (page - 1) * limit;
    let conditions = ["status != 'banned'"];
    const params = [];

    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(name ILIKE $${params.length} OR handle ILIKE $${params.length} OR affiliation ILIKE $${params.length})`);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const countRes = await query(`SELECT COUNT(*) FROM users ${where}`, params);
    const total = parseInt(countRes.rows[0].count);

    params.push(parseInt(limit), offset);
    const result = await query(`
      SELECT id, handle, name, title, affiliation, avatar_url, color, initials,
             is_verified, open_to_collab, followers_count, interests, role
      FROM users ${where}
      ORDER BY followers_count DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    res.json({ users: result.rows, total, page: parseInt(page), pages: Math.ceil(total / limit) });
  } catch (err) { next(err); }
});

// ─── GET /api/users/me/notifications ─────────────────────────────────────────
// IMPORTANT: ALL /me/* routes MUST come before /:handle
router.get('/me/notifications', requireAuth, async (req, res, next) => {
  try {
    const { unread_only } = req.query;
    let where = 'WHERE n.user_id = $1';
    if (unread_only === 'true') where += ' AND n.is_read = false';

    const result = await query(`
      SELECT n.*, u.handle as actor_handle, u.avatar_url as actor_avatar,
             u.color as actor_color, u.initials as actor_initials
      FROM notifications n
      LEFT JOIN users u ON u.id = n.actor_id
      ${where}
      ORDER BY n.created_at DESC LIMIT 50
    `, [req.user.id]);

    res.json(result.rows);
  } catch (err) { next(err); }
});

// ─── POST /api/users/me/notifications/read ────────────────────────────────────
router.post('/me/notifications/read', requireAuth, async (req, res, next) => {
  try {
    await query('UPDATE notifications SET is_read = true WHERE user_id = $1', [req.user.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── PATCH /api/users/me — update own profile ─────────────────────────────────
router.patch('/me', requireAuth, [
  body('name').optional().trim().isLength({ min: 2, max: 100 }),
  body('bio').optional().trim().isLength({ max: 500 }),
  body('website').optional().isURL().withMessage('Invalid website URL'),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { name, bio, title, affiliation, location, website, interests, open_to_collab } = req.body;
    const fields = [];
    const vals = [];
    let i = 1;

    const add = (field, val) => {
      if (val !== undefined) { fields.push(`${field} = $${i++}`); vals.push(val); }
    };
    add('name', name);
    add('bio', bio);
    add('title', title);
    add('affiliation', affiliation);
    add('location', location);
    add('website', website);
    add('open_to_collab', open_to_collab);
    if (interests !== undefined) { fields.push(`interests = $${i++}`); vals.push(interests); }
    if (name) {
      fields.push(`initials = $${i++}`);
      vals.push(name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase());
    }

    if (!fields.length) return res.status(400).json({ error: 'No fields to update' });
    vals.push(req.user.id);

    const result = await query(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${i}
       RETURNING id, handle, name, bio, title, affiliation, location, website,
                 avatar_url, color, initials, interests, open_to_collab, is_verified`,
      vals
    );
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

// ─── POST /api/users/me/avatar ─────────────────────────────────────────────────
router.post('/me/avatar', requireAuth, upload.single('avatar'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const avatarUrl = `/uploads/avatars/${req.file.filename}`;
    await query('UPDATE users SET avatar_url = $1 WHERE id = $2', [avatarUrl, req.user.id]);
    res.json({ avatarUrl });
  } catch (err) { next(err); }
});

// ─── GET /api/users/:handle ────────────────────────────────────────────────────
// NOTE: This wildcard MUST come after all /me/* routes
router.get('/:handle', optionalAuth, async (req, res, next) => {
  try {
    const result = await query(`
      SELECT id, handle, name, bio, title, affiliation, location, website,
             avatar_url, color, initials, role, is_verified, open_to_collab,
             interests, followers_count, following_count, papers_count,
             citations_count, status, created_at
      FROM users WHERE handle = $1 AND status != 'banned'
    `, [req.params.handle]);

    if (!result.rows.length) return res.status(404).json({ error: 'User not found' });
    const user = result.rows[0];

    // Is the current user following this user?
    if (req.user) {
      const followRes = await query(
        'SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = $2',
        [req.user.id, user.id]
      );
      user.is_following = followRes.rows.length > 0;
    }

    // Get user's posts
    const postsRes = await query(`
      SELECT p.id, p.title, p.excerpt, p.type, p.status, p.likes_count, p.comments_count,
             p.is_pinned, p.is_featured, p.created_at,
             COALESCE(json_agg(DISTINCT jsonb_build_object('name', t.name, 'slug', t.slug, 'color', t.color)) FILTER (WHERE t.id IS NOT NULL), '[]') as tags
      FROM posts p
      LEFT JOIN post_tags pt ON pt.post_id = p.id
      LEFT JOIN tags t ON t.id = pt.tag_id
      WHERE p.author_id = $1 AND p.status = 'approved'
      GROUP BY p.id
      ORDER BY p.created_at DESC
      LIMIT 20
    `, [user.id]);
    user.posts = postsRes.rows;

    res.json(user);
  } catch (err) { next(err); }
});

// ─── POST /api/users/:handle/follow ───────────────────────────────────────────
router.post('/:handle/follow', requireAuth, async (req, res, next) => {
  try {
    const target = await query('SELECT id FROM users WHERE handle = $1', [req.params.handle]);
    if (!target.rows.length) return res.status(404).json({ error: 'User not found' });

    const targetId = target.rows[0].id;
    if (targetId === req.user.id) return res.status(400).json({ error: 'Cannot follow yourself' });

    const existing = await query(
      'SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = $2',
      [req.user.id, targetId]
    );

    if (existing.rows.length) {
      // Unfollow
      await query('DELETE FROM follows WHERE follower_id = $1 AND following_id = $2', [req.user.id, targetId]);
      await query('UPDATE users SET followers_count = GREATEST(0, followers_count - 1) WHERE id = $1', [targetId]);
      await query('UPDATE users SET following_count = GREATEST(0, following_count - 1) WHERE id = $1', [req.user.id]);
      res.json({ following: false });
    } else {
      // Follow
      await query('INSERT INTO follows (follower_id, following_id) VALUES ($1, $2)', [req.user.id, targetId]);
      await query('UPDATE users SET followers_count = followers_count + 1 WHERE id = $1', [targetId]);
      await query('UPDATE users SET following_count = following_count + 1 WHERE id = $1', [req.user.id]);

      // Notify
      await query(`
        INSERT INTO notifications (user_id, type, title, body, link, actor_id)
        VALUES ($1, 'follow', $2, $3, $4, $5)
      `, [targetId, `@${req.user.handle} followed you`, null, `/profile/${req.user.handle}`, req.user.id]);

      res.json({ following: true });
    }
  } catch (err) { next(err); }
});

// ─── GET /api/users/:handle/followers ─────────────────────────────────────────
router.get('/:handle/followers', async (req, res, next) => {
  try {
    const user = await query('SELECT id FROM users WHERE handle = $1', [req.params.handle]);
    if (!user.rows.length) return res.status(404).json({ error: 'User not found' });

    const result = await query(`
      SELECT u.id, u.handle, u.name, u.avatar_url, u.color, u.initials, u.is_verified, u.affiliation
      FROM follows f JOIN users u ON u.id = f.follower_id
      WHERE f.following_id = $1
      ORDER BY f.created_at DESC LIMIT 50
    `, [user.rows[0].id]);

    res.json(result.rows);
  } catch (err) { next(err); }
});

// ─── POST /api/users/:handle/collab — send collaboration request ──────────────
router.post('/:handle/collab', requireAuth, async (req, res, next) => {
  try {
    const { message, postId } = req.body;
    const target = await query('SELECT id FROM users WHERE handle = $1', [req.params.handle]);
    if (!target.rows.length) return res.status(404).json({ error: 'User not found' });

    const toUser = target.rows[0].id;
    if (toUser === req.user.id) return res.status(400).json({ error: 'Cannot collab with yourself' });

    await query(`
      INSERT INTO collab_requests (from_user, to_user, post_id, message)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (from_user, post_id) DO UPDATE SET message = EXCLUDED.message, status = 'pending'
    `, [req.user.id, toUser, postId || null, message || null]);

    await query(`
      INSERT INTO notifications (user_id, type, title, body, actor_id)
      VALUES ($1, 'collaboration_request', $2, $3, $4)
    `, [toUser, `@${req.user.handle} wants to collaborate`, message || 'Sent you a collaboration request', req.user.id]);

    res.json({ sent: true });
  } catch (err) { next(err); }
});

module.exports = router;

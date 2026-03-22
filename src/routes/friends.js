const express = require('express');
const { query } = require('../db/pool');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const router = express.Router();

// ─── Helper: get friendship status between two users ─────────────────────────
async function getFriendship(userA, userB) {
  const res = await query(`
    SELECT * FROM friendships
    WHERE (requester_id = $1 AND addressee_id = $2)
       OR (requester_id = $2 AND addressee_id = $1)
    LIMIT 1
  `, [userA, userB]);
  return res.rows[0] || null;
}

// ─── Helper: get friend status string from viewer's perspective ───────────────
function friendStatusFor(friendship, myId) {
  if (!friendship) return 'none';
  if (friendship.status === 'accepted') return 'friends';
  if (friendship.status === 'blocked') return 'blocked';
  if (friendship.status === 'pending') {
    return friendship.requester_id === myId ? 'request_sent' : 'request_received';
  }
  return 'none';
}

// GET /api/friends — list my friends
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const result = await query(`
      SELECT u.id, u.handle, u.name, u.avatar_url, u.color, u.initials,
             u.affiliation, u.is_verified, u.open_to_collab, u.role
      FROM friendships f
      JOIN users u ON u.id = CASE
        WHEN f.requester_id = $1 THEN f.addressee_id
        ELSE f.requester_id
      END
      WHERE (f.requester_id = $1 OR f.addressee_id = $1)
        AND f.status = 'accepted'
      ORDER BY f.updated_at DESC
    `, [req.user.id]);
    res.json(result.rows);
  } catch (err) { next(err); }
});

// GET /api/friends/requests — incoming friend requests
router.get('/requests', requireAuth, async (req, res, next) => {
  try {
    const result = await query(`
      SELECT f.id as friendship_id, f.created_at as requested_at,
             u.id, u.handle, u.name, u.avatar_url, u.color, u.initials,
             u.affiliation, u.is_verified
      FROM friendships f
      JOIN users u ON u.id = f.requester_id
      WHERE f.addressee_id = $1 AND f.status = 'pending'
      ORDER BY f.created_at DESC
    `, [req.user.id]);
    res.json(result.rows);
  } catch (err) { next(err); }
});

// GET /api/friends/sent — outgoing requests I sent
router.get('/sent', requireAuth, async (req, res, next) => {
  try {
    const result = await query(`
      SELECT f.id as friendship_id, f.created_at as requested_at,
             u.id, u.handle, u.name, u.avatar_url, u.color, u.initials,
             u.affiliation, u.is_verified
      FROM friendships f
      JOIN users u ON u.id = f.addressee_id
      WHERE f.requester_id = $1 AND f.status = 'pending'
      ORDER BY f.created_at DESC
    `, [req.user.id]);
    res.json(result.rows);
  } catch (err) { next(err); }
});

// GET /api/friends/status/:handle — get friendship status with a user
router.get('/status/:handle', requireAuth, async (req, res, next) => {
  try {
    const target = await query('SELECT id FROM users WHERE handle = $1', [req.params.handle]);
    if (!target.rows.length) return res.status(404).json({ error: 'User not found' });
    const friendship = await getFriendship(req.user.id, target.rows[0].id);
    res.json({
      status: friendStatusFor(friendship, req.user.id),
      friendship_id: friendship?.id || null,
      since: friendship?.updated_at || null,
    });
  } catch (err) { next(err); }
});

// GET /api/friends/:handle — get someone's public friends list
router.get('/:handle', optionalAuth, async (req, res, next) => {
  try {
    const user = await query('SELECT id FROM users WHERE handle = $1', [req.params.handle]);
    if (!user.rows.length) return res.status(404).json({ error: 'User not found' });
    const userId = user.rows[0].id;

    const result = await query(`
      SELECT u.id, u.handle, u.name, u.avatar_url, u.color, u.initials,
             u.affiliation, u.is_verified, u.role
      FROM friendships f
      JOIN users u ON u.id = CASE
        WHEN f.requester_id = $1 THEN f.addressee_id
        ELSE f.requester_id
      END
      WHERE (f.requester_id = $1 OR f.addressee_id = $1)
        AND f.status = 'accepted'
      ORDER BY f.updated_at DESC
      LIMIT 50
    `, [userId]);
    res.json(result.rows);
  } catch (err) { next(err); }
});

// POST /api/friends/request/:handle — send friend request
router.post('/request/:handle', requireAuth, async (req, res, next) => {
  try {
    const target = await query('SELECT id FROM users WHERE handle = $1', [req.params.handle]);
    if (!target.rows.length) return res.status(404).json({ error: 'User not found' });
    const targetId = target.rows[0].id;
    if (targetId === req.user.id) return res.status(400).json({ error: 'Cannot friend yourself' });

    // Check existing friendship
    const existing = await getFriendship(req.user.id, targetId);
    if (existing) {
      if (existing.status === 'accepted') return res.status(409).json({ error: 'Already friends' });
      if (existing.status === 'pending') return res.status(409).json({ error: 'Request already sent' });
      if (existing.status === 'blocked') return res.status(403).json({ error: 'Cannot send request' });
    }

    await query(`
      INSERT INTO friendships (requester_id, addressee_id, status)
      VALUES ($1, $2, 'pending')
      ON CONFLICT (requester_id, addressee_id) DO UPDATE SET status = 'pending', updated_at = NOW()
    `, [req.user.id, targetId]);

    // Notify
    await query(`
      INSERT INTO notifications (user_id, type, title, body, link, actor_id)
      VALUES ($1, 'follow', $2, $3, $4, $5)
    `, [targetId, `@${req.user.handle} sent you a friend request`, 'Accept or decline in your profile', `/profile/${req.user.handle}`, req.user.id]);

    res.json({ status: 'request_sent' });
  } catch (err) { next(err); }
});

// POST /api/friends/accept/:friendshipId — accept a request
router.post('/accept/:friendshipId', requireAuth, async (req, res, next) => {
  try {
    const result = await query(
      `UPDATE friendships SET status = 'accepted', updated_at = NOW()
       WHERE id = $1 AND addressee_id = $2 AND status = 'pending'
       RETURNING *, (SELECT handle FROM users WHERE id = requester_id) as requester_handle`,
      [req.params.friendshipId, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Request not found' });

    const { requester_id, requester_handle } = result.rows[0];

    // Notify the requester
    await query(`
      INSERT INTO notifications (user_id, type, title, body, link, actor_id)
      VALUES ($1, 'follow', $2, $3, $4, $5)
    `, [requester_id, `@${req.user.handle} accepted your friend request!`, 'You are now friends.', `/profile/${req.user.handle}`, req.user.id]);

    res.json({ status: 'friends', with: requester_handle });
  } catch (err) { next(err); }
});

// POST /api/friends/decline/:friendshipId — decline a request
router.post('/decline/:friendshipId', requireAuth, async (req, res, next) => {
  try {
    await query(
      `UPDATE friendships SET status = 'declined', updated_at = NOW()
       WHERE id = $1 AND addressee_id = $2`,
      [req.params.friendshipId, req.user.id]
    );
    res.json({ status: 'declined' });
  } catch (err) { next(err); }
});

// DELETE /api/friends/:handle — unfriend
router.delete('/:handle', requireAuth, async (req, res, next) => {
  try {
    const target = await query('SELECT id FROM users WHERE handle = $1', [req.params.handle]);
    if (!target.rows.length) return res.status(404).json({ error: 'User not found' });

    await query(`
      DELETE FROM friendships
      WHERE ((requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1))
        AND status = 'accepted'
    `, [req.user.id, target.rows[0].id]);

    res.json({ status: 'removed' });
  } catch (err) { next(err); }
});

// DELETE /api/friends/cancel/:handle — cancel outgoing request
router.delete('/cancel/:handle', requireAuth, async (req, res, next) => {
  try {
    const target = await query('SELECT id FROM users WHERE handle = $1', [req.params.handle]);
    if (!target.rows.length) return res.status(404).json({ error: 'User not found' });

    await query(`
      DELETE FROM friendships
      WHERE requester_id = $1 AND addressee_id = $2 AND status = 'pending'
    `, [req.user.id, target.rows[0].id]);

    res.json({ status: 'cancelled' });
  } catch (err) { next(err); }
});

// GET /api/friends/feed/posts — posts from friends only
router.get('/feed/posts', requireAuth, async (req, res, next) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    const result = await query(`
      SELECT p.id, p.title, p.excerpt, p.type, p.status,
             p.likes_count, p.comments_count, p.views_count,
             p.is_pinned, p.is_featured, p.created_at,
             u.id as author_id, u.handle as author_handle, u.name as author_name,
             u.avatar_url as author_avatar, u.color as author_color,
             u.initials as author_initials, u.affiliation as author_affiliation,
             u.is_verified as author_verified,
             COALESCE(json_agg(DISTINCT jsonb_build_object(
               'name', t.name, 'slug', t.slug, 'color', t.color
             )) FILTER (WHERE t.id IS NOT NULL), '[]') as tags
      FROM posts p
      JOIN users u ON u.id = p.author_id
      LEFT JOIN post_tags pt ON pt.post_id = p.id
      LEFT JOIN tags t ON t.id = pt.tag_id
      WHERE p.status = 'approved'
        AND p.author_id IN (
          SELECT CASE WHEN requester_id = $1 THEN addressee_id ELSE requester_id END
          FROM friendships
          WHERE (requester_id = $1 OR addressee_id = $1) AND status = 'accepted'
        )
      GROUP BY p.id, u.id
      ORDER BY p.is_pinned DESC, p.created_at DESC
      LIMIT $2 OFFSET $3
    `, [req.user.id, parseInt(limit), offset]);

    const count = await query(`
      SELECT COUNT(DISTINCT p.id) FROM posts p
      WHERE p.status = 'approved'
        AND p.author_id IN (
          SELECT CASE WHEN requester_id = $1 THEN addressee_id ELSE requester_id END
          FROM friendships
          WHERE (requester_id = $1 OR addressee_id = $1) AND status = 'accepted'
        )
    `, [req.user.id]);

    res.json({ posts: result.rows, total: parseInt(count.rows[0].count), page: parseInt(page) });
  } catch (err) { next(err); }
});

module.exports = router;

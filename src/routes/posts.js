const express = require('express');
const { body, validationResult } = require('express-validator');
const { query, getClient } = require('../db/pool');
const { requireAuth, optionalAuth, requireMod } = require('../middleware/auth');

const router = express.Router();

// GET /api/posts — feed (paginated, filterable)
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const { page = 1, limit = 10, type, tag, author, pinned, featured, sort = 'new' } = req.query;
    const offset = (page - 1) * limit;
    const params = [];
    const conditions = ["p.status = 'approved'"];

    if (type) { params.push(type); conditions.push(`p.type = $${params.length}`); }
    if (author) { params.push(author); conditions.push(`u.handle = $${params.length}`); }
    if (pinned === 'true') conditions.push('p.is_pinned = true');
    if (featured === 'true') conditions.push('p.is_featured = true');
    if (tag) {
      params.push(tag);
      conditions.push(`EXISTS (SELECT 1 FROM post_tags pt2 JOIN tags t2 ON t2.id = pt2.tag_id WHERE pt2.post_id = p.id AND t2.slug = $${params.length})`);
    }

    const where = 'WHERE ' + conditions.join(' AND ');
    const orderBy = sort === 'top' ? 'p.likes_count DESC, p.created_at DESC' :
                    sort === 'hot' ? '(p.likes_count * 2 + p.comments_count) DESC' :
                    'p.is_pinned DESC, p.is_featured DESC, p.created_at DESC';

    const countRes = await query(`SELECT COUNT(*) FROM posts p JOIN users u ON u.id = p.author_id ${where}`, params);
    const total = parseInt(countRes.rows[0].count);

    params.push(parseInt(limit), offset);
    const result = await query(`
      SELECT p.id, p.title, p.excerpt, p.type, p.status, p.thumbnail_type, p.thumbnail_url,
             p.likes_count, p.comments_count, p.views_count, p.is_pinned, p.is_featured,
             p.created_at, p.updated_at,
             u.id as author_id, u.handle as author_handle, u.name as author_name,
             u.avatar_url as author_avatar, u.color as author_color, u.initials as author_initials,
             u.affiliation as author_affiliation, u.is_verified as author_verified,
             COALESCE(json_agg(DISTINCT jsonb_build_object('name', t.name, 'slug', t.slug, 'color', t.color)) FILTER (WHERE t.id IS NOT NULL), '[]') as tags
      FROM posts p
      JOIN users u ON u.id = p.author_id
      LEFT JOIN post_tags pt ON pt.post_id = p.id
      LEFT JOIN tags t ON t.id = pt.tag_id
      ${where}
      GROUP BY p.id, u.id
      ORDER BY ${orderBy}
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    // If user is logged in, add liked/bookmarked state
    let likedIds = new Set(), bookmarkedIds = new Set();
    if (req.user) {
      const postIds = result.rows.map(p => p.id);
      if (postIds.length) {
        const liked = await query('SELECT post_id FROM likes WHERE user_id = $1 AND post_id = ANY($2)', [req.user.id, postIds]);
        const bookmarked = await query('SELECT post_id FROM bookmarks WHERE user_id = $1 AND post_id = ANY($2)', [req.user.id, postIds]);
        likedIds = new Set(liked.rows.map(r => r.post_id));
        bookmarkedIds = new Set(bookmarked.rows.map(r => r.post_id));
      }
    }

    const posts = result.rows.map(p => ({
      ...p,
      liked: likedIds.has(p.id),
      bookmarked: bookmarkedIds.has(p.id)
    }));

    res.json({ posts, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) { next(err); }
});

// POST /api/posts — create post
router.post('/', requireAuth, [
  body('title').trim().isLength({ min: 5, max: 300 }),
  body('excerpt').trim().isLength({ min: 10, max: 1000 }),
  body('type').isIn(['proposal', 'study', 'findings', 'review', 'discussion']),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { title, excerpt, body: postBody, type, tags = [], thumbnail_type } = req.body;

    // Check post approval setting
    const setting = await query("SELECT value FROM site_settings WHERE key = 'require_post_approval'");
    const requireApproval = setting.rows[0]?.value === 'true';
    const status = requireApproval ? 'pending' : 'approved';

    const client = await getClient();
    try {
      await client.query('BEGIN');

      const postRes = await client.query(`
        INSERT INTO posts (author_id, title, excerpt, body, type, status, thumbnail_type)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `, [req.user.id, title, excerpt, postBody || null, type, status, thumbnail_type || 'none']);

      const post = postRes.rows[0];

      // Process tags
      for (const tagName of tags.slice(0, 10)) {
        const slug = tagName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const tagRes = await client.query(`
          INSERT INTO tags (name, slug, created_by) VALUES ($1, $2, $3)
          ON CONFLICT (slug) DO UPDATE SET post_count = tags.post_count + 1
          RETURNING id
        `, [tagName, slug, req.user.id]);
        await client.query('INSERT INTO post_tags (post_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [post.id, tagRes.rows[0].id]);
      }

      await client.query('COMMIT');
      res.status(201).json({ ...post, requires_approval: requireApproval });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) { next(err); }
});

// GET /api/posts/:id
router.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const result = await query(`
      SELECT p.*, u.handle as author_handle, u.name as author_name, u.avatar_url as author_avatar,
             u.color as author_color, u.initials as author_initials, u.is_verified as author_verified,
             u.affiliation as author_affiliation,
             COALESCE(json_agg(DISTINCT jsonb_build_object('name', t.name, 'slug', t.slug, 'color', t.color)) FILTER (WHERE t.id IS NOT NULL), '[]') as tags
      FROM posts p JOIN users u ON u.id = p.author_id
      LEFT JOIN post_tags pt ON pt.post_id = p.id
      LEFT JOIN tags t ON t.id = pt.tag_id
      WHERE p.id = $1 AND (p.status = 'approved' OR p.author_id = $2 OR $3 = true)
      GROUP BY p.id, u.id
    `, [req.params.id, req.user?.id || null, req.user?.role === 'admin' || req.user?.role === 'superadmin' || false]);

    if (!result.rows.length) return res.status(404).json({ error: 'Post not found' });

    // Increment views
    await query('UPDATE posts SET views_count = views_count + 1 WHERE id = $1', [req.params.id]);

    const post = result.rows[0];
    if (req.user) {
      const liked = await query('SELECT 1 FROM likes WHERE user_id = $1 AND post_id = $2', [req.user.id, post.id]);
      const bookmarked = await query('SELECT 1 FROM bookmarks WHERE user_id = $1 AND post_id = $2', [req.user.id, post.id]);
      post.liked = liked.rows.length > 0;
      post.bookmarked = bookmarked.rows.length > 0;
    }
    res.json(post);
  } catch (err) { next(err); }
});

// POST /api/posts/:id/like
router.post('/:id/like', requireAuth, async (req, res, next) => {
  try {
    const existing = await query('SELECT 1 FROM likes WHERE user_id = $1 AND post_id = $2', [req.user.id, req.params.id]);
    if (existing.rows.length) {
      await query('DELETE FROM likes WHERE user_id = $1 AND post_id = $2', [req.user.id, req.params.id]);
      const res2 = await query('UPDATE posts SET likes_count = GREATEST(0, likes_count - 1) WHERE id = $1 RETURNING likes_count', [req.params.id]);
      return res.json({ liked: false, count: res2.rows[0]?.likes_count });
    }
    await query('INSERT INTO likes (user_id, post_id) VALUES ($1, $2)', [req.user.id, req.params.id]);
    const res2 = await query('UPDATE posts SET likes_count = likes_count + 1 WHERE id = $1 RETURNING likes_count, author_id', [req.params.id]);
    const post = res2.rows[0];

    if (post && post.author_id !== req.user.id) {
      await query(`INSERT INTO notifications (user_id, type, title, actor_id, link) VALUES ($1, 'post_like', $2, $3, $4)`,
        [post.author_id, `@${req.user.handle} liked your post`, req.user.id, `/post/${req.params.id}`]);
    }
    res.json({ liked: true, count: res2.rows[0]?.likes_count });
  } catch (err) { next(err); }
});

// POST /api/posts/:id/bookmark
router.post('/:id/bookmark', requireAuth, async (req, res, next) => {
  try {
    const existing = await query('SELECT 1 FROM bookmarks WHERE user_id = $1 AND post_id = $2', [req.user.id, req.params.id]);
    if (existing.rows.length) {
      await query('DELETE FROM bookmarks WHERE user_id = $1 AND post_id = $2', [req.user.id, req.params.id]);
      return res.json({ bookmarked: false });
    }
    await query('INSERT INTO bookmarks (user_id, post_id) VALUES ($1, $2)', [req.user.id, req.params.id]);
    res.json({ bookmarked: true });
  } catch (err) { next(err); }
});

// GET /api/posts/:id/comments
router.get('/:id/comments', optionalAuth, async (req, res, next) => {
  try {
    const result = await query(`
      SELECT c.id, c.body, c.likes_count, c.parent_id, c.created_at, c.updated_at,
             u.id as author_id, u.handle as author_handle, u.name as author_name,
             u.avatar_url as author_avatar, u.color as author_color, u.initials as author_initials, u.is_verified as author_verified
      FROM comments c
      JOIN users u ON u.id = c.author_id
      WHERE c.post_id = $1 AND c.is_hidden = false
      ORDER BY c.created_at ASC
    `, [req.params.id]);
    res.json(result.rows);
  } catch (err) { next(err); }
});

// POST /api/posts/:id/comments
router.post('/:id/comments', requireAuth, [
  body('body').trim().isLength({ min: 1, max: 2000 }),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { body: commentBody, parentId } = req.body;
    const result = await query(`
      INSERT INTO comments (post_id, author_id, body, parent_id)
      VALUES ($1, $2, $3, $4)
      RETURNING id, body, parent_id, created_at
    `, [req.params.id, req.user.id, commentBody, parentId || null]);

    await query('UPDATE posts SET comments_count = comments_count + 1 WHERE id = $1', [req.params.id]);

    const post = await query('SELECT author_id FROM posts WHERE id = $1', [req.params.id]);
    if (post.rows.length && post.rows[0].author_id !== req.user.id) {
      await query(`INSERT INTO notifications (user_id, type, title, actor_id, link) VALUES ($1, 'post_comment', $2, $3, $4)`,
        [post.rows[0].author_id, `@${req.user.handle} commented on your post`, req.user.id, `/post/${req.params.id}`]);
    }

    const comment = { ...result.rows[0], author_handle: req.user.handle, author_name: req.user.name, author_avatar: req.user.avatar_url, author_color: req.user.color, author_initials: req.user.initials };
    res.status(201).json(comment);
  } catch (err) { next(err); }
});

module.exports = router;

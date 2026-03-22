const express = require('express');
const { query } = require('../db/pool');
const { optionalAuth } = require('../middleware/auth');
const router = express.Router();

// ─── Helper: sanitize search query ───────────────────────────────────────────
function sanitizeQ(q) {
  return (q || '').trim().slice(0, 100).replace(/[%_]/g, '\\$&');
}

// ─── GET /api/search/predict?q= — fast predictive suggestions ────────────────
// Returns top 3 users + top 3 tags + top 3 post titles as user types
router.get('/predict', optionalAuth, async (req, res, next) => {
  try {
    const q = sanitizeQ(req.query.q);
    if (!q || q.length < 2) return res.json({ users: [], tags: [], posts: [] });

    const like = `%${q}%`;
    const startsWith = `${q}%`;

    const [users, tags, posts] = await Promise.all([
      query(`
        SELECT id, handle, name, avatar_url, color, initials, affiliation, is_verified, role
        FROM users
        WHERE status != 'banned'
          AND (handle ILIKE $1 OR name ILIKE $2)
        ORDER BY
          CASE WHEN handle ILIKE $3 THEN 0 ELSE 1 END,
          followers_count DESC
        LIMIT 5
      `, [like, like, startsWith]),

      query(`
        SELECT id, name, slug, color, category, post_count
        FROM tags
        WHERE name ILIKE $1 OR slug ILIKE $1
        ORDER BY
          CASE WHEN name ILIKE $2 THEN 0 ELSE 1 END,
          post_count DESC
        LIMIT 4
      `, [like, startsWith]),

      query(`
        SELECT p.id, p.title, p.type, u.handle as author_handle, u.color as author_color, u.initials as author_initials
        FROM posts p
        JOIN users u ON u.id = p.author_id
        WHERE p.status = 'approved'
          AND (p.title ILIKE $1 OR p.excerpt ILIKE $1)
        ORDER BY p.likes_count DESC
        LIMIT 4
      `, [like]),
    ]);

    res.json({ users: users.rows, tags: tags.rows, posts: posts.rows });
  } catch (err) { next(err); }
});

// ─── GET /api/search?q=&type=all|users|posts|tags&page= ─────────────────────
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const q = sanitizeQ(req.query.q);
    const type = req.query.type || 'all';
    const page = parseInt(req.query.page) || 1;
    const limit = 15;
    const offset = (page - 1) * limit;

    if (!q) return res.json({ users: [], posts: [], tags: [], query: q });

    const like = `%${q}%`;

    // Full text search using pg_trgm similarity + ILIKE
    const results = {};

    if (type === 'all' || type === 'users') {
      const users = await query(`
        SELECT u.id, u.handle, u.name, u.avatar_url, u.color, u.initials,
               u.affiliation, u.title, u.bio, u.is_verified, u.role,
               u.followers_count, u.open_to_collab,
               similarity(u.name, $1) + similarity(u.handle, $1) as score
        FROM users u
        WHERE u.status != 'banned'
          AND (u.name ILIKE $2 OR u.handle ILIKE $2 OR u.affiliation ILIKE $2
               OR u.bio ILIKE $2 OR u.title ILIKE $2
               OR $1 % ANY(u.interests::text[]))
        ORDER BY score DESC, u.followers_count DESC
        LIMIT $3 OFFSET $4
      `, [q, like, type === 'all' ? 5 : limit, type === 'all' ? 0 : offset]);
      results.users = users.rows;
    }

    if (type === 'all' || type === 'posts') {
      const posts = await query(`
        SELECT p.id, p.title, p.excerpt, p.type, p.likes_count,
               p.comments_count, p.created_at, p.is_featured, p.is_pinned,
               u.handle as author_handle, u.name as author_name,
               u.avatar_url as author_avatar, u.color as author_color,
               u.initials as author_initials, u.is_verified as author_verified,
               COALESCE(json_agg(DISTINCT jsonb_build_object('name',t.name,'slug',t.slug,'color',t.color)) FILTER (WHERE t.id IS NOT NULL),'[]') as tags,
               similarity(p.title, $1) as score
        FROM posts p
        JOIN users u ON u.id = p.author_id
        LEFT JOIN post_tags pt ON pt.post_id = p.id
        LEFT JOIN tags t ON t.id = pt.tag_id
        WHERE p.status = 'approved'
          AND (p.title ILIKE $2 OR p.excerpt ILIKE $2 OR p.body ILIKE $2)
        GROUP BY p.id, u.id
        ORDER BY score DESC, p.likes_count DESC
        LIMIT $3 OFFSET $4
      `, [q, like, type === 'all' ? 5 : limit, type === 'all' ? 0 : offset]);
      results.posts = posts.rows;
    }

    if (type === 'all' || type === 'tags') {
      const tags = await query(`
        SELECT t.id, t.name, t.slug, t.color, t.category, t.description,
               COUNT(pt.post_id)::int as post_count,
               similarity(t.name, $1) as score
        FROM tags t
        LEFT JOIN post_tags pt ON pt.tag_id = t.id
        WHERE t.name ILIKE $2 OR t.category ILIKE $2 OR t.description ILIKE $2
        GROUP BY t.id
        ORDER BY score DESC, post_count DESC
        LIMIT $3 OFFSET $4
      `, [q, like, type === 'all' ? 5 : limit, type === 'all' ? 0 : offset]);
      results.tags = tags.rows;
    }

    // Related searches — other queries people might want
    const related = await query(`
      SELECT DISTINCT t.name as suggestion, 'tag' as type
      FROM tags t
      WHERE t.name ILIKE $1 AND t.name != $2
      UNION
      SELECT DISTINCT u.handle as suggestion, 'user' as type
      FROM users u
      WHERE u.handle ILIKE $1 AND u.handle != $2
      LIMIT 6
    `, [like, q]);

    res.json({ ...results, related: related.rows, query: q, page });
  } catch (err) { next(err); }
});

// ─── GET /api/search/users?q=&interests=&open_to_collab= — people search ─────
router.get('/users', optionalAuth, async (req, res, next) => {
  try {
    const q = sanitizeQ(req.query.q);
    const interests = req.query.interests;
    const openToCollab = req.query.open_to_collab;
    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const offset = (page - 1) * limit;

    const conditions = ["u.status != 'banned'"];
    const params = [];

    if (q) {
      params.push(`%${q}%`);
      conditions.push(`(u.name ILIKE $${params.length} OR u.handle ILIKE $${params.length} OR u.affiliation ILIKE $${params.length} OR u.bio ILIKE $${params.length})`);
    }
    if (interests) {
      params.push(`%${interests}%`);
      conditions.push(`array_to_string(u.interests, ' ') ILIKE $${params.length}`);
    }
    if (openToCollab === 'true') {
      conditions.push('u.open_to_collab = true');
    }

    const where = 'WHERE ' + conditions.join(' AND ');
    const countRes = await query(`SELECT COUNT(*) FROM users u ${where}`, params);

    params.push(limit, offset);
    const users = await query(`
      SELECT u.id, u.handle, u.name, u.avatar_url, u.color, u.initials,
             u.affiliation, u.title, u.bio, u.is_verified, u.role,
             u.followers_count, u.following_count, u.open_to_collab, u.interests,
             u.created_at
      FROM users u
      ${where}
      ORDER BY u.is_verified DESC, u.followers_count DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    res.json({
      users: users.rows,
      total: parseInt(countRes.rows[0].count),
      page,
      pages: Math.ceil(parseInt(countRes.rows[0].count) / limit)
    });
  } catch (err) { next(err); }
});

module.exports = router;

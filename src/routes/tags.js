const express = require('express');
const { query } = require('../db/pool');
const { optionalAuth } = require('../middleware/auth');
const router = express.Router();

router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const { category, featured } = req.query;
    const params = [];
    const conditions = [];
    if (category) { params.push(category); conditions.push(`t.category = $${params.length}`); }
    if (featured === 'true') conditions.push('t.is_featured = true');
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const result = await query(`
      SELECT t.id, t.name, t.slug, t.category, t.color, t.description, t.is_featured,
             COUNT(pt.post_id)::int as post_count
      FROM tags t LEFT JOIN post_tags pt ON pt.tag_id = t.id
      ${where} GROUP BY t.id ORDER BY post_count DESC
    `, params);
    res.json(result.rows);
  } catch (err) { next(err); }
});

module.exports = router;

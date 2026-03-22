const express = require('express');
const { body, validationResult } = require('express-validator');
const { query, getClient } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// GET /api/messages/conversations — get all conversations for current user
router.get('/conversations', requireAuth, async (req, res, next) => {
  try {
    const result = await query(`
      SELECT c.id, c.updated_at,
        json_agg(DISTINCT jsonb_build_object(
          'id', u.id, 'handle', u.handle, 'name', u.name,
          'avatar_url', u.avatar_url, 'color', u.color, 'initials', u.initials, 'is_verified', u.is_verified
        )) as participants,
        (SELECT m.body FROM messages m WHERE m.conversation_id = c.id AND m.is_deleted = false ORDER BY m.created_at DESC LIMIT 1) as last_message_body,
        (SELECT m.created_at FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) as last_message_at,
        (SELECT m.sender_id FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) as last_sender_id,
        (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.sender_id != $1 AND m.created_at > cp_me.last_read_at AND m.is_deleted = false) as unread_count
      FROM conversations c
      JOIN conversation_participants cp ON cp.conversation_id = c.id
      JOIN conversation_participants cp_me ON cp_me.conversation_id = c.id AND cp_me.user_id = $1
      JOIN users u ON u.id = cp.user_id
      WHERE $1 = ANY(SELECT user_id FROM conversation_participants WHERE conversation_id = c.id)
      GROUP BY c.id, cp_me.last_read_at
      ORDER BY c.updated_at DESC
    `, [req.user.id]);

    res.json(result.rows);
  } catch (err) { next(err); }
});

// POST /api/messages/conversations — create or get DM conversation
router.post('/conversations', requireAuth, async (req, res, next) => {
  try {
    const { withUserId } = req.body;
    if (!withUserId) return res.status(400).json({ error: 'withUserId required' });
    if (withUserId === req.user.id) return res.status(400).json({ error: 'Cannot message yourself' });

    // Check target user exists
    const target = await query('SELECT id FROM users WHERE id = $1', [withUserId]);
    if (!target.rows.length) return res.status(404).json({ error: 'User not found' });

    // Check if conversation already exists
    const existing = await query(`
      SELECT c.id FROM conversations c
      WHERE (SELECT COUNT(*) FROM conversation_participants WHERE conversation_id = c.id) = 2
        AND EXISTS (SELECT 1 FROM conversation_participants WHERE conversation_id = c.id AND user_id = $1)
        AND EXISTS (SELECT 1 FROM conversation_participants WHERE conversation_id = c.id AND user_id = $2)
    `, [req.user.id, withUserId]);

    if (existing.rows.length) return res.json({ conversationId: existing.rows[0].id, created: false });

    const client = await getClient();
    try {
      await client.query('BEGIN');
      const conv = await client.query('INSERT INTO conversations DEFAULT VALUES RETURNING id');
      const convId = conv.rows[0].id;
      await client.query('INSERT INTO conversation_participants (conversation_id, user_id) VALUES ($1, $2), ($1, $3)', [convId, req.user.id, withUserId]);
      await client.query('COMMIT');
      res.status(201).json({ conversationId: convId, created: true });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) { next(err); }
});

// GET /api/messages/conversations/:id/messages
router.get('/conversations/:id/messages', requireAuth, async (req, res, next) => {
  try {
    // Verify user is participant
    const check = await query('SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!check.rows.length) return res.status(403).json({ error: 'Not a participant' });

    const { before, limit = 50 } = req.query;
    const params = [req.params.id, parseInt(limit)];
    let timeCondition = '';
    if (before) { params.push(before); timeCondition = `AND m.created_at < $${params.length}`; }

    const result = await query(`
      SELECT m.id, m.body, m.created_at, m.is_deleted,
             u.id as sender_id, u.handle as sender_handle, u.name as sender_name,
             u.avatar_url as sender_avatar, u.color as sender_color, u.initials as sender_initials
      FROM messages m JOIN users u ON u.id = m.sender_id
      WHERE m.conversation_id = $1 ${timeCondition}
      ORDER BY m.created_at DESC
      LIMIT $2
    `, params);

    // Mark as read
    await query('UPDATE conversation_participants SET last_read_at = NOW() WHERE conversation_id = $1 AND user_id = $2', [req.params.id, req.user.id]);

    res.json(result.rows.reverse()); // oldest first
  } catch (err) { next(err); }
});

// POST /api/messages/conversations/:id/messages — send a message
router.post('/conversations/:id/messages', requireAuth, [
  body('body').trim().isLength({ min: 1, max: 5000 }),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    // Verify participant
    const check = await query('SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!check.rows.length) return res.status(403).json({ error: 'Not a participant' });

    const result = await query(`
      INSERT INTO messages (conversation_id, sender_id, body)
      VALUES ($1, $2, $3)
      RETURNING id, body, created_at, sender_id
    `, [req.params.id, req.user.id, req.body.body]);

    await query('UPDATE conversations SET updated_at = NOW() WHERE id = $1', [req.params.id]);

    const message = {
      ...result.rows[0],
      sender_handle: req.user.handle,
      sender_name: req.user.name,
      sender_avatar: req.user.avatar_url,
      sender_color: req.user.color,
      sender_initials: req.user.initials,
    };

    // Get other participants to notify via socket
    const others = await query(
      'SELECT user_id FROM conversation_participants WHERE conversation_id = $1 AND user_id != $2',
      [req.params.id, req.user.id]
    );

    // Attach recipient IDs for socket.io in server.js
    req.app.get('io')?.to(`user:${others.rows.map(r => r.user_id).join(',user:')}`)
      .emit('new_message', { conversationId: req.params.id, message });

    // Notify each recipient
    for (const other of others.rows) {
      await query(`INSERT INTO notifications (user_id, type, title, body, link, actor_id) VALUES ($1, 'new_message', $2, $3, $4, $5)`,
        [other.user_id, `New message from @${req.user.handle}`, req.body.body.slice(0, 100), `/messages/${req.params.id}`, req.user.id]);
      req.app.get('io')?.to(`user:${other.user_id}`).emit('notification', { type: 'new_message', from: req.user.handle });
    }

    res.status(201).json(message);
  } catch (err) { next(err); }
});

// DELETE /api/messages/:id — delete own message
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const result = await query('SELECT sender_id FROM messages WHERE id = $1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Message not found' });
    if (result.rows[0].sender_id !== req.user.id && !['admin','superadmin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Cannot delete this message' });
    }
    await query('UPDATE messages SET is_deleted = true, body = \'[deleted]\' WHERE id = $1', [req.params.id]);
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

module.exports = router;

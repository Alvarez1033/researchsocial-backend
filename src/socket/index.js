const jwt = require('jsonwebtoken');
const { query } = require('../db/pool');

module.exports = function setupSocket(io) {

  // Authenticate socket connections
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.split(' ')[1];
      if (!token) { socket.userId = null; return next(); }
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const result = await query('SELECT id, handle, name, role, color, initials, avatar_url FROM users WHERE id = $1', [decoded.userId]);
      if (result.rows.length) {
        socket.userId = result.rows[0].id;
        socket.user = result.rows[0];
      }
      next();
    } catch (err) {
      next(); // allow connection even if auth fails (read-only)
    }
  });

  // Track online users
  const onlineUsers = new Map(); // userId -> Set<socketId>

  io.on('connection', async (socket) => {
    if (socket.userId) {
      // Join personal room
      socket.join(`user:${socket.userId}`);

      // Track online
      if (!onlineUsers.has(socket.userId)) onlineUsers.set(socket.userId, new Set());
      onlineUsers.get(socket.userId).add(socket.id);

      // Update last seen
      await query('UPDATE users SET last_seen_at = NOW() WHERE id = $1', [socket.userId]).catch(() => {});

      // Announce online presence to followers
      io.emit('user_online', { userId: socket.userId, handle: socket.user?.handle });

      // Join admin chat if admin/mod
      if (['admin', 'superadmin', 'moderator'].includes(socket.user?.role)) {
        socket.join('admin-chat');
      }

      // Unread notification count
      const unread = await query('SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = false', [socket.userId]).catch(() => ({ rows: [{ count: 0 }] }));
      socket.emit('unread_count', parseInt(unread.rows[0].count));
    }

    // ─── Join conversation rooms ────────────────────────────────────────────
    socket.on('join_conversation', async (conversationId) => {
      if (!socket.userId) return;
      const check = await query('SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2', [conversationId, socket.userId]).catch(() => ({ rows: [] }));
      if (check.rows.length) socket.join(`conv:${conversationId}`);
    });

    socket.on('leave_conversation', (conversationId) => {
      socket.leave(`conv:${conversationId}`);
    });

    // ─── Typing indicators ──────────────────────────────────────────────────
    socket.on('typing_start', ({ conversationId }) => {
      if (!socket.userId || !socket.user) return;
      socket.to(`conv:${conversationId}`).emit('typing_start', {
        conversationId,
        userId: socket.userId,
        handle: socket.user.handle,
        initials: socket.user.initials,
        color: socket.user.color,
      });
    });

    socket.on('typing_stop', ({ conversationId }) => {
      socket.to(`conv:${conversationId}`).emit('typing_stop', {
        conversationId, userId: socket.userId
      });
    });

    // ─── Real-time message (sent via socket directly) ───────────────────────
    socket.on('send_message', async ({ conversationId, body }) => {
      if (!socket.userId || !body?.trim()) return;
      try {
        const check = await query('SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2', [conversationId, socket.userId]);
        if (!check.rows.length) return;

        const result = await query(`
          INSERT INTO messages (conversation_id, sender_id, body) VALUES ($1, $2, $3)
          RETURNING id, body, created_at, sender_id
        `, [conversationId, socket.userId, body.trim()]);

        await query('UPDATE conversations SET updated_at = NOW() WHERE id = $1', [conversationId]);

        const message = {
          ...result.rows[0],
          sender_handle: socket.user.handle,
          sender_name: socket.user.name,
          sender_avatar: socket.user.avatar_url,
          sender_color: socket.user.color,
          sender_initials: socket.user.initials,
        };

        // Broadcast to all in conversation
        io.to(`conv:${conversationId}`).emit('new_message', { conversationId, message });

        // Notify other participants
        const others = await query('SELECT user_id FROM conversation_participants WHERE conversation_id = $1 AND user_id != $2', [conversationId, socket.userId]);
        for (const p of others.rows) {
          io.to(`user:${p.user_id}`).emit('notification', { type: 'new_message', conversationId, from: socket.user.handle });
          await query(`INSERT INTO notifications (user_id, type, title, body, link, actor_id) VALUES ($1, 'new_message', $2, $3, $4, $5)`,
            [p.user_id, `New message from @${socket.user.handle}`, body.slice(0, 100), `/messages/${conversationId}`, socket.userId]);
        }
      } catch (err) {
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    // ─── Post feed events ───────────────────────────────────────────────────
    socket.on('join_feed', () => socket.join('feed'));
    socket.on('leave_feed', () => socket.leave('feed'));

    // ─── Admin chat ─────────────────────────────────────────────────────────
    socket.on('admin_chat_message', async ({ body }) => {
      if (!socket.userId || !['admin','superadmin','moderator'].includes(socket.user?.role)) return;
      try {
        const result = await query('INSERT INTO admin_messages (sender_id, body) VALUES ($1, $2) RETURNING *', [socket.userId, body.trim()]);
        io.to('admin-chat').emit('admin_message', { ...result.rows[0], handle: socket.user.handle, name: socket.user.name, color: socket.user.color, initials: socket.user.initials, role: socket.user.role });
      } catch (err) {}
    });

    // ─── Disconnect ─────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      if (socket.userId) {
        const sockets = onlineUsers.get(socket.userId);
        if (sockets) {
          sockets.delete(socket.id);
          if (sockets.size === 0) {
            onlineUsers.delete(socket.userId);
            io.emit('user_offline', { userId: socket.userId });
          }
        }
        query('UPDATE users SET last_seen_at = NOW() WHERE id = $1', [socket.userId]).catch(() => {});
      }
    });
  });

  // Expose online check helper
  io.isUserOnline = (userId) => onlineUsers.has(userId) && onlineUsers.get(userId).size > 0;
};

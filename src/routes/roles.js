const express = require('express');
const { query } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { ROLES, PERMISSIONS, getRolePermissions, requirePermission, roleLevel, canManageUser } = require('../config/roles');

const router = express.Router();

// ─── GET /api/roles — list all roles and their permissions ────────────────────
router.get('/', (req, res) => {
  const roles = Object.entries(ROLES).map(([key, r]) => ({
    key,
    label: r.label,
    level: r.level,
    color: r.color,
    bg: r.bg,
    darkBg: r.darkBg,
    badge: r.badge,
    description: r.description,
    permissions: getRolePermissions(key),
  }));
  res.json({ roles, permissions: Object.keys(PERMISSIONS) });
});

// ─── GET /api/roles/my — get current user's permissions ───────────────────────
router.get('/my', requireAuth, (req, res) => {
  res.json({
    role: req.user.role,
    ...ROLES[req.user.role],
    permissions: getRolePermissions(req.user.role),
  });
});

// ─── POST /api/roles/assign — assign a role to a user ────────────────────────
router.post('/assign', requireAuth, async (req, res, next) => {
  try {
    const { userId, role, reason } = req.body;
    if (!userId || !role) return res.status(400).json({ error: 'userId and role required' });
    if (!ROLES[role]) return res.status(400).json({ error: 'Invalid role: ' + role });

    // Fetch target user
    const target = await query('SELECT id, handle, role FROM users WHERE id = $1', [userId]);
    if (!target.rows.length) return res.status(404).json({ error: 'User not found' });
    const targetUser = target.rows[0];

    const myLevel = roleLevel(req.user.role);
    const targetCurrentLevel = roleLevel(targetUser.role);
    const targetNewLevel = roleLevel(role);

    // Can't modify users at or above your level
    if (!canManageUser(req.user.role, targetUser.role)) {
      return res.status(403).json({ error: `Cannot modify a ${targetUser.role} — they are at or above your level` });
    }

    // Can't assign a role equal to or above your own (except superadmin can do anything)
    if (req.user.role !== 'superadmin' && targetNewLevel >= myLevel) {
      return res.status(403).json({ error: `Cannot assign ${role} — that role is at or above your level` });
    }

    // Specific permission checks for assigning staff roles
    const staffRoles = { admin: 'users.assign_role_admin', moderator: 'users.assign_role_moderator', support: 'users.assign_role_support' };
    if (staffRoles[role]) {
      const { hasPermission } = require('../config/roles');
      if (!hasPermission(req.user.role, staffRoles[role])) {
        return res.status(403).json({ error: `Insufficient permissions to assign ${role} role` });
      }
    }

    const oldRole = targetUser.role;

    // Update role
    await query('UPDATE users SET role = $1 WHERE id = $2', [role, userId]);

    // Log the change
    await query(`
      INSERT INTO role_changes (target_id, changed_by, old_role, new_role, reason)
      VALUES ($1, $2, $3, $4, $5)
    `, [userId, req.user.id, oldRole, role, reason || null]);

    // Log to moderation log
    await query(`INSERT INTO moderation_log (admin_id, target_type, target_id, action, reason) VALUES ($1, 'user', $2, $3, $4)`,
      [req.user.id, userId, `role_change:${oldRole}→${role}`, reason || null]);

    // Notify the user
    const roleInfo = ROLES[role];
    await query(`
      INSERT INTO notifications (user_id, type, title, body, actor_id)
      VALUES ($1, 'system', $2, $3, $4)
    `, [userId,
        `Your role has been updated to ${roleInfo.label}`,
        reason ? `Reason: ${reason}` : `You now have ${roleInfo.label} access on ResearchSocial.`,
        req.user.id]);

    res.json({ success: true, userId, oldRole, newRole: role, handle: targetUser.handle });
  } catch (err) { next(err); }
});

// ─── GET /api/roles/history/:userId — role change history ────────────────────
router.get('/history/:userId', requireAuth, requirePermission('admin.user_management'), async (req, res, next) => {
  try {
    const result = await query(`
      SELECT rc.*, 
             u.handle as changed_by_handle, u.name as changed_by_name
      FROM role_changes rc
      JOIN users u ON u.id = rc.changed_by
      WHERE rc.target_id = $1
      ORDER BY rc.created_at DESC
    `, [req.params.userId]);
    res.json(result.rows);
  } catch (err) { next(err); }
});

// ─── POST /api/roles/badges/award — award a badge to a user ──────────────────
router.post('/badges/award', requireAuth, requirePermission('admin.user_management'), async (req, res, next) => {
  try {
    const { userId, badgeKey, badgeLabel, badgeIcon } = req.body;
    await query(`
      INSERT INTO user_badges (user_id, badge_key, badge_label, badge_icon, awarded_by)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (user_id, badge_key) DO UPDATE SET badge_label = $3, badge_icon = $4
    `, [userId, badgeKey, badgeLabel, badgeIcon || '🏆', req.user.id]);
    res.json({ awarded: true });
  } catch (err) { next(err); }
});

// ─── DELETE /api/roles/badges/:userId/:badgeKey ────────────────────────────────
router.delete('/badges/:userId/:badgeKey', requireAuth, requirePermission('admin.user_management'), async (req, res, next) => {
  try {
    await query('DELETE FROM user_badges WHERE user_id = $1 AND badge_key = $2', [req.params.userId, req.params.badgeKey]);
    res.json({ removed: true });
  } catch (err) { next(err); }
});

// ─── GET /api/roles/badges/:userId ────────────────────────────────────────────
router.get('/badges/:userId', async (req, res, next) => {
  try {
    const result = await query('SELECT * FROM user_badges WHERE user_id = $1 ORDER BY created_at', [req.params.userId]);
    res.json(result.rows);
  } catch (err) { next(err); }
});

// ─── Support tickets ──────────────────────────────────────────────────────────

// POST /api/roles/tickets — create support ticket
router.post('/tickets', requireAuth, async (req, res, next) => {
  try {
    const { subject, body, category } = req.body;
    if (!subject || !body) return res.status(400).json({ error: 'Subject and body required' });
    const result = await query(`
      INSERT INTO support_tickets (user_id, subject, body, category)
      VALUES ($1, $2, $3, $4) RETURNING *
    `, [req.user.id, subject, body, category || 'general']);

    // Notify support team
    const support = await query("SELECT id FROM users WHERE role IN ('support','moderator','admin','superadmin') LIMIT 5");
    for (const s of support.rows) {
      await query(`INSERT INTO notifications (user_id, type, title, body, link, actor_id) VALUES ($1,'system',$2,$3,$4,$5)`,
        [s.id, `New support ticket: ${subject.slice(0,60)}`, `From @${req.user.handle}`, `/admin#tickets`, req.user.id]);
    }
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
});

// GET /api/roles/tickets — list tickets (support+ sees all, users see own)
router.get('/tickets', requireAuth, async (req, res, next) => {
  try {
    const { hasPermission } = require('../config/roles');
    const canViewAll = hasPermission(req.user.role, 'support.view_reports');
    const { status, page = 1, limit = 25 } = req.query;
    const offset = (page - 1) * limit;

    const conditions = canViewAll ? [] : ['t.user_id = $1'];
    const params = canViewAll ? [] : [req.user.id];
    if (status) { params.push(status); conditions.push(`t.status = $${params.length}`); }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    params.push(parseInt(limit), offset);

    const result = await query(`
      SELECT t.*, u.handle as user_handle, u.name as user_name, u.color as user_color, u.initials as user_initials,
             a.handle as assigned_handle, a.name as assigned_name
      FROM support_tickets t
      JOIN users u ON u.id = t.user_id
      LEFT JOIN users a ON a.id = t.assigned_to
      ${where}
      ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, t.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);
    res.json(result.rows);
  } catch (err) { next(err); }
});

// GET /api/roles/tickets/:id — get ticket + replies
router.get('/tickets/:id', requireAuth, async (req, res, next) => {
  try {
    const ticket = await query('SELECT * FROM support_tickets WHERE id = $1', [req.params.id]);
    if (!ticket.rows.length) return res.status(404).json({ error: 'Ticket not found' });

    const { hasPermission } = require('../config/roles');
    const canViewAll = hasPermission(req.user.role, 'support.view_reports');
    if (!canViewAll && ticket.rows[0].user_id !== req.user.id) return res.status(403).json({ error: 'Access denied' });

    const replies = await query(`
      SELECT tr.*, u.handle, u.name, u.role, u.color, u.initials, u.avatar_url
      FROM ticket_replies tr JOIN users u ON u.id = tr.author_id
      WHERE tr.ticket_id = $1 ${!canViewAll ? "AND tr.is_internal = false" : ''}
      ORDER BY tr.created_at ASC
    `, [req.params.id]);

    res.json({ ...ticket.rows[0], replies: replies.rows });
  } catch (err) { next(err); }
});

// POST /api/roles/tickets/:id/reply
router.post('/tickets/:id/reply', requireAuth, async (req, res, next) => {
  try {
    const { body, isInternal } = req.body;
    const { hasPermission } = require('../config/roles');
    const isSupport = hasPermission(req.user.role, 'support.view_reports');

    const ticket = await query('SELECT * FROM support_tickets WHERE id = $1', [req.params.id]);
    if (!ticket.rows.length) return res.status(404).json({ error: 'Not found' });
    if (!isSupport && ticket.rows[0].user_id !== req.user.id) return res.status(403).json({ error: 'Access denied' });

    const internal = isSupport && isInternal ? true : false;
    const result = await query(`
      INSERT INTO ticket_replies (ticket_id, author_id, body, is_internal) VALUES ($1,$2,$3,$4) RETURNING *
    `, [req.params.id, req.user.id, body, internal]);

    // Update ticket status
    if (isSupport && ticket.rows[0].status === 'open') {
      await query("UPDATE support_tickets SET status = 'in_progress', assigned_to = $1 WHERE id = $2", [req.user.id, req.params.id]);
    }

    // Notify ticket owner if support replied
    if (isSupport && !internal && ticket.rows[0].user_id !== req.user.id) {
      await query(`INSERT INTO notifications (user_id,type,title,body,link,actor_id) VALUES ($1,'system',$2,$3,$4,$5)`,
        [ticket.rows[0].user_id, `Support replied to your ticket`, `"${ticket.rows[0].subject.slice(0,60)}"`, `/support/tickets/${req.params.id}`, req.user.id]);
    }

    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
});

// PATCH /api/roles/tickets/:id — update ticket status/priority/assignment
router.patch('/tickets/:id', requireAuth, requirePermission('support.view_reports'), async (req, res, next) => {
  try {
    const { status, priority, assignedTo } = req.body;
    const fields = [], vals = [];
    let i = 1;
    if (status) { fields.push(`status = $${i++}`); vals.push(status); }
    if (priority) { fields.push(`priority = $${i++}`); vals.push(priority); }
    if (assignedTo !== undefined) { fields.push(`assigned_to = $${i++}`); vals.push(assignedTo || null); }
    if (status === 'resolved') { fields.push(`resolved_at = NOW()`); }
    if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
    vals.push(req.params.id);
    const result = await query(`UPDATE support_tickets SET ${fields.join(',')} WHERE id = $${i} RETURNING *`, vals);
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;

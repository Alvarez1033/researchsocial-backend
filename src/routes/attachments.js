const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { query } = require('../db/pool');
const { requireAuth, requireMod } = require('../middleware/auth');

const router = express.Router();

// ─── Multer config ─────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(process.cwd(), 'uploads', 'attachments');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `att_${req.user.id}_${Date.now()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|pdf/;
    const ok = allowed.test(path.extname(file.originalname).toLowerCase()) && allowed.test(file.mimetype);
    cb(ok ? null : new Error('Invalid file type'), ok);
  }
});

// ─── POST /api/attachments — upload attachment to a post ──────────────────────
router.post('/', requireAuth, upload.single('file'), async (req, res, next) => {
  try {
    const { postId, type, caption, linkUrl, linkTitle, linkDescription, displayOrder } = req.body;

    // Verify user owns the post
    const post = await query('SELECT id, author_id FROM posts WHERE id = $1', [postId]);
    if (!post.rows.length) return res.status(404).json({ error: 'Post not found' });
    if (post.rows[0].author_id !== req.user.id) return res.status(403).json({ error: 'Not your post' });

    let url = null;
    if (type === 'link') {
      url = linkUrl;
    } else if (req.file) {
      url = `/uploads/attachments/${req.file.filename}`;
    }

    if (!url) return res.status(400).json({ error: 'No file or URL provided' });

    const result = await query(`
      INSERT INTO post_attachments
        (post_id, uploader_id, type, url, caption, link_title, link_description, display_order, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
      RETURNING *
    `, [postId, req.user.id, type || 'image', url, caption || null,
        linkTitle || null, linkDescription || null, parseInt(displayOrder) || 0]);

    // Notify admins/mods about new pending attachment
    const mods = await query("SELECT id FROM users WHERE role IN ('admin','superadmin','moderator') LIMIT 10");
    for (const mod of mods.rows) {
      await query(`
        INSERT INTO notifications (user_id, type, title, body, link, actor_id)
        VALUES ($1, 'system', $2, $3, $4, $5)
      `, [mod.id, '📎 New attachment needs review', `@${req.user.handle} uploaded a ${type||'image'} to their post`, `/admin#attachments`, req.user.id]);
    }

    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File too large (max 10MB)' });
    next(err);
  }
});

// ─── GET /api/attachments/post/:postId — get attachments for a post ────────────
router.get('/post/:postId', async (req, res, next) => {
  try {
    // If not authenticated or not mod, only show approved
    const { user } = req;
    const isMod = user && ['moderator', 'admin', 'superadmin'].includes(user.role);
    const isOwner = user ? await query('SELECT 1 FROM posts WHERE id = $1 AND author_id = $2', [req.params.postId, user.id]).then(r => r.rows.length > 0) : false;

    let whereStatus = "AND pa.status = 'approved'";
    if (isMod || isOwner) whereStatus = ''; // show all

    const result = await query(`
      SELECT pa.*, u.handle as uploader_handle, u.name as uploader_name
      FROM post_attachments pa
      JOIN users u ON u.id = pa.uploader_id
      WHERE pa.post_id = $1 ${whereStatus}
      ORDER BY pa.display_order, pa.created_at
    `, [req.params.postId]);

    res.json(result.rows);
  } catch (err) { next(err); }
});

// ─── PATCH /api/attachments/:id — edit caption or remove ──────────────────────
router.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const att = await query('SELECT * FROM post_attachments WHERE id = $1', [req.params.id]);
    if (!att.rows.length) return res.status(404).json({ error: 'Attachment not found' });
    if (att.rows[0].uploader_id !== req.user.id) return res.status(403).json({ error: 'Not yours' });

    const { caption } = req.body;
    const result = await query(
      'UPDATE post_attachments SET caption = $1 WHERE id = $2 RETURNING *',
      [caption, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

// ─── DELETE /api/attachments/:id — delete own attachment ──────────────────────
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const att = await query('SELECT * FROM post_attachments WHERE id = $1', [req.params.id]);
    if (!att.rows.length) return res.status(404).json({ error: 'Not found' });

    const isMod = ['moderator', 'admin', 'superadmin'].includes(req.user.role);
    if (att.rows[0].uploader_id !== req.user.id && !isMod) {
      return res.status(403).json({ error: 'Not yours' });
    }

    // Delete file from disk if it's a local upload
    if (att.rows[0].url?.startsWith('/uploads/')) {
      const filePath = path.join(process.cwd(), att.rows[0].url);
      fs.unlink(filePath, () => {});
    }

    await query('DELETE FROM post_attachments WHERE id = $1', [req.params.id]);
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// ─── POST /api/attachments/:id/review — mod approve/reject ────────────────────
router.post('/:id/review', requireAuth, requireMod, async (req, res, next) => {
  try {
    const { action, reason } = req.body; // action: 'approve' | 'reject'
    if (!['approve', 'reject'].includes(action)) return res.status(400).json({ error: 'Invalid action' });

    const status = action === 'approve' ? 'approved' : 'rejected';
    const result = await query(`
      UPDATE post_attachments
      SET status = $1, reviewed_by = $2, reviewed_at = NOW(), rejection_reason = $3
      WHERE id = $4
      RETURNING *, (SELECT author_id FROM posts WHERE id = post_id) as post_author_id
    `, [status, req.user.id, reason || null, req.params.id]);

    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });

    const att = result.rows[0];
    // Notify post author
    if (att.post_author_id) {
      await query(`
        INSERT INTO notifications (user_id, type, title, body, link, actor_id)
        VALUES ($1, 'system', $2, $3, $4, $5)
      `, [att.post_author_id,
          action === 'approve' ? '✅ Attachment approved' : '❌ Attachment rejected',
          action === 'approve' ? 'Your attachment is now visible to all users.' : `Reason: ${reason || 'Not specified'}`,
          `/post/${att.post_id}`, req.user.id]);
    }

    // Log to moderation log
    await query('INSERT INTO moderation_log (admin_id, target_type, target_id, action, reason) VALUES ($1, $2, $3, $4, $5)',
      [req.user.id, 'attachment', att.id, action, reason || null]);

    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

// ─── GET /api/attachments/pending — all pending attachments (mod only) ─────────
router.get('/pending/all', requireAuth, requireMod, async (req, res, next) => {
  try {
    const result = await query(`
      SELECT pa.*, 
             p.title as post_title, p.id as post_id,
             u.handle as uploader_handle, u.name as uploader_name,
             u.color as uploader_color, u.initials as uploader_initials
      FROM post_attachments pa
      JOIN posts p ON p.id = pa.post_id
      JOIN users u ON u.id = pa.uploader_id
      WHERE pa.status = 'pending'
      ORDER BY pa.created_at ASC
    `);
    res.json(result.rows);
  } catch (err) { next(err); }
});

module.exports = router;

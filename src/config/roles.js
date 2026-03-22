// ─────────────────────────────────────────────────────────────────────────────
//  ResearchSocial — Role & Permission System
// ─────────────────────────────────────────────────────────────────────────────

const ROLES = {
  superadmin: {
    label: 'Superadmin',
    level: 100,
    color: '#7c2d12',
    bg: '#fff1f2',
    darkBg: '#3b0f0f',
    badge: '👑',
    description: 'Site owner — unrestricted access to everything',
  },
  admin: {
    label: 'Admin',
    level: 80,
    color: '#0369a1',
    bg: '#e0f2fe',
    darkBg: '#0c2a3e',
    badge: '🛡️',
    description: 'Executive-level admin — full site control except superadmin actions',
  },
  moderator: {
    label: 'Moderator',
    level: 60,
    color: '#b45309',
    bg: '#fef3c7',
    darkBg: '#3b2000',
    badge: '🔨',
    description: 'Staff moderator — full content and user moderation',
  },
  support: {
    label: 'Support',
    level: 40,
    color: '#6d28d9',
    bg: '#ede9fe',
    darkBg: '#2e1065',
    badge: '🎧',
    description: 'Support agent — can assist users, view reports, limited moderation',
  },
  premium: {
    label: 'Premium',
    level: 20,
    color: '#b45309',
    bg: '#fef9c3',
    darkBg: '#3b2e00',
    badge: '⭐',
    description: 'Premium subscriber — extended features',
  },
  pro: {
    label: 'Pro',
    level: 18,
    color: '#0e7490',
    bg: '#cffafe',
    darkBg: '#0c2a3e',
    badge: '🚀',
    description: 'Pro subscriber — advanced research tools',
  },
  content_creator: {
    label: 'Content Creator',
    level: 15,
    color: '#7c3aed',
    bg: '#ede9fe',
    darkBg: '#2e1065',
    badge: '✍️',
    description: 'Approved content creator — can publish featured articles',
  },
  verified: {
    label: 'Verified',
    level: 12,
    color: '#0ea5e9',
    bg: '#e0f2fe',
    darkBg: '#0c2a3e',
    badge: '✓',
    description: 'Identity-verified researcher or institution',
  },
  member: {
    label: 'Member',
    level: 1,
    color: '#4b5563',
    bg: '#f3f4f6',
    darkBg: '#1f2937',
    badge: null,
    description: 'Standard community member',
  },
};

// ─── Permission definitions ────────────────────────────────────────────────────
const PERMISSIONS = {
  // ── Posts
  'posts.create':           [1, 100],   // all members
  'posts.edit_own':         [1, 100],
  'posts.delete_own':       [1, 100],
  'posts.pin':              [60, 100],  // mod+
  'posts.feature':          [60, 100],
  'posts.approve':          [60, 100],
  'posts.reject':           [60, 100],
  'posts.ghost':            [60, 100],
  'posts.delete_any':       [60, 100],
  'posts.edit_any':         [80, 100],  // admin+

  // ── Attachments
  'attachments.upload':     [1, 100],
  'attachments.review':     [60, 100],  // mod+
  'attachments.delete_any': [60, 100],

  // ── Comments
  'comments.create':        [1, 100],
  'comments.delete_own':    [1, 100],
  'comments.delete_any':    [60, 100],
  'comments.hide':          [40, 100],  // support+

  // ── Users
  'users.follow':           [1, 100],
  'users.message':          [1, 100],
  'users.view_email':       [60, 100],  // mod+
  'users.view_any_profile': [40, 100],  // support+
  'users.mute':             [60, 100],
  'users.timeout':          [60, 100],
  'users.suspend':          [60, 100],
  'users.ban':              [80, 100],  // admin+
  'users.assign_role_support':     [80, 100],
  'users.assign_role_moderator':   [80, 100],
  'users.assign_role_admin':       [100, 100], // superadmin only
  'users.assign_role_premium':     [60, 100],
  'users.assign_role_pro':         [60, 100],
  'users.assign_role_verified':    [60, 100],
  'users.assign_role_content_creator': [80, 100],
  'users.delete_account':          [80, 100],

  // ── Tags
  'tags.create':            [60, 100],
  'tags.edit':              [60, 100],
  'tags.delete':            [80, 100],
  'tags.feature':           [60, 100],

  // ── Analytics
  'analytics.view_basic':   [40, 100],  // support+
  'analytics.view_full':    [60, 100],  // mod+

  // ── Admin panel
  'admin.access':           [40, 100],  // support+
  'admin.moderation':       [60, 100],  // mod+
  'admin.user_management':  [60, 100],
  'admin.settings':         [80, 100],  // admin+
  'admin.assign_admins':    [100, 100], // superadmin only

  // ── Support
  'support.view_reports':   [40, 100],
  'support.respond_reports':[40, 100],
  'support.view_user_dm':   [80, 100],  // admin+ only (privacy)

  // ── Content Creator
  'content.featured_post':  [15, 100],  // content_creator+
  'content.article':        [15, 100],

  // ── Premium / Pro
  'premium.extended_search':[18, 100],  // pro+
  'premium.analytics':      [20, 100],  // premium+
};

// ─── Check if a role has a permission ──────────────────────────────────────────
function hasPermission(role, permission) {
  const roleLevel = ROLES[role]?.level ?? 0;
  const [minLevel] = PERMISSIONS[permission] || [999];
  return roleLevel >= minLevel;
}

// ─── Get all permissions for a role ────────────────────────────────────────────
function getRolePermissions(role) {
  const level = ROLES[role]?.level ?? 0;
  return Object.entries(PERMISSIONS)
    .filter(([, [min]]) => level >= min)
    .map(([perm]) => perm);
}

// ─── Middleware factory ────────────────────────────────────────────────────────
function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (!hasPermission(req.user.role, permission)) {
      return res.status(403).json({
        error: 'Insufficient permissions',
        required: permission,
        your_role: req.user.role,
      });
    }
    next();
  };
}

// ─── Role rank helpers ────────────────────────────────────────────────────────
function roleLevel(role) { return ROLES[role]?.level ?? 0; }
function canManageUser(actorRole, targetRole) {
  return roleLevel(actorRole) > roleLevel(targetRole);
}

module.exports = { ROLES, PERMISSIONS, hasPermission, getRolePermissions, requirePermission, roleLevel, canManageUser };

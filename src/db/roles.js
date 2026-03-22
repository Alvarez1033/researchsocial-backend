require('dotenv').config();
const { pool } = require('./pool');

const schema = `
-- ─── Step 1: Add role_new text column if not exists ──────────────────────────
DO $$ BEGIN
  ALTER TABLE users ADD COLUMN role_new TEXT DEFAULT 'member';
  EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- ─── Step 2: Copy data — cast enum to text, map 'user' → 'member' ─────────────
UPDATE users SET role_new = CASE
  WHEN role::text = 'user'        THEN 'member'
  WHEN role::text = 'superadmin'  THEN 'superadmin'
  WHEN role::text = 'admin'       THEN 'admin'
  WHEN role::text = 'moderator'   THEN 'moderator'
  ELSE 'member'
END
WHERE role_new = 'member' OR role_new IS NULL;

-- ─── Step 3: Drop the old enum column ─────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE users DROP COLUMN IF EXISTS role;
  EXCEPTION WHEN others THEN NULL;
END $$;

-- ─── Step 4: Rename new column ────────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE users RENAME COLUMN role_new TO role;
  EXCEPTION WHEN others THEN NULL;
END $$;

-- ─── Step 5: Add check constraint (safe, only if column is now text) ──────────
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (
    role IN ('superadmin','admin','moderator','support','premium','pro','content_creator','verified','member')
  );
  EXCEPTION WHEN check_violation THEN
    -- If still violated, force-update any bad values
    UPDATE users SET role = 'member' WHERE role NOT IN ('superadmin','admin','moderator','support','premium','pro','content_creator','verified','member');
    ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (
      role IN ('superadmin','admin','moderator','support','premium','pro','content_creator','verified','member')
    );
END $$;

-- ─── Step 6: Set default ──────────────────────────────────────────────────────
ALTER TABLE users ALTER COLUMN role SET DEFAULT 'member';

-- ─── Ensure superadmin stays superadmin ───────────────────────────────────────
UPDATE users SET role = 'superadmin' WHERE email = 'admin@researchsocial.com' AND role != 'superadmin';

-- ─── Role audit log ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS role_changes (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  target_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  changed_by    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  old_role      TEXT NOT NULL,
  new_role      TEXT NOT NULL,
  reason        TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_role_changes_target ON role_changes(target_id);

-- ─── User badges ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_badges (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_key   VARCHAR(50) NOT NULL,
  badge_label VARCHAR(100) NOT NULL,
  badge_icon  VARCHAR(10),
  awarded_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, badge_key)
);

-- ─── Support tickets ──────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE ticket_status AS ENUM ('open', 'in_progress', 'resolved', 'closed');
  EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE ticket_priority AS ENUM ('low', 'medium', 'high', 'urgent');
  EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS support_tickets (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_to   UUID REFERENCES users(id) ON DELETE SET NULL,
  subject       VARCHAR(300) NOT NULL,
  body          TEXT NOT NULL,
  status        ticket_status DEFAULT 'open',
  priority      ticket_priority DEFAULT 'medium',
  category      VARCHAR(50),
  resolved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tickets_user ON support_tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON support_tickets(status);

CREATE TABLE IF NOT EXISTS ticket_replies (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_id   UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  is_internal BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_role_text ON users(role);
`;

async function addRolesTables() {
  const client = await pool.connect();
  try {
    console.log('👑 Updating roles system...');
    await client.query(schema);
    
    // Verify
    const check = await client.query("SELECT DISTINCT role FROM users ORDER BY role");
    console.log('✅ Roles system ready! Current roles in DB:', check.rows.map(r => r.role).join(', '));
  } catch (err) {
    console.error('❌ Failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

addRolesTables().catch(() => process.exit(1));

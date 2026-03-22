require('dotenv').config();
const { pool } = require('./pool');

const schema = `
-- ─── Update roles enum to include new roles ──────────────────────────────────
-- We can't easily modify pg enums, so we recreate users.role as text with a check

-- Step 1: Add new column
DO $$ BEGIN
  ALTER TABLE users ADD COLUMN role_new TEXT DEFAULT 'member';
  EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Step 2: Copy existing data
UPDATE users SET role_new = role::text WHERE role_new IS NULL OR role_new = 'member';

-- Step 3: Drop old column constraints and add check on new column
DO $$ BEGIN
  ALTER TABLE users DROP COLUMN role;
  EXCEPTION WHEN undefined_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE users RENAME COLUMN role_new TO role;
  EXCEPTION WHEN undefined_column THEN NULL;
END $$;

-- Add check constraint
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (
  role IN ('superadmin','admin','moderator','support','premium','pro','content_creator','verified','member')
);

-- Default
ALTER TABLE users ALTER COLUMN role SET DEFAULT 'member';

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
CREATE INDEX IF NOT EXISTS idx_role_changes_changed_by ON role_changes(changed_by);

-- ─── User badges (separate from roles — earned achievements) ─────────────────
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
CREATE INDEX IF NOT EXISTS idx_badges_user ON user_badges(user_id);

-- ─── Support tickets table ────────────────────────────────────────────────────
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
CREATE INDEX IF NOT EXISTS idx_tickets_assigned ON support_tickets(assigned_to, status);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON support_tickets(status);

CREATE TABLE IF NOT EXISTS ticket_replies (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_id   UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  is_internal BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ticket_replies ON ticket_replies(ticket_id, created_at);

-- ─── Index for role queries ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_users_role_text ON users(role);
`;

async function addRolesTables() {
  const client = await pool.connect();
  try {
    console.log('👑 Updating roles system...');
    await client.query(schema);
    console.log('✅ Roles system ready!');
  } catch (err) {
    console.error('❌ Failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

addRolesTables().catch(() => process.exit(1));

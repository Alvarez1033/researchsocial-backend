require('dotenv').config();
const { pool } = require('./pool');

const schema = `
-- ─── Extensions ────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ─── ENUM types ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('user', 'moderator', 'admin', 'superadmin');
  EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE post_status AS ENUM ('pending', 'approved', 'rejected', 'ghosted');
  EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE post_type AS ENUM ('proposal', 'study', 'findings', 'review', 'discussion');
  EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE user_status AS ENUM ('active', 'muted', 'timed_out', 'suspended', 'banned');
  EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE notification_type AS ENUM (
    'new_message', 'post_comment', 'post_like', 'follow',
    'collaboration_request', 'post_approved', 'post_rejected',
    'mention', 'system'
  );
  EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── USERS ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  handle          VARCHAR(30) UNIQUE NOT NULL,
  email           VARCHAR(255) UNIQUE NOT NULL,
  password_hash   VARCHAR(255) NOT NULL,
  name            VARCHAR(100) NOT NULL,
  bio             TEXT,
  title           VARCHAR(100),
  affiliation     VARCHAR(200),
  location        VARCHAR(100),
  website         VARCHAR(255),
  avatar_url      VARCHAR(500),
  color           VARCHAR(20) DEFAULT '#818cf8',
  initials        VARCHAR(4),
  role            user_role DEFAULT 'user',
  status          user_status DEFAULT 'active',
  is_verified     BOOLEAN DEFAULT FALSE,
  open_to_collab  BOOLEAN DEFAULT TRUE,
  interests       TEXT[] DEFAULT '{}',
  followers_count INTEGER DEFAULT 0,
  following_count INTEGER DEFAULT 0,
  papers_count    INTEGER DEFAULT 0,
  citations_count INTEGER DEFAULT 0,
  timeout_until   TIMESTAMPTZ,
  suspension_reason TEXT,
  last_seen_at    TIMESTAMPTZ,
  email_verified  BOOLEAN DEFAULT FALSE,
  refresh_token   TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_handle ON users(handle);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

-- ─── TAGS ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tags (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        VARCHAR(50) UNIQUE NOT NULL,
  slug        VARCHAR(50) UNIQUE NOT NULL,
  category    VARCHAR(50),
  color       VARCHAR(20) DEFAULT '#818cf8',
  description TEXT,
  post_count  INTEGER DEFAULT 0,
  is_featured BOOLEAN DEFAULT FALSE,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tags_slug ON tags(slug);
CREATE INDEX IF NOT EXISTS idx_tags_category ON tags(category);

-- ─── POSTS ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS posts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  author_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type            post_type NOT NULL DEFAULT 'discussion',
  status          post_status DEFAULT 'approved',
  title           VARCHAR(300) NOT NULL,
  excerpt         TEXT NOT NULL,
  body            TEXT,
  thumbnail_type  VARCHAR(20) DEFAULT 'none',
  thumbnail_url   VARCHAR(500),
  is_pinned       BOOLEAN DEFAULT FALSE,
  is_featured     BOOLEAN DEFAULT FALSE,
  likes_count     INTEGER DEFAULT 0,
  comments_count  INTEGER DEFAULT 0,
  views_count     INTEGER DEFAULT 0,
  shares_count    INTEGER DEFAULT 0,
  moderation_note TEXT,
  moderated_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  moderated_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_id);
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
CREATE INDEX IF NOT EXISTS idx_posts_pinned ON posts(is_pinned);
CREATE INDEX IF NOT EXISTS idx_posts_featured ON posts(is_featured);
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);

-- ─── POST TAGS (junction) ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS post_tags (
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  tag_id  UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_post_tags_tag ON post_tags(tag_id);

-- ─── LIKES ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS likes (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id    UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, post_id)
);
CREATE INDEX IF NOT EXISTS idx_likes_post ON likes(post_id);

-- ─── COMMENTS ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS comments (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  post_id     UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id   UUID REFERENCES comments(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  likes_count INTEGER DEFAULT 0,
  is_hidden   BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id);
CREATE INDEX IF NOT EXISTS idx_comments_author ON comments(author_id);

-- ─── FOLLOWS ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS follows (
  follower_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (follower_id, following_id)
);
CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_id);

-- ─── COLLABORATION REQUESTS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS collab_requests (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  from_user   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id     UUID REFERENCES posts(id) ON DELETE SET NULL,
  message     TEXT,
  status      VARCHAR(20) DEFAULT 'pending',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(from_user, post_id)
);

-- ─── MESSAGES ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversations (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conversation_participants (
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_at    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_conv_participants_user ON conversation_participants(user_id);

CREATE TABLE IF NOT EXISTS messages (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body            TEXT NOT NULL,
  is_deleted      BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);

-- ─── NOTIFICATIONS ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        notification_type NOT NULL,
  title       VARCHAR(200) NOT NULL,
  body        TEXT,
  link        VARCHAR(500),
  actor_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  is_read     BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifs_user ON notifications(user_id, is_read, created_at DESC);

-- ─── BOOKMARKS ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bookmarks (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id    UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, post_id)
);

-- ─── MODERATION LOG ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS moderation_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_id    UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  target_type VARCHAR(20) NOT NULL,  -- 'user', 'post', 'comment'
  target_id   UUID NOT NULL,
  action      VARCHAR(50) NOT NULL,  -- 'approve', 'reject', 'ghost', 'mute', 'ban', etc.
  reason      TEXT,
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_modlog_admin ON moderation_log(admin_id);
CREATE INDEX IF NOT EXISTS idx_modlog_target ON moderation_log(target_id);
CREATE INDEX IF NOT EXISTS idx_modlog_created ON moderation_log(created_at DESC);

-- ─── SITE SETTINGS ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS site_settings (
  key         VARCHAR(100) PRIMARY KEY,
  value       JSONB NOT NULL,
  description TEXT,
  updated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── ADMIN CHAT ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_messages (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sender_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── TRIGGERS: updated_at ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER posts_updated_at BEFORE UPDATE ON posts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER comments_updated_at BEFORE UPDATE ON comments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER conversations_updated_at BEFORE UPDATE ON conversations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── Default site settings ───────────────────────────────────────────────────
INSERT INTO site_settings (key, value, description) VALUES
  ('require_post_approval', 'false', 'New posts require admin approval before going live'),
  ('allow_registration', 'true', 'Allow new user registrations'),
  ('maintenance_mode', 'false', 'Show maintenance banner'),
  ('featured_tag_ids', '[]', 'Tag IDs to feature on homepage'),
  ('announcement', '""', 'Site-wide announcement banner text'),
  ('max_posts_per_day', '10', 'Max posts a user can make per day'),
  ('verify_on_signup', 'false', 'Require email verification on signup')
ON CONFLICT (key) DO NOTHING;
`;

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🗄️  Running database migrations...');
    await client.query(schema);
    console.log('✅  Migrations complete!');
  } catch (err) {
    console.error('❌  Migration failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(() => process.exit(1));

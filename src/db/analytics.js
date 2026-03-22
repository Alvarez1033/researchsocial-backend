require('dotenv').config();
const { pool } = require('./pool');

const schema = `
-- ─── Analytics tables ─────────────────────────────────────────────────────────

-- Page views / visits
CREATE TABLE IF NOT EXISTS page_views (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  path        VARCHAR(500) NOT NULL,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  session_id  VARCHAR(100),
  ip_hash     VARCHAR(64),   -- hashed for privacy
  referrer    VARCHAR(500),
  user_agent  VARCHAR(500),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_views_path ON page_views(path, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_views_created ON page_views(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_views_session ON page_views(session_id);

-- Daily summary (cached counts — updated by cron or on-demand)
CREATE TABLE IF NOT EXISTS analytics_daily (
  date             DATE PRIMARY KEY,
  total_views      INTEGER DEFAULT 0,
  unique_visitors  INTEGER DEFAULT 0,
  new_users        INTEGER DEFAULT 0,
  new_posts        INTEGER DEFAULT 0,
  new_messages     INTEGER DEFAULT 0,
  new_comments     INTEGER DEFAULT 0,
  new_likes        INTEGER DEFAULT 0
);

-- Active sessions (online users)
CREATE TABLE IF NOT EXISTS active_sessions (
  session_id   VARCHAR(100) PRIMARY KEY,
  user_id      UUID REFERENCES users(id) ON DELETE CASCADE,
  path         VARCHAR(500),
  last_seen    TIMESTAMPTZ DEFAULT NOW(),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sessions_last_seen ON active_sessions(last_seen);
`;

async function addAnalyticsTables() {
  const client = await pool.connect();
  try {
    console.log('📊 Adding analytics tables...');
    await client.query(schema);
    console.log('✅ Analytics tables ready!');
  } catch (err) {
    console.error('❌ Failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

addAnalyticsTables().catch(() => process.exit(1));

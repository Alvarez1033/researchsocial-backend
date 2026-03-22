require('dotenv').config();
const { pool } = require('./pool');

const schema = `
-- ─── Friend requests & friendships ───────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE friend_status AS ENUM ('pending', 'accepted', 'declined', 'blocked');
  EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS friendships (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  requester_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       friend_status DEFAULT 'pending',
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(requester_id, addressee_id)
);
CREATE INDEX IF NOT EXISTS idx_friends_requester ON friendships(requester_id, status);
CREATE INDEX IF NOT EXISTS idx_friends_addressee ON friendships(addressee_id, status);

-- Trigger updated_at
DO $$ BEGIN
  CREATE TRIGGER friendships_updated_at BEFORE UPDATE ON friendships
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
`;

async function addFriendsTables() {
  const client = await pool.connect();
  try {
    console.log('👥 Adding friends tables...');
    await client.query(schema);
    console.log('✅ Friends tables ready!');
  } catch (err) {
    console.error('❌ Failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

addFriendsTables().catch(() => process.exit(1));

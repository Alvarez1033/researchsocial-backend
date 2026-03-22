require('dotenv').config();
const { pool } = require('./pool');

async function addFriendsTables() {
  const client = await pool.connect();
  try {
    console.log('👥 Setting up friends tables...');

    // Create table using TEXT + CHECK instead of ENUM (avoids ENUM creation failures)
    await client.query(`
      CREATE TABLE IF NOT EXISTS friendships (
        id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        requester_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        addressee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status       TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','accepted','declined','blocked')),
        created_at   TIMESTAMPTZ DEFAULT NOW(),
        updated_at   TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(requester_id, addressee_id)
      );
    `);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_friends_requester ON friendships(requester_id, status);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_friends_addressee ON friendships(addressee_id, status);`);

    // If table existed with old ENUM type, migrate it to TEXT
    try {
      await client.query(`
        ALTER TABLE friendships
          ALTER COLUMN status TYPE TEXT USING status::TEXT,
          ALTER COLUMN status SET DEFAULT 'pending',
          ALTER COLUMN status SET NOT NULL;
      `);
      // Re-add check constraint if missing
      await client.query(`
        DO $$ BEGIN
          ALTER TABLE friendships ADD CONSTRAINT friendships_status_check
            CHECK (status IN ('pending','accepted','declined','blocked'));
          EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
      `);
    } catch (_) {}

    // Trigger for updated_at
    await client.query(`
      CREATE OR REPLACE FUNCTION update_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
      $$ LANGUAGE plpgsql;
    `);
    await client.query(`
      DO $$ BEGIN
        CREATE TRIGGER friendships_updated_at BEFORE UPDATE ON friendships
          FOR EACH ROW EXECUTE FUNCTION update_updated_at();
        EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    console.log('✅ Friends tables ready!');
  } catch (err) {
    console.error('❌ Friends migration failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

addFriendsTables().catch(() => process.exit(1));

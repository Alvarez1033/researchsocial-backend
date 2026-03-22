require('dotenv').config();
const { pool } = require('./pool');

const schema = `
-- ─── Post attachments (images, charts, links) ───────────────────────────────

DO $$ BEGIN
  CREATE TYPE attachment_type AS ENUM ('image', 'chart', 'link', 'pdf');
  EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE attachment_status AS ENUM ('pending', 'approved', 'rejected');
  EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS post_attachments (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  post_id       UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  uploader_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type          attachment_type NOT NULL,
  url           VARCHAR(1000),
  thumbnail_url VARCHAR(1000),
  caption       TEXT,
  link_title    VARCHAR(300),
  link_description TEXT,
  status        attachment_status DEFAULT 'pending',
  reviewed_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at   TIMESTAMPTZ,
  rejection_reason TEXT,
  display_order INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_attachments_post ON post_attachments(post_id);
CREATE INDEX IF NOT EXISTS idx_attachments_status ON post_attachments(status);
CREATE INDEX IF NOT EXISTS idx_attachments_uploader ON post_attachments(uploader_id);

-- ─── Extend posts table with structured body ─────────────────────────────────
-- Add structured_body column if not exists
DO $$ BEGIN
  ALTER TABLE posts ADD COLUMN structured_body JSONB DEFAULT '{}';
  EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
`;

async function addAttachmentsTables() {
  const client = await pool.connect();
  try {
    console.log('📎 Adding attachments tables...');
    await client.query(schema);
    console.log('✅ Attachments tables ready!');
  } catch (err) {
    console.error('❌ Failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

addAttachmentsTables().catch(() => process.exit(1));

require('dotenv').config();
const { pool } = require('./pool');

async function fix() {
  const client = await pool.connect();
  try {
    console.log('🔧 Fixing role column...');
    
    // Check current state
    const colType = await client.query(`
      SELECT data_type, udt_name 
      FROM information_schema.columns 
      WHERE table_name='users' AND column_name='role'
    `);
    console.log('Current role column type:', colType.rows[0]);
    
    const isEnum = colType.rows[0]?.udt_name === 'user_role';
    
    if (isEnum) {
      console.log('Still enum — converting...');
      
      // Add text column
      await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS role_text TEXT DEFAULT 'member'");
      
      // Copy with mapping
      await client.query(`
        UPDATE users SET role_text = CASE
          WHEN role::text IN ('superadmin','admin','moderator') THEN role::text
          ELSE 'member'
        END
      `);
      
      // Drop enum column
      await client.query("ALTER TABLE users DROP COLUMN role");
      
      // Rename
      await client.query("ALTER TABLE users RENAME COLUMN role_text TO role");
      
      // Add constraint
      await client.query(`
        ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (
          role IN ('superadmin','admin','moderator','support','premium','pro','content_creator','verified','member')
        )
      `);
      
      await client.query("ALTER TABLE users ALTER COLUMN role SET DEFAULT 'member'");
      console.log('✅ Role column converted to text!');
    } else {
      console.log('Already text — just ensuring constraint...');
      // Update any bad values
      await client.query(`
        UPDATE users SET role = 'member' 
        WHERE role NOT IN ('superadmin','admin','moderator','support','premium','pro','content_creator','verified','member')
      `);
      
      // Drop and re-add constraint
      await client.query("ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check");
      await client.query(`
        ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (
          role IN ('superadmin','admin','moderator','support','premium','pro','content_creator','verified','member')
        )
      `);
      console.log('✅ Constraint updated!');
    }
    
    // Create role_changes table
    await client.query(`
      CREATE TABLE IF NOT EXISTS role_changes (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        target_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        changed_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        old_role TEXT NOT NULL, new_role TEXT NOT NULL, reason TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    
    // Create user_badges table
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_badges (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        badge_key VARCHAR(50) NOT NULL, badge_label VARCHAR(100) NOT NULL,
        badge_icon VARCHAR(10), awarded_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, badge_key)
      )
    `);

    // Create ticket tables
    await client.query(`
      DO $$ BEGIN CREATE TYPE ticket_status AS ENUM ('open','in_progress','resolved','closed');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);
    await client.query(`
      DO $$ BEGIN CREATE TYPE ticket_priority AS ENUM ('low','medium','high','urgent');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS support_tickets (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
        subject VARCHAR(300) NOT NULL, body TEXT NOT NULL,
        status ticket_status DEFAULT 'open', priority ticket_priority DEFAULT 'medium',
        category VARCHAR(50), resolved_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS ticket_replies (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
        author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        body TEXT NOT NULL, is_internal BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    
    const roles = await client.query("SELECT DISTINCT role FROM users ORDER BY role");
    console.log('Roles in DB:', roles.rows.map(r=>r.role).join(', '));
    console.log('✅ All done!');
  } catch(err) {
    console.error('❌', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}
fix().catch(() => process.exit(1));

require('dotenv').config();
const { pool } = require('./pool');

async function reset() {
  const client = await pool.connect();
  try {
    console.log('🗑️  Clearing all data (keeping admin user)...');
    
    // Delete in order respecting foreign keys
    await client.query('DELETE FROM admin_messages');
    await client.query('DELETE FROM moderation_log');
    await client.query('DELETE FROM bookmarks');
    await client.query('DELETE FROM notifications');
    await client.query('DELETE FROM messages');
    await client.query('DELETE FROM conversation_participants');
    await client.query('DELETE FROM conversations');
    await client.query('DELETE FROM collab_requests');
    await client.query('DELETE FROM follows');
    await client.query('DELETE FROM comments');
    await client.query('DELETE FROM likes');
    await client.query('DELETE FROM post_tags');
    await client.query('DELETE FROM posts');
    await client.query('DELETE FROM tags');
    await client.query('DELETE FROM site_settings');
    // Delete all users except admin
    await client.query("DELETE FROM users WHERE role != 'superadmin'");
    
    // Reset post/follower counts on admin
    await client.query("UPDATE users SET followers_count=0, following_count=0, papers_count=0, citations_count=0");

    console.log('✅ Database cleared! Only admin user remains.');
    
    const admin = await client.query("SELECT handle, email, role FROM users");
    admin.rows.forEach(u => console.log(`  Kept: @${u.handle} (${u.email}) — ${u.role}`));
  } catch(err) {
    console.error('❌ Reset error:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

reset().catch(() => process.exit(1));

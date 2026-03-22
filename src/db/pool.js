const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'researchsocial',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD || undefined,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('Unexpected database error:', err);
});

// Helper: run a query
async function query(text, params) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    if (process.env.NODE_ENV === 'development' && duration > 100) {
      console.log('Slow query:', { text: text.slice(0, 80), duration, rows: res.rowCount });
    }
    return res;
  } catch (err) {
    console.error('Query error:', { text: text.slice(0, 80), params, error: err.message });
    throw err;
  }
}

// Helper: get a client for transactions
async function getClient() {
  const client = await pool.connect();
  const originalQuery = client.query.bind(client);
  const release = client.release.bind(client);
  client.query = (...args) => originalQuery(...args);
  client.release = () => { client.query = originalQuery; release(); };
  return client;
}

module.exports = { pool, query, getClient };

// =============================================================
// HugoMed - muunganisho wa PostgreSQL
// Railway inaweka DATABASE_URL yenyewe (angalia README).
// =============================================================

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.warn('ONYO: DATABASE_URL haijawekwa. Weka kwenye Railway > Variables.');
}

// Ndani ya Railway hakuna haja ya SSL.
// Ukiunganisha kutoka nje (public URL), weka DATABASE_SSL=true.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

pool.on('error', (err) => {
  console.error('Kosa la database pool:', err.message);
});

// Kutumia: db.query('SELECT * FROM patients WHERE tenant_id = $1', [tenantId])
function query(text, params) {
  return pool.query(text, params);
}

// Kwa kazi zinazohitaji hatua nyingi kwa pamoja (transaction)
async function transaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Inaunda majedwali yote kutoka schema.sql (kama hayapo tayari)
async function runSchema() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
}

module.exports = { pool, query, transaction, runSchema };

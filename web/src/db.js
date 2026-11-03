const fs = require('fs');
const path = require('path');
const { Pool, types } = require('pg');
const config = require('./config');

// Kolom DATE dikembalikan sebagai teks 'YYYY-MM-DD' (bukan Date) agar hash dokumen stabil
types.setTypeParser(1082, (v) => v);

const pool = new Pool({ connectionString: config.databaseUrl });

async function migrate() {
  const dir = path.join(__dirname, '..', 'migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    await pool.query(fs.readFileSync(path.join(dir, f), 'utf8'));
  }
}

async function waitForDb(retries = 30) {
  for (let i = 0; i < retries; i++) {
    try { await pool.query('SELECT 1'); return; } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

const toVector = (arr) => '[' + arr.map((v) => Number(v).toFixed(6)).join(',') + ']';

module.exports = { pool, migrate, waitForDb, toVector };

// Kunci penerbit Ed25519. Kunci privat disimpan di berkas (KEY_DIR), kunci publik di basis data.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const { pool } = require('./db');

const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
let active = null; // { keyId, privateKey, publicRaw }

const rawPublic = (pubKeyObj) => pubKeyObj.export({ format: 'der', type: 'spki' }).subarray(-32);
const keyIdOf = (raw) => crypto.createHash('sha256').update(raw).digest().subarray(0, 4);
const publicFromRaw = (raw) => crypto.createPublicKey({ key: Buffer.concat([SPKI_ED25519_PREFIX, raw]), format: 'der', type: 'spki' });

async function loadOrCreateIssuerKey() {
  fs.mkdirSync(config.keyDir, { recursive: true });
  const file = path.join(config.keyDir, 'issuer_ed25519.pem');
  let privateKey;
  if (fs.existsSync(file)) {
    privateKey = crypto.createPrivateKey(fs.readFileSync(file));
  } else {
    const kp = crypto.generateKeyPairSync('ed25519');
    privateKey = kp.privateKey;
    fs.writeFileSync(file, privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 });
    console.log(`[keys] kunci penerbit baru dibuat: ${file}`);
  }
  const publicRaw = rawPublic(crypto.createPublicKey(privateKey));
  const keyId = keyIdOf(publicRaw);
  await pool.query(
    `INSERT INTO issuer_keys (key_id, public_key) VALUES ($1, $2) ON CONFLICT (key_id) DO NOTHING`,
    [keyId, publicRaw]);
  active = { keyId, privateKey, publicRaw };
  return active;
}

function issuerKey() {
  if (!active) throw new Error('Kunci penerbit belum dimuat');
  return active;
}

async function publicKeyById(keyId) {
  const { rows } = await pool.query('SELECT public_key, active FROM issuer_keys WHERE key_id = $1', [keyId]);
  if (!rows.length) return null;
  return { key: publicFromRaw(rows[0].public_key), active: rows[0].active };
}

module.exports = { loadOrCreateIssuerKey, issuerKey, publicKeyById, keyIdOf };

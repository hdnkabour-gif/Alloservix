'use strict';
// Passphrase-encrypted backup container, so an owner can keep an off-volume copy without trusting the storage location.
// Format: "ALLOBK01" | salt(16) | iv(12) | tag(16) | ciphertext   (AES-256-GCM, key = scrypt(passphrase, salt), header authenticated).
// The passphrase is never stored by the application: lose it and the export is unrecoverable.
const crypto = require('node:crypto');
const MAGIC = Buffer.from('ALLOBK01');
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 96 * 1024 * 1024 };

function checkPassphrase(p) {
  if (typeof p !== 'string' || p.length < 16 || p.length > 200) { const e = new Error('Phrase secrète de 16 à 200 caractères requise'); e.public = true; e.status = 400; throw e; }
  return p.normalize('NFKC');
}
function encryptBuffer(plain, passphrase) {
  const pass = checkPassphrase(passphrase), salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', crypto.scryptSync(pass, salt, 32, SCRYPT), iv);
  cipher.setAAD(MAGIC);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), ct]);
}
function decryptBuffer(blob, passphrase) {
  const bad = () => { const e = new Error('Phrase secrète incorrecte ou fichier corrompu'); e.public = true; e.status = 400; return e; };
  if (!Buffer.isBuffer(blob) || blob.length < MAGIC.length + 44 || !blob.subarray(0, 8).equals(MAGIC) || typeof passphrase !== 'string') throw bad();
  try {
    const salt = blob.subarray(8, 24), iv = blob.subarray(24, 36), tag = blob.subarray(36, 52);
    const d = crypto.createDecipheriv('aes-256-gcm', crypto.scryptSync(passphrase.normalize('NFKC'), salt, 32, SCRYPT), iv);
    d.setAAD(MAGIC); d.setAuthTag(tag);
    return Buffer.concat([d.update(blob.subarray(52)), d.final()]);
  } catch { throw bad(); }
}
module.exports = { encryptBuffer, decryptBuffer, MAGIC };

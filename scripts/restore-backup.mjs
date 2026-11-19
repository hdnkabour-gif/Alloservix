// Decrypt an ALLOSERVIX encrypted backup export and verify it. Run on a trusted machine (Node >= 22).
//   ALLO_BACKUP_PASSPHRASE='your passphrase' node scripts/restore-backup.mjs alloservix-20261119-120000.sqlite.enc restored.sqlite
// The passphrase is read from the environment (never from argv/history). The output file is never overwritten.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { decryptBuffer } = require('../backup-crypto.js');
const { DatabaseSync } = require('node:sqlite');
const [input, output] = process.argv.slice(2);
if (!input || !output || !process.env.ALLO_BACKUP_PASSPHRASE) { console.error('usage: ALLO_BACKUP_PASSPHRASE=… node scripts/restore-backup.mjs <export.enc> <output.sqlite>'); process.exit(2); }
if (fs.existsSync(output)) { console.error('refusing to overwrite ' + output); process.exit(2); }
const plain = decryptBuffer(fs.readFileSync(input), process.env.ALLO_BACKUP_PASSPHRASE);
fs.writeFileSync(output, plain, { mode: 0o600, flag: 'wx' });
const db = new DatabaseSync(output, { readOnly: true });
const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
const counts = Object.fromEntries(['services', 'service_requests', 'technicians', 'inquiries', 'staff_accounts', 'audit'].map(t => { try { return [t, db.prepare(`SELECT count(*) n FROM ${t}`).get().n]; } catch { return [t, null]; } }));
db.close();
console.log(JSON.stringify({ output, integrity, counts }, null, 2));
process.exit(integrity === 'ok' ? 0 : 1);

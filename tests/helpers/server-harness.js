'use strict';
// Test harness: starts the real server as a child process with an isolated data directory.
// Ambient provider keys are always blanked so tests can never call real AI vendors.
const crypto = require('node:crypto'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..', '..');

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32encode(buf) { let bits = 0, v = 0, out = ''; for (const b of buf) { v = (v << 8) | b; bits += 8; while (bits >= 5) { out += B32[(v >>> (bits - 5)) & 31]; bits -= 5; } v &= (1 << bits) - 1; } if (bits) out += B32[(v << (5 - bits)) & 31]; return out; }
function b32decode(s) { let bits = 0, v = 0; const out = []; for (const c of s) { v = (v << 5) | B32.indexOf(c); bits += 5; if (bits >= 8) { bits -= 8; out.push((v >> bits) & 255); v &= (1 << bits) - 1; } } return Buffer.from(out); }
function otpAt(secret, step) { const m = Buffer.alloc(8); m.writeBigUInt64BE(BigInt(step)); const h = crypto.createHmac('sha1', b32decode(secret)).update(m).digest(), o = h.at(-1) & 15; return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0'); }
// Returns a valid code that was not used before for this secret (server rejects replays of a step).
const used = new Map();
function code(secret, { peek = false } = {}) { // peek: do not reserve the step (for requests the server must reject without consuming)
  const cur = Math.floor(Date.now() / 30000), last = used.get(secret) || 0, step = Math.max(cur, last + 1);
  if (peek) return otpAt(secret, step > cur + 5 ? cur : step); // may be a replay: callers only use it where the server must refuse anyway
  if (step > cur + 5) throw new Error('test harness: next TOTP step not yet valid for this secret; use another account');
  used.set(secret, step); return otpAt(secret, step);
}
const freePort = () => new Promise((resolve, reject) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); s.on('error', reject); });
const scrypt = pw => { const salt = crypto.randomBytes(24); return salt.toString('hex') + ':' + crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex'); };

async function startServer(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'allo-rbac-')), port = await freePort(), url = 'http://127.0.0.1:' + port;
  const owner = { email: 'owner@example.org', password: 'Bootstrap-Owner-Phrase-2026!', secret: b32encode(crypto.randomBytes(20)) }; // unique per server: TOTP steps are tracked per secret
  const env = {
    ...process.env, PORT: String(port), DATA_DIR: dir, NODE_ENV: 'test',
    ADMIN_EMAIL: owner.email, ADMIN_PASSWORD_HASH: scrypt(owner.password), ADMIN_TOTP_SECRET: owner.secret,
    ALLO_DATA_KEY: crypto.randomBytes(32).toString('hex'), ENABLE_REQUESTS: 'true', ADMIN_REAUTH_SECONDS: '300', ADMIN_RATE_SCALE: '100', ADMIN_TOTP_WINDOW: '5',
    OPENAI_API_KEY: '', GEMINI_API_KEY: '', ANTHROPIC_API_KEY: '', DEEPSEEK_API_KEY: '', ENABLE_AI: 'false', ...extra
  };
  const child = spawn(process.execPath, ['server.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let errs = ''; child.stderr.on('data', d => { errs += d.toString(); });
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) break;
    try { if ((await fetch(url + '/health')).ok) break; } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 70));
  }
  const stop = () => { child.kill(); fs.rmSync(dir, { recursive: true, force: true }); };
  return { url, port, dir, owner, env, stop, errors: () => errs };
}

// Minimal client with cookie + CSRF handling.
class Client {
  constructor(url) { this.url = url; this.cookie = ''; this.csrf = ''; }
  async call(method, p, data, headers = {}) {
    const h = { ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers };
    if (this.cookie) h.Cookie = this.cookie;
    if (this.csrf && method !== 'GET') h['X-CSRF-Token'] = this.csrf;
    const r = await fetch(this.url + p, { method, headers: h, body: data !== undefined ? JSON.stringify(data) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc && sc.startsWith('allo_admin=')) this.cookie = sc.split(';')[0];
    let body = null; const t = await r.text(); try { body = JSON.parse(t); } catch { body = t; }
    return { status: r.status, body, headers: r.headers };
  }
  get(p) { return this.call('GET', p); }
  post(p, d = {}) { return this.call('POST', p, d); }
  put(p, d = {}) { return this.call('PUT', p, d); }
  async login(email, password, secret) {
    const r = await this.call('POST', '/api/admin/login', { email, password, totp: code(secret) });
    if (r.status === 200) this.csrf = r.body.csrf;
    return r;
  }
}
module.exports = { startServer, Client, code, otpAt, root };

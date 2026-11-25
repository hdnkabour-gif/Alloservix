'use strict';
// #31: team notification for a new service request, behind a replaceable transport.
// - ONE notification per event: a unique event_key (e.g. "request_created:<id>"), so a retried
//   request, a double call or a restart never alerts twice.
// - Every attempt is recorded in notification_deliveries (status, attempts, timestamps, error
//   class): the team can see whether an alert was really delivered, not just that a row exists.
// - The message carries NO personal data: reference, service, city and the admin link only.
//   Contact details stay encrypted in the request and are read in the protected inbox.
// - Transports: "none" (default: nothing is sent, status not_configured), "mock" (writes to a
//   local outbox file in DATA_DIR, for isolated tests), "mock-fail" (always fails, for tests).
//   A real channel (e-mail, WhatsApp, push) needs its own approval and delivery test.
// Delivery semantics (#34 review): AT-LEAST-ONCE, never "exactly once".
// - A send is fenced by a random claim token: only the current claim holder can record the outcome.
// - A claim older than the lease (process crashed or stalled) may be taken over; the expired attempt is
//   counted in uncertain_attempts (it may or may not have reached the team) and the alert is sent again.
// - A send that does not finish within timeoutMs is recorded as "uncertain" and NOT re-sent
//   automatically: staff see it in the log and the request itself is always in the inbox.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');

const MAX_ATTEMPTS = 3;
// A claim older than this is considered abandoned (process crashed while sending) and may be taken over.
const CLAIM_LEASE_MS = 5 * 60 * 1000;
const now = () => new Date().toISOString();

function createNotifier(db, { transport = process.env.NOTIFY_TRANSPORT || 'none', dataDir = process.env.DATA_DIR || path.join(__dirname, '.data'), adminLink = '/ops-v10/index.html', send: sendOverride = null, timeoutMs = 10000 } = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS notification_deliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT, event_key TEXT NOT NULL UNIQUE, kind TEXT NOT NULL,
    reference TEXT NOT NULL, channel TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','sending','delivered','failed','uncertain','not_configured')),
    attempts INTEGER NOT NULL DEFAULT 0, uncertain_attempts INTEGER NOT NULL DEFAULT 0, claim_token TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, delivered_at TEXT, last_error TEXT NOT NULL DEFAULT '')`);
  const outbox = path.join(dataDir, 'mock-outbox.jsonl');
  const transports = {
    none: null,
    mock: message => { fs.mkdirSync(dataDir, { recursive: true }); fs.appendFileSync(outbox, JSON.stringify(message) + '\n', { mode: 0o600 }); },
    'mock-fail': () => { throw new Error('mock transport failure'); }
  };
  if (!Object.hasOwn(transports, transport)) throw new Error('Unknown NOTIFY_TRANSPORT');
  let send = sendOverride || transports[transport];

  // Atomic claim (#34 review): only the process whose UPDATE changes the row may send, and it receives a
  // random token. A claim past its lease may be taken over; that expired attempt is counted as uncertain.
  const claim = key => {
    const token = crypto.randomBytes(16).toString('hex');
    const changed = db.prepare(`UPDATE notification_deliveries SET status='sending',claim_token=?,attempts=attempts+1,
       uncertain_attempts=uncertain_attempts+CASE WHEN status='sending' THEN 1 ELSE 0 END,updated_at=?
       WHERE event_key=? AND attempts<? AND (status IN ('pending','failed') OR (status='sending' AND updated_at<?))`)
      .run(token, now(), key, MAX_ATTEMPTS, new Date(Date.now() - CLAIM_LEASE_MS).toISOString()).changes === 1;
    return changed ? token : null;
  };
  // Fenced finalization: only the current claim holder may record the outcome.
  const finalize = (key, token, status, error = '') => db.prepare(`UPDATE notification_deliveries SET status=?,claim_token=NULL,updated_at=?,last_error=?,
       delivered_at=CASE WHEN ?='delivered' THEN ? ELSE delivered_at END WHERE event_key=? AND claim_token=? AND status='sending'`)
    .run(status, now(), error, status, now(), key, token).changes === 1;
  const current = key => db.prepare('SELECT * FROM notification_deliveries WHERE event_key=?').get(key);
  const withTimeout = p => new Promise((resolve, reject) => {
    const t = setTimeout(() => { const e = new Error('timeout'); e.name = 'Timeout'; reject(e); }, timeoutMs);
    Promise.resolve(p).then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });

  /** Idempotent per event; at-least-once delivery (see header). Synchronous transports finish before it returns. */
  async function notify(kind, eventId, { reference, service = '', city = '' }) {
    const key = `${kind}:${eventId}`;
    const existed = Boolean(current(key));
    if (!existed) db.prepare("INSERT OR IGNORE INTO notification_deliveries(event_key,kind,reference,channel,status,created_at,updated_at) VALUES(?,?,?,?, 'pending',?,?)").run(key, kind, reference, transport, now(), now());
    if (!send) {
      db.prepare("UPDATE notification_deliveries SET status='not_configured',updated_at=? WHERE event_key=? AND status='pending'").run(now(), key);
      return { status: current(key).status, duplicate: existed };
    }
    const message = { kind, reference, service, city, link: adminLink, at: now() };
    let claimed = false, fenced = false, token;
    while ((token = claim(key))) {
      claimed = true;
      try {
        const r = send(message);
        if (r && typeof r.then === 'function') await withTimeout(r);
        fenced = !finalize(key, token, 'delivered');
        break;
      } catch (e) {
        // Only the error class is stored: a transport message could echo request content.
        const name = String(e?.name || 'Error').slice(0, 60);
        if (name === 'Timeout') { fenced = !finalize(key, token, 'uncertain', name); break; }
        if (!finalize(key, token, 'failed', name)) { fenced = true; break; }
      }
    }
    return { status: current(key).status, duplicate: existed || !claimed, ...(fenced ? { fenced: true } : {}) };
  }

  const list = () => db.prepare('SELECT event_key,kind,reference,channel,status,attempts,uncertain_attempts,created_at,updated_at,delivered_at,last_error FROM notification_deliveries ORDER BY id DESC LIMIT 100').all();
  return { notify, list, transport, MAX_ATTEMPTS, setSend: fn => { send = fn; } };
}

module.exports = { createNotifier, MAX_ATTEMPTS };

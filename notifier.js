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
const fs = require('node:fs'), path = require('node:path');

const MAX_ATTEMPTS = 3;
// A claim older than this is considered abandoned (process crashed while sending) and may be taken over.
const CLAIM_LEASE_MS = 5 * 60 * 1000;
const now = () => new Date().toISOString();

function createNotifier(db, { transport = process.env.NOTIFY_TRANSPORT || 'none', dataDir = process.env.DATA_DIR || path.join(__dirname, '.data'), adminLink = '/ops-v10/index.html', send: sendOverride = null } = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS notification_deliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT, event_key TEXT NOT NULL UNIQUE, kind TEXT NOT NULL,
    reference TEXT NOT NULL, channel TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','sending','delivered','failed','not_configured')),
    attempts INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, delivered_at TEXT, last_error TEXT NOT NULL DEFAULT '')`);
  const outbox = path.join(dataDir, 'mock-outbox.jsonl');
  const transports = {
    none: null,
    mock: message => { fs.mkdirSync(dataDir, { recursive: true }); fs.appendFileSync(outbox, JSON.stringify(message) + '\n', { mode: 0o600 }); },
    'mock-fail': () => { throw new Error('mock transport failure'); }
  };
  if (!Object.hasOwn(transports, transport)) throw new Error('Unknown NOTIFY_TRANSPORT');
  let send = sendOverride || transports[transport];

  // Atomic claim (#34 review): only the process whose UPDATE changes the row may send. Another process
  // handling the same event at the same time sees "sending" and does nothing, so at most one alert
  // leaves per attempt even with several server processes on one database.
  const claim = key => db.prepare(`UPDATE notification_deliveries SET status='sending',attempts=attempts+1,updated_at=?
     WHERE event_key=? AND attempts<? AND (status IN ('pending','failed') OR (status='sending' AND updated_at<?))`)
    .run(now(), key, MAX_ATTEMPTS, new Date(Date.now() - CLAIM_LEASE_MS).toISOString()).changes === 1;
  const current = key => db.prepare('SELECT * FROM notification_deliveries WHERE event_key=?').get(key);

  /** Idempotent: the same event never produces a second delivery once one is recorded or in progress. */
  function notify(kind, eventId, { reference, service = '', city = '' }) {
    const key = `${kind}:${eventId}`;
    const existed = Boolean(current(key));
    if (!existed) db.prepare("INSERT OR IGNORE INTO notification_deliveries(event_key,kind,reference,channel,status,created_at,updated_at) VALUES(?,?,?,?, 'pending',?,?)").run(key, kind, reference, transport, now(), now());
    if (!send) {
      db.prepare("UPDATE notification_deliveries SET status='not_configured',updated_at=? WHERE event_key=? AND status='pending'").run(now(), key);
      return { status: current(key).status, duplicate: existed };
    }
    const message = { kind, reference, service, city, link: adminLink, at: now() };
    let claimed = false;
    while (claim(key)) {
      claimed = true;
      try {
        send(message);
        db.prepare("UPDATE notification_deliveries SET status='delivered',delivered_at=?,updated_at=?,last_error='' WHERE event_key=?").run(now(), now(), key);
        break;
      } catch (e) {
        // Only the error class is stored: a transport message could echo request content.
        db.prepare("UPDATE notification_deliveries SET status='failed',updated_at=?,last_error=? WHERE event_key=?").run(now(), String(e?.name || 'Error').slice(0, 60), key);
      }
    }
    return { status: current(key).status, duplicate: existed || !claimed };
  }

  const list = () => db.prepare('SELECT event_key,kind,reference,channel,status,attempts,created_at,updated_at,delivered_at,last_error FROM notification_deliveries ORDER BY id DESC LIMIT 100').all();
  return { notify, list, transport, MAX_ATTEMPTS, setSend: fn => { send = fn; } };
}

module.exports = { createNotifier, MAX_ATTEMPTS };

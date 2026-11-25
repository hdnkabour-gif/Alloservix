'use strict';
// #31 Web Push transport for team alerts (owner decision: Push). No third-party package: VAPID (RFC 8292)
// is signed with node:crypto. The push carries NO payload, so no request content or personal data ever
// leaves the server; the service worker shows a generic "new request" notice and staff open the
// protected console. Endpoints are restricted to known browser push services (no SSRF).
const crypto = require('node:crypto');

const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^web\.push\.apple\.com$/, /^[a-z0-9-]+\.notify\.windows\.com$/];
const b64u = buf => Buffer.from(buf).toString('base64url');

function vapidFromEnv(env = process.env) {
  const pub = env.PUSH_VAPID_PUBLIC_KEY || '', priv = env.PUSH_VAPID_PRIVATE_KEY || '', subject = env.PUSH_VAPID_SUBJECT || '';
  if (!pub || !priv || !/^(mailto:|https:\/\/)/.test(subject)) return null;
  const point = Buffer.from(pub, 'base64url'), d = Buffer.from(priv, 'base64url');
  if (point.length !== 65 || point[0] !== 4 || d.length !== 32) throw new Error('Invalid VAPID keys');
  const key = crypto.createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d: b64u(d), x: b64u(point.subarray(1, 33)), y: b64u(point.subarray(33)) }, format: 'jwk' });
  return { publicKey: pub, key, subject };
}

function generateVapidKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = privateKey.export({ format: 'jwk' }), pub = publicKey.export({ format: 'jwk' });
  return { publicKey: b64u(Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, 'base64url'), Buffer.from(pub.y, 'base64url')])), privateKey: jwk.d };
}

function vapidJwt(vapid, audience, nowSec = Math.floor(Date.now() / 1000)) {
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const payload = b64u(JSON.stringify({ aud: audience, exp: nowSec + 12 * 3600, sub: vapid.subject }));
  const sig = crypto.sign('sha256', Buffer.from(`${header}.${payload}`), { key: vapid.key, dsaEncoding: 'ieee-p1363' });
  return `${header}.${payload}.${b64u(sig)}`;
}

/** Only https endpoints of known push services. NODE_ENV=test may add one local host for isolated tests. */
function allowedEndpoint(endpoint, env = process.env) {
  let u; try { u = new URL(String(endpoint)); } catch { return false; }
  if (String(endpoint).length > 1024 || u.username || u.password) return false;
  const testHost = env.NODE_ENV === 'test' ? env.PUSH_TEST_ALLOW_HOST || '' : '';
  if (testHost && u.protocol === 'http:' && u.host === testHost) return true;
  return u.protocol === 'https:' && !u.port && PUSH_HOSTS.some(r => r.test(u.hostname));
}

function createPushStore(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS push_subscriptions (id INTEGER PRIMARY KEY AUTOINCREMENT, endpoint TEXT NOT NULL UNIQUE,
    staff TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, last_status INTEGER)`);
  return {
    add(endpoint, staff) { db.prepare("INSERT INTO push_subscriptions(endpoint,staff,created_at,active) VALUES(?,?,?,1) ON CONFLICT(endpoint) DO UPDATE SET active=1,staff=excluded.staff").run(endpoint, String(staff || '').slice(0, 160), new Date().toISOString()); },
    remove(endpoint) { return db.prepare('UPDATE push_subscriptions SET active=0 WHERE endpoint=?').run(endpoint).changes; },
    active() { return db.prepare('SELECT id,endpoint FROM push_subscriptions WHERE active=1 ORDER BY id').all(); },
    mark(id, status, active) { db.prepare('UPDATE push_subscriptions SET last_status=?,active=? WHERE id=?').run(status, active ? 1 : 0, id); },
    counts() { return db.prepare('SELECT sum(active=1) AS active,count(*) AS total FROM push_subscriptions').get(); }
  };
}

/**
 * Transport for notifier.js: sends one empty push to every active device. Delivered when at least one
 * push service accepted it (201/202). 404/410 = device unsubscribed: deactivated. No device = failure
 * (visible in the delivery log), so a missing setup is never reported as an alert sent.
 */
function createWebPushTransport({ store, vapid, fetchImpl = fetch, env = process.env }) {
  return async function sendWebPush() {
    const subs = store.active().filter(s => allowedEndpoint(s.endpoint, env));
    if (!subs.length) { const e = new Error('no subscribed device'); e.name = 'NoSubscribers'; throw e; }
    let accepted = 0;
    for (const s of subs) {
      let status = 0;
      try {
        const audience = new URL(s.endpoint).origin;
        const r = await fetchImpl(s.endpoint, { method: 'POST', redirect: 'error', headers: { TTL: '3600', Urgency: 'high', 'Content-Length': '0', Authorization: `vapid t=${vapidJwt(vapid, audience)}, k=${vapid.publicKey}` } });
        status = r.status;
      } catch { status = 0; }
      if (status === 201 || status === 202) accepted++;
      store.mark(s.id, status, !(status === 404 || status === 410));
    }
    if (!accepted) { const e = new Error('push not accepted'); e.name = 'PushRejected'; throw e; }
    return { accepted, devices: subs.length };
  };
}

module.exports = { vapidFromEnv, generateVapidKeys, vapidJwt, allowedEndpoint, createPushStore, createWebPushTransport };

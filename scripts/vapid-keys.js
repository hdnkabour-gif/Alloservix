'use strict';
// Prints a NEW VAPID key pair for Web Push team alerts. Run once on a trusted machine, then store the
// values as Railway variables PUSH_VAPID_PUBLIC_KEY / PUSH_VAPID_PRIVATE_KEY (+ PUSH_VAPID_SUBJECT=mailto:…).
// Never commit them. Changing the keys requires every device to re-enable alerts.
const { generateVapidKeys } = require('../webpush');
const k = generateVapidKeys();
process.stdout.write(`PUSH_VAPID_PUBLIC_KEY=${k.publicKey}\nPUSH_VAPID_PRIVATE_KEY=${k.privateKey}\n`);

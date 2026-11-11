import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import webpush from 'web-push';
import { Client } from '@upstash/qstash';

process.env.KV_DRIVER = 'memory';
process.env.SECRET = 'test-session-secret-not-for-production';
process.env.ORIGIN = 'https://gym.example';
process.env.VAPID_SUBJECT = 'mailto:test@example.com';
const vapid = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = vapid.publicKey;
process.env.VAPID_PRIVATE_KEY = vapid.privateKey;
process.env.QSTASH_CURRENT_SIGNING_KEY = 'test-current-signing-key-not-for-production';
process.env.QSTASH_NEXT_SIGNING_KEY = 'test-next-signing-key-not-for-production';

const { default: handler } = await import('../../api/index.js');
const { db } = await import('../../api/_lib/db.js');
const { makeSession } = await import('../../api/_lib/session.js');

const user = id => ({ id, name: id, sv: 0 });
const subscription = id => ({
  endpoint: 'https://web.push.apple.com/' + id,
  keys: { p256dh: vapid.publicKey, auth: Buffer.alloc(16, 1).toString('base64url') },
});
const deviceId = 'test-device-1234';
const token = (raw, path, key = process.env.QSTASH_CURRENT_SIGNING_KEY) => {
  const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const payload = {
    iss: 'Upstash', sub: process.env.ORIGIN + path,
    exp: Math.floor(Date.now() / 1000) + 60,
    body: crypto.createHash('sha256').update(raw).digest('base64url'),
  };
  const input = b64({ alg: 'HS256' }) + '.' + b64(payload);
  return input + '.' + crypto.createHmac('sha256', key).update(input).digest('base64url');
};

async function request(path, { uid, method = 'GET', body, raw, headers = {}, parsed = false } = {}) {
  const req = Readable.from(raw == null || parsed ? [] : [raw]);
  req.url = path;
  req.method = method;
  req.headers = { ...(uid ? { authorization: 'Bearer ' + makeSession(user(uid)) } : {}), ...headers };
  if (body !== undefined) req.body = body;
  if (parsed) req.body = JSON.parse(raw);
  const res = {
    statusCode: 0, headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    end(value) { this.body = value ? JSON.parse(value) : null; },
  };
  await handler(req, res);
  return { status: res.statusCode, body: res.body };
}
async function subscribe(uid) {
  await db.putUser(user(uid));
  const response = await request('/api/push/subscribe', {
    uid, method: 'POST', body: { subscription: subscription(uid), deviceId },
  });
  assert.equal(response.status, 200);
}

before(async () => { await db.putUser(user('owner')); });

test('push endpoints require login and return the configured public key', async () => {
  assert.equal((await request('/api/push/public-key')).status, 401);
  const result = await request('/api/push/public-key', { uid: 'owner' });
  assert.equal(result.status, 200);
  assert.equal(result.body.key, vapid.publicKey);
  assert.equal(result.body.scheduled, true);
});

test('only real browser push services and valid key shapes are accepted', async () => {
  for (const endpoint of ['http://127.0.0.1/x', 'https://gym.example/x', 'https://web.push.apple.com.evil.example/x', 'https://web.push.apple.com:444/x']) {
    const result = await request('/api/push/subscribe', {
      uid: 'owner', method: 'POST', body: { subscription: { ...subscription('invalid'), endpoint } },
    });
    assert.equal(result.status, 400, endpoint);
  }
});

test('subscription status and removal are scoped to the logged-in user', async () => {
  await subscribe('alice');
  await db.putUser(user('bob'));
  const path = '/api/push/status?endpoint=' + encodeURIComponent(subscription('alice').endpoint);
  assert.deepEqual((await request(path, { uid: 'alice' })).body, { subscribed: true, deviceId });
  assert.deepEqual((await request(path, { uid: 'bob' })).body, { subscribed: false, deviceId: null });
  await request('/api/push/unsubscribe', { uid: 'bob', method: 'POST', body: { endpoint: subscription('alice').endpoint } });
  assert.equal((await request(path, { uid: 'alice' })).body.subscribed, true);
  await request('/api/push/unsubscribe', { uid: 'alice', method: 'POST', body: { endpoint: subscription('alice').endpoint } });
  assert.equal((await request(path, { uid: 'alice' })).body.subscribed, false);
});

test('an endpoint cannot move between accounts without its original keys', async () => {
  await subscribe('carol');
  const changed = subscription('carol');
  changed.keys.auth = Buffer.alloc(16, 2).toString('base64url');
  const result = await request('/api/push/subscribe', { uid: 'bob', method: 'POST', body: { subscription: changed } });
  assert.equal(result.status, 409);
});

test('test push is delivered and expired subscriptions are reported, not marked successful', async t => {
  await subscribe('tester');
  let sent;
  t.mock.method(webpush, 'sendNotification', async (sub, payload) => { sent = { sub, payload: JSON.parse(payload) }; });
  const result = await request('/api/push/test', { uid: 'tester', method: 'POST', body: {} });
  assert.equal(result.status, 200);
  assert.equal(sent.sub.endpoint, subscription('tester').endpoint);
  assert.equal(sent.payload.tag, 'test');
  await subscribe('expired');
  webpush.sendNotification.mock.mockImplementation(async () => { throw Object.assign(new Error('gone'), { statusCode: 410 }); });
  assert.equal((await request('/api/push/test', { uid: 'expired', method: 'POST', body: {} })).status, 410);
});

test('scheduler rejects missing, tampered, and wrong-destination signatures', async () => {
  const path = '/api/reminders/run';
  assert.equal((await request(path, { method: 'POST', raw: '{}' })).status, 401);
  const signature = token('{}', path);
  assert.equal((await request(path, { method: 'POST', raw: '{"changed":true}', headers: { 'upstash-signature': signature } })).status, 401);
  assert.equal((await request(path, { method: 'POST', raw: '{}', headers: { 'upstash-signature': token('{}', '/wrong') } })).status, 401);
});

test('signed five-minute tick delivers a due reminder once, even with parsed Vercel bodies', async t => {
  await subscribe('scheduled');
  const now = new Date();
  const target = new Date(now.getTime() + 30 * 60000);
  await db.putState('scheduled', {
    reminder: { on: true, tz: 'UTC', lead: 30, training: { [target.getUTCDay()]: target.toISOString().slice(11, 16) } },
    workouts: [], routines: [],
  });
  const deliveries = [];
  t.mock.method(webpush, 'sendNotification', async (sub, payload) => { deliveries.push({ sub, payload: JSON.parse(payload) }); });
  const path = '/api/reminders/run';
  const headers = { 'upstash-signature': token('{}', path, process.env.QSTASH_NEXT_SIGNING_KEY) };
  assert.equal((await request(path, { method: 'POST', raw: '{}', headers, parsed: true })).status, 200);
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].sub.endpoint, subscription('scheduled').endpoint);
  assert.equal(deliveries[0].payload.tag, 'day-reminder');
  assert.equal((await request(path, { method: 'POST', raw: '{}', headers })).status, 200);
  assert.equal(deliveries.length, 1);
});

test('cancelled delayed rest alerts are not delivered', async t => {
  await subscribe('rest');
  const job = 'a'.repeat(48);
  await db.cache('job:' + job, { uid: 'rest', deviceId }, 7200);
  await db.cache('rest:rest:' + deviceId, job, 7200);
  assert.equal((await request('/api/push/rest-timer/cancel', { uid: 'rest', method: 'POST', body: { deviceId } })).status, 200);
  const send = t.mock.method(webpush, 'sendNotification', async () => {});
  const raw = JSON.stringify({ job }), path = '/api/push/deliver';
  const result = await request(path, { method: 'POST', raw, headers: { 'upstash-signature': token(raw, path) } });
  assert.equal(result.status, 200);
  assert.equal(result.body.skipped, true);
  assert.equal(send.mock.callCount(), 0);
});

test('rest alerts schedule an opaque job and deliver once to the initiating device', async t => {
  await subscribe('rest-delivery');
  process.env.QSTASH_TOKEN = 'test-token-not-for-production';
  let published;
  t.mock.method(Client.prototype, 'publishJSON', async request => { published = request; return { messageId: 'test-job' }; });
  const result = await request('/api/push/rest-timer', {
    uid: 'rest-delivery', method: 'POST', body: { seconds: 90, deviceId },
  });
  assert.equal(result.status, 200);
  assert.equal(published.delay, 90);
  assert.equal(published.url, 'https://gym.example/api/push/deliver');
  assert.deepEqual(Object.keys(published.body), ['job']);
  assert.match(published.body.job, /^[a-f0-9]{48}$/);
  const deliveries = [];
  t.mock.method(webpush, 'sendNotification', async (sub, payload) => { deliveries.push({ sub, payload: JSON.parse(payload) }); });
  const raw = JSON.stringify(published.body), path = '/api/push/deliver';
  const headers = { 'upstash-signature': token(raw, path) };
  assert.equal((await request(path, { method: 'POST', raw, headers })).status, 200);
  assert.equal((await request(path, { method: 'POST', raw, headers })).status, 200);
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].sub.endpoint, subscription('rest-delivery').endpoint);
  assert.equal(deliveries[0].payload.tag, 'rest-timer');
});

test('a valid timetable round-trips through sync and stale revisions are still rejected', async () => {
  const state = {
    workouts: [], routines: [],
    reminder: { on: true, time: '08:00', tz: 'Europe/Lisbon', training: { 1: '18:00' }, lead: 30, hours: { 1: { from: '06:00', to: '22:00' } } },
  };
  const saved = await request('/api/data', { uid: 'owner', method: 'PUT', body: { state, baseRev: 0 } });
  assert.equal(saved.status, 200);
  const fetched = await request('/api/data', { uid: 'owner' });
  assert.deepEqual(fetched.body.state.reminder, state.reminder);
  assert.equal(fetched.body.rev, 1);
  assert.equal((await request('/api/data', { uid: 'owner', method: 'PUT', body: { state, baseRev: 0 } })).status, 409);
});

test('invalid schedule inputs fail explicitly rather than saving a broken reminder', async () => {
  for (const reminder of [
    { on: true, tz: 'Not/A_Timezone' },
    { on: true, tz: 'UTC', training: { 1: '25:00' } },
    { on: true, tz: 'UTC', hours: { 1: { from: '08:00', to: '08:00' } } },
    { on: true, tz: 'UTC', lead: -10 },
    { on: true, tz: 'UTC', hours: { 1: [{ from: '07:00', to: '14:00' }, { from: '15:00', to: '15:00' }] } },
    { on: true, tz: 'UTC', hours: { 1: [{ from: '07:00', to: '14:00' }, null] } },
    { on: true, tz: 'UTC', hours: { 1: [[{ from: '07:00', to: '14:00' }]] } },
  ]) {
    assert.equal((await request('/api/data', { uid: 'owner', method: 'PUT', body: { state: { workouts: [], routines: [], reminder } } })).status, 400);
  }
});

test('split opening hours round-trip through the same sync document as legacy opening hours', async () => {
  const hours = {
    1: [{ from: '07:00', to: '14:00' }, { from: '15:00', to: '17:00' }, { from: '20:00', to: '23:00' }],
    2: { from: '06:00', to: '22:00' }, 3: [], 4: null,
  };
  const state = { workouts: [], routines: [], reminder: { on: true, tz: 'UTC', hours } };
  const saved = await request('/api/data', { uid: 'owner', method: 'PUT', body: { state } });
  assert.equal(saved.status, 200);
  const fetched = await request('/api/data', { uid: 'owner' });
  assert.deepEqual(fetched.body.state.reminder.hours, hours);
});

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

process.env.KV_DRIVER = 'memory';
process.env.SECRET = 'test-session-secret-not-for-production';
process.env.ORIGIN = 'https://gym.example';

const { default: handler } = await import('../../api/index.js');
const { db } = await import('../../api/_lib/db.js');
const { makeSession } = await import('../../api/_lib/session.js');
const { hashPassword } = await import('../../api/_lib/password.js');

const uid = 'mcp-pair-user';
const password = 'correct horse battery';
const profile = { id: uid, name: 'MCP User', sv: 0 };

async function request(path, { method = 'GET', body, token, origin, headers = {} } = {}) {
  const req = Readable.from([]);
  req.url = path;
  req.method = method;
  req.headers = {
    ...headers,
    ...(token ? { authorization: 'Bearer ' + token } : {}),
    ...(origin ? { origin } : {}),
  };
  if (body !== undefined) req.body = body;
  const res = {
    statusCode: 0,
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    end(value) { this.body = value ? JSON.parse(value) : null; },
  };
  await handler(req, res);
  return { status: res.statusCode, body: res.body, headers: res.headers };
}

before(async () => {
  const created = new Date().toISOString();
  await db.putUser({ ...profile, created, pw: { h: await hashPassword(password), set: created } });
});

test('native app CORS preflight is allowed only for the Capacitor origins', async () => {
  const ios = await request('/api/pair/redeem', {
    method: 'OPTIONS',
    origin: 'capacitor://localhost',
    headers: {
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type',
    },
  });
  assert.equal(ios.status, 204);
  assert.equal(ios.headers['Access-Control-Allow-Origin'], 'capacitor://localhost');
  assert.match(ios.headers['Access-Control-Allow-Methods'], /POST/);
  assert.match(ios.headers['Access-Control-Allow-Headers'], /Content-Type/);

  const android = await request('/api/pair/redeem', { method: 'OPTIONS', origin: 'https://localhost' });
  assert.equal(android.headers['Access-Control-Allow-Origin'], 'https://localhost');

  const external = await request('/api/pair/redeem', { method: 'OPTIONS', origin: 'https://attacker.example' });
  assert.equal(external.headers['Access-Control-Allow-Origin'], undefined);
  const blocked = await request('/api/pair/redeem', {
    method: 'POST',
    origin: 'https://attacker.example',
    body: { code: 'ABCDEFGH' },
  });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.headers['Access-Control-Allow-Origin'], undefined);
});

test('MCP pairing requires the signed-in profile password and issues a single-use code', async () => {
  const token = makeSession(profile);
  assert.equal((await request('/api/account/passkeys', { token })).status, 200);
  assert.deepEqual((await request('/api/account/passkeys', { token })).body, {
    passkeys: [], password: true, lastWayIn: true,
  });
  assert.equal((await request('/api/pair/create', { method: 'POST', body: { current: 'wrong password' }, token })).status, 401);

  const created = await request('/api/pair/create', { method: 'POST', body: { current: password }, token });
  assert.equal(created.status, 200);
  assert.match(created.body.code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);

  const redeemed = await request('/api/pair/redeem', {
    method: 'POST', origin: 'capacitor://localhost', body: { code: created.body.code },
  });
  assert.equal(redeemed.status, 200);
  assert.equal(redeemed.headers['Access-Control-Allow-Origin'], 'capacitor://localhost');
  assert.equal(redeemed.body.user.id, uid);
  assert.equal((await request('/api/me', { token: redeemed.body.token })).status, 200);
  assert.equal((await request('/api/pair/redeem', { method: 'POST', body: { code: created.body.code } })).status, 400);
});

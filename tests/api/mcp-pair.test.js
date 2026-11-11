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

async function request(path, { method = 'GET', body, token } = {}) {
  const req = Readable.from([]);
  req.url = path;
  req.method = method;
  req.headers = token ? { authorization: 'Bearer ' + token } : {};
  if (body !== undefined) req.body = body;
  const res = {
    statusCode: 0,
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    end(value) { this.body = value ? JSON.parse(value) : null; },
  };
  await handler(req, res);
  return { status: res.statusCode, body: res.body };
}

before(async () => {
  const created = new Date().toISOString();
  await db.putUser({ ...profile, created, pw: { h: await hashPassword(password), set: created } });
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

  const redeemed = await request('/api/pair/redeem', { method: 'POST', body: { code: created.body.code } });
  assert.equal(redeemed.status, 200);
  assert.equal(redeemed.body.user.id, uid);
  assert.equal((await request('/api/me', { token: redeemed.body.token })).status, 200);
  assert.equal((await request('/api/pair/redeem', { method: 'POST', body: { code: created.body.code } })).status, 400);
});

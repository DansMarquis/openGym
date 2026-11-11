import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
process.env.KV_DRIVER = 'memory';
const { motivation } = await import('../../api/_lib/motivation.js');

async function request(date) {
  const req = Readable.from([]);
  req.url = '/api/motivation?date=' + date;
  const res = { setHeader() {}, end(body) { this.body = JSON.parse(body); } };
  await motivation(req, res);
  return res;
}

test('daily inspiration is cached and contains provider attribution without rendering provider HTML', async t => {
  const date = new Date().toISOString().slice(0, 10);
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify([
    { q: 'A little consistency goes further than a little perfection.', a: 'openGym test', h: '<script>bad()</script>' },
  ])));
  const first = await request(date);
  assert.equal(first.statusCode, 200);
  assert.deepEqual(first.body, { date, text: 'A little consistency goes further than a little perfection.', author: 'openGym test', source: 'ZenQuotes API' });
  const second = await request(date);
  assert.deepEqual(second.body, first.body);
  assert.equal(fetch.mock.callCount(), 1);
});

test('invalid dates are rejected and provider failures stay explicit', async t => {
  assert.equal((await request('not-a-date')).statusCode, 400);
  assert.equal((await request('2099-01-01')).statusCode, 400);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  t.mock.method(globalThis, 'fetch', async () => new Response('unavailable', { status: 503 }));
  assert.equal((await request(tomorrow)).statusCode, 503);
});

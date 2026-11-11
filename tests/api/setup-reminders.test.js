import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@upstash/qstash';

test('setup creates a single five-minute schedule with bounded retries and compact JSON', async t => {
  process.env.ORIGIN = 'https://gym.example';
  process.env.QSTASH_TOKEN = 'test-token-not-for-production';
  const schedules = new Client({ token: process.env.QSTASH_TOKEN }).schedules;
  const create = t.mock.method(Object.getPrototypeOf(schedules), 'create', async () => ({ scheduleId: 'opengym-reminders' }));
  t.mock.method(console, 'log', () => {});
  await import('../../scripts/setup-reminders.mjs');
  const args = create.mock.calls[0].arguments[0];
  assert.equal(args.destination, 'https://gym.example/api/reminders/run');
  assert.equal(args.scheduleId, 'opengym-reminders');
  assert.equal(args.cron, '*/5 * * * *');
  assert.equal(args.body, '{}');
  assert.equal(args.retries, 2);
  assert.equal(args.headers['Content-Type'], 'application/json');
});

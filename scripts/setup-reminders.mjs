import { Client } from '@upstash/qstash';

const origin = process.env.ORIGIN;
if (!origin || new URL(origin).protocol !== 'https:' || !process.env.QSTASH_TOKEN) {
  throw new Error('Set ORIGIN=https://your-app.vercel.app and QSTASH_TOKEN before running setup.');
}
const result = await new Client({ token: process.env.QSTASH_TOKEN }).schedules.create({
  destination: origin.replace(/\/$/, '') + '/api/reminders/run',
  scheduleId: 'opengym-reminders',
  cron: '*/5 * * * *',
  body: '{}',
  headers: { 'Content-Type': 'application/json' },
  retries: 2,
});
console.log('Reminder schedule ready:', result.scheduleId, '(every five minutes, 288 scheduled messages/day before retries).');

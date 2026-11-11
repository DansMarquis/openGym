import crypto from 'node:crypto';
import webpush from 'web-push';
import { Receiver, Client } from '@upstash/qstash';
import { db } from './db.js';
import { json, readBody, queryOf } from './http.js';
import { readSession } from './session.js';
import { reminderDue } from './reminders.js';
import { dayReminderPush, restTimerPush, testPush } from '../../_legacy-backend/push-messages.js';

const hash = endpoint => crypto.createHash('sha256').update(endpoint).digest('hex');
const device = value => /^[A-Za-z0-9_-]{8,64}$/.test(value || '') ? value : null;
const origin = () => process.env.ORIGIN?.replace(/\/$/, '');
const client = () => new Client({ token: process.env.QSTASH_TOKEN });
export const pushConfigured = () => !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
export const schedulerConfigured = () => !!(origin()?.startsWith('https://')
  && process.env.QSTASH_CURRENT_SIGNING_KEY && process.env.QSTASH_NEXT_SIGNING_KEY);

const TRAINING_COPY = {
  en: ['Workout planned today', 'Your workout is planned for {0}. See you at the gym!'],
  pt: ['Treino planeado', 'O teu treino está marcado para as {0}. Até já no ginásio!'],
  'pt-BR': ['Treino planejado', 'Seu treino está marcado para as {0}. Até já na academia!'],
  es: ['Entrenamiento previsto', 'Tu entrenamiento está previsto para las {0}. ¡Nos vemos en el gimnasio!'],
  fr: ['Entraînement prévu', 'Ton entraînement est prévu à {0}. À la salle !'],
  de: ['Training geplant', 'Dein Training ist für {0} geplant. Bis gleich im Studio!'],
  it: ['Allenamento programmato', 'Il tuo allenamento è previsto alle {0}. Ci vediamo in palestra!'],
  sv: ['Planerat träningspass', 'Din träning är planerad till {0}. Vi ses på gymmet!'],
  pl: ['Zaplanowany trening', 'Twój trening jest zaplanowany na {0}. Do zobaczenia na siłowni!'],
  hu: ['Tervezett edzés', 'Az edzésed időpontja: {0}. Találkozunk a teremben!'],
  tr: ['Planlanan antrenman', 'Antrenmanın saat {0} için planlandı. Salonda görüşürüz!'],
  ru: ['Запланированная тренировка', 'Твоя тренировка запланирована на {0}. До встречи в зале!'],
  uk: ['Заплановане тренування', 'Твоє тренування заплановане на {0}. До зустрічі в залі!'],
  ar: ['تمرين مخطط', 'تمرينك مخطط في {0}. نراك في النادي!'],
  bn: ['পরিকল্পিত ব্যায়াম', 'আপনার ব্যায়ামের সময় {0}। জিমে দেখা হবে!'],
  hi: ['नियोजित कसरत', 'आपकी कसरत का समय {0} है। जिम में मिलते हैं!'],
  ko: ['예정된 운동', '운동 예정 시간은 {0}입니다. 헬스장에서 만나요!'],
  th: ['การออกกำลังกายที่วางแผนไว้', 'คุณวางแผนออกกำลังกายเวลา {0} แล้วพบกันที่ยิม!'],
  zh: ['训练计划', '你的训练安排在 {0}，健身房见！'],
  'zh-TW': ['訓練計畫', '你的訓練安排在 {0}，健身房見！'],
};

async function completeAll(tasks) {
  const results = await Promise.allSettled(tasks);
  const failed = results.filter(result => result.status === 'rejected');
  if (failed.length) throw new AggregateError(failed.map(result => result.reason), 'Push delivery failed; scheduler may retry.');
  return results.map(result => result.value);
}

function validSubscription(sub) {
  if (!sub || typeof sub.endpoint !== 'string' || sub.endpoint.length > 2048) return false;
  let url;
  try { url = new URL(sub.endpoint); } catch { return false; }
  // Only browser-owned push services can be contacted; arbitrary endpoints would permit SSRF.
  const allowed = url.hostname === 'fcm.googleapis.com' || url.hostname === 'updates.push.services.mozilla.com'
    || url.hostname.endsWith('.notify.windows.com')
    || url.hostname === 'web.push.apple.com' || url.hostname.endsWith('.push.apple.com');
  if (!allowed || url.protocol !== 'https:' || url.port || url.username || url.password) return false;
  const keys = sub.keys;
  return typeof keys?.auth === 'string' && /^[A-Za-z0-9_-]{22}={0,2}$/.test(keys.auth)
    && typeof keys?.p256dh === 'string' && /^[A-Za-z0-9_-]{87}={0,2}$/.test(keys.p256dh);
}

async function signedUser(req, res) {
  const user = await readSession(req, db.getUser);
  if (!user) json(res, 401, { error: 'not signed in' });
  return user;
}

async function send(id, record, payload) {
  try {
    await webpush.sendNotification(record.subscription, JSON.stringify(payload), {
      vapidDetails: {
        subject: process.env.VAPID_SUBJECT,
        publicKey: process.env.VAPID_PUBLIC_KEY,
        privateKey: process.env.VAPID_PRIVATE_KEY,
      },
      TTL: 900, timeout: 5000,
    });
    return true;
  } catch (e) {
    if (e.statusCode === 404 || e.statusCode === 410) {
      await db.removeSubscription(id);
      return false;
    }
    throw e;
  }
}

export async function pushRoute(req, res, path) {
  const user = await signedUser(req, res);
  if (!user) return;
  if (!pushConfigured()) return json(res, 503, { error: 'Configure VAPID keys and subject on the server first.', code: 'push-unconfigured' });
  if (path === '/api/push/public-key') {
    return json(res, 200, { key: process.env.VAPID_PUBLIC_KEY, scheduled: schedulerConfigured() });
  }
  const subscriptions = await db.subscriptions();
  const own = Object.entries(subscriptions).filter(([, record]) => record.uid === user.id);
  if (path === '/api/push/status') {
    const id = hash(queryOf(req).get('endpoint') || '');
    const record = subscriptions[id];
    return json(res, 200, { subscribed: record?.uid === user.id, deviceId: record?.uid === user.id ? record.deviceId : null });
  }
  const body = await readBody(req);
  if (path === '/api/push/subscribe') {
    if (!validSubscription(body.subscription)) return json(res, 400, { error: 'invalid push subscription' });
    const sub = body.subscription;
    const saved = await db.claimSubscription(hash(sub.endpoint), {
      uid: user.id, deviceId: device(body.deviceId),
      subscription: { endpoint: sub.endpoint, keys: { auth: sub.keys.auth, p256dh: sub.keys.p256dh } },
    });
    if (saved === 0) return json(res, 409, { error: 'This subscription belongs to another profile with different keys.' });
    if (saved === -1) return json(res, 429, { error: 'This personal deployment has reached its limit of 100 push subscriptions.' });
    return json(res, 200, { ok: true });
  }
  if (path === '/api/push/unsubscribe') {
    const id = hash(typeof body.endpoint === 'string' ? body.endpoint : '');
    if (subscriptions[id]?.uid === user.id) await db.removeSubscription(id);
    return json(res, 200, { ok: true });
  }
  if (path === '/api/push/test') {
    if (!own.length) return json(res, 409, { error: 'Turn on push notifications first.' });
    if (!await db.once('push-test:' + user.id, 15)) return json(res, 429, { error: 'Please wait 15 seconds before another test.' });
    const state = await db.getState(user.id);
    const results = await completeAll(own.map(([id, record]) => send(id, record, testPush(state?.lang))));
    if (!results.some(Boolean)) return json(res, 410, { error: 'Subscriptions expired. Turn notifications off and on again.' });
    return json(res, 200, { ok: true });
  }
  if (path === '/api/push/rest-timer/cancel') {
    const key = device(body.deviceId);
    if (!key) return json(res, 400, { error: 'device id required' });
    await db.cache('rest:' + user.id + ':' + key, '', 3600);
    return json(res, 200, { ok: true });
  }
  if (!schedulerConfigured() || !process.env.QSTASH_TOKEN) {
    return json(res, 503, { error: 'Configure free QStash scheduling on the server first.', code: 'scheduler-unconfigured' });
  }
  const seconds = Number(body.seconds), key = device(body.deviceId);
  if (!key || !Number.isInteger(seconds) || seconds < 1 || seconds > 3600) return json(res, 400, { error: 'invalid rest timer' });
  if (!own.some(([, record]) => record.deviceId === key)) return json(res, 409, { error: 'Turn on push notifications first.' });
  const job = crypto.randomBytes(24).toString('hex');
  await db.cache('job:' + job, { uid: user.id, deviceId: key }, 7200);
  await db.cache('rest:' + user.id + ':' + key, job, 7200);
  await client().publishJSON({
    url: origin() + '/api/push/deliver', body: { job }, delay: seconds, retries: 2,
  });
  return json(res, 200, { ok: true });
}

export async function scheduledRoute(req, res, path) {
  if (!pushConfigured() || !schedulerConfigured()) return json(res, 503, { error: 'Push scheduling is not configured.' });
  // QStash's SDK and setup script send compact JSON. Vercel may have already parsed it,
  // whereas local Node requests still carry the raw stream.
  let raw;
  if (typeof req.body === 'string') raw = req.body;
  else if (Buffer.isBuffer(req.body)) raw = req.body.toString('utf8');
  else if (req.body != null) raw = JSON.stringify(req.body);
  else {
    const chunks = [];
    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    raw = Buffer.concat(chunks).toString('utf8');
  }
  const receiver = new Receiver({
    currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY,
    nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY,
  });
  let verified = false;
  try {
    verified = await receiver.verify({ signature: req.headers['upstash-signature'] || '', body: raw, url: origin() + path });
  } catch (e) {
    console.warn('QStash signature rejected:', e.message);
  }
  if (!verified) return json(res, 401, { error: 'invalid scheduler signature' });
  const subscriptions = await db.subscriptions();
  if (path === '/api/push/deliver') {
    let body;
    try { body = JSON.parse(raw); } catch { return json(res, 400, { error: 'invalid job' }); }
    if (!/^[a-f0-9]{48}$/.test(body?.job || '')) return json(res, 400, { error: 'invalid job' });
    const job = await db.cached('job:' + body.job);
    if (!job || await db.cached('rest:' + job.uid + ':' + job.deviceId) !== body.job) return json(res, 200, { skipped: true });
    const user = await db.getUser(job.uid);
    if (!user || user.disabled) return json(res, 200, { skipped: true });
    const state = await db.getState(job.uid);
    const own = Object.entries(subscriptions).filter(([, record]) => record.uid === job.uid && record.deviceId === job.deviceId);
    await completeAll(own.map(async ([id, record]) => {
      if (await db.cached('rest-sent:' + body.job + ':' + id)) return;
      if (!await db.once('rest-send:' + body.job + ':' + id, 30)) throw new Error('rest delivery already in progress');
      await send(id, record, restTimerPush(state?.lang));
      await db.cache('rest-sent:' + body.job + ':' + id, true, 7200);
    }));
    return json(res, 200, { ok: true });
  }
  const users = [...new Set(Object.values(subscriptions).map(record => record.uid))];
  const now = new Date();
  await completeAll(users.map(async uid => {
    const user = await db.getUser(uid);
    if (!user || user.disabled) return;
    const state = await db.getState(uid);
    const due = reminderDue(state, now);
    if (!due) return;
    const own = Object.entries(subscriptions).filter(([, record]) => record.uid === uid);
    await completeAll(own.map(async ([id, record]) => {
      const key = 'day:' + uid + ':' + due.date + ':' + id;
      if (await db.cached(key)) return;
      if (!await db.once(key, 30)) throw new Error('reminder delivery already in progress');
      const payload = dayReminderPush(state.lang, null);
      if (state.reminder.training) {
        const [title, body] = TRAINING_COPY[state.lang] || TRAINING_COPY[String(state.lang || '').split('-')[0]] || TRAINING_COPY.en;
        payload.title = title;
        payload.body = body.replace('{0}', due.time);
      }
      await send(id, record, payload);
      await db.cache(key, true, 172800);
    }));
  }));
  return json(res, 200, { ok: true });
}

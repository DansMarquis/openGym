// Minimal openGym backend for Vercel — a single Serverless Function that answers the handful of
// endpoints the existing frontend needs to sign in and sync workouts, backed by Upstash Redis
// instead of openGym's on-disk JSON documents.
//
// All /api/* paths (any depth) are routed here by a rewrite in vercel.json:
//   { "source": "/api/:path*", "destination": "/api/index?__p=:path*" }
// The original path is reconstructed from the `__p` query param (with a fallback to req.url), so a
// single function can dispatch every route regardless of nesting — avoiding Vercel's catch-all
// filename quirks.
//
// Implemented, matching openGym's request/response contract:
//   GET  /api/health          GET  /api/config         GET  /api/me
//   POST /api/register/password   POST /api/login/password
//   POST /api/logout          POST /api/logout/all
//   GET  /api/data            GET  /api/data/rev       PUT  /api/data
//
// Deliberately NOT implemented (these need a persistent server, a real filesystem, or background
// jobs that Vercel's serverless model can't provide): passkeys/WebAuthn, the Coach, media upload,
// third-party integrations, the watch relay, push notifications, nudges, admin tooling, device
// pairing. Calls to those return 501 so the frontend degrades instead of hanging.
import crypto from 'node:crypto';
import { db } from './_lib/db.js';
import { json, readBody, pathOf, queryOf, str } from './_lib/http.js';
import {
  readSession, makeSession, sessionVersion, sessionCookie, clearCookie, publicUser,
} from './_lib/session.js';
import { hashPassword, verifyPassword, passwordProblem, POLICY_ERRORS } from './_lib/password.js';

const INVITE_ONLY = /^(1|true|yes|on)$/i.test(process.env.INVITE_ONLY || '');
const ALLOW_GUEST = !/^(0|false|no|off)$/i.test(process.env.ALLOW_GUEST || '');
const PASSWORD_LOGIN = !/^(0|false|no|off)$/i.test(process.env.PASSWORD_LOGIN || ''); // on by default here
const DEFAULT_LANG = process.env.DEFAULT_LANG || '';
const ORIGIN = process.env.ORIGIN || '';
const WID_KEEP = 20;
const WRONG = { error: 'wrong name or password', code: 'bad-credentials' };

const nameKey = s => str(s).trim().toLowerCase().slice(0, 300);

// The requested /api path. The rewrite forwards it in `__p` (segments after /api/); fall back to
// the raw URL for direct hits.
function apiPath(req) {
  const forwarded = queryOf(req).get('__p');
  if (forwarded != null) return ('/api/' + forwarded).replace(/\/+$/, '') || '/api';
  return pathOf(req);
}

// Reject a state-changing request whose browser Origin isn't ours. A same-origin fetch from the
// deployed app always matches; a request with no Origin header (non-browser) is allowed through.
function csrfOk(req) {
  const method = req.method;
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;
  const origin = req.headers.origin;
  if (!origin) return true;
  if (!ORIGIN) return true; // not configured — don't block
  try { return new URL(origin).host === new URL(ORIGIN).host; } catch { return false; }
}

// ---- individual handlers ------------------------------------------------------------------

async function health(req, res) {
  try {
    await db.ping();
    const meta = await db.meta();
    json(res, 200, { ok: true, users: meta.users || 0, writable: true });
  } catch {
    json(res, 503, { ok: false, writable: false });
  }
}

async function config(req, res) {
  await readSession(req, db.getUser); // touch session; config itself is public
  json(res, 200, {
    invite_only: INVITE_ONLY,
    allow_guest: ALLOW_GUEST,
    ...(PASSWORD_LOGIN ? { password_login: true } : {}),
    ...(DEFAULT_LANG ? { default_lang: DEFAULT_LANG } : {}),
  });
}

async function me(req, res) {
  const user = await readSession(req, db.getUser);
  if (!user) return json(res, 401, { error: 'not signed in' });
  json(res, 200, { user: publicUser(user) });
}

async function registerPassword(req, res) {
  if (!PASSWORD_LOGIN) return json(res, 403, { error: 'password sign-up is off', code: 'disabled' });
  const body = await readBody(req);
  const name = str(body.name).trim().slice(0, 40);
  if (!name) return json(res, 400, { error: 'name required', code: 'missing' });
  const problem = passwordProblem(body.password);
  if (problem) return json(res, 400, { error: POLICY_ERRORS[problem], code: problem });

  const key = nameKey(name);
  const uid = crypto.randomBytes(12).toString('base64url');
  // Atomically claim the name; if taken, bail before writing anything.
  const claimed = await db.claimName(key, uid);
  if (!claimed) return json(res, 409, { error: 'another profile already signs in with this name', code: 'name-taken' });

  const h = await hashPassword(body.password);
  const created = new Date().toISOString();
  const user = { id: uid, name, created, pw: { h, set: created }, sv: 0 };

  // First account to exist becomes the owner/admin.
  const meta = await db.meta();
  if (!meta.owner) { user.owner = true; user.admin = true; meta.owner = uid; }
  meta.users = (meta.users || 0) + 1;

  await db.putUser(user);
  await db.setMeta(meta);
  json(res, 200, { user: publicUser(user) }, { 'Set-Cookie': sessionCookie(user) });
}

async function loginPassword(req, res) {
  if (!PASSWORD_LOGIN) return json(res, 403, { error: 'password sign-in is off', code: 'disabled' });
  const body = await readBody(req);
  const key = nameKey(body.identifier ?? body.name ?? body.email);
  const pw = typeof body.password === 'string' ? body.password : '';
  if (!key || !pw) return json(res, 400, { error: 'name and password required', code: 'missing' });

  const uid = await db.uidForName(key);
  const user = uid ? await db.getUser(uid) : null;
  const ok = user && user.pw && (await verifyPassword(pw, user.pw.h));
  if (!ok) return json(res, 401, WRONG);
  if (user.disabled) return json(res, 403, { error: 'this account has been disabled', code: 'disabled' });

  json(res, 200, { user: publicUser(user) }, { 'Set-Cookie': sessionCookie(user) });
}

async function logout(req, res) {
  json(res, 200, { ok: true }, { 'Set-Cookie': clearCookie });
}

async function logoutAll(req, res) {
  const user = await readSession(req, db.getUser);
  if (!user) return json(res, 401, { error: 'not signed in' });
  user.sv = sessionVersion(user) + 1;
  await db.putUser(user);
  json(res, 200, { ok: true }, { 'Set-Cookie': clearCookie });
}

async function getData(req, res) {
  const user = await readSession(req, db.getUser);
  if (!user) return json(res, 401, { error: 'not signed in' });
  const state = await db.getState(user.id);
  json(res, 200, { state: state || null, rev: state?._rev || 0 });
}

async function getDataRev(req, res) {
  const user = await readSession(req, db.getUser);
  if (!user) return json(res, 401, { error: 'not signed in' });
  const state = await db.getState(user.id);
  json(res, 200, { rev: state?._rev || 0, ...(state?._wid ? { wid: state._wid } : {}) });
}

const isListOrNull = v => v == null || Array.isArray(v);

async function putData(req, res) {
  const user = await readSession(req, db.getUser);
  if (!user) return json(res, 401, { error: 'not signed in' });
  const body = await readBody(req);
  const incoming = body.state;
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    return json(res, 400, { error: 'state required' });
  }
  if (!Object.keys(incoming).some(k => k !== '_rev' && k !== '_ts')) {
    return json(res, 400, { error: 'state required' });
  }
  if (!isListOrNull(incoming.workouts) || !isListOrNull(incoming.routines)) {
    return json(res, 400, { error: 'invalid state' });
  }

  const cur = await db.getState(user.id);
  const curRev = cur?._rev || 0;
  // Conditional write: a stale baseRev (another device wrote since) comes back as a 409 carrying
  // the current document, so the client can merge and retry — this is openGym's sync contract.
  if (body.baseRev != null && body.baseRev !== curRev) {
    return json(res, 409, { error: 'conflict', rev: curRev, state: cur || null });
  }
  if (body.baseRev != null && typeof body.baseWid === 'string' && cur?._wid && body.baseWid !== cur._wid) {
    return json(res, 409, { error: 'conflict', rev: curRev, state: cur || null });
  }

  delete incoming.active; // in-progress workouts stay device-local
  incoming._rev = curRev + 1;
  incoming._ts = Date.now();
  incoming._wids = [
    ...(Array.isArray(cur?._wids) ? cur._wids : []),
    ...(cur?._wid ? [cur._wid] : []),
  ].filter(x => typeof x === 'string').slice(-WID_KEEP);
  incoming._wid = crypto.randomBytes(8).toString('hex');

  await db.putState(user.id, incoming);
  json(res, 200, { ok: true, rev: incoming._rev, wid: incoming._wid });
}

// Endpoints the frontend may probe but this build does not provide. 501 keeps the UI from hanging.
function notImplemented(req, res) {
  json(res, 501, { error: 'not available on this deployment', code: 'unsupported' });
}

// ---- dispatch -----------------------------------------------------------------------------

const routes = {
  'GET /api/health': health,
  'GET /api/config': config,
  'GET /api/me': me,
  'POST /api/register/password': registerPassword,
  'POST /api/login/password': loginPassword,
  'POST /api/logout': logout,
  'POST /api/logout/all': logoutAll,
  'GET /api/data': getData,
  'GET /api/data/rev': getDataRev,
  'PUT /api/data': putData,
};

export default async function handler(req, res) {
  const path = apiPath(req);
  try {
    if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
    if (!csrfOk(req)) return json(res, 403, { error: 'bad origin', code: 'csrf' });

    const route = routes[req.method + ' ' + path];
    if (route) return await route(req, res);

    // Any other /api/* path: a feature this minimal build doesn't carry.
    if (path.startsWith('/api/')) return notImplemented(req, res);
    return json(res, 404, { error: 'not found' });
  } catch (e) {
    console.error('api error', req.method, path, e?.message);
    const msg = /KV not configured|SECRET not configured/.test(e?.message || '')
      ? e.message
      : 'internal error';
    json(res, 500, { error: msg });
  }
}

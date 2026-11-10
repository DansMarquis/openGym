// Stateless, signed sessions — a faithful reimplementation of openGym's cookie scheme so the
// existing frontend accepts them unchanged.
//
// Payload: `<uid>:<expiry>:<version>:<kind>`, HMAC-SHA256 signed with SECRET. `version` is the
// user's `sv` counter (bumping it on the user record invalidates every token already issued).
// `kind` is 'c' for a browser cookie. The token is self-verifying, so no session store is needed.
import crypto from 'node:crypto';

const SECRET = process.env.SECRET || '';
const SESSION_DAYS = Math.max(1, Number(process.env.SESSION_DAYS) || 90);

// On Vercel every deployment is https, so the cookie uses the hardened __Host- prefix (host-only,
// Secure, Path=/). openGym accepts both this and the legacy `gymsid` name on the way in.
const ORIGIN = process.env.ORIGIN || '';
const SECURE = !/^http:\/\//i.test(ORIGIN); // default to secure unless ORIGIN is explicitly http
const COOKIE = SECURE ? '__Host-gymsid' : 'gymsid';
const SECURE_ATTR = SECURE ? ' Secure;' : '';

function sign(payload) {
  if (!SECRET) throw new Error('SECRET not configured');
  const mac = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return payload + '.' + mac;
}

function verifySig(token) {
  if (!SECRET || !token) return null;
  const i = token.lastIndexOf('.');
  if (i < 0) return null;
  const payload = token.slice(0, i);
  const mac = token.slice(i + 1);
  const expect = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null;
  } catch {
    return null;
  }
  return payload;
}

export const sessionVersion = user => user.sv || 0;

export function makeSession(user, kind = 'c') {
  const exp = Date.now() + SESSION_DAYS * 86400000;
  return sign(user.id + ':' + exp + ':' + sessionVersion(user) + ':' + kind);
}

// Pull the session token from the Cookie header (both cookie names accepted) or a Bearer header.
function tokenFrom(req) {
  const cookieHeader = req.headers.cookie || '';
  for (const name of [COOKIE, 'gymsid']) {
    for (const part of cookieHeader.split(';')) {
      const eq = part.indexOf('=');
      if (eq < 0) continue;
      if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
    }
  }
  const auth = req.headers.authorization || '';
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
}

// Resolve the signed-in user for a request, or null. `lookup(uid)` is db.getUser.
export async function readSession(req, lookup) {
  const token = tokenFrom(req);
  const payload = verifySig(token);
  if (!payload) return null;
  const [uid, exp, ver] = payload.split(':');
  if (!uid || Number(exp) < Date.now()) return null;
  const user = await lookup(uid);
  if (!user || user.disabled) return null;
  const claimed = ver === undefined ? 0 : Number(ver);
  if (!Number.isInteger(claimed) || claimed !== sessionVersion(user)) return null;
  return user;
}

export function sessionCookie(user) {
  return `${COOKIE}=${makeSession(user, 'c')}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly;${SECURE_ATTR} SameSite=Lax`;
}

export const clearCookie = `${COOKIE}=; Path=/; Max-Age=0; HttpOnly;${SECURE_ATTR} SameSite=Lax`;

export const publicUser = u => ({
  id: u.id,
  name: u.name,
  admin: !!u.admin || !!u.owner,
  ...(u.owner ? { owner: true } : {}),
});

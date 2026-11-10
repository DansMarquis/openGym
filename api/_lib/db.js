// KV data layer for the minimal openGym-on-Vercel backend.
//
// openGym's real backend keeps per-profile JSON documents on a POSIX filesystem. On Vercel there
// is no persistent disk, so this replaces that layer with Upstash Redis (provisioned through the
// Vercel Marketplace). The data model is deliberately small — only what the login screen and the
// workout-sync loop need:
//
//   gym:name:<nameKey>  -> uid                 (login lookup, one per name/email)
//   gym:user:<uid>      -> user record (JSON)  (id, name, pw hash, created, sv, roles)
//   gym:state:<uid>     -> workout document (JSON, the thing GET/PUT /api/data move)
//   gym:meta            -> { users: <count>, owner: <uid|null> }  (health + first-admin claim)
//
// @upstash/redis is a REST client: no sockets, no connection pool, safe to construct per cold
// start in a serverless function.
import { Redis } from '@upstash/redis';

// A tiny in-memory stand-in for the subset of Redis this layer uses. Enabled with KV_DRIVER=memory
// (for `vercel dev` / local tests without a real store). State lives only in the process, so it is
// never used in production, where the Upstash env vars are always present.
function memoryClient() {
  const m = new Map();
  return {
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async set(k, v, opts) {
      if (opts && opts.nx && m.has(k)) return null;
      m.set(k, v);
      return 'OK';
    },
    async ping() { return 'PONG'; },
  };
}

// The Vercel Marketplace Upstash integration injects KV_REST_API_URL / KV_REST_API_TOKEN (the
// names Vercel KV used) and also the native UPSTASH_REDIS_REST_URL / _TOKEN. Accept either, so the
// same code works however the store was linked.
function client() {
  if ((process.env.KV_DRIVER || '').toLowerCase() === 'memory') return memoryClient();
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error('KV not configured: set KV_REST_API_URL and KV_REST_API_TOKEN (Upstash via Vercel Marketplace)');
  }
  return new Redis({ url, token });
}

let _redis = null;
const redis = () => (_redis ||= client());

const NAME_KEY = n => 'gym:name:' + String(n).trim().toLowerCase();
const USER_KEY = uid => 'gym:user:' + uid;
const STATE_KEY = uid => 'gym:state:' + uid;
const META_KEY = 'gym:meta';

// @upstash/redis already JSON-serialises objects it stores and parses them on the way out, so a
// value set as an object comes back as an object. Strings come back as strings.
export const db = {
  async meta() {
    return (await redis().get(META_KEY)) || { users: 0, owner: null };
  },
  async setMeta(meta) {
    await redis().set(META_KEY, meta);
  },
  async uidForName(name) {
    return await redis().get(NAME_KEY(name));
  },
  async getUser(uid) {
    return uid ? await redis().get(USER_KEY(uid)) : null;
  },
  async putUser(user) {
    await redis().set(USER_KEY(user.id), user);
  },
  // Create the name->uid index entry only if the name is free; returns false if it was taken.
  async claimName(name, uid) {
    const ok = await redis().set(NAME_KEY(name), uid, { nx: true });
    return ok === 'OK' || ok === true;
  },
  async getState(uid) {
    return await redis().get(STATE_KEY(uid));
  },
  async putState(uid, state) {
    await redis().set(STATE_KEY(uid), state);
  },
  async ping() {
    await redis().ping();
    return true;
  },
};

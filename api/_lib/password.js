// Password hashing with Node's built-in scrypt — no native dependency, runs on Vercel's Node
// runtime as-is. Format: `scrypt$<N>$<r>$<p>$<saltB64>$<hashB64>`. (openGym's own store uses a
// different format, but a fresh KV instance has no existing hashes to stay compatible with.)
import crypto from 'node:crypto';

const N = 16384, r = 8, p = 1, KEYLEN = 32;
const MIN_LENGTH = 8;
const MAX_LENGTH = 200;

export function passwordProblem(pw) {
  if (typeof pw !== 'string') return 'missing';
  if (pw.length < MIN_LENGTH) return 'too-short';
  if (pw.length > MAX_LENGTH) return 'too-long';
  return null;
}

export const POLICY_ERRORS = {
  missing: 'a password is required',
  'too-short': `the password needs at least ${MIN_LENGTH} characters`,
  'too-long': `the password can have at most ${MAX_LENGTH} characters`,
};

export function hashPassword(pw) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(pw, salt, KEYLEN, { N, r, p }, (err, dk) => {
      if (err) return reject(err);
      resolve(`scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${dk.toString('base64')}`);
    });
  });
}

export function verifyPassword(pw, stored) {
  return new Promise(resolve => {
    if (typeof pw !== 'string' || typeof stored !== 'string') return resolve(false);
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return resolve(false);
    const [, sN, sr, sp, saltB64, hashB64] = parts;
    let salt, expected;
    try {
      salt = Buffer.from(saltB64, 'base64');
      expected = Buffer.from(hashB64, 'base64');
    } catch {
      return resolve(false);
    }
    crypto.scrypt(pw, salt, expected.length, { N: Number(sN), r: Number(sr), p: Number(sp) }, (err, dk) => {
      if (err) return resolve(false);
      try {
        resolve(crypto.timingSafeEqual(dk, expected));
      } catch {
        resolve(false);
      }
    });
  });
}

// Small request/response helpers for the Vercel Node runtime.

export function json(res, status, body, headers) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // No caching of API answers by the browser or the CDN.
  res.setHeader('Cache-Control', 'no-store');
  if (headers) for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}

// Vercel's Node runtime parses JSON bodies into req.body for us; fall back to reading the raw
// stream if it didn't (e.g. an unusual content-type).
export async function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'object') return req.body;
    if (typeof req.body === 'string') {
      try { return JSON.parse(req.body); } catch { return {}; }
    }
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
}

// The path without query string, e.g. "/api/data".
export function pathOf(req) {
  const url = req.url || '';
  const q = url.indexOf('?');
  return q < 0 ? url : url.slice(0, q);
}

export function queryOf(req) {
  try { return new URL(req.url, 'http://x').searchParams; } catch { return new URLSearchParams(); }
}

const text = v => (typeof v === 'string' ? v : '');
export const str = text;

import { db } from './db.js';
import { json, queryOf } from './http.js';

export async function motivation(req, res) {
  const date = queryOf(req).get('date') || new Date().toISOString().slice(0, 10);
  const today = Date.parse(new Date().toISOString().slice(0, 10));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))
    || Math.abs(Date.parse(date) - today) > 86400000) return json(res, 400, { error: 'invalid quote date' });
  const key = 'quote:' + date;
  const cached = await db.cached(key);
  if (cached) return json(res, 200, cached);
  if (!await db.once(key, 60)) return json(res, 503, { error: 'Daily quote is temporarily unavailable.' });
  try {
    const response = await fetch('https://zenquotes.io/api/today', { signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw new Error('quote provider returned ' + response.status);
    const quotes = await response.json();
    const quote = Array.isArray(quotes) ? quotes[0] : null;
    if (typeof quote?.q !== 'string' || !quote.q.trim() || quote.q.length > 1000
      || typeof quote.a !== 'string' || !quote.a.trim() || quote.a.length > 160) throw new Error('invalid quote provider response');
    const value = { date, text: quote.q.trim(), author: quote.a.trim(), source: 'ZenQuotes API' };
    await db.cache(key, value, 259200);
    return json(res, 200, value);
  } catch (e) {
    console.error('daily quote:', e.message);
    return json(res, 503, { error: 'Daily quote is temporarily unavailable.' });
  }
}

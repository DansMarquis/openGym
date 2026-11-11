import { api } from './api.js'

const KEY = 'og_daily_quote'
const LOCAL = [
  'One small step today is progress worth keeping.',
  'Build a habit you can return to, not a perfect day.',
  'Your pace is yours. Keep showing up for yourself.',
  'Rest is part of progress. Listen to your body.',
  'A little consistency goes further than a little perfection.',
  'Make room for the effort you can give today.',
  'Every honest attempt is a place to begin again.',
]
export const offlineQuote = date => ({
  date, text: LOCAL[Math.abs(Math.floor(Date.parse(date + 'T12:00:00Z') / 86400000)) % LOCAL.length], author: 'openGym',
})
const valid = (quote, date) => quote?.date === date && typeof quote.text === 'string'
  && !!quote.text.trim() && quote.text.length <= 1000 && typeof quote.author === 'string' && !!quote.author.trim() && quote.author.length <= 160

export async function dailyQuote(date) {
  try {
    const cached = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (valid(cached, date)) return cached
  } catch (e) { console.warn('Daily quote cache could not be read:', e.message) }
  const quote = await api('/api/motivation?date=' + encodeURIComponent(date))
  if (!valid(quote, date)) throw new Error('Invalid daily quote')
  try { localStorage.setItem(KEY, JSON.stringify(quote)) }
  catch (e) { console.warn('Daily quote cache could not be saved:', e.message) }
  return quote
}

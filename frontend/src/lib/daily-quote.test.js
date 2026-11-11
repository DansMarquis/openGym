// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './api.js'
import { dailyQuote, offlineQuote } from './daily-quote.js'
vi.mock('./api.js', () => ({ api: vi.fn() }))
beforeEach(() => { localStorage.clear(); vi.mocked(api).mockReset() })

describe('daily inspiration', () => {
  const date = '2026-11-10'
  const quote = { date, text: 'Every honest attempt is a place to begin again.', author: 'openGym test', source: 'ZenQuotes API' }
  it('keeps the same API quote all day and can read it offline', async () => {
    vi.mocked(api).mockResolvedValue(quote)
    expect(await dailyQuote(date)).toEqual(quote)
    vi.mocked(api).mockRejectedValue(new Error('offline'))
    expect(await dailyQuote(date)).toEqual(quote)
    expect(api).toHaveBeenCalledTimes(1)
  })

  it('does not reuse yesterday or quietly hide a failed request', async () => {
    vi.mocked(api).mockResolvedValueOnce(quote).mockRejectedValueOnce(new Error('offline'))
    await dailyQuote(date)
    await expect(dailyQuote('2026-11-11')).rejects.toThrow('offline')
    expect(offlineQuote(date)).toEqual(offlineQuote(date))
    expect(offlineQuote('2026-11-11').text).not.toBe(offlineQuote(date).text)
  })

  it('rejects malformed provider data instead of caching an empty card', async () => {
    vi.mocked(api).mockResolvedValue({ date, text: '', author: 'Unknown' })
    await expect(dailyQuote(date)).rejects.toThrow('Invalid daily quote')
  })
})

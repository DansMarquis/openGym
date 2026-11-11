// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import DailyQuote from './DailyQuote.jsx'
import { dailyQuote } from '../lib/daily-quote.js'
vi.mock('../lib/daily-quote.js', async importOriginal => ({ ...await importOriginal(), dailyQuote: vi.fn() }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host, root
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(new Date(2026, 10, 10, 12))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks() })

it('renders text safely, credits the provider and refreshes after midnight', async () => {
  vi.mocked(dailyQuote).mockImplementation(async date => ({ date, text: '<img src=x onerror=bad()>', author: 'Test', source: 'ZenQuotes API' }))
  await act(async () => root.render(<DailyQuote />))
  expect(host.querySelector('blockquote').textContent).toBe('<img src=x onerror=bad()>')
  expect(host.querySelector('img')).toBeNull()
  expect(host.querySelector('a').href).toBe('https://zenquotes.io/')
  vi.setSystemTime(new Date(2026, 10, 11, 0, 1))
  await act(async () => document.dispatchEvent(new Event('visibilitychange')))
  expect(dailyQuote).toHaveBeenLastCalledWith('2026-11-11')
})

it('labels offline content instead of presenting it as an API response', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.mocked(dailyQuote).mockRejectedValue(new Error('offline'))
  await act(async () => root.render(<DailyQuote />))
  expect(host.textContent).toContain('Daily quote unavailable. Showing an offline message.')
  expect(host.textContent).toContain('openGym')
  expect(host.querySelector('a')).toBeNull()
})

it('cycles through six daily designs and preserves long quotes and attribution', async () => {
  const text = 'Small steps, taken consistently, help build a stronger tomorrow. '.repeat(8)
  vi.mocked(dailyQuote).mockImplementation(async date => ({ date, text, author: 'Test author', source: 'ZenQuotes API' }))
  const styles = new Set()
  await act(async () => root.render(<DailyQuote />))
  const firstStyle = host.querySelector('section').className
  await act(async () => document.dispatchEvent(new Event('visibilitychange')))
  expect(host.querySelector('section').className).toBe(firstStyle)
  for (let day = 10; day < 16; day++) {
    vi.setSystemTime(new Date(2026, 10, day, 12))
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    const card = host.querySelector('section')
    styles.add([...card.classList].find(name => /^daily-quote--(?!long)/.test(name)))
    expect(card.classList.contains('daily-quote--long')).toBe(true)
    expect(host.querySelector('blockquote').textContent).toBe(text)
    expect(host.querySelector('figcaption').textContent).toContain('Test author')
    expect(host.querySelector('a').href).toBe('https://zenquotes.io/')
  }
  expect(styles.size).toBe(6)
})

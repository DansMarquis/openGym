import { useEffect, useState } from 'react'
import { dailyQuote, offlineQuote } from '../lib/daily-quote.js'
import { todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import './DailyQuote.css'

const STYLES = ['olive', 'emerald', 'terracotta', 'indigo', 'berry', 'ocean']

export default function DailyQuote() {
  const [day, setDay] = useState(todayISO)
  const [result, setResult] = useState(null)
  useEffect(() => {
    const refresh = () => setDay(todayISO())
    const timer = setInterval(refresh, 60000)
    document.addEventListener('visibilitychange', refresh)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refresh) }
  }, [])
  useEffect(() => {
    let gone = false
    dailyQuote(day).then(quote => {
      if (!gone) setResult({ quote, offline: false })
    }).catch(e => {
      console.warn('Daily quote unavailable:', e.message)
      if (!gone) setResult({ quote: offlineQuote(day), offline: true })
    })
    return () => { gone = true }
  }, [day])
  const current = result?.quote.date === day ? result : null
  const style = STYLES[Math.floor(Date.parse(day + 'T12:00:00Z') / 86400000) % STYLES.length]
  const long = (current?.quote.text.length || 0) > 240
  return <section className={`card daily-quote daily-quote--${style}${long ? ' daily-quote--long' : ''}`} aria-label={t('Daily motivation')}>
    <div className="daily-quote-body">
      <div className="daily-quote-heading">{t('Daily motivation')}</div>
      <svg className="daily-quote-mark" viewBox="0 0 40 32" aria-hidden="true" focusable="false">
        <path d="M3 4h13v13c0 8-5 12-12 13v-6c4-1 6-3 6-6H3V4Zm22 0h13v13c0 8-5 12-12 13v-6c4-1 6-3 6-6h-7V4Z" fill="currentColor" />
      </svg>
      {!current ? <p className="daily-quote-loading" role="status">{t('Loading…')}</p> :
        <figure className="daily-quote-figure">
          <blockquote className="daily-quote-text" lang="en">{current.quote.text}</blockquote>
          <figcaption className="daily-quote-author" lang="en">
            <span aria-hidden="true">- </span>{current.quote.author}
          </figcaption>
        </figure>}
    </div>
    {current && <footer className="daily-quote-footer">
      {current.offline
        ? <p role="status">{t('Daily quote unavailable. Showing an offline message.')}</p>
        : <a href="https://zenquotes.io/" target="_blank" rel="noopener noreferrer">{current.quote.source || 'ZenQuotes API'}</a>}
    </footer>}
  </section>
}

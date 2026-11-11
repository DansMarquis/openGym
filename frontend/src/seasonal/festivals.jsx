import { useEffect, useState } from 'react'
import './festivals.css'

const COLORS = ['#e49c37', '#d85353', '#51a988', '#a47bce']

function Art({ theme, index = 0 }) {
  const color = COLORS[index % COLORS.length]
  if (theme === 'autumn') return <svg viewBox="0 0 40 48" fill="none">
    <path d="M20 3C3 9 2 29 18 36C34 31 39 15 20 3Z" fill={color} />
    <path d="M20 12L17 45M18 29L10 22M19 23L28 17" stroke="#794923" strokeWidth="2" strokeLinecap="round" />
  </svg>
  if (theme === 'santos') return <svg viewBox="0 0 40 58" fill="none">
    <path d="M20 2L36 18L27 36H13L4 18Z" fill={color} />
    <path d="M20 2L14 18L17 36M20 2L26 18L23 36M4 18H36" stroke="#fff" strokeOpacity=".6" />
    <path d="M17 38L14 52L20 48L24 56L26 38" stroke={color} strokeWidth="3" />
  </svg>
  if (theme === 'newyear') return <svg viewBox="0 0 64 64" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round">
    {Array.from({ length: 12 }, (_, i) => <path key={i} d="M32 13V3M32 43V58" transform={`rotate(${i * 30} 32 32)`} />)}
    <circle cx="32" cy="32" r="3" fill={color} />
  </svg>
  return <svg viewBox="0 0 40 48" fill="none">
    <path d="M8 3L18 10L11 21L2 14Z" fill={color} />
    <path d="M28 16C39 23 19 29 31 39" stroke={COLORS[(index + 1) % 4]} strokeWidth="4" />
    <circle cx="9" cy="37" r="4" fill={color} />
  </svg>
}

export function Layer({ theme, hidden = false }) {
  const [visible, setVisible] = useState(!document.hidden)
  useEffect(() => {
    const change = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', change)
    return () => document.removeEventListener('visibilitychange', change)
  }, [])
  if (!visible || hidden) return null
  return <div aria-hidden="true" className={`festival-layer festival-${theme}`} key={theme}>
    {theme === 'santos' && <svg className="festival-bunting" viewBox="0 0 360 35" preserveAspectRatio="none">
      <path d="M0 2Q180 42 360 2" fill="none" stroke="#b48b60" />
      {Array.from({ length: 12 }, (_, i) => <path key={i} d={`M${i * 30 + 5} 12l12 20l12-20Z`} fill={COLORS[i % 4]} />)}
    </svg>}
    {Array.from({ length: 12 }, (_, i) => <span key={i} className="festival-particle" style={{
      left: `${3 + (i * 37) % 94}%`, top: theme === 'newyear' ? `${8 + (i * 17) % 65}%` : undefined,
      '--delay': `${i * 1.3}s`, '--duration': `${10 + i % 5}s`,
    }}><Art theme={theme} index={i} /></span>)}
  </div>
}

export function Deco({ theme, spot }) {
  if (!['home-hero', 'home-streak', 'workout-hdr', 'finish'].includes(spot)) return null
  return <span aria-hidden="true" className="festival-deco"><Art theme={theme} /></span>
}

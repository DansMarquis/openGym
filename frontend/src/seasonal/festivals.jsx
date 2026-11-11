import { useEffect, useState } from 'react'
import './festivals.css'

const COLORS = {
  autumn: ['#c96428', '#d9962f', '#9d4d2e', '#e4b85c'],
  santos: ['#e49c37', '#d85353', '#51a988', '#a47bce'],
  newyear: ['#e8bc4e', '#f4eee0', '#df7048', '#92b8d5'],
  carnival: ['#e84d8a', '#f4c542', '#35b8a0', '#8d64d6'],
}

function Art({ theme, index = 0 }) {
  const palette = COLORS[theme] || COLORS.carnival
  const color = palette[index % palette.length]
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
  if (theme === 'carnival') return <svg viewBox="0 0 48 36" fill="none">
    <path d="M3 12C8 3 16 4 24 11C32 4 40 3 45 12L40 26C35 30 29 28 24 23C19 28 13 30 8 26Z" fill={color} />
    <path d="M7 14C12 10 18 12 22 17C17 22 12 23 9 20ZM26 17C30 12 36 10 41 14L39 20C36 23 31 22 26 17Z" fill="#fffaf0" />
    <path d="M24 11V23M4 13L1 8M44 13L47 8" stroke={palette[(index + 1) % palette.length]} strokeWidth="2" strokeLinecap="round" />
  </svg>
  return <svg viewBox="0 0 40 48" fill="none">
    <path d="M8 3L18 10L11 21L2 14Z" fill={color} />
    <path d="M28 16C39 23 19 29 31 39" stroke={palette[(index + 1) % palette.length]} strokeWidth="4" />
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
    {['santos', 'carnival'].includes(theme) && <svg className="festival-bunting" viewBox="0 0 360 35" preserveAspectRatio="none">
      <path d="M0 2Q180 42 360 2" fill="none" stroke="currentColor" />
      {Array.from({ length: 12 }, (_, i) => <path key={i} d={`M${i * 30 + 5} 12l12 20l12-20Z`} fill={COLORS[theme][i % 4]} />)}
    </svg>}
    {Array.from({ length: 12 }, (_, i) => <span key={i} className="festival-particle" style={{
      left: `${3 + (i * 37) % 94}%`, top: theme === 'newyear' ? `${8 + (i * 17) % 65}%` : undefined,
      '--delay': `${i * 1.3}s`, '--duration': `${10 + i % 5}s`,
    }}><Art theme={theme} index={i} /></span>)}
  </div>
}

export function Deco({ theme, spot }) {
  const art = index => <Art theme={theme} index={index} />
  switch (spot) {
    case 'header-bats':
    case 'stats-hdr': return <span aria-hidden="true" className="festival-header">{[0, 1, 2, 3].map(art)}</span>
    case 'home-hero': return <span aria-hidden="true" className="festival-card-deco festival-corner festival-corner-br">{art(0)}</span>
    case 'plan-card': return <span aria-hidden="true" className="festival-card-deco festival-corner festival-corner-tr">{art(1)}</span>
    case 'stats-web': return <span aria-hidden="true" className="festival-card-deco festival-corner festival-corner-bl">{art(2)}</span>
    case 'home-streak': return <span aria-hidden="true" className="festival-card-deco festival-peek">{art(0)}</span>
    case 'stats-peek': return <span aria-hidden="true" className="festival-card-deco festival-peek festival-peek-pair">{art(0)}{art(2)}</span>
    case 'stats-tile': return <span aria-hidden="true" className="festival-card-deco festival-hang">{art(0)}{art(2)}</span>
    case 'stats-heatmap': return <span aria-hidden="true" className="festival-card-deco festival-hang festival-hang-single">{art(1)}</span>
    case 'streak-flame': return <span aria-hidden="true" className="festival-hat">{art(0)}</span>
    case 'workout-hdr': return <span aria-hidden="true" className="festival-card-deco festival-workout-corner">{art(1)}</span>
    case 'rest-timer': return <span aria-hidden="true" className="festival-rest">{[0, 1, 2].map(art)}</span>
    case 'streak-party':
    case 'finish': return <span aria-hidden="true" className="festival-finish">{art(0)}{art(2)}</span>
    default: return null
  }
}

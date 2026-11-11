// Seasonal themes (v1.4.3): a little decoration for a few weeks a year. Halloween first, then
// Christmas (v1.4.4) with its advent calendar (lib/advent.js).
//
// This file is all the main bundle carries of them: the list, the date windows and the choice.
// The art, its CSS and its timers live in seasonal/<id>.jsx, fetched only while a theme is on
// (components/Seasonal.jsx), so a profile with themes off, or a day out of season, pays nothing.
//
// The choice is a Look setting like Theme and Accent color, so it syncs with the profile:
// S.seasonal = { halloween: 'auto' | 'on' | 'off', halloweenColors: true, halloweenWorkout: false,
//               christmas: 'auto', christmasColors: false, christmasWorkout: true }.
// Absent reads as Auto, without the colours, and with the workout screen decorated.
// What happens once a day (the pumpkin's surprise) is per device, in localStorage below.

/* One entry per theme. `from` and `to` are [month, day], 1-based and inclusive, in local time:
   Halloween is on from 1 October to the end of 31 October and gone on 1 November. The strings
   are English keys, translated where they are shown. A theme with `colors` offers an accent
   override, which is only ever opt-in. `appIcon` names its icon in lib/app-icon-variants.js, which
   the settings page then suggests while the theme shows. */
import { isOn } from './modules.js'

export const THEMES = [
  {
    id: 'newyear', title: 'New Year', icon: 'sparkles', tint: 'var(--orange)',
    from: [12, 31], to: [1, 6],
    colors: 'orange', colorsTitle: 'Festive colors', colorsNote: 'Your own accent returns when the theme ends.',
    workoutTitle: 'Also during workouts', workoutNote: 'Seasonal decorations. Never on your sets.',
    during: 'Seasonal decorations. Never on your sets.', back: 'Returns automatically in season.',
  },
  {
    id: 'halloween', title: 'Halloween', icon: 'pumpkin', tint: 'var(--orange)',
    from: [10, 1], to: [10, 31],
    colors: 'orange', colorsTitle: 'Spooky colors', colorsNote: 'A pumpkin orange accent while Halloween shows. Your own color comes back after.',
    workoutTitle: 'Also during workouts', workoutNote: 'A cobweb in the header, bats behind the rest timer, pumpkins on the finish screen. Never on your sets.',
    during: 'Spiders, bats and one shy pumpkin until the end of October. Never during a workout.',
    back: 'Back next October. The spiders are on holiday.',
    appIcon: 'halloween', appIconTitle: 'Try the Halloween app icon',
  },
  {
    id: 'christmas', title: 'Christmas', icon: 'gift', tint: 'var(--red)',
    from: [12, 1], to: [12, 31],
    colors: 'red', colorsTitle: 'Festive colors', colorsNote: 'A berry red accent while Christmas shows. Your own color comes back after.',
    workoutTitle: 'Also during workouts', workoutNote: 'A few snowflakes behind the cards, a bauble in the header, presents on the finish screen. Never on your sets.',
    during: 'Snow, fairy lights, a sleigh and an advent calendar until the end of December. Never on your sets.',
    back: 'Back next December. The elves are on a tea break.',
    appIcon: 'christmas', appIconTitle: 'Try the Christmas app icon',
  },
  {
    id: 'santos', title: 'Santos Populares', icon: 'gift', tint: 'var(--red)',
    from: [6, 1], to: [6, 30],
    colors: 'red', colorsTitle: 'Festive colors', colorsNote: 'Your own accent returns when the theme ends.',
    workoutTitle: 'Also during workouts', workoutNote: 'Seasonal decorations. Never on your sets.',
    during: 'Seasonal decorations. Never on your sets.', back: 'Returns automatically in season.',
  },
  {
    id: 'carnival', title: 'Carnival', icon: 'sparkles', tint: 'var(--purple)',
    from: [2, 1], to: [3, 9],
    colors: 'purple', colorsTitle: 'Festive colors', colorsNote: 'Your own accent returns when the theme ends.',
    workoutTitle: 'Also during workouts', workoutNote: 'Seasonal decorations. Never on your sets.',
    during: 'Seasonal decorations. Never on your sets.', back: 'Returns automatically in season.',
  },
  {
    id: 'autumn', title: 'Autumn', icon: 'sparkles', tint: 'var(--orange)',
    from: [9, 22], to: [11, 30],
    colors: 'orange', colorsTitle: 'Festive colors', colorsNote: 'Your own accent returns when the theme ends.',
    workoutTitle: 'Also during workouts', workoutNote: 'Seasonal decorations. Never on your sets.',
    during: 'Seasonal decorations. Never on your sets.', back: 'Returns automatically in season.',
  },
]
export const THEME_IDS = THEMES.map(th => th.id)
export const CHOICES = ['auto', 'on', 'off']
const byId = id => THEMES.find(th => th.id === id) || null

const md = d => (d.getMonth() + 1) * 100 + d.getDate()

// Gregorian Easter (Meeus), then 47 days back to Carnival Tuesday.
export function carnivalTuesday(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451), x = h + l - 7 * m + 114
  const date = new Date(year, Math.floor(x / 31) - 1, (x % 31) + 1, 12)
  date.setDate(date.getDate() - 47)
  return date
}

/** Whether `now` (local time) falls inside the theme's window. A window may wrap the new year. */
export function inSeason(theme, now = new Date()) {
  const th = typeof theme === 'string' ? byId(theme) : theme
  if (!th) return false
  if (th.id === 'carnival') {
    const end = carnivalTuesday(now.getFullYear()), start = new Date(end)
    start.setDate(start.getDate() - 3)
    return md(now) >= md(start) && md(now) <= md(end)
  }
  const x = md(now), a = th.from[0] * 100 + th.from[1], b = th.to[0] * 100 + th.to[1]
  return a <= b ? x >= a && x <= b : x >= a || x <= b
}

/** 'auto', 'on' or 'off'; anything else (absent, a value from a newer client) reads as Auto. */
export function seasonChoice(S, id) {
  const v = S?.seasonal?.[id]
  return CHOICES.includes(v) ? v : 'auto'
}

/** Whether the theme shows now: On always, Off never, Auto inside its window. */
export function themeOn(S, id, now = new Date()) {
  const c = seasonChoice(S, id)
  return c === 'on' || (c === 'auto' && inSeason(id, now))
}

/** Explicit On wins over Auto. Otherwise list order gives holidays priority over autumn. */
export function activeSeason(S, now = new Date()) {
  // Settings → Modules: Seasonal themes off is no theme at all, whatever each one is set to.
  if (!isOn(S, 'seasonal')) return null
  return THEMES.find(th => seasonChoice(S, th.id) === 'on')?.id
    || THEMES.find(th => themeOn(S, th.id, now))?.id || null
}

/** The accent a showing theme puts on instead of the user's own, when its colours are chosen. */
export function seasonAccent(S, now = new Date()) {
  const id = activeSeason(S, now)
  const th = id && byId(id)
  return th?.colors && S?.seasonal?.[id + 'Colors'] === true ? th.colors : null
}

/** Whether the showing theme also decorates the workout screen: on unless switched off. */
export function seasonInWorkout(S, now = new Date()) {
  const id = activeSeason(S, now)
  return !!id && S?.seasonal?.[id + 'Workout'] !== false
}

/* Once a day per device: true the first time it is asked on a local date, false after. Storage
   that is not there (a private window, blocked site data) answers false, so nothing repeats. */
const pad = n => String(n).padStart(2, '0')
const dayOf = now => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
export function onceToday(key, now = new Date()) {
  try {
    const k = 'og_season_' + key, today = dayOf(now)
    if (localStorage.getItem(k) === today) return false
    localStorage.setItem(k, today)
    return true
  } catch (e) { return false }
}
/** Whether onceToday(key) already fired today, without using it up. */
export function doneToday(key, now = new Date()) {
  try { return localStorage.getItem('og_season_' + key) === dayOf(now) } catch (e) { return true }
}

export const reducedMotion = () => {
  try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches } catch (e) { return false }
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
export const validTime = value => typeof value === 'string' && TIME.test(value)
export const timeMinutes = value => validTime(value) ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : null

// Read the original one-period shape as well as a day's list, without rewriting saved data.
export const openingPeriods = day => day == null ? [] : Array.isArray(day) ? day : [day]
export const validOpeningPeriod = period => !!period && !Array.isArray(period)
  && validTime(period.from) && validTime(period.to) && period.from !== period.to
export const validOpeningDay = day => openingPeriods(day).every(validOpeningPeriod)

// Missing opening hours mean "not specified"; an empty entry explicitly means closed.
export function gymOpenAt(hours, weekday, time) {
  const minute = timeMinutes(time)
  if (minute == null) return false
  if (!hours) return true
  const current = openingPeriods(hours[weekday])
  const previous = openingPeriods(hours[(weekday + 6) % 7])
  const contains = (entry, overnight) => {
    const from = timeMinutes(entry?.from), to = timeMinutes(entry?.to)
    if (from == null || to == null || from === to) return false
    return overnight ? from > to && minute < to
      : from < to ? minute >= from && minute < to : minute >= from
  }
  return current.some(period => contains(period, false)) || previous.some(period => contains(period, true))
}

export function trainingTime(reminder, weekday) {
  return validTime(reminder?.training?.[weekday]) ? reminder.training[weekday] : null
}

export function leadMinutes(reminder) {
  const n = Number(reminder?.lead)
  return Number.isInteger(n) && n >= 0 && n <= 180 ? n : 30
}

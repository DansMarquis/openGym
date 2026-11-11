import { describe, expect, it } from 'vitest'
import { gymOpenAt, leadMinutes, trainingTime, validTime, validOpeningDay } from './training-hours.js'

describe('gym opening hours', () => {
  it('accepts separate opening periods without treating the breaks as open', () => {
    const hours = { 1: [
      { from: '07:00', to: '14:00' },
      { from: '15:00', to: '17:00' },
      { from: '20:00', to: '23:00' },
    ] }
    for (const time of ['07:00', '13:59', '15:00', '16:59', '20:00', '22:59']) {
      expect(gymOpenAt(hours, 1, time), time).toBe(true)
    }
    for (const time of ['06:59', '14:00', '14:30', '17:00', '19:59', '23:00']) {
      expect(gymOpenAt(hours, 1, time), time).toBe(false)
    }
  })

  it('distinguishes unspecified hours, closed days and a closing boundary', () => {
    expect(gymOpenAt(undefined, 1, '18:00')).toBe(true)
    expect(gymOpenAt({}, 1, '18:00')).toBe(false)
    const hours = { 1: { from: '06:00', to: '22:00' } }
    expect(gymOpenAt(hours, 1, '06:00')).toBe(true)
    expect(gymOpenAt(hours, 1, '21:59')).toBe(true)
    expect(gymOpenAt(hours, 1, '22:00')).toBe(false)
  })

  it('carries overnight opening into the next day, including Sunday', () => {
    const hours = { 6: { from: '22:00', to: '02:00' } }
    expect(gymOpenAt(hours, 6, '23:00')).toBe(true)
    expect(gymOpenAt(hours, 0, '01:59')).toBe(true)
    expect(gymOpenAt(hours, 0, '02:00')).toBe(false)
    expect(gymOpenAt(hours, 6, '01:00')).toBe(false)
  })

  it('carries overnight periods in a split day into the next weekday only', () => {
    const hours = { 6: [{ from: '07:00', to: '14:00' }, { from: '20:00', to: '02:00' }], 0: [] }
    expect(gymOpenAt(hours, 6, '12:00')).toBe(true)
    expect(gymOpenAt(hours, 6, '16:00')).toBe(false)
    expect(gymOpenAt(hours, 6, '23:00')).toBe(true)
    expect(gymOpenAt(hours, 0, '01:59')).toBe(true)
    expect(gymOpenAt(hours, 0, '02:00')).toBe(false)
    expect(gymOpenAt(hours, 1, '01:00')).toBe(false)
  })

  it('validates every period while keeping old single-period and closed days readable', () => {
    expect(validOpeningDay({ from: '07:00', to: '14:00' })).toBe(true)
    expect(validOpeningDay([{ from: '07:00', to: '14:00' }, { from: '15:00', to: '17:00' }])).toBe(true)
    expect(validOpeningDay(null)).toBe(true)
    expect(validOpeningDay([])).toBe(true)
    expect(validOpeningDay([{ from: '07:00', to: '14:00' }, { from: '17:00', to: '17:00' }])).toBe(false)
    expect(validOpeningDay([null])).toBe(false)
    expect(validOpeningDay([[{ from: '07:00', to: '14:00' }]])).toBe(false)
    expect(validOpeningDay('07:00-14:00')).toBe(false)
  })

  it('rejects invalid times and treats equal boundaries as closed', () => {
    expect(validTime('24:00')).toBe(false)
    expect(validTime('8:00')).toBe(false)
    expect(gymOpenAt({ 1: { from: '08:00', to: '08:00' } }, 1, '12:00')).toBe(false)
    expect(trainingTime({ training: { 1: 'bad' } }, 1)).toBe(null)
    expect(leadMinutes({ lead: -1 })).toBe(30)
  })
})

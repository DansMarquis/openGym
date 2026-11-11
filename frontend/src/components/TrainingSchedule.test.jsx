// @vitest-environment happy-dom
import React, { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it } from 'vitest'
import TrainingSchedule from './TrainingSchedule.jsx'
globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host, root
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })
function Editor({ initial = {} }) {
  const [reminder, setReminder] = useState(initial)
  return <TrainingSchedule reminder={reminder} setReminder={patch => setReminder(r => ({ ...r, ...patch }))} />
}
const click = label => act(() => host.querySelector(`[aria-label="${label}"]`).click())

it('lets the user choose training days and warns when the gym is closed', async () => {
  await act(async () => root.render(<Editor />))
  expect(host.querySelector('input[type="time"]')).toBeNull()
  click('Choose training times')
  click('Monday: Choose training times')
  expect(host.querySelector('[aria-label="Monday: Training times"]').value).toBe('18:00')
  click('Use gym opening hours')
  expect(host.textContent).not.toContain('Outside gym opening hours.')
  click('Monday: Gym opening hours')
  expect(host.textContent).toContain('Outside gym opening hours. No reminder will be sent.')
  click('Monday: Choose training times')
  expect(host.textContent).not.toContain('Outside gym opening hours.')
  click('Choose training times')
  expect(host.querySelector('input[type="time"]')).toBeNull()
})

it('adds and removes opening periods without discarding a legacy day or changing other days', async () => {
  await act(async () => root.render(<Editor initial={{
    training: { 1: '18:00' },
    hours: { 1: { from: '07:00', to: '14:00' }, 2: [{ from: '09:00', to: '17:00' }] },
  }} />))
  const monday = () => host.querySelector('[role="group"][aria-label="Monday"]')
  const addMonday = () => act(() => [...monday().querySelectorAll('button')].find(button => button.textContent === 'Add opening period').click())
  expect(host.querySelector('[aria-label="Monday: 1: Opening time"]').value).toBe('07:00')
  addMonday()
  addMonday()
  expect(monday().querySelectorAll('input[type="time"]').length).toBe(6)
  expect(host.querySelector('[aria-label="Monday: 1: Closing time"]').value).toBe('14:00')
  expect(host.querySelector('[aria-label="Monday: 2: Opening time"]').value).toBe('14:00')
  expect(host.querySelector('[aria-label="Tuesday: 1: Opening time"]').value).toBe('09:00')
  click('Monday: 2: Remove opening period')
  expect(monday().querySelectorAll('input[type="time"]').length).toBe(4)
  click('Monday: 1: Remove opening period')
  click('Monday: 1: Remove opening period')
  expect(monday().querySelector('input[type="time"]')).toBeNull()
  expect(host.querySelector('[aria-label="Monday: Gym opening hours"]').getAttribute('aria-checked')).toBe('false')
  expect(host.textContent).toContain('Outside gym opening hours. No reminder will be sent.')
})

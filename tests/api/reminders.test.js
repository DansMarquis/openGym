import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reminderDue } from '../../api/_lib/reminders.js';

test('a planned Monday training notifies thirty minutes before, in the user timezone', () => {
  const state = {
    reminder: { on: true, tz: 'Europe/Lisbon', training: { 1: '18:00' }, lead: 30 },
    workouts: [], routines: [],
  };
  assert.equal(reminderDue(state, new Date('2026-11-09T17:29:00Z')), null);
  assert.deepEqual(reminderDue(state, new Date('2026-11-09T17:30:00Z')), {
    date: '2026-11-09', time: '18:00',
  });
  assert.equal(reminderDue(state, new Date('2026-11-09T17:46:00Z')), null);
});

test('summer time, midnight lead and a disabled reminder use the training day', () => {
    const state = {
      reminder: { on: true, tz: 'Europe/Lisbon', training: { 1: '00:15' }, lead: 30 },
      workouts: [], routines: [],
    };
    assert.deepEqual(reminderDue(state, new Date('2026-07-05T22:45:00Z')), { date: '2026-07-06', time: '00:15' });
    state.workouts = [{ d: '2026-07-06' }];
    assert.equal(reminderDue(state, new Date('2026-07-05T22:45:00Z')), null);
    state.workouts = [];
    state.reminder.on = false;
    assert.equal(reminderDue(state, new Date('2026-07-05T22:45:00Z')), null);
});

test('a closed gym, excused day and unplanned day never send', () => {
    const state = {
      reminder: { on: true, tz: 'UTC', training: { 1: '18:00' }, lead: 30, hours: {} },
      workouts: [], routines: [],
    };
    const now = new Date('2026-11-09T17:35:00Z');
    assert.equal(reminderDue(state, now), null);
    state.reminder.hours = { 1: { from: '06:00', to: '22:00' } };
    state.dayNotes = { '2026-11-09': { tag: 'sick' } };
    assert.equal(reminderDue(state, now), null);
    delete state.dayNotes;
    assert.deepEqual(reminderDue(state, now), { date: '2026-11-09', time: '18:00' });
    assert.equal(reminderDue(state, new Date('2026-11-10T17:35:00Z')), null);
});

test('the legacy routine reminder does not carry yesterday into the next day', () => {
  const state = {
    reminder: { on: true, tz: 'UTC', time: '23:55' },
    workouts: [], routines: [{ id: 'a', name: 'A' }], week: { 1: 'a' }, dayPlan: {},
  };
  assert.equal(reminderDue(state, new Date('2026-11-10T00:01:00Z')), null);
});

test('split gym opening hours suppress reminders during every break', () => {
  const state = {
    reminder: {
      on: true, tz: 'UTC', lead: 30, training: { 1: '15:30' },
      hours: { 1: [{ from: '07:00', to: '14:00' }, { from: '15:00', to: '17:00' }, { from: '20:00', to: '23:00' }] },
    },
    workouts: [], routines: [],
  };
  assert.deepEqual(reminderDue(state, new Date('2026-11-09T15:00:00Z')), { date: '2026-11-09', time: '15:30' });
  state.reminder.training[1] = '14:30';
  assert.equal(reminderDue(state, new Date('2026-11-09T14:00:00Z')), null);
  state.reminder.training[1] = '18:00';
  assert.equal(reminderDue(state, new Date('2026-11-09T17:30:00Z')), null);
  state.reminder.training[1] = '20:00';
  assert.deepEqual(reminderDue(state, new Date('2026-11-09T19:30:00Z')), { date: '2026-11-09', time: '20:00' });
});

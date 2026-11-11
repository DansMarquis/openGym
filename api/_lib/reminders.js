import { gymOpenAt, leadMinutes, timeMinutes, trainingTime } from '../../frontend/src/lib/training-hours.js';
import { effectiveRoutineId } from '../../_legacy-backend/queue.js';

export function wallClock(now, tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map(p => [p.type, p.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return {
    date, time: `${parts.hour}:${parts.minute}`,
    weekday: new Date(date + 'T12:00:00Z').getUTCDay(),
  };
}

const excused = (S, date) => {
  const note = S.dayNotes?.[date];
  return ['sick', 'travel', 'rest', 'injured'].includes(note?.tag) || !!note?.text?.trim();
};

export function reminderDue(S, now = new Date()) {
  const r = S?.reminder;
  if (!r?.on || !r.tz) return null;
  const lead = r.training ? leadMinutes(r) : 0;
  const today = wallClock(now, r.tz).date;
  // Compare instants before converting to the user's wall clock. This also handles a reminder
  // on the evening before training and offsets changing at daylight-saving boundaries.
  for (let late = 0; late <= 15; late++) {
    const target = wallClock(new Date(now.getTime() + (lead - late) * 60000), r.tz);
    if (!r.training && target.date !== today) continue;
    const planned = r.training ? trainingTime(r, target.weekday) : r.time;
    if (timeMinutes(planned) == null || planned !== target.time) continue;
    if (r.training && !gymOpenAt(r.hours, target.weekday, planned)) continue;
    if ((S.workouts || []).some(w => w?.d === target.date) || excused(S, target.date)) continue;
    if (!r.training && !effectiveRoutineId(S, target.date)) continue;
    return { date: target.date, time: planned };
  }
  return null;
}

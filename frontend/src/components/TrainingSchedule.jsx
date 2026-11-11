import { Section, Row, Switch, SelectRow, Button } from './ui.jsx'
import { t } from '../lib/i18n.js'
import { DAYN } from '../lib/format.js'
import { gymOpenAt, leadMinutes, trainingTime, openingPeriods, validOpeningPeriod, timeMinutes } from '../lib/training-hours.js'
import './TrainingSchedule.css'

export default function TrainingSchedule({ reminder = {}, setReminder }) {
  const weekdays = [1, 2, 3, 4, 5, 6, 0]
  const custom = reminder.training != null
  const changeDay = (day, time) => {
    const training = { ...reminder.training }
    if (time) training[day] = time
    else delete training[day]
    setReminder({ training })
  }
  const changeHours = (day, periods) => setReminder({
    hours: { ...reminder.hours, [day]: periods },
  })
  const changePeriod = (day, index, patch) => changeHours(day,
    openingPeriods(reminder.hours?.[day]).map((period, i) => i === index ? { ...period, ...patch } : period))
  const addPeriod = day => {
    const periods = openingPeriods(reminder.hours?.[day])
    const last = periods.at(-1)?.to || '06:00'
    const end = (timeMinutes(last) + 60) % 1440
    changeHours(day, [...periods, { from: last, to: `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}` }])
  }
  return <>
    <Section title={t('Training times')} footer={t('Reminders can arrive a few minutes late. Your saved timezone is used even when the app is closed.')}>
      <Row icon="calendar" title={t('Choose training times')}>
        <Switch checked={custom} aria-label={t('Choose training times')}
          onChange={on => setReminder({ training: on ? {} : null })} />
      </Row>
      {custom && <>
        <SelectRow icon="bell" title={t('Remind me before training')} value={String(leadMinutes(reminder))}
          onChange={value => setReminder({ lead: Number(value) })}
          options={[0, 15, 30, 60, 120, 180].map(n => ({ value: String(n), label: `${n} ${t('min')}` }))} />
        {weekdays.map(day => {
          const time = trainingTime(reminder, day)
          const outside = time && !gymOpenAt(reminder.hours, day, time)
          return <Row key={day} title={t(DAYN[day])} subtitle={outside ? t('Outside gym opening hours. No reminder will be sent.') : undefined}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {time && <input type="time" className="timef" value={time} aria-label={t(DAYN[day]) + ': ' + t('Training times')}
                onChange={e => { if (e.target.value) changeDay(day, e.target.value) }} />}
              <Switch checked={!!time} aria-label={t(DAYN[day]) + ': ' + t('Choose training times')}
                onChange={on => changeDay(day, on ? '18:00' : null)} />
            </div>
          </Row>
        })}
      </>}
    </Section>
    <Section title={t('Gym opening hours')} footer={t('An overnight opening continues into the next day. Turn a day off when the gym is closed.')}>
      <Row icon="clock" title={t('Use gym opening hours')}>
        <Switch checked={!!reminder.hours} aria-label={t('Use gym opening hours')} onChange={on => setReminder({
          hours: on ? Object.fromEntries(weekdays.map(day => [day, [{ from: '06:00', to: '22:00' }]])) : null,
        })} />
      </Row>
      {reminder.hours && weekdays.map(day => {
        const periods = openingPeriods(reminder.hours[day])
        const label = t(DAYN[day])
        return <div key={day} className="gym-hours-day" role="group" aria-label={label}>
          <Row title={label}>
            <Switch checked={periods.length > 0} aria-label={label + ': ' + t('Gym opening hours')}
              onChange={on => changeHours(day, on ? [{ from: '06:00', to: '22:00' }] : null)} />
          </Row>
          {periods.length > 0 && <div className="gym-hours-periods">
            {periods.map((period, index) => {
              const invalid = !validOpeningPeriod(period)
              const prefix = label + ': ' + (index + 1) + ': '
              const errorId = `gym-hours-error-${day}-${index}`
              return <div key={index} className="gym-hours-period">
                <div className="gym-hours-inputs">
                  <input type="time" className="timef" value={period.from} aria-label={prefix + t('Opening time')}
                    aria-invalid={invalid || undefined} aria-describedby={invalid ? errorId : undefined}
                    onChange={e => { if (e.target.value) changePeriod(day, index, { from: e.target.value }) }} />
                  <span aria-hidden="true">-</span>
                  <input type="time" className="timef" value={period.to} aria-label={prefix + t('Closing time')}
                    aria-invalid={invalid || undefined} aria-describedby={invalid ? errorId : undefined}
                    onChange={e => { if (e.target.value) changePeriod(day, index, { to: e.target.value }) }} />
                  <Button size="sm" variant="ghost" icon="minus" aria-label={prefix + t('Remove opening period')}
                    onClick={() => changeHours(day, periods.filter((_, i) => i !== index))} />
                </div>
                {invalid && <p id={errorId} className="gym-hours-error" role="status">{t('Opening and closing times must differ.')}</p>}
              </div>
            })}
            <Button size="sm" variant="ghost" icon="plus" onClick={() => addPeriod(day)}>{t('Add opening period')}</Button>
          </div>}
        </div>
      })}
    </Section>
  </>
}

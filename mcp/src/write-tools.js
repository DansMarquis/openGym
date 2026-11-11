/* The write tools save a described workout or a confirmed training plan through the user's
   openGym server (api-client.js), preserving the revision contract the phone sync uses.

   The language is the LLM's job and the arithmetic is the lib's (frontend/src/lib/log-workout.js):
   the client turns what was said into exercises and sets, and this builds, checks and files them.
   What the lib will not guess at — a name the library spells twice, an exercise the user has not
   made yet — comes back as `problems` with candidates, for the LLM to put to the user. Plan
   creation previews first and always adds new routines rather than replacing existing ones. */
import { z } from 'zod'
import { isoDate, entryView, withCustomsIndexed } from './tools.js'
import { localUid, invalidate } from './state.js'
import { apiConfig, apiFetch } from './api-client.js'
import { buildLoggedWorkout, appendLoggedWorkout, findDuplicate, BODY_PARTS, LOG_LIMITS } from '../../frontend/src/lib/log-workout.js'
import { friendlyDuration } from './labels.js'
import { mergePlan, parsePlan } from '../../frontend/src/lib/plan-share.js'
import crypto from 'node:crypto'

const localIso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
const hhmm = t => { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') }
// Two writers racing the same profile resolve in a round or two; past that something keeps
// writing, and the user is better told than retried at.
const MAX_ATTEMPTS = 3
// Saves per hour, per MCP process. Logging a week someone forgot is a handful; a client looping on
// the tool is not, and each save is a full profile write on the server that every device pulls.
export const WRITE_LIMIT = 20
const WINDOW_MS = 60 * 60000
let saves = []
export const _resetWriteWindow = () => { saves = [] }
const PLAN_CONFIRM_MS = 10 * 60000
const pendingPlans = new Map()

function fail(code, message) {
  const err = new Error(message)
  err.code = code
  return err
}

// The tool's snake_case parameters as the lib's description.
const inputOf = p => ({
  date: p.date,
  start: p.start,
  durationMin: p.duration_min,
  name: p.name,
  note: p.note,
  unit: p.unit,
  exercises: (p.exercises || []).map(ex => ({
    exercise: ex.exercise,
    createCustom: ex.create_custom,
    bodyPart: ex.body_part,
    note: ex.note,
    sets: (ex.sets || []).map(s => ({ reps: s.reps, seconds: s.seconds, weight: s.weight, warmup: s.warmup, failure: s.failure, rir: s.rir, rpe: s.rpe })),
  })),
})

// What was (or would be) saved, read back the way get_workout reads a session, so the user can
// check it in the words the app uses ("12 × 12 kg", "1:00").
function viewOf(w, S, resolved) {
  const withCustoms = { ...S, customEx: [...(S.customEx || []), ...resolved.customEx] }
  return {
    workout_id: w.id,
    date: w.d,
    start: hhmm(w.start),
    duration: w.end > w.start ? friendlyDuration(w.end - w.start) : null,
    name: w.name,
    unit: S.unit === 'lb' ? 'lb' : 'kg',
    volume: w.vol,
    ...(w.note ? { note: w.note } : {}),
    prs: (w.prs || []).map(id => resolved.resolved.find(r => r.id === id)?.name || id),
    exercises: w.entries.map(e => {
      const v = entryView(e, withCustoms)
      const r = resolved.resolved.find(x => x.id === e.id)
      return {
        id: e.id,
        name: v.name,
        ...(r?.input !== undefined && r.input !== v.name ? { you_said: r.input } : {}),
        ...(r?.created ? { new_custom_exercise: true } : {}),
        ...(r?.weightMeans ? { weight_means: r.weightMeans === 'each' ? 'per dumbbell' : 'both dumbbells together' } : {}),
        // The numbers spelled out next to the app's own label ("12×10 F": 12 kg, 10 reps, to
        // failure), so reading it back to the user cannot swap the weight and the reps.
        sets: e.sets.map((row, i) => ({
          label: v.sets[i].label,
          weight: Number(row.w) || 0,
          ...(row.sec != null ? { seconds: row.sec } : { reps: row.r }),
          ...(row.phase === 'warmup' ? { warmup: true } : {}),
          ...(row.failure ? { failure: true } : {}),
          ...(row.rir != null ? { rir: row.rir } : {}),
          ...(row.rpe != null ? { rpe: row.rpe } : {}),
        })),
        ...(e.note ? { note: e.note } : {}),
      }
    }),
  }
}

const setSchema = z.object({
  reps: z.number().int().min(1).max(LOG_LIMITS.maxReps).optional().describe('Reps done. Give reps for a rep exercise, or seconds for a hold, never both in one exercise.'),
  seconds: z.number().min(1).max(LOG_LIMITS.maxSec).optional().describe('Seconds held, for a timed exercise (plank, hang, wall sit).'),
  weight: z.number().min(0).optional().describe('Load in `unit`. Omit or 0 for bodyweight. On an assistance machine it is the help (less is better). For dumbbells: as the profile logs that exercise (see weight_means in the reply).'),
  warmup: z.boolean().optional().describe('A warm-up set: kept out of volume, PRs and the next suggested weight.'),
  failure: z.boolean().optional().describe('Taken to failure.'),
  rir: z.number().min(0).max(10).optional().describe('Reps in reserve, if the user said it. Not with rpe.'),
  rpe: z.number().min(6).max(10).optional().describe('RPE, if the user said it. Not with rir.'),
})

export const logWorkout = {
  name: 'log_workout',
  description: [
    'Log a workout the user describes into their openGym history (it syncs to all their devices). Turn what they said into exercises and one entry per set:',
    '"curls, 12 kg, 12/12/10" is three sets of {reps, weight: 12}; "3 sets of 12, except the last was 10" is 12, 12, 10.',
    'Ask instead of assuming when the weight, the number of sets or the reps are unclear.',
    'Exercises are matched against the user\'s library by name or id. A common name resolves to the library\'s default variant ("shoulder press" is the barbell one): when the reply\'s `name` differs from `you_said` and the variant matters (dumbbell vs barbell, machine vs cable), confirm with the user, or pass an id. If a name matches several exercises, or none, nothing is saved and `problems` lists candidates: ask the user which one, then call again with its id.',
    'Only set create_custom for an exercise the user confirms is not in the library.',
    'Call with dry_run: true first when you had to interpret anything, show the user the preview, and log it once they agree.',
    'Calling again with the same description does not log it twice. Cardio (time and speed) and supersets are not supported here.',
  ].join(' '),
  schema: {
    date: isoDate().optional().describe('YYYY-MM-DD the session was done; defaults to today. Not in the future.'),
    start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM, 24 h').optional().describe('Start time HH:MM, if the user said it. Without it a session logged today ends now; one in the past starts at 18:00.'),
    duration_min: z.number().min(1).max(LOG_LIMITS.maxDurationMin).optional().describe('How long the session took, in minutes, if known.'),
    name: z.string().max(80).optional().describe('A name for the session, e.g. "Arms" or "Push day". Defaults to "Workout".'),
    note: z.string().max(500).optional().describe('A note on the whole session.'),
    unit: z.enum(['kg', 'lb']).optional().describe('The unit the user gave weights in; defaults to the profile\'s. Converted when it differs.'),
    exercises: z.array(z.object({
      exercise: z.string().min(1).max(120).describe('Exercise name as the user said it ("dumbbell curl"), or an exercise id from an earlier answer.'),
      create_custom: z.boolean().optional().describe('Create this as the user\'s own exercise when the library has nothing matching. Only after the user confirms.'),
      body_part: z.enum(BODY_PARTS).optional().describe('Body part of a new custom exercise, when its name does not say.'),
      note: z.string().max(280).optional().describe('A note on this exercise today.'),
      sets: z.array(setSchema).min(1).max(LOG_LIMITS.maxSets),
    })).min(1).max(LOG_LIMITS.maxExercises),
    dry_run: z.boolean().optional().describe('Build and return the preview without saving anything.'),
    allow_duplicate: z.boolean().optional().describe('Log it even though the same sets are already logged that day (a genuine second session). Give it a different start or name too.'),
  },
  handler: async (params, { env = process.env, fetchImpl } = {}) => {
    const cfg = apiConfig(env)
    const opts = fetchImpl ? { fetchImpl } : {}
    // One clock for every attempt: a retry after a conflict files the same workout, not a later one.
    const now = Date.now()
    saves = saves.filter(t => now - t < WINDOW_MS)
    if (!params.dry_run && saves.length >= WRITE_LIMIT) {
      throw fail('ERATE', `log_workout already saved ${WRITE_LIMIT} workouts in the last hour, the most it takes in one go; nothing was saved. Wait a bit, or log the rest in the app.`)
    }
    const input = inputOf({ ...params, date: params.date || localIso(new Date(now)) })

    const me = await apiFetch(cfg, '/api/me', opts)
    const uid = me.body?.user?.id
    // A guard that cannot read whose token this is refuses rather than steps aside.
    if (typeof uid !== 'string' || !uid) throw fail('EAPI', 'the openGym server did not say which profile OPENGYM_TOKEN belongs to (GET /api/me); nothing was saved')
    const local = localUid()
    if (local && local !== uid) {
      // The ids go to the operator on stderr, not into the model's context (state.js ambiguousUid).
      console.error(`[opengym-mcp] OPENGYM_TOKEN is for profile ${uid}, this server reads ${local}`)
      throw fail('EPROFILE', 'OPENGYM_TOKEN belongs to another profile than the one this server reads: pair again from the right profile, or set OPENGYM_UID to match (the ids are on the server\'s stderr)')
    }

    let got = await apiFetch(cfg, '/api/data', opts)
    // A description without a unit is in the profile's, as the profile was when first read: a
    // retry after another device switched kg ↔ lb reads the same numbers the same way.
    let unit = null, meanings = null
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const doc = got.body?.state
      if (!doc || typeof doc !== 'object') {
        throw fail('ENOSTATE', 'this profile has no synced data on the server yet: open openGym and sign in on a device once, then try again')
      }
      // The document exactly as the server sent it, plus the workout: anything else in the PUT —
      // a default filled in here — would be stamped as an edit made now and land on every device.
      const S = structuredClone(doc)
      unit = unit || (S.unit === 'lb' ? 'lb' : 'kg')
      // The profile's own exercises indexed for the build, as the app has them: a custom one-arm
      // dumbbell press counts one bell, a custom assisted machine folds towards less help.
      const built = withCustomsIndexed(S, () => buildLoggedWorkout(S, input, { now, unit, meanings }))
      if (built.problems) {
        return { logged: false, problems: built.problems, next: 'Nothing was saved. Settle these with the user (pick a candidate id, fix a set) and call again.' }
      }
      // What each dumbbell weight meant on the first read stays what it means on a retry.
      meanings = meanings || Object.fromEntries(built.workout.entries.map(e => [e.id, e.target?.dbLoad || 'as']))
      const preview = viewOf(built.workout, S, built)
      if (params.dry_run) {
        const dup = findDuplicate(S, built.workout)
        return { logged: false, dry_run: true, would_log: preview, ...(dup && (dup.sameRequest || !params.allow_duplicate) ? { duplicate_of: dup.workout.id } : {}) }
      }
      const added = withCustomsIndexed({ customEx: [...(S.customEx || []), ...built.customEx] }, () =>
        appendLoggedWorkout(S, built, { now, allowDuplicate: params.allow_duplicate === true }))
      if (!added.added) {
        return { logged: false, duplicate: true, workout_id: added.workout.id, date: added.workout.d, message: 'This session is already in the history; nothing was added. If it really was a second session, call again with allow_duplicate: true and a different start or name.' }
      }
      const put = await apiFetch(cfg, '/api/data', { ...opts, method: 'PUT', body: { state: S, baseRev: got.body.rev ?? 0, ...(typeof doc._wid === 'string' ? { baseWid: doc._wid } : {}) } })
      if (put.status !== 409) {
        invalidate()
        saves.push(now)
        // The operator's trail (stderr, as the profile guard's): which workout went in, for what
        // day and at which revision. Never the token, and nothing the model sees.
        const sets = added.workout.entries.reduce((n, e) => n + e.sets.length, 0)
        console.error(`[opengym-mcp] log_workout saved ${added.workout.id} for ${added.workout.d} (${added.workout.entries.length} exercises, ${sets} sets), rev ${put.body?.rev ?? '?'}`)
        return { logged: true, ...viewOf(added.workout, S, built), revision: put.body?.rev ?? null }
      }
      // Another device wrote in between: the server sent its current document back with the 409,
      // so the workout is built again on top of that one. A 409 without one (a proxy's page) is
      // not something to build on.
      if (!put.body?.state || typeof put.body.state !== 'object' || typeof put.body.rev !== 'number') {
        throw fail('EAPI', 'the openGym server answered 409 without the current profile; nothing was saved')
      }
      got = { status: 200, body: { state: put.body.state, rev: put.body.rev } }
    }
    throw fail('ECONFLICT', `the profile kept changing on the server (${MAX_ATTEMPTS} attempts); nothing was saved, try again in a moment`)
  },
}

const PLAN_DAYS = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 }
const routineSchema = z.object({
  name: z.string().trim().min(1).max(80),
  exercises: z.array(z.object({
    exercise_id: z.string().trim().min(1).max(80),
    sets: z.number().int().min(1).max(30),
    reps: z.union([z.number().int().min(1).max(100), z.string().trim().min(1).max(24)]),
    weight: z.number().min(0).optional(),
  })).min(1).max(30),
  days: z.array(z.enum(Object.keys(PLAN_DAYS))).optional(),
})

async function profileFor(cfg, opts) {
  const me = await apiFetch(cfg, '/api/me', opts)
  const uid = me.body?.user?.id
  if (typeof uid !== 'string' || !uid) throw fail('EAPI', 'the openGym server did not say which profile OPENGYM_TOKEN belongs to (GET /api/me)')
  const local = localUid()
  if (local && local !== uid) throw fail('EPROFILE', 'OPENGYM_TOKEN belongs to another profile than the one this server reads: pair again from the right profile, or set OPENGYM_UID to match')
  const got = await apiFetch(cfg, '/api/data', opts)
  if (!got.body?.state || typeof got.body.state !== 'object') {
    throw fail('ENOSTATE', 'this profile has no synced data on the server yet: open openGym and sign in on a device once, then try again')
  }
  return { uid, got }
}

function parsedPlan(bundle, S) {
  const parsed = parsePlan({ ...bundle, customEx: S.customEx || [] }, S.unit === 'lb' ? 'lb' : 'kg')
  if (parsed.dropped || parsed.routineCount !== bundle.routines.length) {
    throw fail('EINVAL', 'one or more exercises are not in this profile’s openGym library; use exercise ids from search_exercises, and nothing was saved')
  }
  return parsed
}

function planSummary(routines) {
  return routines.map(r => ({
    name: r.name,
    exercises: (r.ex || r.exercises || []).map(e => ({
      exercise_id: e.id || e.exercise_id,
      sets: e.sets,
      reps: e.reps,
      ...(e.weight !== undefined ? { weight: e.weight } : {}),
    })),
    ...(r.days?.length ? { days: r.days } : {}),
  }))
}

export const createTrainingPlan = {
  name: 'create_training_plan',
  description: [
    'Create new routines in the user’s openGym profile from a training plan you have designed.',
    'Use search_exercises to resolve every exercise to an openGym exercise_id, and inspect the profile’s routines and history before proposing the plan.',
    'This tool is deliberately two-step: first call it with the plan to get a preview and confirmation_id; show the complete preview and ask the user to approve it. Only after an explicit yes, call again with that confirmation_id and confirm: true. The second call saves; do not claim a plan is saved before then.',
    'New routines are always added, never replaced. By default the current weekly schedule is kept. To assign the plan’s days, set schedule_mode to replace and provide days on routines; this replaces the entire weekly schedule, so explain that in the preview.',
    'Weights use the supplied unit, or the profile’s unit. Cardio and custom exercise creation are not supported.',
  ].join(' '),
  schema: {
    name: z.string().trim().min(1).max(80).optional().describe('A short name for the proposed plan.'),
    unit: z.enum(['kg', 'lb']).optional().describe('Unit used for prescribed weights; defaults to the profile’s unit.'),
    routines: z.array(routineSchema).min(1).max(12).optional().describe('New routines, in the order they should appear. Use exercise_id values from search_exercises.'),
    schedule_mode: z.enum(['keep', 'replace']).optional().describe('Defaults to keep. replace assigns the provided routine days and replaces the whole weekly schedule.'),
    confirmation_id: z.string().min(20).max(100).optional().describe('The short-lived id returned by the preview call.'),
    confirm: z.boolean().optional().describe('Set true only after the user explicitly approves the exact preview.'),
  },
  handler: async (params, { env = process.env, fetchImpl } = {}) => {
    const cfg = apiConfig(env)
    const opts = fetchImpl ? { fetchImpl } : {}
    const now = Date.now()
    for (const [id, pending] of pendingPlans) if (pending.expires <= now) pendingPlans.delete(id)

    if (params.confirmation_id) {
      if (params.confirm !== true) throw fail('EINVAL', 'confirm must be true after the user approves the preview')
      const pending = pendingPlans.get(params.confirmation_id)
      if (!pending || pending.expires <= now) {
        pendingPlans.delete(params.confirmation_id)
        throw fail('EEXPIRED', 'that plan preview expired or was already used; preview it again before saving')
      }
      const { uid, got: initial } = await profileFor(cfg, opts)
      if (uid !== pending.uid) throw fail('EPROFILE', 'the pairing belongs to a different profile than the one that previewed this plan')
      let got = initial
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const doc = got.body?.state
        if (!doc || typeof doc !== 'object') throw fail('ENOSTATE', 'this profile has no synced data on the server yet; nothing was saved')
        const destinationUnit = doc.unit === 'lb' ? 'lb' : 'kg'
        if (destinationUnit !== pending.destinationUnit) {
          throw fail('EPLANSTALE', 'the profile unit changed after this plan was previewed; nothing was saved, so preview the plan again')
        }
        const S = structuredClone(doc)
        S.routines = Array.isArray(S.routines) ? S.routines : []
        if (pending.scheduleMode === 'replace') S.week = S.week && typeof S.week === 'object' ? { ...S.week } : {}
        const bundle = { ...pending.bundle, customEx: S.customEx || [] }
        const parsed = parsedPlan(bundle, S)
        const result = mergePlan(S, parsed, { schedule: pending.scheduleMode === 'replace' })
        S._ts = Date.now()
        const put = await apiFetch(cfg, '/api/data', {
          ...opts,
          method: 'PUT',
          body: { state: S, baseRev: got.body.rev ?? 0, ...(typeof doc._wid === 'string' ? { baseWid: doc._wid } : {}) },
        })
        if (put.status !== 409) {
          pendingPlans.delete(params.confirmation_id)
          invalidate()
          console.error(`[opengym-mcp] create_training_plan saved ${result.routines} routines for profile ${uid}, rev ${put.body?.rev ?? 'unknown'}`)
          return {
            saved: true,
            plan_name: pending.name,
            routines: pending.summary,
            unit: pending.destinationUnit,
            routine_ids: result.ids,
            schedule_replaced: pending.scheduleMode === 'replace',
            revision: put.body?.rev ?? null,
          }
        }
        if (!put.body?.state || typeof put.body.state !== 'object') {
          throw fail('ECONFLICT', 'the profile changed while saving this plan, and the server did not include its current state; nothing was saved')
        }
        got = put
      }
      throw fail('ECONFLICT', `the profile kept changing during ${MAX_ATTEMPTS} save attempts; nothing was saved`)
    }

    if (params.confirm === true) throw fail('EINVAL', 'confirmation_id is required; preview the plan first')
    if (!params.name || !Array.isArray(params.routines)) throw fail('EINVAL', 'name and routines are required to preview a training plan')
    const scheduleMode = params.schedule_mode || 'keep'
    const parsedInput = z.array(routineSchema).min(1).max(12).safeParse(params.routines)
    if (!parsedInput.success) throw fail('EINVAL', parsedInput.error.issues[0]?.message || 'invalid training plan')
    const routines = parsedInput.data
    const names = routines.map(r => r.name.toLowerCase())
    if (new Set(names).size !== names.length) throw fail('EINVAL', 'routine names in a plan must be unique')
    if (scheduleMode === 'keep' && routines.some(r => r.days?.length)) {
      throw fail('EINVAL', 'routine days require schedule_mode: replace; otherwise the existing weekly schedule is kept')
    }

    const { uid, got } = await profileFor(cfg, opts)
    const doc = got.body.state
    const destinationUnit = doc.unit === 'lb' ? 'lb' : 'kg'
    const unit = params.unit || destinationUnit
    const routinesWithIds = routines.map((r, i) => ({
      id: `mcp-r${i + 1}`,
      name: r.name,
      ex: r.exercises.map(e => ({
        id: e.exercise_id,
        sets: e.sets,
        reps: e.reps,
        ...(e.weight !== undefined ? { weight: e.weight } : {}),
      })),
      ...(r.days?.length ? { days: [...new Set(r.days)] } : {}),
    }))
    const week = {}
    if (scheduleMode === 'replace') {
      routinesWithIds.forEach(r => (r.days || []).forEach(day => {
        const weekday = PLAN_DAYS[day]
        ;(week[weekday] ||= []).push(r.id)
      }))
    }
    const bundle = { opengym_plan: 1, name: params.name.trim(), unit, week, routines: routinesWithIds }
    const parsed = parsedPlan({ ...bundle, customEx: doc.customEx || [] }, doc)
    const confirmationId = crypto.randomBytes(24).toString('base64url')
    if (pendingPlans.size >= 32) pendingPlans.delete(pendingPlans.keys().next().value)
    pendingPlans.set(confirmationId, {
      uid,
      name: bundle.name,
      bundle,
      scheduleMode,
      destinationUnit,
      summary: planSummary(parsed.routines),
      expires: now + PLAN_CONFIRM_MS,
    })
    return {
      saved: false,
      requires_confirmation: true,
      confirmation_id: confirmationId,
      plan_name: bundle.name,
      routines: planSummary(routinesWithIds),
      schedule_replaced: scheduleMode === 'replace',
      schedule_warning: scheduleMode === 'replace'
        ? 'Approving this plan replaces the entire current weekly schedule.'
        : 'The existing weekly schedule will remain unchanged; assign these routines to days later in openGym.',
      unit: parsed.unit,
      expires_in_seconds: PLAN_CONFIRM_MS / 1000,
    }
  },
}

export const WRITE_TOOLS = [logWorkout, createTrainingPlan]

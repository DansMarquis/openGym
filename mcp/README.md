# openGym MCP server

A [Model Context Protocol](https://modelcontextprotocol.io) bridge that lets an external LLM
application (Claude Desktop, Cursor, Cline, Continue, etc.) read your openGym profile —
routines, workouts, body-weight log, estimated 1RMs, and muscle balance — directly from your
self-hosted `./data` directory or your signed-in Vercel server. It can also draft and save new
training routines after you review and explicitly confirm the plan.

It runs locally as a stdio process spawned by the LLM client and adds no new container. Local
mode reads the same `state-<uid>.json` files the openGym api already writes. Remote mode uses a
paired session token to read the Vercel profile through `/api/me` and `/api/data`. The LLM never
sees passkeys, VAPID keys, or Redis credentials. Writes go through the openGym API with revision
checks; plan creation always previews first and never replaces existing routines.

The numbers it answers with are computed by the **same pure functions the React UI uses**
(`frontend/src/lib/*.js`) — `estimate1RM`, `loadOfWorkouts`, `effectiveRoutine`, etc. — so a
"what's my bench 1RM?" answer matches the Stats screen exactly.

> Both local-file and remote Vercel profiles are supported. See **Roadmap** below.

## Quick start

### 1. Install

```bash
cd mcp
npm install
```

### 2. Point it at your data

The MCP server reads the same `./data` directory `docker compose up` creates. Pick the profile
to answer for — its user id is in `./data/db.json` under `users[].id`:

```bash
# single-user instance (the common self-hosted case) — auto-detected:
node src/index.js

# multi-user instance, or just to be explicit:
OPENGYM_UID=<your-uid> OPENGYM_DATA=/path/to/openGym/data node src/index.js
```

For a Vercel-hosted profile, use [pairing](#pairing) to get a token, then configure remote mode
instead. Do not set `OPENGYM_DATA` or `OPENGYM_UID` in remote mode.

### 3. Register with your LLM client

Add the server to your LLM client's MCP config. For Claude Desktop, edit
`claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`):

```jsonc
{
  "mcpServers": {
    "opengym": {
      "command": "node",
      "args": ["/absolute/path/to/openGym/mcp/src/index.js"],
      "env": {
        "OPENGYM_DATA": "/absolute/path/to/openGym/data",
        "OPENGYM_UID": "<your-uid>"   // optional — auto-detected if you have one profile
      }
    }
  }
}
```

For Cursor and other MCP-compatible clients, see the client's MCP docs — the same `command` +
`args` + `env` shape is what every stdio MCP server expects.

Restart the client; you should see the openGym tools appear with "serving profile \<name\>" on
the server's stderr.

For Claude Desktop with a Vercel profile, use this `env` instead of the local data settings:

```jsonc
"env": {
  "OPENGYM_REMOTE": "1",
  "OPENGYM_URL": "https://your-app.vercel.app",
  "OPENGYM_TOKEN": "<the token from pairing>"
}
```

## Tools

Eleven read-only tools and two write tools. Training-plan creation always requires confirmation:

| Tool | What it answers |
|---|---|
| `list_routines` | What routines are saved in my profile? (names + exercise counts) |
| `get_routine` | What does the Push Day routine prescribe? (sets/reps/weight and rest per exercise) |
| `preview_session` | What will the app actually put on screen when I start this routine — after the progression policy and my history have overridden the plan? |
| `get_week_plan` | What's planned when: the next seven days with their routines and how each was decided (coach week, a pinned session, an override, the weekday plan), the current coach week when one is running, and the weekday table. |
| `list_workouts` | Recent sessions — newest first, with dates, sets done/planned, volume, duration, PRs. |
| `get_workout` | Full set-by-set breakdown of one session, by `workout_id` or by date. On a day with two sessions the date alone returns both ids to pick from rather than guessing at one. `form_videos` says how many sets were filmed; the videos themselves never leave the app. A set with a note of its own (set menu → Note) carries it as `sets[].note`. |
| `get_bodyweight` | Weigh-ins, one value per day (the profile's "Daily weigh-in value": morning, average or last), each day's readings with their times, the latest weight, the goal line, and deltas vs goal. |
| `estimate_1rm` | All-time best 1RM for an exercise + the trend, or a PR table across all exercises. |
| `muscle_balance` | Which muscles I've trained this week/month/all-time, ranked + which I've neglected. |
| `get_programme` | My programmes (routines as a block of weeks with %1RM / RPE targets), and which week of the running one I'm in. |
| `search_exercises` | Find exercise ids by name, body part or equipment for use in a plan. |
| `log_workout` | *Writes.* "I did dumbbell curls, 12 kg, 12/12/10" → a logged session in your history, on every device. Needs pairing: [Logging workouts](#logging-workouts). |
| `create_training_plan` | *Writes after confirmation.* Preview a plan, ask the user to approve it, then add its routines without replacing existing routines. |

`get_routine` and `preview_session` answer two different questions, and confusing them is the
easiest way for a coach to give wrong advice. `get_routine` reports what the routine *stores*.
`preview_session` reports what the athlete will actually *see*: a routine holding "squat 3×8 @
60 kg" opens at 75 kg if the policy progressed or deloaded from that routine's last logged
session. The routine's own weight is the last fallback the session builder consults, not the
first; its reps hold unless a policy that moves reps moved them, or the profile starts planned
sessions from the last session (`starts_from`). Ask `preview_session` before naming a weight.

An exercise merged into another in the app (an exercise's details → Merge into…) reads as the one
it went into everywhere, also in a workout another device logged against it before it synced.

Each tool returns JSON the LLM can format as it likes; structured fields (sets, dates, levels)
are pre-formatted into human-readable labels in `src/labels.js` so the LLM doesn't need to
re-interpret them.

## Logging workouts

`log_workout` lets you tell your LLM what you did instead of tapping it in:

> "Log today: dumbbell curls, 12 kg, three sets of 12 except the last was 10. Then planks, 3 × 60 s."

The LLM turns that into exercises and sets; the tool matches the exercises against your library,
builds the workout the way the app's Finish button does (PR badges, the next suggested weight,
warm-ups kept out of volume) and saves it through your openGym server, so every signed-in
device shows it within half a minute. Asking for the same thing twice logs it once.

Exercise names are matched the way a CSV import matches them. A common name resolves to the
library's default variant ("shoulder press" is the barbell one, "leg press" the 45° sled), and the
reply shows what it was matched to so the LLM can check with you. What it will not do is pick
between two entries: "lever chest press" is two in the library, and a name like that, or one that
matches nothing, comes back as a question with candidates. It only creates one of your own
exercises when you confirm the library has none.

It saves at most 20 workouts an hour (a forgotten week is fine, a client stuck in a loop is
not), and each save leaves one line on the MCP server's stderr with the workout's id, day and
the server revision it landed at. Workouts it logged have ids starting with `mw`.

## Creating a training plan

Ask Claude to review your saved routines and recent training, then propose a plan. It can use
`search_exercises` to find the exact openGym ids for exercises. The first
`create_training_plan` call only validates and previews the proposal; Claude must show it to you
and get an explicit yes before calling again with the returned `confirmation_id` and
`confirm: true`. That second call adds new routines and preserves the existing ones.

The default keeps your current weekly schedule unchanged. If you ask Claude to schedule the new
routines, it must use `schedule_mode: "replace"` and explain that approving the plan replaces the
entire weekly schedule. Plan weights use your profile's unit unless Claude specifies `kg` or
`lb`. Cardio and creating custom exercises are not supported yet.

### Pairing

Writes go through the api rather than straight into `./data`, because the api is what keeps a
phone's sync and this write from overwriting each other. Pairing is also how Claude Desktop reads
a Vercel-hosted profile:

1. In openGym, signed in as the profile to use: **Settings → Account → Pair the mobile app**.
   Confirm with your current password; the one-time code is valid for five minutes. On the Vercel
   deployment this code can pair Claude Desktop as well as a phone.
2. Turn the code into a token:

   ```bash
   node mcp/scripts/pair.mjs https://your-app.vercel.app ABCD-EFGH-JKLM
   ```

   The command prints the token to stdout. Do not paste it into a chat or commit it.
3. Add the address and token to the MCP server's `env` in your client config. For Vercel, enable
   remote mode and do not set `OPENGYM_DATA`:

   ```jsonc
   "env": {
     "OPENGYM_REMOTE": "1",
     "OPENGYM_URL": "https://your-app.vercel.app",
     "OPENGYM_TOKEN": "<the token pair.mjs printed>"
   }
   ```

   For a local self-hosted profile, keep the `OPENGYM_DATA` / `OPENGYM_UID` settings; the paired
   token enables writes.

Things to know about that token:

- It is a **full sign-in to your profile**, the same kind the paired phone app holds, not a
  workout-only key. Your client's config file holds it in plain text; treat it like a password.
- `OPENGYM_URL` has to be `https://` (plain `http://` only to `localhost`), so it never crosses a
  network in the clear.
- It lasts `SESSION_DAYS` (90 days by default). **Sign out everywhere** in Settings ends it at
  once. The MCP tools then say the token was not accepted: pair again.
- Pairing again gets you a new token but does **not** end the old one. To retire a token you
  think has leaked, use Sign out everywhere (which also disconnects paired phones).
- In remote mode the profile is selected by the token, and the read tools refresh it from the
  server before each call. If the MCP server also reads local data, the token has to belong to
  that same profile (`OPENGYM_UID`); a token for another one is refused.

### What it does not do (yet)

- `log_workout` does not support cardio, supersets or per-side sets. Plan creation supports
  resistance exercises and existing library exercises; log or add unsupported items in the app.
- Edit or delete a workout. Fix a mistake in the app's History.
- Complete a routine's session. A logged workout is freestyle: it counts in history, stats,
  1RM, PRs and the muscle map, and like any freestyle session it can inform a routine that has
  no history of its own, but it does not tick off a planned day or a coach week's session.

## How it reuses the training logic

The MCP server imports the training helpers under `frontend/src/lib/` directly as Node ESM
and calls the same functions the React UI does (`history.js`, `onerm.js`, `muscles.js`,
`exercises.js`). The numbers it returns match what the Stats screen shows, because they are
the same code.

The one lib file that wasn't Node-safe was `i18n.js` (Vite's `import.meta.glob` at module
top level) — split into `i18n-core.js` (pure, Node-safe) + `i18n.js` (Vite/React bits,
re-exports from core). `exercises.js` got a one-line `import.meta.env || {}` guard. No new
dependencies landed in `frontend/`, no public exports changed.

## Design constraints honoured

- **One runtime dependency beyond the MCP SDK:** none. No database driver, no HTTP framework.
- **No new container.** stdio transport is spawned by the LLM client; nothing to add to
  `docker-compose.yml`.
- **No passkey material, VAPID keys, or Redis credentials leave openGym.** Local mode reads
  files; remote mode and writes use a paired session token. Vercel pairing confirms the profile
  password and issues a five-minute, single-use code for the existing MCP pairing script.
- **No telemetry.** Local reads make no network call. Remote mode fetches the profile from your
  openGym server before each tool call. The process exits when the LLM client disconnects.

## Tests

```bash
cd mcp && npm test
```

Tool-layer cases seed state from `frontend/src/lib/demoSeed.js` (the same deterministic fixture
the public demo runs on). They pin JSON shape and user-facing edge cases: rest-day override,
missing routine, zero-workout history, no synced state, superset links, three 1RM formulas.
"Today" is pinned via `vi.useFakeTimers({ now: ..., toFake: ['Date'] })` so date-dependent
tools see consistent values regardless of when the suite runs. The pure lib functions have
their own tests in `frontend/src/lib/*.test.js`.

`log_workout` and `create_training_plan` are tested in `write-tools.test.js` against a stand-in
api (conflicts, retries, confirmation, validation, a rejected token, dry runs, duplicates).
`log-workout.e2e.test.js` tests `log_workout` against the real
`api/server.js` on a temp data directory, which needs `npm ci` in `api/` (it skips without it on
a laptop and fails under `CI`). The workout it builds is tested in
`frontend/src/lib/log-workout.test.js`.

The Vercel pairing routes are tested in `tests/api/mcp-pair.test.js`.

## Roadmap

- **Done (Phase 1):** read-only stdio tools, direct `./data` access or authenticated remote reads.
- **Done (Phase 1.5):** `preview_session` — the policy's next prescription, the opening set
  rows it produces, and which of plan / confirmed weight / history each number came from.
- **Done:** `search_exercises` and `create_training_plan`, with a preview and explicit
  confirmation before routines are added.
- **Phase 2:** read+write over stdio, in pieces (#116). Writes go through the api's own
  `PUT /api/data` with the revision they read, as a paired device does, rather than into
  `state-<uid>.json` directly: the api is the one writer of that file, and its sync stamps are
  what keep a write from being undone by the next phone that merges.
  - **Done:** `log_workout` and `create_training_plan`, on the paired-session token
    (`scripts/pair.mjs`).
  - Next: `add_bodyweight`, `edit_routine`, `assign_weekday`, `override_day`, log corrections.
- **Phase 3:** Streamable HTTP transport, opt-in 4th container in `docker-compose.yml`. Same
  tool implementations, second transport — the MCP SDK supports both behind one tool registration.

## License

AGPL-3.0-or-later, same as openGym.

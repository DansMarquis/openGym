# Vercel webapp: free push reminders

This fork uses the Redis-backed serverless API in `api/`, not the original
filesystem backend in `_legacy-backend/`. Login and sync already work on Vercel.
Web Push, daily motivational quotes and gym-time reminders are supported too.
Apple Watch and HealthKit still require the native iPhone/Watch apps; they cannot
be connected directly to this webapp.

The native iPhone and Android apps can pair with this Vercel server using
**Settings → Account → Pair the mobile app** and the one-time code. The API
allows cross-origin requests only from the Capacitor app origins
(`capacitor://localhost` on iOS and `https://localhost` on Android); no extra
CORS settings are needed on Vercel. Redeploy after pulling an API CORS fix
before trying to pair again.

## Free services and limits

Keep Vercel Hobby, the existing free Upstash Redis database, and choose **QStash
Free**, not Pay as You Go or a paid plan. No paid plan is required by this code.
As checked on 10 November 2026, QStash Free created through the Vercel
Marketplace (**Storage → Create Storage → Upstash → QStash**) allows 500
messages/day; a QStash Free plan created directly at Upstash may show a
different allowance ([pricing](https://upstash.com/pricing/qstash)). Check the
limit shown on your own plan.

One shared schedule runs every five minutes: **288 deliveries/day** before
retries, regardless of how many profiles have reminders. That leaves about 200
messages/day for rest-timer alerts and retries. Each rest-timer alert uses an
additional delayed message, including cancelled timers, so a typical workout of
20 to 40 timed sets stays within the limit. Retries also count against the
allowance. Monitor usage in the Upstash and Vercel dashboards, stay
on their free plans, and do not enable paid upgrades. Free quotas and vendor
terms can change; unlimited usage and guaranteed delivery are not promised.
The deployment is intended for personal use and caps stored push subscriptions
at 100.

The scheduler does not need the app, Safari or your phone to remain open.
Notifications may arrive up to about five minutes after the reminder time,
longer if a provider or the device delays delivery. The server catches up for
15 minutes, not indefinitely. Focus mode, notification permissions, an offline
device and operating-system restrictions can still delay or suppress an alert.

## 1. Configure Vercel environment variables

Keep the existing Redis variables and `SECRET`. Add the following to the
**Production** environment in Vercel, then redeploy:

| Variable | Value |
|---|---|
| `ORIGIN` | Your canonical HTTPS URL, for example `https://your-app.vercel.app`, without a trailing slash |
| `VAPID_PUBLIC_KEY` | Generated public key |
| `VAPID_PRIVATE_KEY` | Generated private key, server only |
| `VAPID_SUBJECT` | A real contact address such as `mailto:you@example.com` |
| `QSTASH_TOKEN` | Token from your QStash Free console; needed for delayed rest alerts |
| `QSTASH_CURRENT_SIGNING_KEY` | Current signing key from QStash |
| `QSTASH_NEXT_SIGNING_KEY` | Next signing key from QStash |

Generate one VAPID pair locally after `npm ci` in the repository root:

```sh
npx web-push generate-vapid-keys
```

Keep that pair stable across redeployments. Never commit the private key,
QStash token, signing keys or your local environment file. Do not put them in
`VITE_` variables, which are public in the browser bundle.

## 2. Create the shared schedule once

Locally, provide `ORIGIN` and `QSTASH_TOKEN` through your shell environment or a
private environment file. Then run:

```sh
npm run setup:reminders
```

The script creates or updates the schedule named `opengym-reminders` to POST
`{}` to `/api/reminders/run` on `*/5 * * * *`, with at most two retries.
Do not run a separate schedule per profile. Use one canonical production
deployment, not previews. If you change domains, rerun setup and remove any old
schedules from the QStash console. Only authenticated QStash requests can run
the delivery endpoints; a browser cannot trigger the scheduler.

If Vercel Deployment Protection is enabled, QStash must be allowed to reach
these two callback routes. A protected preview or a login interstitial prevents
delivery. Do not make a protected deployment public merely to test notifications.

QStash receives the callback URL and, for rest alerts, an opaque job token.
Workout documents, gym hours, push subscriptions and notification contents stay
in Redis/the API and are not included in scheduler messages. The browser's push
provider necessarily receives encrypted Web Push messages.

## 3. Enable notifications on the iPhone

1. Use iOS/iPadOS **16.4 or newer**.
2. Open your HTTPS app in Safari, then **Share → Add to Home Screen**.
3. Open it using that Home Screen icon and sign in.
4. Open **Settings → Reminders**, turn on **Push notifications**, allow the
   permission prompt and select **Send test notification**.
5. Close the app and confirm the test alert is received. Also check iOS Settings
   → Notifications and Focus settings.

Safari on macOS supports Web Push without this Home Screen installation step.
A Safari tab on iPhone is not equivalent to the installed Home Screen webapp.

## 4. Set gym hours and training times

Under **Settings → Plan & schedule**, set **Choose training times**. Select
training days, their times and the lead time (0, 15, 30, 60, 120 or 180 minutes).
Optionally enable **Use gym opening hours** and edit each day's opening/closing
times. Use **Add opening period** for split
hours such as `07:00-14:00`, `15:00-17:00`, `20:00-23:00`. Each period can be
edited or removed separately; breaks between periods count as closed. Existing
single-period schedules remain supported. Disable a day when the gym is closed.
Equal opening and closing times are invalid. For a 24-hour gym, leave
opening-hour filtering off.

Overnight hours work across weekdays, such as Monday 22:00 to Tuesday 02:00.
A training time outside opening hours displays a warning and gets no reminder.
Opening hours are checked at the training time, not the earlier notification
time. On **Settings → Reminders**, enable **Workout day reminder** and
**Push notifications** to receive these reminders. With custom training times enabled, those days are explicit training
plans, even without a routine assigned in the weekly planner. Without custom
times, the original planned-routine reminder uses its single reminder time.

A logged workout or an excused day note suppresses the day's reminder. Successful
delivery is tracked per profile, training date and browser subscription so
retries and daylight-saving clock changes do not normally duplicate reminders.
Changes must finish syncing to the server before closing the app; the server
can only act on the last synced schedule and workout history. Changing a
schedule after that day's reminder was sent does not send another one.
Timezone is detected by the app and updated when you open it after travelling.

Evening nudges and the annual Wrapped notification are not implemented in this
Vercel backend and are not offered by its notification card.

## Quotes and festive themes

Home shows an English motivational quote from the free
[ZenQuotes API](https://docs.zenquotes.io/zenquotes-documentation/), with author
and provider attribution. Quotes appear in a coloured typographic card inspired
by a quotation poster, with a large quotation mark and a separate author line.
Six coordinated colour/font combinations rotate by calendar date, staying the
same across reloads. Fonts are local system fonts, with no external font requests.
Long quotes use a smaller size without truncation. The server caches a quote per calendar date and the
browser keeps today's quote for offline use. If no cached quote is available
and the API fails, a clearly labelled, locally written message is shown.
No API key or paid subscription is required.

**Settings → Look & Home → Seasonal themes** includes Santos Populares (June),
autumn (22 September to 30 November), New Year (31 December to 6 January) and
Carnival (Saturday through Tuesday, calculated from Easter). Explicit **On**
overrides automatic themes. On Auto, New Year takes priority over Christmas
on 31 December and Halloween over autumn in October. If multiple themes are
explicitly On, list order wins. Decorations ignore taps, respect reduced motion
and can be disabled during workouts.

## Claude Desktop training plans

The optional [openGym MCP server](../mcp/README.md) can read a Vercel profile
and add training-plan routines through the API. It does not need an Anthropic API
key or API billing; Claude Desktop runs the MCP process locally. In
**Settings → Account → Pair the mobile app**, confirm with your current
password, then use the five-minute code with `node mcp/scripts/pair.mjs
https://your-app.vercel.app CODE`. Put the printed token in Claude Desktop's
MCP server environment as `OPENGYM_TOKEN`, with `OPENGYM_REMOTE=1` and
`OPENGYM_URL` set to the same HTTPS address. Do not set `OPENGYM_DATA` for
remote mode.

The token grants full access to the profile, not only plan creation. Treat it
like a password and do not paste it into a chat. Claude must show a plan preview
and get your explicit approval before it saves; existing routines are preserved.
The weekly schedule is left alone unless you explicitly request a schedule
replacement.

## Validation

```sh
npm test
npm test --prefix frontend -- src/lib/training-hours.test.js src/lib/seasonal.test.js src/components/Seasonal.lazy.test.jsx src/lib/daily-quote.test.js src/components/TrainingSchedule.test.jsx src/components/DailyQuote.test.jsx src/views/Settings.push.test.jsx src/views/settings-pages.test.jsx src/lib/push.test.js src/lib/pt-br-locale.test.js
cd frontend
node scripts/check-locales.mjs
node scripts/check-source-strings.mjs --strict
npm run build
```

Mocked push delivery in automated tests verifies API behaviour, not Apple
delivery. Complete the real closed-app iPhone test after deploying the keys and
activating the QStash schedule.

# openGym on Vercel — minimal KV backend

This fork adds a **minimal, Vercel-native backend** so openGym's frontend can run on Vercel, where
openGym's real backend (a stateful Node server that writes JSON files to disk and runs background
jobs) cannot. The original backend is preserved untouched under [`_legacy-backend/`](_legacy-backend/)
for reference; a few pure modules the frontend imports from it (coach helpers, password/sync utils)
still build from there.

## Architecture

```
frontend/                Vite/React PWA  ->  built to frontend/dist (static, served by Vercel CDN)
api/[...path].js         ONE Vercel Serverless Function, all /api/* routes
api/_lib/                db (Upstash Redis), session (HMAC cookies), password (scrypt), http helpers
_legacy-backend/         openGym's original Node backend (not deployed; kept for reference + shared modules)
```

- **Storage:** Upstash Redis (provisioned via the Vercel Marketplace) instead of on-disk JSON.
- **Sessions:** openGym's exact HMAC-signed cookie scheme (`uid:exp:ver:kind`), so the existing
  frontend accepts them unchanged. No session store needed.
- **Passwords:** Node's built-in `scrypt` (no native deps).

## What works

Sign-up / sign-in with a username + password, sessions, sign-out (incl. "sign out everywhere"),
and the full **workout sync** loop the app lives on — load, save, revision polling, and
conflict detection (409 + merge), matching openGym's `/api/data` contract.

Endpoints: `GET /api/health`, `GET /api/config`, `GET /api/me`,
`POST /api/register/password`, `POST /api/login/password`, `POST /api/logout`,
`POST /api/logout/all`, `GET /api/data`, `GET /api/data/rev`, `PUT /api/data`.

## What is intentionally NOT implemented (returns HTTP 501)

These need a persistent server, a real filesystem, or always-on background jobs that Vercel's
serverless model can't provide:

- **Passkeys / WebAuthn** login (password login is the auth path here)
- **Coach** (AI features)
- **Media** upload (exercise photos/videos)
- Third-party **integrations**, the **watch relay**, **push notifications**, **nudges**
- **Admin** tools, **device pairing / links**

The frontend degrades on a 501 instead of hanging. This is a stripped-down openGym, by design.

## Required environment variables (set in Vercel → Project → Settings → Environment Variables)

| Variable | Required | Notes |
|---|---|---|
| `SECRET` | **yes** | Signs session cookies. Generate: `openssl rand -base64 48`. Keep stable — changing it signs everyone out. |
| `ORIGIN` | **yes** | The deployed URL, e.g. `https://your-app.vercel.app`. Used for the cookie `Secure` flag and the CSRF origin check. |
| `KV_REST_API_URL` | **yes** | Injected automatically when you add **Upstash for Redis** from the Vercel Marketplace (also accepts `UPSTASH_REDIS_REST_URL`). |
| `KV_REST_API_TOKEN` | **yes** | Injected automatically by the Upstash integration (also accepts `UPSTASH_REDIS_REST_TOKEN`). |
| `PASSWORD_LOGIN` | no | On by default. Set `0` to disable password login. |
| `ALLOW_GUEST` | no | On by default (client-only local mode). Set `0` to disable. |
| `INVITE_ONLY` | no | Off by default. |
| `DEFAULT_LANG` | no | e.g. `en`. |
| `SESSION_DAYS` | no | Cookie lifetime, default `90`. |

## Deploy steps

1. **Import** this repo in Vercel (New Project). It auto-reads `vercel.json`
   (build = `cd frontend && npm install && npm run build`, output = `frontend/dist`,
   function = `api/[...path].js`).
2. **Add storage:** Project → Storage → add **Upstash for Redis** (Marketplace). This injects the
   `KV_REST_API_URL` / `KV_REST_API_TOKEN` vars.
3. **Set env vars:** add `SECRET` and `ORIGIN` (above). Redeploy after the first deploy gives you
   the real URL, so `ORIGIN` matches it.
4. **Deploy.** First account you create becomes the owner/admin.

## Local development (no cloud store needed)

```bash
# Build the frontend
cd frontend && npm install && npm run build && cd ..

# Run the function locally with an in-memory KV (state lost on restart):
#   set KV_DRIVER=memory, SECRET=anything, ORIGIN=http://localhost:3000
vercel dev     # or: KV_DRIVER=memory SECRET=dev-secret ORIGIN=http://localhost:3000 vercel dev
```

The in-memory driver (`KV_DRIVER=memory`) is for local testing only; production always uses Upstash.

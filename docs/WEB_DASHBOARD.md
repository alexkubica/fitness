# Web Dashboard

Last updated: 2026-06-17

`apps/web` is a Next.js, Tailwind, and shadcn-style dashboard for the private
Fitness Coach data set.

## What It Shows

- Google-gated private health dashboard.
- Daily Apple Health aggregates from Neon through the shared database package.
- Metric cards for weight, steps, active energy, resting energy, sleep, heart
  rate, resting heart rate, and walking heart rate.
- Last-90-day sparklines and latest / 30-day average / 30-day delta summaries.
- MCP setup panel with copy actions and ChatGPT/Claude/Cursor/VS Code
  instructions.

## Local Development

```bash
npm run dev -w @fitness/web
```

The dashboard can render the public MCP setup section without secrets. The
private health dashboard needs:

- `DATABASE_URL`
- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `GOOGLE_AUTH_ALLOWED_EMAILS`
- `GOOGLE_AUTH_STATE_SECRET` or `WEB_SESSION_SECRET`
- `WEB_AUTH_USER_ID`

## Vercel

Production URL:

```text
https://fitness-web-rust.vercel.app
```

Vercel project: `alex-kubicas-projects/fitness-web`.

Deploy the web dashboard as a separate Vercel Next.js project. Keep the existing
backend Vercel project for `/mcp`, `/oauth2`, `/telegram`, and iOS HealthKit
sync unless we intentionally merge the routing later.

Deploy from the repo root so npm workspaces, Turbopack, and file tracing all see
the same monorepo root:

```bash
npx vercel@latest build --prod --yes --scope alex-kubicas-projects --project fitness-web --local-config apps/web/vercel.json
npx vercel@latest deploy --prebuilt --prod --scope alex-kubicas-projects --project fitness-web --local-config apps/web/vercel.json
```

Required production env vars:

- `DATABASE_URL`
- `NEXT_PUBLIC_FITNESS_BACKEND_URL=https://fitness-ten-fawn.vercel.app`
- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `GOOGLE_AUTH_ALLOWED_EMAILS`
- `GOOGLE_AUTH_STATE_SECRET` or `WEB_SESSION_SECRET`
- `WEB_AUTH_USER_ID=user_alex`
- `WEB_SESSION_TTL_SECONDS=2592000`

Add this authorized redirect URI to the Google OAuth Web client for the web
deployment:

```text
https://fitness-web-rust.vercel.app/api/auth/google/callback
```

Add this authorized JavaScript origin too:

```text
https://fitness-web-rust.vercel.app
```

Do not expose raw bearer tokens, database credentials, or HealthKit sync tokens
to the browser. The dashboard reads health aggregates from server components.

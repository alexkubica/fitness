# Deployment

Last updated: 2026-06-16

## Current Decision

Use Vercel as the active production backend for the Node/Hono server because
Render Free cold starts were too slow for Telegram, MCP, and iOS sync usage.
Keep Render as the rollback host until the Vercel Google OAuth callback and
iOS device sync have both been verified.

Why:

- Vercel functions can still cold start, but Fluid Compute reduces the impact
  and avoids Render Free's explicit 15-minute idle spin-down and about one
  minute spin-up path.
- The MCP endpoint currently works on Vercel for `initialize`, but the MCP SDK
  stream/session transport still relies on per-instance memory. Watch connector
  behavior before deleting the Render fallback.
- Koyeb still documents a free web service, but Koyeb also documents that
  Starter requires a valid payment method and the current onboarding flow showed
  a Pro plan payment screen. Its pricing FAQ says card validation places a $29
  pre-authorization hold and, when Pro is selected, charges a prorated Pro
  amount.
- Fly.io is not the first free target because its docs state there is no free
  account/free tier, only a limited free trial.

Official docs checked:

- Vercel Fluid Compute: `https://vercel.com/docs/fluid-compute`
- Vercel Functions: `https://vercel.com/docs/functions`
- Vercel Node versions:
  `https://vercel.com/docs/functions/runtimes/node-js/node-js-versions`
- Vercel environment variables:
  `https://vercel.com/docs/environment-variables`
- Render deploy for free: `https://render.com/docs/free`
- Render pricing:
  `https://render.com/pricing`
- Render free-tier comparison:
  `https://render.com/articles/platforms-with-a-real-free-tier-for-developers-in-2026`
- Koyeb organizations/plans:
  `https://www.koyeb.com/docs/reference/organizations`
- Koyeb pricing FAQ:
  `https://www.koyeb.com/docs/faqs/pricing`
- Render web services:
  `https://render.com/docs/web-services`
- Fly.io cost management:
  `https://fly.io/docs/about/cost-management/`
- Fly.io free trial:
  `https://fly.io/docs/about/free-trial/`

## Deployable Shape

- Runtime: Node 22, pinned by `package.json` engines and `.node-version`.
- Vercel project: `alex-kubicas-projects/fitness`.
- Vercel production URL: `https://fitness-ten-fawn.vercel.app`.
- Vercel config: root `vercel.json`, framework `hono`, Fluid Compute enabled,
  Frankfurt region `fra1`, entrypoint `server.ts`, install command
  `npm ci --include=dev` so TypeScript is present during production builds.
- Render Blueprint: `render.yaml` provisions the first free web service.
- Build command: `npm run build` after the provider installs dependencies.
  Use `npm ci --include=dev && npm run build` on hosts that expect a full shell
  build command, because TypeScript is a build-time dev dependency and
  production-mode `npm ci` may omit it.
- Start command: `npm start`.
- Web process: `Procfile` runs `npm start`.
- Health probe: `GET /healthz`.
- Readiness probe: `GET /readyz`.
- Port: hosting provider should supply `PORT`; the server binds to `0.0.0.0`.

## Vercel Setup

Current service:

- Project: `fitness`
- Scope/team: `alex-kubicas-projects`
- Production URL: `https://fitness-ten-fawn.vercel.app`
- Latest verified deployment on 2026-06-16:
  `https://fitness-3o0qsq4jx-alex-kubicas-projects.vercel.app`, aliased to the
  production URL above.

Preferred flow:

1. Link the project once with
   `npx vercel@latest link --yes --scope alex-kubicas-projects --project fitness`.
2. Build production output with
   `npx vercel@latest build --prod --yes --scope alex-kubicas-projects`.
3. Deploy with
   `npx vercel@latest deploy --prebuilt --prod --scope alex-kubicas-projects`.
4. Copy/update production env vars from Render without printing secret values:
   `npm run vercel:sync-env-from-render -- --url https://fitness-ten-fawn.vercel.app`.
5. Redeploy after env changes so Vercel attaches the new environment to the
   deployment.
6. Verify `/readyz`, `/.well-known/oauth-protected-resource`, OAuth code/token
   exchange, MCP `initialize`, Telegram webhook info, and the protected reminder
   endpoint.

Google Cloud OAuth must include this authorized redirect URI for Google sign-in
to work on Vercel:

```text
https://fitness-ten-fawn.vercel.app/auth/google/callback
```

The backend env var already uses that callback on Vercel. If Google Cloud has
not been updated yet, `/auth/google/start` redirects correctly but Google may
reject the request with `redirect_uri_mismatch`.

## Render Setup

Render is now the rollback host, not the active default.

Current service:

- Service name: `fitness-coach`
- Service id: `srv-d8ld7uf7f7vs7380e4jg`
- URL: `https://fitness-coach-93ve.onrender.com`
- Last known deploy touched on 2026-06-16: `dep-d8ogdbrsq97s73fkh2l0`, after
  setting OAuth TTL env vars to match Vercel.

Preferred flow:

1. Create or sign in to Render using the deployment-owner account.
2. Open the Blueprint creation flow for
   `https://github.com/alexkubica/fitness`.
3. Authorize Render's GitHub app for the private repo if prompted.
4. Confirm Render found the root `render.yaml`.
5. Select the personal workspace, not a work/work-client workspace.
6. When Render prompts for `DATABASE_URL`, paste the Neon connection string
   from the project password manager or Neon CLI. Do not paste it into chat.
7. Deploy the Blueprint.
8. After deploy, verify `https://<service>.onrender.com/readyz` returns
   `status: "ready"`.

Note: during the first Blueprint creation on 2026-06-11, the `DATABASE_URL`
placeholder was not present on the resulting service. The service failed at
runtime with `DATABASE_URL is required in production`. The value was then added
directly to the service through Render's single environment variable API and a
fresh deploy went live.

Manual fallback if Blueprint creation fails:

1. Create a Web Service from the private GitHub repo `alexkubica/fitness`.
2. Use branch `main`.
3. Use the repository root as the root directory.
4. Select the Free web service instance in Frankfurt.
5. Use build command `npm ci --include=dev && npm run build`.
6. Use start command `npm start` or allow the committed `Procfile`.
7. Set the health check path to `/readyz`.
8. Add the environment variables below through Render environment variables.

## Koyeb Note

Do not pay for Koyeb Pro for this project unless the user explicitly approves
the monthly cost. During the initial evaluation, the personal Koyeb onboarding screen
forced a Pro plan credit-card flow. Koyeb docs still list one free web service
per organization, but their organizations docs say Starter is available to
users with a valid payment method, and their pricing FAQ says card validation
uses a $29 pre-authorization hold and charges the prorated selected plan amount
when signing up on Pro.

## Required Environment Variables

Set values in the provider UI or CLI. Do not commit real values.

- `NODE_ENV=production`
- `NODE_VERSION=22.17.0`
- `HOST=0.0.0.0`
- `FITNESS_PERSISTENCE=neon`
- `DATABASE_URL`: Neon connection string for project `bold-wave-29754976`.
- `AUTH_JWKS_JSON`: public JWKS used to verify signed production JWTs. The
  matching private JWK is also needed as `OAUTH_SIGNING_PRIVATE_JWK` only when
  the server-side OAuth authorization-code issuer is enabled.
- `OAUTH_CLIENTS_JSON`: predefined public OAuth clients, for example
  `[{"id":"fitness-chatgpt","redirectUris":["https://<client-callback>"]},{"id":"fitness-ios-bootstrap","redirectUris":["fitnesscoach://oauth/callback"]}]`.
- `OAUTH_PRIVATE_LOGIN_CODE`: private one-time-style login code used by the owner to
  approve the first private connector login. Store in Render secrets and local
  password manager only. This remains a break-glass fallback once Google login
  is configured.
- `OAUTH_SIGNING_PRIVATE_JWK`: private RS256 JWK used to sign MCP access tokens
  from `/oauth2/token`. Store only as a provider secret; do not print it.
- `OAUTH_USER_ID=user_alex`
- `OAUTH_ACCESS_TOKEN_TTL_SECONDS=3600`: access tokens are short-lived but not
  annoyingly short.
- `OAUTH_AUTHORIZATION_CODE_TTL_SECONDS=300`
- `OAUTH_REFRESH_TOKEN_TTL_SECONDS=31536000`: maximum supported refresh-token
  lifetime is 365 days.
- `GOOGLE_OAUTH_CLIENT_ID`: Google OAuth Web client id for private user login.
- `GOOGLE_OAUTH_CLIENT_SECRET`: Google OAuth Web client secret. Store only as a
  provider secret.
- `GOOGLE_OAUTH_REDIRECT_URI`: usually
  `https://fitness-ten-fawn.vercel.app/auth/google/callback` on Vercel, or the
  rollback host's `/auth/google/callback` URL on Render.
- `GOOGLE_AUTH_ALLOWED_EMAILS`: comma-separated allowed Google account emails
  for this private app. Prefer the single exact email returned by Google for
  the owner's approved Google account, for example `owner@example.com`.
- `GOOGLE_AUTH_STATE_SECRET`: random 32+ character state-signing secret, or set
  `AUTH_SESSION_SECRET` instead.
- `TELEGRAM_WEBHOOK_SECRET_TOKEN`: random webhook secret sent by Telegram.
- `TELEGRAM_BOT_TOKEN`: BotFather token, required before real Telegram replies.
- `TELEGRAM_BOT_USERNAME`: non-secret bot username, without `@`; currently
  `fitme26bot`. This enables one-tap `t.me` deep links after Google login.
- `TELEGRAM_REMINDER_JOB_SECRET`: random bearer secret for
  `/internal/jobs/telegram-reminders/run`. Store the same value as the GitHub
  repository secret `TELEGRAM_REMINDER_JOB_SECRET` for the scheduled workflow.
- `TELEGRAM_LINK_URL`: optional override for the bot's link page; defaults from
  `FITNESS_EXTERNAL_URL`, `RENDER_EXTERNAL_URL`, or Vercel system URL to
  `https://<host>/telegram/link`.
- `TELEGRAM_COACH_LLM_ENABLED`: `0` by default. Set to `1` only when optional
  third-party smart coach calls are approved and `OPENROUTER_API_KEY` is set.
- `TELEGRAM_COACH_LLM_PROVIDER=openrouter`
- `OPENROUTER_API_KEY`: server-side OpenRouter API key for optional Telegram
  smart coach replies and native meal estimation. Store only as a provider
  secret or local Keychain item.
- `OPENROUTER_MODEL=openrouter/free`: default zero-cost router for low-volume
  Telegram private alpha testing. Free limits are low and availability can vary.
- `OPENROUTER_SITE_URL`: deployed HTTPS app URL for OpenRouter attribution.
- `OPENROUTER_APP_NAME=Fitness Coach`
- `MEAL_ESTIMATION_MODEL=openai/gpt-4.1-mini`: default text-only meal macro
  estimator. Meal requests require structured JSON output.
- `MEAL_ESTIMATION_VISION_MODEL=openai/gpt-4.1-mini`: default meal photo
  estimator. `OPENROUTER_MODEL` is intentionally not used for meals.
- `MEAL_ESTIMATION_FALLBACK_MODEL=openrouter/free`: free fallback if the primary
  meal model returns malformed output or fails.
- `MCP_RESOURCE_URL`: deployed HTTPS MCP URL, usually `https://<host>/mcp`.
  Optional when `FITNESS_EXTERNAL_URL`, `RENDER_EXTERNAL_URL`, or Vercel system
  URL is present.
- `MCP_ISSUER_URL`: OAuth issuer URL once the auth provider is deployed.
  Optional when `FITNESS_EXTERNAL_URL`, `RENDER_EXTERNAL_URL`, or Vercel system
  URL is present.
- `MCP_AUDIENCE=fitness-mcp`
- `MCP_EXPECTED_SUBJECT=user_alex`
- `HEALTH_SYNC_TOKEN_ISSUER`: real HealthKit API token issuer once deployed.
  Optional when `FITNESS_EXTERNAL_URL`, `RENDER_EXTERNAL_URL`, or Vercel system
  URL is present.
- `HEALTH_SYNC_TOKEN_AUDIENCE=fitness-api`
- `HEALTH_SYNC_TOKEN_RESOURCE`: deployed HTTPS API origin. Optional on Render
  when `FITNESS_EXTERNAL_URL`, `RENDER_EXTERNAL_URL`, or Vercel system URL is
  present.
- `HEALTH_SYNC_EXPECTED_SUBJECT=user_alex`

Never set `ALLOW_FAKE_AUTH_TOKENS=1` against the hosted Neon database. The
server rejects that combination intentionally.

## Database

The real Neon project already exists:

- Project: `bold-wave-29754976`
- Region: `aws-eu-central-1`
- Branch: `main`
- Database: `fitness`
- Role: `fitness_owner`

Run migrations before deployment or after a migration-only change:

```bash
export DATABASE_URL="$(neonctl connection-string main --project-id bold-wave-29754976 --role-name fitness_owner --database-name fitness --no-analytics)"
npm run verify:database
unset DATABASE_URL
```

Do not paste or commit the connection string.

## Current Production Boundary

The service is deployed as a live HTTPS shell. Health/readiness, Telegram
webhook validation, real bot replies, Neon persistence wiring, signed JWT
verification, OAuth metadata, and private OAuth authorization-code endpoints are
deploy-ready.

The deployed OAuth flow should include a `fitness-local-smoke` public client
with redirect URI `http://127.0.0.1:53682/oauth/callback` for private smoke
testing, a `fitness-ios-bootstrap` public client with redirect URI
`fitnesscoach://oauth/callback` for the iOS HealthKit session bootstrap, and a
`fitness-chatgpt` public client after ChatGPT shows the connector callback URI.
OpenAI documents the production callback as
`https://chatgpt.com/connector/oauth/{callback_id}` and shows the exact value in
the ChatGPT app management page. Add that exact URI to `OAUTH_CLIENTS_JSON`
before completing the production connector.

As of 2026-06-16, Vercel has the `fitness-ios-bootstrap` client configured and
HealthKit token issuer/resource pinned to `https://fitness-ten-fawn.vercel.app`.
Render has the same TTL settings as a rollback host.

Google sign-in is the preferred identity gate for approving MCP connector access
and creating Telegram link commands. Configure a Google OAuth Web client with
authorized redirect URI
`https://fitness-ten-fawn.vercel.app/auth/google/callback`, then set the Google
env vars above. Google tokens prove the owner's identity only; MCP, iOS, and
Telegram still use this backend's own scoped tokens and short-lived link tokens.

Recommended Google Auth Platform setup:

1. Open Google Auth Platform > Clients > Create client in the owner's Google
   account. Use a dedicated personal fitness project, not the finance app
   project.
2. Choose application type `Web application`.
3. Add authorized redirect URI
   `https://fitness-ten-fawn.vercel.app/auth/google/callback`. Keep the Render
   callback only as a rollback URI if desired.
4. Keep the app in testing/private mode and restrict test users to the owner's exact
   Google email.
5. Store the generated client values locally without printing them or placing
   them in shell history:

```bash
read -r -s -p 'Google OAuth client id: ' GOOGLE_OAUTH_CLIENT_ID_INPUT && echo
security add-generic-password -U -s fitness-google-oauth-client-id -a google-oauth -w "$GOOGLE_OAUTH_CLIENT_ID_INPUT"
unset GOOGLE_OAUTH_CLIENT_ID_INPUT

read -r -s -p 'Google OAuth client secret: ' GOOGLE_OAUTH_CLIENT_SECRET_INPUT && echo
security add-generic-password -U -s fitness-google-oauth-client-secret -a google-oauth -w "$GOOGLE_OAUTH_CLIENT_SECRET_INPUT"
unset GOOGLE_OAUTH_CLIENT_SECRET_INPUT
```

6. Configure Vercel without printing secret values. The current helper copies
   existing Render env vars and applies Vercel URL overrides:

```bash
npm run vercel:sync-env-from-render -- --url https://fitness-ten-fawn.vercel.app
```

Render rollback can still be updated with `npm run render:configure-google-auth`
when intentionally maintaining both hosts.

## Optional OpenRouter Telegram Coach

Telegram smart coach replies are disabled by default. When enabled, the server
calls OpenRouter only after the Telegram webhook secret is verified, the chat is
a private DM, and the Telegram user is linked through the authenticated Google
flow. The prompt is minimized to the current Telegram message plus a compact
deterministic daily report; raw HealthKit rows are not sent.

Store the OpenRouter API key locally without printing it:

```bash
read -r -s -p 'OpenRouter API key: ' OPENROUTER_API_KEY_INPUT && echo
security add-generic-password -U -s fitness-openrouter-api-key -a openrouter -w "$OPENROUTER_API_KEY_INPUT"
unset OPENROUTER_API_KEY_INPUT
```

Configure Render or Vercel without printing secret values. The current
OpenRouter helper still targets Render; copy/sync resulting env vars to Vercel
with `npm run vercel:sync-env-from-render -- --url https://fitness-ten-fawn.vercel.app`
after changes:

```bash
npm run render:configure-openrouter
RENDER_API_KEY="$(security find-generic-password -w -s render-api-key-codex)" npm run render:check -- --wait
```

Disable it again with:

```bash
npm run render:configure-openrouter -- --disable
```

For the first ChatGPT developer-mode connector smoke test:

1. In ChatGPT, enable Developer mode, then create a connector with URL
   `https://fitness-ten-fawn.vercel.app/mcp`.
2. Copy the callback URI ChatGPT shows for this connector.
3. Update provider `OAUTH_CLIENTS_JSON` by merging a `fitness-chatgpt` public
   client whose `redirectUris` contains that callback URI. Keep the existing
   `fitness-ios-bootstrap` client.
4. Redeploy or restart the provider service if required by the env update.
5. Refresh the connector metadata in ChatGPT and complete Google sign-in. The
   private `OAUTH_PRIVATE_LOGIN_CODE` remains only as a break-glass fallback.
6. Confirm ChatGPT lists `get_health_summary`, `get_metric_timeseries`, and
   `generate_report`.

## Telegram Reminder Scheduling

Recurring Telegram reminders are triggered by the GitHub Actions workflow
`.github/workflows/telegram-reminders.yml`, not by Render Cron. This keeps the
first hosted schedule on free infrastructure; Render Cron has a separate
monthly minimum cost.

The workflow runs every 30 minutes in UTC and POSTs to the protected internal
endpoint:

```text
https://fitness-ten-fawn.vercel.app/internal/jobs/telegram-reminders/run
```

Required production setup:

1. Set `TELEGRAM_REMINDER_JOB_SECRET` on the active provider service.
2. Set the same value as the GitHub repository secret
   `TELEGRAM_REMINDER_JOB_SECRET`.
3. Keep `TELEGRAM_BOT_TOKEN`, `DATABASE_URL`, and `FITNESS_PERSISTENCE=neon`
   configured on the active provider.
4. Enable reminders per user in `telegram_reminder_preferences`; defaults are
   disabled.

Manual live smoke:

```bash
curl --fail-with-body --silent --show-error \
  --request POST \
  --header "authorization: Bearer $TELEGRAM_REMINDER_JOB_SECRET" \
  https://fitness-ten-fawn.vercel.app/internal/jobs/telegram-reminders/run
```

The response contains only counts: `planned`, `sent`, `failed`, and `failures`.
Do not print the bearer secret.

## Telegram Command Menu

The bot uses Telegram's standard command menu through `setMyCommands`. After
changing the command catalog, sync Telegram's menu from a shell with access to
`TELEGRAM_BOT_TOKEN` or local Keychain item `fitness-telegram-bot-token`:

```bash
npm run telegram:configure-commands
```

The command prints only the number of commands updated. It must not print the
bot token.

Live HealthKit sync still needs real-device signing and an explicit first
session bootstrap. Hosted iOS uploads must set or persist
`ALLOW_LIVE_HEALTH_DATA=1`, `ALLOW_HOSTED_HEALTH_BACKEND=1`,
`FITNESS_BACKEND_URL`, `FITNESS_HEALTH_USER_ID`, `FITNESS_HEALTH_SYNC_TOKEN`,
`FITNESS_HEALTH_REFRESH_TOKEN`, `FITNESS_HEALTH_TOKEN_EXPIRES_AT`, and
`FITNESS_HEALTH_OAUTH_CLIENT_ID` outside git. The app stores tokens in Keychain
after script bootstrap and can refresh expired access tokens through
`/oauth2/token`.

## Rollback

- Roll back code by redeploying the previous Git commit from the hosting
  provider.
- Roll back secrets by restoring previous provider env values from the provider
  change history or local password manager.
- Roll back database changes only after backing up the Neon branch. Do not run
  destructive SQL against live personal data without a backup and rollback note.

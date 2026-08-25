# DevOps

## Environments

- Local development uses fake or disposable data by default.
- CI and preview environments use fake or scrubbed data only.
- Production may process real personal health data and therefore requires
  explicit auth, encrypted provider secrets, backups, monitoring, and rollback.

## Secrets

Keep database URLs, OAuth secrets, signing private JWKs, bot tokens, model API
keys, reminder secrets, and allowlisted identity values in provider secret
stores or owner-only local files. Never put them in Git, shell history, build
artifacts, logs, issue reports, or copied command output.

The committed `.npmrc` pins installs to the public npm registry so a developer's
private package registry cannot leak into `package-lock.json`.

## Deployment rules

- Build with Node.js 22 and `npm ci`.
- Apply migrations to disposable data first and take a recoverable production
  backup before schema or destructive data changes.
- Deploy server and web independently, then verify readiness, unauthenticated
  rejection, wrong-user rejection, OAuth callback handling, and scoped happy
  paths.
- Keep fake-token overrides disabled in production. The server must reject them
  even if an operator accidentally sets the development flag.
- Keep raw Apple Health exports and meal photos off hosted logs and build
  artifacts.
- Use bounded request bodies, least-privilege roles, revocable credentials, and
  short-lived user sessions.
- Rotate credentials after suspected disclosure; update every dependent service
  atomically and verify old credentials fail.

## Local private data

Temporary health exports must live outside the repository. Pass their path with
an environment variable or command argument, restrict file permissions, and
delete them after the comparison or migration is complete.

See `docs/DEPLOYMENT.md` for provider-neutral setup and
`docs/SECURITY_THREAT_MODEL.md` for the security boundary.

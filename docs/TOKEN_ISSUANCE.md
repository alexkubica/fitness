# Private Token Issuance

`@fitness/auth` includes a local-only CLI for issuing short-lived RS256 bearer
tokens for MCP and HealthKit/API smoke tests. It signs with a private JWK supplied
at runtime and must not be used with committed secrets.

Build the package before running the CLI:

```bash
npm run build -w @fitness/auth
```

## Private JWK Input

Preferred local input is a macOS Keychain generic-password item. The service name
is configured explicitly:

```bash
FITNESS_AUTH_PRIVATE_JWK_KEYCHAIN_SERVICE=fitness-auth-private-jwk \
  npm run issue-token -w @fitness/auth -- --profile mcp --ttl-seconds 300 --json
```

For disposable test keys only, the CLI can read JSON from
`FITNESS_AUTH_PRIVATE_JWK`:

```bash
FITNESS_AUTH_PRIVATE_JWK='<private-jwk-json>' \
  npm run issue-token -w @fitness/auth -- --profile healthkit --raw
```

Do not paste or commit real private JWK material. The CLI prints only the issued
bearer token in `--raw` mode, or a JSON envelope with the token and non-secret
metadata in `--json` mode.

## Profiles

MCP defaults are local-safe and match the server's local MCP defaults:

- issuer: `https://mcp.fitness.local`
- audience: `fitness-mcp`
- resource: `https://mcp.fitness.local/mcp`
- subject: `user_alex`
- scopes: `health:read coach:read report:read meal:write coach:write`

Override them with args or server env names:

```bash
FITNESS_AUTH_PRIVATE_JWK_KEYCHAIN_SERVICE=fitness-auth-private-jwk \
MCP_ISSUER_URL=https://<host> \
MCP_RESOURCE_URL=https://<host>/mcp \
MCP_AUDIENCE=fitness-mcp \
MCP_EXPECTED_SUBJECT=user_alex \
  npm run issue-token -w @fitness/auth -- \
  --profile mcp \
  --ttl-seconds 300 \
  --json
```

HealthKit/API defaults are local-safe and match the server's local HealthKit auth
defaults:

- issuer: `https://auth.fitness.local`
- audience: `fitness-api`
- resource: `https://api.fitness.local`
- subject: `user_alex`
- scopes: `health:write`

Override them with args or server env names:

```bash
FITNESS_AUTH_PRIVATE_JWK_KEYCHAIN_SERVICE=fitness-auth-private-jwk \
HEALTH_SYNC_TOKEN_ISSUER=https://<host> \
HEALTH_SYNC_TOKEN_AUDIENCE=fitness-api \
HEALTH_SYNC_TOKEN_RESOURCE=https://<host> \
HEALTH_SYNC_EXPECTED_SUBJECT=user_alex \
  npm run issue-token -w @fitness/auth -- \
  --profile healthkit \
  --ttl-seconds 300 \
  --raw
```

Args take precedence over env values:

```bash
npm run issue-token -w @fitness/auth -- \
  --profile mcp \
  --issuer https://<issuer-host> \
  --resource https://<resource-host>/mcp \
  --audience fitness-mcp \
  --subject user_alex \
  --scope health:read \
  --ttl-seconds 300 \
  --json
```

`--scope` can be repeated. MCP tokens are constrained to the connector scopes:
`health:read`, `coach:read`, `report:read`, `meal:write`, and `coach:write`.
HealthKit/iOS app tokens are constrained to the approved iOS scopes, including
`health:write`, `health:sync`, `meal:write`, and `coach:write`. TTLs must be
positive integers no greater than 3600 seconds.

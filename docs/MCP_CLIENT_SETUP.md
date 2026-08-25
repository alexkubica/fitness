# Fitme MCP Client Setup

Last updated: 2026-06-22

This guide documents how to connect external LLM clients to the private Fitme
MCP server.

## Server

- Live MCP endpoint: `https://fitness-ten-fawn.vercel.app/mcp`
- Transport: MCP Streamable HTTP over HTTPS.
- Authentication: OAuth through Fitness Coach and the allowed Google account.
- ChatGPT OAuth client ID: `fitness-chatgpt`
- Scopes: `health:read`, `coach:read`, `report:read`, `meal:write`,
  `coach:write`
- Write policy: direct meal creates/updates/deletes are the supported write
  path. Meal deletes and snapshot rollbacks are explicit confirmation-gated.
  Apple Health writeback remains native-app only.

An unauthenticated request to `/mcp` returning HTTP `401` is expected.

## Web Setup Panel

The Next.js dashboard includes an MCP setup panel with copy buttons and client
instructions. When deployed, open `/mcp-setup`.

## ChatGPT

Shortcut: <https://chatgpt.com/apps#settings/Connectors>

1. Open ChatGPT web settings.
2. Go to `Settings > Apps & Connectors > Advanced settings`.
3. Enable developer mode if the Create button is hidden.
4. Create a connector named `Fitme`.
5. Set the connector URL to `https://fitness-ten-fawn.vercel.app/mcp`.
6. If ChatGPT asks for a user-defined OAuth client ID, enter
   `fitness-chatgpt`. Do not enter the Google OAuth client ID.
7. Complete OAuth with the allowed Google account.
8. In a new chat, add the connector from the composer tools menu or mention
   `@fitme`.

If tools, descriptions, or scopes change, refresh the connector metadata from
ChatGPT connector settings after deployment.

## Claude

Use Claude remote custom connectors, not local stdio config, for this deployed
server:

1. Open Claude settings.
2. Go to `Customize > Connectors`.
3. Add a custom connector with endpoint
   `https://fitness-ten-fawn.vercel.app/mcp`.
4. Complete OAuth and enable the connector in a conversation.

## Cursor / VS Code

Use a user-level MCP config and do not commit personal auth configuration:

```json
{
  "mcpServers": {
    "fitme": {
      "url": "https://fitness-ten-fawn.vercel.app/mcp"
    }
  }
}
```

If a client cannot complete OAuth, register a dedicated OAuth client only after
confirming the exact redirect URI it sends.

## Other Clients

Remote HTTP MCP entries usually use `url` or `serverUrl`:

```json
{
  "mcpServers": {
    "fitme": {
      "serverUrl": "https://fitness-ten-fawn.vercel.app/mcp"
    }
  }
}
```

Clients that only support local `stdio` MCP need a local bridge that can speak
remote Streamable HTTP and complete OAuth.

## Validation Prompts

Start with read-only prompts:

```text
@fitme pull my health summary for the last 30 days
@fitme show my weight trend for the last 90 days
@fitme generate a weekly fitness report
```

## Troubleshooting

- `Tool not found`: refresh connector metadata in the client.
- `invalid_client`: the connector is using the wrong OAuth client ID. Use
  `fitness-chatgpt`, not the Google OAuth client ID.
- `redirect_uri is not registered`: copy the exact ChatGPT callback URL from
  the connector settings and add it to `OAUTH_CLIENTS_JSON` for
  `fitness-chatgpt`.
- OAuth loop: confirm the allowed Google account is used.
- HTTP `401` at `/mcp`: expected without OAuth.
- Missing health data: sync from the latest iOS app build first.
- Client only supports `stdio`: use a bridge or choose a remote-capable MCP
  client.

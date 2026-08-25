#!/usr/bin/env node
/* global AbortSignal, URL, console, fetch, process */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const DEFAULT_RENDER_SERVICE_ID = "srv-d8ld7uf7f7vs7380e4jg";
const DEFAULT_VERCEL_PROJECT_PATH = ".vercel/project.json";
const DEFAULT_VERCEL_AUTH_PATH =
  "Library/Application Support/com.vercel.cli/auth.json";
const RENDER_API_BASE_URL = "https://api.render.com/v1";
const VERCEL_API_BASE_URL = "https://api.vercel.com";

const KEYCHAIN_SERVICES = {
  renderApiKey: "render-api-key-codex",
};

const COPY_KEYS = [
  "AUTH_JWKS_JSON",
  "DATABASE_URL",
  "FITNESS_PERSISTENCE",
  "GOOGLE_AUTH_ALLOWED_EMAILS",
  "GOOGLE_AUTH_STATE_SECRET",
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "HEALTH_SYNC_EXPECTED_SUBJECT",
  "HEALTH_SYNC_TOKEN_AUDIENCE",
  "MEAL_ESTIMATION_APP_NAME",
  "MEAL_ESTIMATION_FALLBACK_MODEL",
  "MEAL_ESTIMATION_MODEL",
  "MEAL_ESTIMATION_VISION_MODEL",
  "MCP_AUDIENCE",
  "MCP_EXPECTED_SUBJECT",
  "NODE_ENV",
  "OAUTH_CLIENTS_JSON",
  "OAUTH_PRIVATE_LOGIN_CODE",
  "OAUTH_SIGNING_PRIVATE_JWK",
  "OAUTH_USER_ID",
  "OPENROUTER_API_KEY",
  "OPENROUTER_APP_NAME",
  "OPENROUTER_MODEL",
  "OPENROUTER_SITE_URL",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_BOT_USERNAME",
  "TELEGRAM_COACH_LLM_ENABLED",
  "TELEGRAM_COACH_LLM_PROVIDER",
  "TELEGRAM_REMINDER_JOB_SECRET",
  "TELEGRAM_WEBHOOK_SECRET_TOKEN",
];

const PLAIN_KEYS = new Set([
  "FITNESS_EXTERNAL_URL",
  "FITNESS_PERSISTENCE",
  "GOOGLE_OAUTH_REDIRECT_URI",
  "HEALTH_SYNC_EXPECTED_SUBJECT",
  "HEALTH_SYNC_TOKEN_AUDIENCE",
  "HEALTH_SYNC_TOKEN_ISSUER",
  "HEALTH_SYNC_TOKEN_RESOURCE",
  "MEAL_ESTIMATION_APP_NAME",
  "MEAL_ESTIMATION_FALLBACK_MODEL",
  "MEAL_ESTIMATION_MODEL",
  "MEAL_ESTIMATION_VISION_MODEL",
  "MCP_AUDIENCE",
  "MCP_EXPECTED_SUBJECT",
  "NODE_ENV",
  "OAUTH_ACCESS_TOKEN_TTL_SECONDS",
  "OAUTH_AUTHORIZATION_CODE_TTL_SECONDS",
  "OAUTH_REFRESH_TOKEN_TTL_SECONDS",
  "OAUTH_USER_ID",
  "OPENROUTER_APP_NAME",
  "OPENROUTER_MODEL",
  "OPENROUTER_SITE_URL",
  "TELEGRAM_BOT_USERNAME",
  "TELEGRAM_COACH_LLM_ENABLED",
  "TELEGRAM_COACH_LLM_PROVIDER",
]);

const args = parseArgs(process.argv.slice(2));
const renderServiceId =
  process.env.RENDER_SERVICE_ID ?? DEFAULT_RENDER_SERVICE_ID;
const vercelProject = readJson(
  process.env.VERCEL_PROJECT_CONFIG ?? DEFAULT_VERCEL_PROJECT_PATH,
);
const vercelProjectId =
  process.env.VERCEL_PROJECT_ID ?? vercelProject.projectId;
const vercelTeamId = process.env.VERCEL_TEAM_ID ?? vercelProject.orgId;
const renderApiKey =
  envString("RENDER_API_KEY") ??
  readKeychainGenericPassword(KEYCHAIN_SERVICES.renderApiKey);
const vercelToken =
  envString("VERCEL_TOKEN") ??
  readJson(`${homedir()}/${DEFAULT_VERCEL_AUTH_PATH}`).token;
const target = args.target ?? process.env.VERCEL_ENV_TARGET ?? "production";
const backendUrl = normalizedOrigin(
  args.url ??
    process.env.FITNESS_VERCEL_URL ??
    process.env.FITNESS_EXTERNAL_URL,
);

const missing = [
  ["RENDER_API_KEY or Keychain render-api-key-codex", renderApiKey],
  ["VERCEL_TOKEN or local Vercel CLI auth", vercelToken],
  ["Vercel project id", vercelProjectId],
  ["Vercel team/org id", vercelTeamId],
].flatMap(([name, value]) => (value === undefined ? [name] : []));

if (missing.length > 0) {
  console.error("Missing required configuration:");
  for (const name of missing) {
    console.error(`- ${name}`);
  }
  process.exit(1);
}

const renderEnv = await readRenderEnvVars(renderServiceId);
const desiredEnvVars = desiredVercelEnvVars(renderEnv, backendUrl);
const existingEnvVars = await readVercelEnvVars();

for (const envVar of desiredEnvVars) {
  await removeExistingVercelEnvVar(envVar.key, existingEnvVars);
}

await createVercelEnvVars(desiredEnvVars);

console.log(
  `Synced ${desiredEnvVars.length} Vercel ${target} env vars from Render.`,
);
for (const envVar of desiredEnvVars) {
  console.log(`- ${envVar.key}`);
}

function desiredVercelEnvVars(renderEnv, externalUrl) {
  const values = new Map();

  for (const key of COPY_KEYS) {
    const value = renderEnv.get(key);

    if (value !== undefined) {
      values.set(key, value);
    }
  }

  values.set("NODE_ENV", "production");
  values.set("OAUTH_ACCESS_TOKEN_TTL_SECONDS", "3600");
  values.set("OAUTH_AUTHORIZATION_CODE_TTL_SECONDS", "300");
  values.set("OAUTH_REFRESH_TOKEN_TTL_SECONDS", "31536000");

  if (externalUrl !== undefined) {
    values.set("FITNESS_EXTERNAL_URL", externalUrl);
    values.set(
      "GOOGLE_OAUTH_REDIRECT_URI",
      new URL("/auth/google/callback", externalUrl).toString(),
    );
    values.set("HEALTH_SYNC_TOKEN_ISSUER", externalUrl);
    values.set("HEALTH_SYNC_TOKEN_RESOURCE", externalUrl);
  }

  return Array.from(values.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => ({
      key,
      target: [target],
      type: PLAIN_KEYS.has(key) ? "plain" : "sensitive",
      value,
    }));
}

async function readRenderEnvVars(serviceId) {
  const envVars = new Map();
  let cursor;

  for (let page = 0; page < 20; page += 1) {
    const url = new URL(
      `${RENDER_API_BASE_URL}/services/${encodeURIComponent(serviceId)}/env-vars`,
    );

    if (cursor !== undefined) {
      url.searchParams.set("cursor", cursor);
    }

    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${renderApiKey}`,
      },
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      throw new Error(`Render env list failed with HTTP ${response.status}.`);
    }

    const entries = await response.json();

    if (!Array.isArray(entries) || entries.length === 0) {
      break;
    }

    for (const entry of entries) {
      const key = entry.envVar?.key;
      const value = entry.envVar?.value;

      if (typeof key === "string" && typeof value === "string") {
        envVars.set(key, value);
      }
    }

    cursor = entries.at(-1)?.cursor;

    if (cursor === undefined) {
      break;
    }
  }

  return envVars;
}

async function readVercelEnvVars() {
  const response = await fetch(vercelApiUrl("/v10/projects/:projectId/env"), {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${vercelToken}`,
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`Vercel env list failed with HTTP ${response.status}.`);
  }

  const body = await response.json();
  return Array.isArray(body.envs) ? body.envs : [];
}

async function removeExistingVercelEnvVar(key, existingEnvVars) {
  const matches = existingEnvVars.filter(
    (envVar) => envVar.key === key && envTargets(envVar).includes(target),
  );

  for (const envVar of matches) {
    const targets = envTargets(envVar);

    if (targets.length !== 1 || targets[0] !== target) {
      throw new Error(
        `Refusing to replace ${key}; existing Vercel env var targets ${targets.join(
          ", ",
        )}. Remove or split it in the Vercel dashboard first.`,
      );
    }

    const response = await fetch(
      vercelApiUrl(`/v9/projects/:projectId/env/${envVar.id}`),
      {
        method: "DELETE",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${vercelToken}`,
        },
        signal: AbortSignal.timeout(30_000),
      },
    );

    if (!response.ok && response.status !== 404) {
      throw new Error(
        `Vercel env delete failed for ${key} with HTTP ${response.status}.`,
      );
    }
  }
}

async function createVercelEnvVars(envVars) {
  const response = await fetch(vercelApiUrl("/v10/projects/:projectId/env"), {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${vercelToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(envVars),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`Vercel env create failed with HTTP ${response.status}.`);
  }
}

function envTargets(envVar) {
  return Array.isArray(envVar.target) ? envVar.target.map(String) : [];
}

function vercelApiUrl(path) {
  const url = new URL(
    path.replace(":projectId", encodeURIComponent(vercelProjectId)),
    VERCEL_API_BASE_URL,
  );
  url.searchParams.set("teamId", vercelTeamId);

  return url;
}

function normalizedOrigin(value) {
  if (value === undefined || value.length === 0) {
    return undefined;
  }

  return new URL(value.includes("://") ? value : `https://${value}`).origin;
}

function parseArgs(values) {
  const parsed = {};

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];

    if (value === "--url") {
      parsed.url = values[index + 1];
      index += 1;
    } else if (value === "--target") {
      parsed.target = values[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }

  return parsed;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readKeychainGenericPassword(service) {
  try {
    const value = execFileSync(
      "security",
      ["find-generic-password", "-w", "-s", service],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();

    return value.length === 0 ? undefined : value;
  } catch {
    return undefined;
  }
}

function envString(name) {
  const value = process.env[name];

  return value === undefined || value.length === 0 ? undefined : value;
}

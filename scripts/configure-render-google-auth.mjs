#!/usr/bin/env node
/* global AbortSignal, URL, console, fetch, process */

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const DEFAULT_SERVICE_ID = "srv-d8ld7uf7f7vs7380e4jg";
const DEFAULT_BACKEND_URL = "https://fitness-coach-93ve.onrender.com";
const RENDER_API_BASE_URL = "https://api.render.com/v1";

const KEYCHAIN_SERVICES = {
  renderApiKey: "render-api-key-codex",
  googleClientId: "fitness-google-oauth-client-id",
  googleClientSecret: "fitness-google-oauth-client-secret",
  googleStateSecret: "fitness-google-auth-state-secret",
};

const args = new Set(process.argv.slice(2));
const shouldDeploy = !args.has("--no-deploy");
const serviceId = process.env.RENDER_SERVICE_ID ?? DEFAULT_SERVICE_ID;
const backendUrl = process.env.FITNESS_RENDER_URL ?? DEFAULT_BACKEND_URL;

const renderApiKey =
  envString("RENDER_API_KEY") ??
  readKeychainGenericPassword(KEYCHAIN_SERVICES.renderApiKey);
const googleClientId =
  envString("GOOGLE_OAUTH_CLIENT_ID") ??
  readKeychainGenericPassword(KEYCHAIN_SERVICES.googleClientId);
const googleClientSecret =
  envString("GOOGLE_OAUTH_CLIENT_SECRET") ??
  readKeychainGenericPassword(KEYCHAIN_SERVICES.googleClientSecret);
const allowedEmails = envString("GOOGLE_AUTH_ALLOWED_EMAILS");

const missing = [
  ["RENDER_API_KEY or Keychain render-api-key-codex", renderApiKey],
  [
    "GOOGLE_OAUTH_CLIENT_ID or Keychain fitness-google-oauth-client-id",
    googleClientId,
  ],
  [
    "GOOGLE_OAUTH_CLIENT_SECRET or Keychain fitness-google-oauth-client-secret",
    googleClientSecret,
  ],
  ["GOOGLE_AUTH_ALLOWED_EMAILS", allowedEmails],
].flatMap(([name, value]) => (value === undefined ? [name] : []));

if (missing.length > 0) {
  console.error("Missing required configuration:");
  for (const name of missing) {
    console.error(`- ${name}`);
  }
  console.error(
    "Store Google client values in Keychain or provide env vars, and set GOOGLE_AUTH_ALLOWED_EMAILS to the exact allowed Google email.",
  );
  process.exit(1);
}

const googleStateSecret =
  envString("GOOGLE_AUTH_STATE_SECRET") ?? ensureGoogleStateSecret();

const envVars = {
  GOOGLE_OAUTH_CLIENT_ID: googleClientId,
  GOOGLE_OAUTH_CLIENT_SECRET: googleClientSecret,
  GOOGLE_OAUTH_REDIRECT_URI: new URL(
    "/auth/google/callback",
    backendUrl,
  ).toString(),
  GOOGLE_AUTH_ALLOWED_EMAILS: allowedEmails,
  GOOGLE_AUTH_STATE_SECRET: googleStateSecret,
};

for (const [key, value] of Object.entries(envVars)) {
  await updateRenderEnvVar(key, value);
  console.log(`Updated Render env var ${key}.`);
}

if (shouldDeploy) {
  const deploy = await triggerDeployOnly();
  console.log(`Triggered Render deploy ${deploy.id ?? "(queued)"}.`);
}

async function updateRenderEnvVar(key, value) {
  const response = await fetchRender(
    `/services/${encodeURIComponent(serviceId)}/env-vars/${encodeURIComponent(
      key,
    )}`,
    {
      method: "PUT",
      body: JSON.stringify({ value }),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Render env update failed for ${key} with HTTP ${response.status}.`,
    );
  }
}

async function triggerDeployOnly() {
  const response = await fetchRender(
    `/services/${encodeURIComponent(serviceId)}/deploys`,
    {
      method: "POST",
      body: JSON.stringify({ deployMode: "deploy_only" }),
    },
  );
  const body = await response.text();

  if (!response.ok) {
    throw new Error(
      `Render deploy trigger failed with HTTP ${response.status}.`,
    );
  }

  return body.length > 0 ? JSON.parse(body) : {};
}

async function fetchRender(path, init) {
  return fetch(`${RENDER_API_BASE_URL}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${renderApiKey}`,
      "content-type": "application/json",
      ...init.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });
}

function ensureGoogleStateSecret() {
  const existing = readKeychainGenericPassword(
    KEYCHAIN_SERVICES.googleStateSecret,
  );

  if (existing !== undefined) {
    return existing;
  }

  const generated = randomBytes(32).toString("base64url");
  writeKeychainGenericPassword(
    KEYCHAIN_SERVICES.googleStateSecret,
    "google-auth-state-secret",
    generated,
  );

  return generated;
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

function writeKeychainGenericPassword(service, account, value) {
  execFileSync(
    "security",
    ["add-generic-password", "-U", "-s", service, "-a", account, "-w", value],
    {
      stdio: ["ignore", "ignore", "ignore"],
    },
  );
}

function envString(name) {
  const value = process.env[name];

  return value === undefined || value.length === 0 ? undefined : value;
}

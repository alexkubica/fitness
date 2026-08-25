#!/usr/bin/env node
/* global AbortSignal, URL, console, fetch, process */

import { execFileSync } from "node:child_process";

const DEFAULT_SERVICE_ID = "srv-d8ld7uf7f7vs7380e4jg";
const DEFAULT_BACKEND_URL = "https://fitness-coach-93ve.onrender.com";
const RENDER_API_BASE_URL = "https://api.render.com/v1";

const KEYCHAIN_SERVICES = {
  renderApiKey: "render-api-key-codex",
  openRouterApiKey: "fitness-openrouter-api-key",
};

const args = new Set(process.argv.slice(2));
const shouldDeploy = !args.has("--no-deploy");
const shouldDisable = args.has("--disable");
const serviceId = process.env.RENDER_SERVICE_ID ?? DEFAULT_SERVICE_ID;
const backendUrl = process.env.FITNESS_RENDER_URL ?? DEFAULT_BACKEND_URL;

const renderApiKey =
  envString("RENDER_API_KEY") ??
  readKeychainGenericPassword(KEYCHAIN_SERVICES.renderApiKey);

if (renderApiKey === undefined) {
  console.error("Missing RENDER_API_KEY or Keychain render-api-key-codex.");
  process.exit(1);
}

const envVars = shouldDisable
  ? {
      TELEGRAM_COACH_LLM_ENABLED: "0",
    }
  : enabledOpenRouterEnvVars();

for (const [key, value] of Object.entries(envVars)) {
  await updateRenderEnvVar(key, value);
  console.log(`Updated Render env var ${key}.`);
}

if (shouldDeploy) {
  const deploy = await triggerDeployOnly();
  console.log(`Triggered Render deploy ${deploy.id ?? "(queued)"}.`);
}

function enabledOpenRouterEnvVars() {
  const openRouterApiKey =
    envString("OPENROUTER_API_KEY") ??
    readKeychainGenericPassword(KEYCHAIN_SERVICES.openRouterApiKey);

  if (openRouterApiKey === undefined) {
    console.error(
      "Missing OPENROUTER_API_KEY or Keychain fitness-openrouter-api-key.",
    );
    process.exit(1);
  }

  return {
    TELEGRAM_COACH_LLM_ENABLED: "1",
    TELEGRAM_COACH_LLM_PROVIDER: "openrouter",
    OPENROUTER_API_KEY: openRouterApiKey,
    OPENROUTER_MODEL: envString("OPENROUTER_MODEL") ?? "openrouter/free",
    OPENROUTER_SITE_URL:
      envString("OPENROUTER_SITE_URL") ??
      new URL("/", backendUrl).toString().replace(/\/$/u, ""),
    OPENROUTER_APP_NAME: envString("OPENROUTER_APP_NAME") ?? "Fitness Coach",
  };
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

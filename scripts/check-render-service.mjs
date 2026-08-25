#!/usr/bin/env node
/* global AbortSignal, URL, console, fetch, process, setTimeout */

const DEFAULT_SERVICE_ID = "srv-d8ld7uf7f7vs7380e4jg";
const DEFAULT_SERVICE_URL = "https://fitness-coach-93ve.onrender.com";
const RENDER_API_BASE_URL = "https://api.render.com/v1";
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 15 * 1000;
const RECENT_LOG_LIMIT = 100;

const args = new Set(process.argv.slice(2));
const waitForTerminalDeploy = args.has("--wait");
const includeLogs = !args.has("--no-logs");
const failOnLogs = args.has("--fail-on-logs");
const jsonOnly = args.has("--json");
const apiKey = process.env.RENDER_API_KEY;
const serviceId = process.env.RENDER_SERVICE_ID ?? DEFAULT_SERVICE_ID;
const serviceUrl = process.env.FITNESS_RENDER_URL ?? DEFAULT_SERVICE_URL;

if (apiKey === undefined || apiKey.length === 0) {
  console.error("RENDER_API_KEY is required.");
  process.exit(1);
}

const service = await fetchRenderJson(`/services/${serviceId}`);
const deploy = await waitForTerminalDeployStatus(serviceId);
const readiness = await checkReadiness(serviceUrl);
const recentLogMatches = includeLogs
  ? await readRecentLogMatches(service.ownerId, serviceId)
  : [];

printSummary({ deploy, readiness, recentLogMatches, service });

if (
  isFailedDeployStatus(deploy.status) ||
  deploy.status !== "live" ||
  readiness.ok === false ||
  (failOnLogs && recentLogMatches.some((entry) => entry.severity === "error"))
) {
  process.exitCode = 1;
}

async function waitForTerminalDeployStatus(targetServiceId) {
  const startedAt = Date.now();

  while (true) {
    const latestDeploy = await fetchLatestDeploy(targetServiceId);

    if (!waitForTerminalDeploy || isTerminalDeployStatus(latestDeploy.status)) {
      return latestDeploy;
    }

    if (Date.now() - startedAt > DEFAULT_TIMEOUT_MS) {
      return latestDeploy;
    }

    if (!jsonOnly) {
      console.log(
        `Render deploy ${latestDeploy.id} is ${latestDeploy.status}; waiting...`,
      );
    }
    await sleep(DEFAULT_INTERVAL_MS);
  }
}

async function fetchLatestDeploy(targetServiceId) {
  const deploys = await fetchRenderJson(
    `/services/${targetServiceId}/deploys?limit=1`,
  );
  const deploy = Array.isArray(deploys) ? deploys[0]?.deploy : undefined;

  if (deploy === undefined) {
    throw new Error("Render returned no deploys for the service.");
  }

  return {
    id: String(deploy.id),
    status: String(deploy.status),
    commit: String(deploy.commit?.id ?? "unknown"),
    createdAt: String(deploy.createdAt ?? "unknown"),
    finishedAt:
      deploy.finishedAt === null || deploy.finishedAt === undefined
        ? undefined
        : String(deploy.finishedAt),
  };
}

async function checkReadiness(targetServiceUrl) {
  const url = new URL("/readyz", targetServiceUrl);

  try {
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
      },
      signal: AbortSignal.timeout(20_000),
    });
    const body = await response.text();

    return {
      body: body.slice(0, 500),
      ok: response.ok,
      status: response.status,
      url: url.href,
    };
  } catch (error) {
    return {
      body: error instanceof Error ? error.message : String(error),
      ok: false,
      status: 0,
      url: url.href,
    };
  }
}

async function readRecentLogMatches(ownerId, targetServiceId) {
  if (typeof ownerId !== "string" || ownerId.length === 0) {
    return [
      {
        message:
          "Render service response did not include ownerId; skipped logs.",
        severity: "warning",
        timestamp: "unknown",
      },
    ];
  }

  const logs = await fetchRenderJson(
    `/logs?ownerId=${encodeURIComponent(ownerId)}&resource=${encodeURIComponent(
      targetServiceId,
    )}&limit=${RECENT_LOG_LIMIT}`,
  );
  const entries = Array.isArray(logs) ? logs : logs.logs;

  if (!Array.isArray(entries)) {
    return [
      {
        message: "Render logs response shape was not recognized.",
        severity: "warning",
        timestamp: "unknown",
      },
    ];
  }

  return entries
    .map((entry) => ({
      labels: nonSecretLabels(entry.labels),
      message: redactLogMessage(String(entry.message ?? entry.text ?? "")),
      severity: severityForLogEntry(entry),
      timestamp: String(entry.timestamp ?? entry.time ?? "unknown"),
    }))
    .filter((entry) => entry.severity !== "info")
    .slice(0, 12);
}

function severityForLogEntry(entry) {
  const message = String(entry.message ?? entry.text ?? "");
  const level = String(entry.labels?.level ?? entry.level ?? "").toLowerCase();

  if (["emergency", "alert", "critical", "error"].includes(level)) {
    return "error";
  }

  if (["warning", "warn"].includes(level)) {
    return "warning";
  }

  if (
    /could not extend|neondberror|port scan timeout|timed out|uncaught|unhandled|failed|error/iu.test(
      message,
    )
  ) {
    return "error";
  }

  if (
    /detected service running|fitness-server listening|your service is live/iu.test(
      message,
    )
  ) {
    return "notice";
  }

  return "info";
}

function nonSecretLabels(labels) {
  if (labels === undefined || labels === null || typeof labels !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(labels)
      .filter(([key]) => ["level", "type"].includes(key))
      .map(([key, value]) => [key, String(value)]),
  );
}

function redactLogMessage(message) {
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [redacted]")
    .replace(
      /(token|secret|password|authorization|api[_-]?key)=\S+/giu,
      "$1=[redacted]",
    )
    .slice(0, 240);
}

async function fetchRenderJson(path) {
  const response = await fetch(`${RENDER_API_BASE_URL}${path}`, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.text();

  if (!response.ok) {
    throw new Error(`Render API ${path} failed with HTTP ${response.status}.`);
  }

  return JSON.parse(body);
}

function printSummary({ deploy, readiness, recentLogMatches, service }) {
  console.log(
    JSON.stringify(
      {
        deploy,
        readiness: {
          body: readiness.body,
          ok: readiness.ok,
          status: readiness.status,
          url: readiness.url,
        },
        recentLogMatches,
        service: {
          id: service.id,
          name: service.name,
          suspended: service.suspended,
          type: service.type,
        },
      },
      null,
      2,
    ),
  );
}

function isTerminalDeployStatus(status) {
  return (
    status === "live" ||
    status === "deactivated" ||
    status === "update_failed" ||
    status === "build_failed" ||
    status === "pre_deploy_failed" ||
    status === "canceled"
  );
}

function isFailedDeployStatus(status) {
  return (
    status === "update_failed" ||
    status === "build_failed" ||
    status === "pre_deploy_failed" ||
    status === "canceled"
  );
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

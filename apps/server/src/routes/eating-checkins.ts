import type { Context, Hono } from "hono";
import {
  EATING_CONTEXTS,
  type EatingCheckInPatch,
  type EatingContext,
} from "@fitness/db";
import type { AuthScope } from "@fitness/auth";
import type { ServerEnv } from "../auth.js";
import type { AuditPort } from "../services/audit.js";
import type { AuthorizationService } from "../services/authorization.js";
import type { EatingCheckInService } from "../services/eating-checkins.js";
import type { ProfileContext, ProfileService } from "../services/profiles.js";
import {
  resolveRouteProfileContext,
  routeProfileErrorBody,
} from "./profile-context.js";

export type EatingCheckInRouteServices = Readonly<{
  audit: AuditPort;
  authorization: AuthorizationService;
  eatingCheckIns: EatingCheckInService;
  profiles: ProfileService;
}>;

const scaleFields = new Set([
  "hungerBefore",
  "fullnessAfter",
  "urgeIntensity",
  "emotionIntensity",
]);

export function registerEatingCheckInRoutes(
  app: Hono<ServerEnv>,
  services: EatingCheckInRouteServices,
): void {
  app.get("/api/eating-checkins", async (context) => {
    const prepared = await readContext(context, services, "checkin.list");
    if (prepared.ok === false) return prepared.response;
    const range = parseRange(context);
    const checkIns = await services.eatingCheckIns.getCheckIns({
      userId: prepared.profile.subjectUserId,
      profileId: prepared.profile.profileId,
      range,
      linkedMealId: context.req.query("linkedMealId"),
      linkedPlannedMealId: context.req.query("linkedPlannedMealId"),
      limit: optionalInt(context.req.query("limit")),
    });
    return context.json({ checkIns });
  });

  app.get("/api/eating-checkins/latest", async (context) => {
    const prepared = await readContext(context, services, "checkin.latest");
    if (prepared.ok === false) return prepared.response;
    const checkIn = await services.eatingCheckIns.getLatestCheckIn({
      userId: prepared.profile.subjectUserId,
      profileId: prepared.profile.profileId,
    });
    return context.json({ checkIn: checkIn ?? null });
  });

  app.get("/api/eating-checkins/trigger-summary", async (context) => {
    const prepared = await readContext(context, services, "checkin.summary");
    if (prepared.ok === false) return prepared.response;
    const summary = await services.eatingCheckIns.getTriggerSummary({
      userId: prepared.profile.subjectUserId,
      profileId: prepared.profile.profileId,
      range: parseRange(context) ?? defaultWeekRange(),
      limit: optionalInt(context.req.query("limit")),
    });
    return context.json({ summary });
  });

  app.get("/api/eating-checkins/binge-summary", async (context) => {
    const prepared = await readContext(
      context,
      services,
      "checkin.binge-summary",
    );
    if (prepared.ok === false) return prepared.response;
    const summary = await services.eatingCheckIns.getBingePatternSummary({
      userId: prepared.profile.subjectUserId,
      profileId: prepared.profile.profileId,
      range: parseRange(context) ?? defaultWeekRange(),
      limit: optionalInt(context.req.query("limit")),
    });
    return context.json({ summary });
  });

  app.get("/api/eating-checkins/weekly-report", async (context) => {
    const prepared = await readContext(context, services, "checkin.weekly");
    if (prepared.ok === false) return prepared.response;
    const report = await services.eatingCheckIns.getWeeklyReport({
      userId: prepared.profile.subjectUserId,
      profileId: prepared.profile.profileId,
      range: parseRange(context) ?? defaultWeekRange(),
      limit: optionalInt(context.req.query("limit")),
    });
    return context.json({ report });
  });

  app.post("/api/eating-checkins", async (context) => {
    const prepared = await writeContext(context, services, "checkin.create");
    if (prepared.ok === false) return prepared.response;
    const payload = await jsonObject(context);
    if (payload.ok === false) return payload.response;
    const parsed = parseCheckInBody(payload.value);
    if (parsed.ok === false) return context.json(parsed.error, 400);
    const result = await services.eatingCheckIns.createCheckIn({
      ...parsed.value,
      userId: prepared.profile.subjectUserId,
      profileId: prepared.profile.profileId,
      occurredAt: parsed.value.occurredAt ?? new Date().toISOString(),
    });
    await auditCheckIn(
      services.audit,
      prepared.profile,
      "create",
      result.checkIn.id,
    );
    return context.json(result);
  });

  app.patch("/api/eating-checkins/:id", async (context) => {
    const prepared = await writeContext(context, services, "checkin.update");
    if (prepared.ok === false) return prepared.response;
    const payload = await jsonObject(context);
    if (payload.ok === false) return payload.response;
    const parsed = parseCheckInPatch(payload.value);
    if (parsed.ok === false) return context.json(parsed.error, 400);
    const checkIn = await services.eatingCheckIns.updateCheckIn({
      userId: prepared.profile.subjectUserId,
      profileId: prepared.profile.profileId,
      checkInId: context.req.param("id"),
      patch: parsed.value,
    });
    if (checkIn !== undefined) {
      await auditCheckIn(
        services.audit,
        prepared.profile,
        "update",
        checkIn.id,
      );
    }
    return checkIn === undefined
      ? context.json({ error: "not-found" }, 404)
      : context.json({ checkIn });
  });

  app.post("/api/eating-checkins/:id/link", async (context) => {
    const prepared = await writeContext(context, services, "checkin.link");
    if (prepared.ok === false) return prepared.response;
    const payload = await jsonObject(context);
    if (payload.ok === false) return payload.response;
    const checkIn = await services.eatingCheckIns.linkCheckInToMeal({
      userId: prepared.profile.subjectUserId,
      profileId: prepared.profile.profileId,
      checkInId: context.req.param("id"),
      linkedMealId: optionalString(payload.value.linkedMealId),
      linkedPlannedMealId: optionalString(payload.value.linkedPlannedMealId),
    });
    if (checkIn !== undefined) {
      await auditCheckIn(services.audit, prepared.profile, "link", checkIn.id);
    }
    return checkIn === undefined
      ? context.json({ error: "not-found" }, 404)
      : context.json({ checkIn });
  });
}

type PreparedContext =
  | Readonly<{ ok: true; profile: ProfileContext }>
  | Readonly<{ ok: false; response: Response }>;

async function readContext(
  context: Context<ServerEnv>,
  services: EatingCheckInRouteServices,
  action: string,
): Promise<PreparedContext> {
  if (!hasAnyScope(context, ["coach:read", "coach:write"])) {
    return {
      ok: false,
      response: context.json({ error: "missing-scope" }, 403),
    };
  }
  return routeContext(context, services, "checkin.read", action);
}

async function writeContext(
  context: Context<ServerEnv>,
  services: EatingCheckInRouteServices,
  action: string,
): Promise<PreparedContext> {
  if (!hasAnyScope(context, ["coach:write"])) {
    return {
      ok: false,
      response: context.json({ error: "missing-scope" }, 403),
    };
  }
  return routeContext(context, services, "checkin.write", action);
}

async function routeContext(
  context: Context<ServerEnv>,
  services: EatingCheckInRouteServices,
  permission: "checkin.read" | "checkin.write",
  action: string,
): Promise<PreparedContext> {
  const auth = context.get("auth");
  const profile = await resolveRouteProfileContext(
    services.profiles,
    auth.actorUserId,
    context.req.query("profileId"),
    services.authorization,
    permission,
    action,
    context.req.header("x-request-id"),
  );
  if (profile.ok === false) {
    return {
      ok: false,
      response: context.json(routeProfileErrorBody(profile), profile.status),
    };
  }
  return { ok: true, profile: profile.value };
}

function hasAnyScope(
  context: Context<ServerEnv>,
  scopes: readonly AuthScope[],
): boolean {
  const granted = new Set(context.get("auth").scopes);
  return scopes.some((scope) => granted.has(scope));
}

function parseRange(
  context: Context<ServerEnv>,
): Readonly<{ from: string; to: string }> | undefined {
  const from = context.req.query("from");
  const to = context.req.query("to");
  return from === undefined || to === undefined ? undefined : { from, to };
}

function defaultWeekRange(): Readonly<{ from: string; to: string }> {
  const to = new Date();
  const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1_000);
  return { from: from.toISOString(), to: to.toISOString() };
}

type ParsedBody<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: { error: string; message: string } }>;

function parseCheckInBody(body: Record<string, unknown>): ParsedBody<{
  occurredAt?: string | undefined;
  timezone: string;
  idempotencyKey?: string | undefined;
  linkedMealId?: string | undefined;
  linkedPlannedMealId?: string | undefined;
  hungerBefore?: number | undefined;
  fullnessAfter?: number | undefined;
  urgeIntensity?: number | undefined;
  emotionIntensity?: number | undefined;
  emotions?: readonly string[] | undefined;
  triggers?: readonly string[] | undefined;
  automaticThought?: string | undefined;
  balancedResponse?: string | undefined;
  eatingContext?: EatingContext | undefined;
  lossOfControl?: boolean | undefined;
  ateUntilPain?: boolean | undefined;
  ateWithScreen?: boolean | undefined;
  ateFromPackage?: boolean | undefined;
  tookSecondServing?: boolean | undefined;
  copingAction?: string | undefined;
  urgeDelayMinutes?: number | undefined;
  outcome?: string | undefined;
  note?: string | undefined;
}> {
  const parsed = parseCheckInPatch(body);
  if (parsed.ok === false) return parsed;
  const timezone = optionalString(body.timezone);
  if (timezone === undefined) {
    return invalid("timezone is required.");
  }
  return {
    ok: true,
    value: {
      ...parsed.value,
      timezone,
      idempotencyKey: optionalString(body.idempotencyKey),
    },
  };
}

function parseCheckInPatch(
  body: Record<string, unknown>,
): ParsedBody<EatingCheckInPatch> {
  const parsed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (key === "timezone" || key === "idempotencyKey") continue;
    if (value === undefined || value === null || value === "") continue;
    if (scaleFields.has(key)) {
      const number = Number(value);
      if (!Number.isInteger(number) || number < 0 || number > 10) {
        return invalid(`${key} must be an integer from 0 to 10.`);
      }
      parsed[key] = number;
      continue;
    }
    if (key === "urgeDelayMinutes") {
      const number = Number(value);
      if (!Number.isInteger(number) || number < 0) {
        return invalid("urgeDelayMinutes must be a nonnegative integer.");
      }
      parsed[key] = number;
      continue;
    }
    if (
      [
        "lossOfControl",
        "ateUntilPain",
        "ateWithScreen",
        "ateFromPackage",
        "tookSecondServing",
      ].includes(key)
    ) {
      if (typeof value !== "boolean") return invalid(`${key} must be boolean.`);
      parsed[key] = value;
      continue;
    }
    if (key === "emotions" || key === "triggers") {
      if (
        !Array.isArray(value) ||
        value.some((item) => typeof item !== "string")
      ) {
        return invalid(`${key} must be a string array.`);
      }
      parsed[key] = value.map((item) => item.trim()).filter(Boolean);
      continue;
    }
    if (key === "eatingContext") {
      if (
        typeof value !== "string" ||
        !(EATING_CONTEXTS as readonly string[]).includes(value)
      ) {
        return invalid("eatingContext is invalid.");
      }
      parsed[key] = value;
      continue;
    }
    if (
      [
        "occurredAt",
        "linkedMealId",
        "linkedPlannedMealId",
        "automaticThought",
        "balancedResponse",
        "copingAction",
        "outcome",
        "note",
      ].includes(key)
    ) {
      const text = optionalString(value);
      if (text !== undefined) parsed[key] = text;
    }
  }
  return { ok: true, value: parsed as EatingCheckInPatch };
}

async function jsonObject(
  context: Context<ServerEnv>,
): Promise<
  | Readonly<{ ok: true; value: Record<string, unknown> }>
  | Readonly<{ ok: false; response: Response }>
> {
  try {
    const value = await context.req.json();
    if (isRecord(value)) return { ok: true, value };
  } catch {
    // Fall through to invalid response.
  }
  return {
    ok: false,
    response: context.json(
      {
        error: "invalid-payload",
        message: "Request body must be an object.",
      },
      400,
    ),
  };
}

async function auditCheckIn(
  audit: AuditPort,
  profile: ProfileContext,
  operation: string,
  checkInId: string,
): Promise<void> {
  await audit.create({
    action: `eating_checkin.${operation}`,
    actor: { type: "user", id: profile.actorUserId },
    target: { type: "eating_checkin", id: checkInId },
    userId: profile.subjectUserId,
    profileId: profile.profileId,
    metadata: { profileId: profile.profileId },
  });
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function optionalInt(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(message: string): ParsedBody<never> {
  return { ok: false, error: { error: "invalid-payload", message } };
}

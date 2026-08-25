import {
  isHealthMetricName,
  isValidHealthMetricValue,
  metricByName,
  type HealthMetricName,
  type HealthMetricUnit,
} from "@fitness/domain";
import type { Hono } from "hono";
import type { ServerEnv } from "../auth.js";
import type { AuditPort } from "../services/audit.js";
import type { AuthorizationService } from "../services/authorization.js";
import type {
  HealthMetricDeletedSampleInput,
  HealthMetricSampleInput,
  HealthSyncIngestInput,
  HealthSyncResponse,
  HealthSyncService,
} from "../services/health-sync.js";
import type { ProfileService } from "../services/profiles.js";
import {
  resolveRouteProfileContext,
  routeProfileErrorBody,
} from "./profile-context.js";

export const HEALTH_SYNC_UPLOAD_MAX_TOTAL_ITEMS = 1_000;

export type HealthSyncRouteServices = Readonly<{
  audit: AuditPort;
  authorization: AuthorizationService;
  healthSync: HealthSyncService;
  profiles: ProfileService;
}>;

type ValidationError = Readonly<{
  ok: false;
  error: "invalid-payload" | "payload-too-large";
  message: string;
  status: 400 | 413;
}>;

type ValidationResult<T> = Readonly<{ ok: true; value: T }> | ValidationError;

type HealthSyncMinimalResponse = Omit<
  HealthSyncResponse,
  "samples" | "deletedSamples"
>;

type JsonRequest = Readonly<{
  json(): Promise<unknown>;
}>;

const TIME_ZONE_VALIDATION_CACHE_MAX_ENTRIES = 512;
const timeZoneValidationCache = new Map<string, boolean>();

export function registerHealthSyncRoutes(
  app: Hono<ServerEnv>,
  services: HealthSyncRouteServices,
): void {
  app.post("/api/health/samples", async (context) => {
    const preferHeader = context.req.header("Prefer");
    const payloadResult = await parseHealthSyncRequest(context.req);

    if (payloadResult.ok === false) {
      const error = payloadResult;

      return context.json(
        { error: error.error, message: error.message },
        error.status,
      );
    }

    const payload = payloadResult.value;
    const auth = context.get("auth");

    if (
      !auth.scopes.includes("health:sync") &&
      !auth.scopes.includes("health:write")
    ) {
      return context.json({ error: "missing-scope" }, 403);
    }

    if (payload.userId !== auth.userId) {
      return context.json({ error: "wrong-user" }, 403);
    }

    const profileContext = await resolveRouteProfileContext(
      services.profiles,
      auth.actorUserId,
      payload.profileId,
      services.authorization,
      "health.write",
      "health.samples.ingest",
      context.req.header("x-request-id"),
    );

    if (profileContext.ok === false) {
      return context.json(
        routeProfileErrorBody(profileContext),
        profileContext.status,
      );
    }

    const ingestPayload: HealthSyncIngestInput = {
      ...payload,
      userId: profileContext.value.subjectUserId,
      profileId: profileContext.value.profileId,
    };
    const ingestResult = await services.healthSync.ingest(ingestPayload);

    if (ingestResult.createdBatch) {
      await services.audit.create({
        action: "health.samples.ingest",
        actor: auth.actor,
        target: {
          type: "health_samples",
          id: payload.idempotencyKey,
        },
        userId: profileContext.value.subjectUserId,
        profileId: profileContext.value.profileId,
        metadata: {
          accepted: ingestResult.response.accepted,
          created: ingestResult.response.created,
          duplicate: ingestResult.response.duplicate,
          deleted: ingestResult.response.deleted,
          alreadyDeleted: ingestResult.response.alreadyDeleted,
          missingDeleted: ingestResult.response.missingDeleted,
          profileId: profileContext.value.profileId,
        },
      });
    }

    if (prefersMinimalHealthSyncResponse(preferHeader)) {
      context.header("Preference-Applied", "return=minimal");
      return context.json(minimalHealthSyncResponse(ingestResult.response));
    }

    return context.json(ingestResult.response);
  });
}

async function parseHealthSyncRequest(
  request: JsonRequest,
): Promise<ValidationResult<HealthSyncIngestInput>> {
  try {
    return parseHealthSyncPayload(await request.json());
  } catch {
    return invalid("Request body must be valid JSON.");
  }
}

function parseHealthSyncPayload(
  value: unknown,
): ValidationResult<HealthSyncIngestInput> {
  if (!isRecord(value)) {
    return invalid("Payload must be an object.");
  }

  const userId = nonEmptyString(value.userId);
  const idempotencyKeyResult = parseIdempotencyKey(value.idempotencyKey);

  if (userId === undefined) {
    return invalid("Payload userId is required.");
  }

  if (idempotencyKeyResult.ok === false) {
    return idempotencyKeyResult;
  }

  if (!Array.isArray(value.samples)) {
    return invalid("Payload samples must be an array.");
  }

  const deletedSamplesValue =
    value.deletedSamples === undefined ? [] : value.deletedSamples;

  if (!Array.isArray(deletedSamplesValue)) {
    return invalid("Payload deletedSamples must be an array.");
  }

  if (value.samples.length === 0 && deletedSamplesValue.length === 0) {
    return invalid("Payload samples or deletedSamples must be non-empty.");
  }

  const totalItemCount = value.samples.length + deletedSamplesValue.length;

  if (totalItemCount > HEALTH_SYNC_UPLOAD_MAX_TOTAL_ITEMS) {
    return payloadTooLarge(
      `Payload samples plus deletedSamples must contain at most ${HEALTH_SYNC_UPLOAD_MAX_TOTAL_ITEMS} total items; received ${totalItemCount}.`,
    );
  }

  const samples: HealthMetricSampleInput[] = [];
  const deletedSamples: HealthMetricDeletedSampleInput[] = [];

  for (const sample of value.samples) {
    const sampleResult = parseHealthSample(sample);

    if (sampleResult.ok === false) {
      return sampleResult;
    }

    samples.push(sampleResult.value);
  }

  for (const deletedSample of deletedSamplesValue) {
    const deletedSampleResult = parseDeletedHealthSample(deletedSample);

    if (deletedSampleResult.ok === false) {
      return deletedSampleResult;
    }

    deletedSamples.push(deletedSampleResult.value);
  }

  return {
    ok: true,
    value: {
      userId,
      profileId: nonEmptyString(value.profileId),
      idempotencyKey: idempotencyKeyResult.value,
      samples,
      deletedSamples,
    },
  };
}

function parseHealthSample(
  value: unknown,
): ValidationResult<HealthMetricSampleInput> {
  if (!isRecord(value)) {
    return invalid("Each sample must be an object.");
  }

  const metricNameResult = parseMetricName(value.metricName);

  if (metricNameResult.ok === false) {
    return metricNameResult;
  }

  const metricName = metricNameResult.value;
  const unitResult = parseUnit(metricName, value.unit);

  if (unitResult.ok === false) {
    return unitResult;
  }

  if (!isFiniteNumber(value.value)) {
    return invalid("Sample value must be a finite number.");
  }

  if (!isValidHealthMetricValue(metricName, value.value)) {
    return invalid("Sample value is outside the metric contract.");
  }

  const startTime = parseTimestamp(value.startTime, "startTime");
  const endTime = parseTimestamp(value.endTime, "endTime");

  if (startTime.ok === false) {
    return startTime;
  }

  if (endTime.ok === false) {
    return endTime;
  }

  if (Date.parse(endTime.value) < Date.parse(startTime.value)) {
    return invalid("Sample endTime cannot be before startTime.");
  }

  const timezone = nonEmptyString(value.timezone);
  const source = nonEmptyString(value.source);
  const sourceSampleId = nonEmptyString(value.sourceSampleId);

  if (timezone === undefined || !isValidTimeZone(timezone)) {
    return invalid("Sample timezone must be a valid IANA time zone.");
  }

  if (source === undefined) {
    return invalid("Sample source is required.");
  }

  if (source === "apple_health") {
    return invalid(
      "Raw Apple Health sample uploads are no longer accepted; upload daily apple_health_daily aggregates.",
    );
  }

  if (sourceSampleId === undefined) {
    return invalid("Sample sourceSampleId is required.");
  }

  return {
    ok: true,
    value: {
      metricName,
      unit: unitResult.value,
      value: value.value,
      startTime: startTime.value,
      endTime: endTime.value,
      timezone,
      source,
      sourceSampleId,
    },
  };
}

function parseDeletedHealthSample(
  value: unknown,
): ValidationResult<HealthMetricDeletedSampleInput> {
  if (!isRecord(value)) {
    return invalid("Each deleted sample must be an object.");
  }

  const metricNameResult = parseMetricName(value.metricName);

  if (metricNameResult.ok === false) {
    return metricNameResult;
  }

  const source = nonEmptyString(value.source);
  const sourceSampleId = nonEmptyString(value.sourceSampleId);

  if (source === undefined) {
    return invalid("Deleted sample source is required.");
  }

  if (sourceSampleId === undefined) {
    return invalid("Deleted sample sourceSampleId is required.");
  }

  return {
    ok: true,
    value: {
      metricName: metricNameResult.value,
      source,
      sourceSampleId,
    },
  };
}

function parseMetricName(value: unknown): ValidationResult<HealthMetricName> {
  if (typeof value !== "string" || !isHealthMetricName(value)) {
    return invalid("Sample metricName is not supported.");
  }

  return { ok: true, value };
}

function parseUnit(
  metricName: HealthMetricName,
  value: unknown,
): ValidationResult<HealthMetricUnit> {
  const metric = metricByName(metricName);

  if (value !== metric.unit) {
    return invalid("Sample unit does not match the metric contract.");
  }

  return { ok: true, value: metric.unit };
}

function parseTimestamp(
  value: unknown,
  fieldName: "startTime" | "endTime",
): ValidationResult<string> {
  if (
    typeof value !== "string" ||
    !isIsoTimestampWithOffset(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    return invalid(
      `Sample ${fieldName} must be a valid ISO timestamp with timezone.`,
    );
  }

  return { ok: true, value };
}

function parseIdempotencyKey(value: unknown): ValidationResult<string> {
  const idempotencyKey = nonEmptyString(value);

  if (idempotencyKey === undefined) {
    return invalid("Payload idempotencyKey is required.");
  }

  if (!/^[A-Za-z0-9._:-]{1,128}$/u.test(idempotencyKey)) {
    return invalid(
      "Payload idempotencyKey must be 1-128 safe identifier characters.",
    );
  }

  return { ok: true, value: idempotencyKey };
}

function invalid(message: string): ValidationError {
  return { ok: false, error: "invalid-payload", message, status: 400 };
}

function payloadTooLarge(message: string): ValidationError {
  return { ok: false, error: "payload-too-large", message, status: 413 };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }

  return value;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isIsoTimestampWithOffset(value: string): boolean {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/u.exec(
      value,
    );

  if (match === null) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    !Number.isInteger(second)
  ) {
    return false;
  }

  if (
    month < 1 ||
    month > 12 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    return false;
  }

  return day >= 1 && day <= daysInMonth(year, month);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isValidTimeZone(value: string): boolean {
  const cachedResult = timeZoneValidationCache.get(value);

  if (cachedResult !== undefined) {
    return cachedResult;
  }

  const isValid = validateTimeZone(value);

  if (timeZoneValidationCache.size >= TIME_ZONE_VALIDATION_CACHE_MAX_ENTRIES) {
    const oldestKey = timeZoneValidationCache.keys().next().value;

    if (oldestKey !== undefined) {
      timeZoneValidationCache.delete(oldestKey);
    }
  }

  timeZoneValidationCache.set(value, isValid);

  return isValid;
}

function validateTimeZone(value: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function prefersMinimalHealthSyncResponse(
  preferHeader: string | undefined,
): boolean {
  return (
    preferHeader
      ?.split(",")
      .some((preference) =>
        /^return\s*=\s*minimal$/iu.test(preference.trim()),
      ) ?? false
  );
}

function minimalHealthSyncResponse(
  response: HealthSyncResponse,
): HealthSyncMinimalResponse {
  return {
    status: response.status,
    idempotencyKey: response.idempotencyKey,
    accepted: response.accepted,
    created: response.created,
    duplicate: response.duplicate,
    deleted: response.deleted,
    alreadyDeleted: response.alreadyDeleted,
    missingDeleted: response.missingDeleted,
  };
}

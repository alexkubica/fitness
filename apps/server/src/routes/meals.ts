import type {
  MealIngredientInput,
  MealLogInput,
  MealMacroTotals,
  SavedMealTemplateInput,
} from "@fitness/db";
import type { Hono } from "hono";
import type { ServerEnv } from "../auth.js";
import type { AuditPort } from "../services/audit.js";
import type { AuthorizationService } from "../services/authorization.js";
import type { MealLogService } from "../services/meals.js";
import type { ProfileService } from "../services/profiles.js";
import {
  localFoodDateTimeToUtc,
  normalizeMcpDateRange,
} from "../mcp/tools/date-range.js";
import {
  resolveRouteProfileContext,
  routeProfileErrorBody,
} from "./profile-context.js";

export type MealRoutesServices = Readonly<{
  audit: AuditPort;
  authorization: AuthorizationService;
  meals: MealLogService;
  profiles: ProfileService;
}>;

type JsonRequest = Readonly<{
  json(): Promise<unknown>;
}>;

type ValidationResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{
      ok: false;
      error: "invalid-payload" | "payload-too-large";
      message: string;
      status: 400 | 413;
    }>;

const maxTitleChars = 120;
const maxMealTypeChars = 80;
const maxNoteChars = 2_000;
const maxEstimateSummaryChars = 300;
const maxIngredientNameChars = 120;
const maxIngredientUnitChars = 40;
const maxIngredients = 40;
const maxPhotoCount = 6;

export function registerMealRoutes(
  app: Hono<ServerEnv>,
  services: MealRoutesServices,
): void {
  app.get("/api/meals/logs", async (context) => {
    const auth = context.get("auth");

    if (!auth.scopes.includes("meal:write")) {
      return context.json({ error: "missing-scope" }, 403);
    }

    const query = parseMealListQuery({
      date: context.req.query("date"),
      from: context.req.query("from"),
      limit: context.req.query("limit"),
      profileId: context.req.query("profileId"),
      timezone: context.req.query("timezone"),
      to: context.req.query("to"),
    });

    if (query.ok === false) {
      return context.json(
        { error: query.error, message: query.message },
        query.status,
      );
    }

    const profileContext = await resolveRouteProfileContext(
      services.profiles,
      auth.actorUserId,
      query.value.profileId,
      services.authorization,
      "meal.read",
      "meal.log.list",
      context.req.header("x-request-id"),
    );

    if (profileContext.ok === false) {
      return context.json(
        routeProfileErrorBody(profileContext),
        profileContext.status,
      );
    }

    const meals = await services.meals.listMeals({
      ...query.value,
      userId: profileContext.value.subjectUserId,
      profileId: profileContext.value.profileId,
    });

    return context.json({ meals });
  });

  app.post("/api/meals/logs", async (context) => {
    const auth = context.get("auth");

    if (!auth.scopes.includes("meal:write")) {
      return context.json({ error: "missing-scope" }, 403);
    }

    const payload = await parseMealLogRequest(context.req, auth.userId);

    if (payload.ok === false) {
      return context.json(
        { error: payload.error, message: payload.message },
        payload.status,
      );
    }

    const profileContext = await resolveRouteProfileContext(
      services.profiles,
      auth.actorUserId,
      payload.value.profileId,
      services.authorization,
      "meal.write",
      "meal.log.upsert",
      context.req.header("x-request-id"),
    );

    if (profileContext.ok === false) {
      return context.json(
        routeProfileErrorBody(profileContext),
        profileContext.status,
      );
    }

    const result = await services.meals.upsertMealWithResult({
      ...payload.value,
      userId: profileContext.value.subjectUserId,
      profileId: profileContext.value.profileId,
    });
    const meal = result.meal;

    await services.audit.create({
      action: "meal.log.upsert",
      actor: auth.actor,
      target: {
        type: "meal",
        id: meal.id,
      },
      userId: profileContext.value.subjectUserId,
      profileId: profileContext.value.profileId,
      metadata: {
        calories: meal.totals.calories,
        ingredientCount: meal.ingredients.length,
        origin: meal.origin,
        photoCount: meal.photoCount,
        profileId: profileContext.value.profileId,
      },
    });

    return context.json({
      meal,
      mealId: result.mealId,
      operation: result.operation,
    });
  });

  app.delete("/api/meals/logs/:id", async (context) => {
    const auth = context.get("auth");

    if (!auth.scopes.includes("meal:write")) {
      return context.json({ error: "missing-scope" }, 403);
    }

    const profileContext = await resolveRouteProfileContext(
      services.profiles,
      auth.actorUserId,
      context.req.query("profileId"),
      services.authorization,
      "meal.delete",
      "meal.log.delete",
      context.req.header("x-request-id"),
    );

    if (profileContext.ok === false) {
      return context.json(
        routeProfileErrorBody(profileContext),
        profileContext.status,
      );
    }

    const meal = await services.meals.deleteMeal({
      deletedAt: new Date().toISOString(),
      id: context.req.param("id"),
      userId: profileContext.value.subjectUserId,
      profileId: profileContext.value.profileId,
    });

    if (meal === undefined) {
      return context.json({ error: "not-found" }, 404);
    }

    await services.audit.create({
      action: "meal.log.delete",
      actor: auth.actor,
      target: {
        type: "meal",
        id: meal.id,
      },
      userId: profileContext.value.subjectUserId,
      profileId: profileContext.value.profileId,
      metadata: {
        origin: meal.origin,
        profileId: profileContext.value.profileId,
      },
    });

    return context.json({ meal });
  });

  app.get("/api/meals/templates", async (context) => {
    const auth = context.get("auth");

    if (!auth.scopes.includes("meal:write")) {
      return context.json({ error: "missing-scope" }, 403);
    }

    const limit = parseLimit(context.req.query("limit"), 50, 200);

    if (limit.ok === false) {
      return context.json(
        { error: limit.error, message: limit.message },
        limit.status,
      );
    }

    const profileContext = await resolveRouteProfileContext(
      services.profiles,
      auth.actorUserId,
      context.req.query("profileId"),
      services.authorization,
      "meal.read",
      "meal.template.list",
      context.req.header("x-request-id"),
    );

    if (profileContext.ok === false) {
      return context.json(
        routeProfileErrorBody(profileContext),
        profileContext.status,
      );
    }

    const templates = await services.meals.listTemplates({
      limit: limit.value,
      userId: profileContext.value.subjectUserId,
      profileId: profileContext.value.profileId,
    });

    return context.json({ templates });
  });

  app.post("/api/meals/templates", async (context) => {
    const auth = context.get("auth");

    if (!auth.scopes.includes("meal:write")) {
      return context.json({ error: "missing-scope" }, 403);
    }

    const payload = await parseTemplateRequest(context.req, auth.userId);

    if (payload.ok === false) {
      return context.json(
        { error: payload.error, message: payload.message },
        payload.status,
      );
    }

    const profileContext = await resolveRouteProfileContext(
      services.profiles,
      auth.actorUserId,
      payload.value.profileId,
      services.authorization,
      "meal.write",
      "meal.template.upsert",
      context.req.header("x-request-id"),
    );

    if (profileContext.ok === false) {
      return context.json(
        routeProfileErrorBody(profileContext),
        profileContext.status,
      );
    }

    const template = await services.meals.upsertTemplate({
      ...payload.value,
      userId: profileContext.value.subjectUserId,
      profileId: profileContext.value.profileId,
    });

    await services.audit.create({
      action: "meal.template.upsert",
      actor: auth.actor,
      target: {
        type: "meal_template",
        id: template.id,
      },
      userId: profileContext.value.subjectUserId,
      profileId: profileContext.value.profileId,
      metadata: {
        calories: template.totals.calories,
        ingredientCount: template.ingredients.length,
        profileId: profileContext.value.profileId,
      },
    });

    return context.json({ template });
  });
}

async function parseMealLogRequest(
  request: JsonRequest,
  userId: string,
): Promise<ValidationResult<MealLogInput>> {
  try {
    return parseMealLogPayload(await request.json(), userId);
  } catch {
    return invalid("Request body must be valid JSON.");
  }
}

function parseMealLogPayload(
  value: unknown,
  userId: string,
): ValidationResult<MealLogInput> {
  if (!isRecord(value)) {
    return invalid("Payload must be an object.");
  }

  const clientMealId = boundedOptionalString(
    value.clientMealId,
    "clientMealId",
    120,
  );
  const timezone = boundedString(value.timezone, "timezone", 80);
  const occurredAt = mealOccurredAt(
    value,
    timezone.ok ? timezone.value : "Asia/Jerusalem",
  );
  const title = boundedString(value.title, "title", maxTitleChars);
  const mealType = boundedString(value.mealType, "mealType", maxMealTypeChars);
  const note = boundedOptionalString(value.note, "note", maxNoteChars);
  const totals = parseTotals(value.totals);
  const ingredients = parseIngredients(value.ingredients);
  const photoCount = integerRange(
    value.photoCount ?? 0,
    "photoCount",
    0,
    maxPhotoCount,
  );
  const estimateStatus = parseEstimateStatus(value.estimateStatus);
  const estimateConfidence = optionalNumberRange(
    value.estimateConfidence,
    "estimateConfidence",
    0,
    1,
  );
  const estimateSummary = boundedOptionalString(
    value.estimateSummary,
    "estimateSummary",
    maxEstimateSummaryChars,
  );

  if (clientMealId.ok === false) return clientMealId;
  if (timezone.ok === false) return timezone;
  if (occurredAt.ok === false) return occurredAt;
  if (title.ok === false) return title;
  if (mealType.ok === false) return mealType;
  if (note.ok === false) return note;
  if (totals.ok === false) return totals;
  if (ingredients.ok === false) return ingredients;
  if (photoCount.ok === false) return photoCount;
  if (estimateStatus.ok === false) return estimateStatus;
  if (estimateConfidence.ok === false) return estimateConfidence;
  if (estimateSummary.ok === false) return estimateSummary;

  const resolvedClientMealId = clientMealId.value;
  const idempotencyKey =
    typeof value.idempotencyKey === "string" &&
    value.idempotencyKey.trim().length > 0
      ? value.idempotencyKey.trim()
      : resolvedClientMealId === undefined
        ? undefined
        : `ios-meal:${resolvedClientMealId}`;

  if (idempotencyKey === undefined) {
    return invalid("Payload clientMealId or idempotencyKey is required.");
  }

  if (idempotencyKey.length > 200) {
    return invalid("Payload idempotencyKey must be at most 200 characters.");
  }

  return {
    ok: true,
    value: {
      userId,
      profileId: nonEmptyString(value.profileId),
      idempotencyKey,
      clientMealId: resolvedClientMealId,
      occurredAt: occurredAt.value,
      timezone: timezone.value,
      title: title.value,
      mealType: mealType.value,
      note: note.value,
      totals: totals.value,
      ingredients: ingredients.value,
      photoCount: photoCount.value,
      estimateStatus: estimateStatus.value,
      estimateConfidence: estimateConfidence.value,
      estimateSummary: estimateSummary.value,
      origin: "ios",
      provenance: {
        client: "ios",
        version: 1,
      },
    },
  };
}

async function parseTemplateRequest(
  request: JsonRequest,
  userId: string,
): Promise<ValidationResult<SavedMealTemplateInput>> {
  try {
    return parseTemplatePayload(await request.json(), userId);
  } catch {
    return invalid("Request body must be valid JSON.");
  }
}

function parseTemplatePayload(
  value: unknown,
  userId: string,
): ValidationResult<SavedMealTemplateInput> {
  if (!isRecord(value)) {
    return invalid("Payload must be an object.");
  }

  const clientTemplateId = boundedString(
    value.clientTemplateId,
    "clientTemplateId",
    120,
  );
  const title = boundedString(value.title, "title", maxTitleChars);
  const mealType = boundedString(value.mealType, "mealType", maxMealTypeChars);
  const note = boundedOptionalString(value.note, "note", maxNoteChars);
  const totals = parseTotals(value.totals);
  const ingredients = parseIngredients(value.ingredients);
  const usageCount = integerRange(
    value.usageCount ?? 0,
    "usageCount",
    0,
    100_000,
  );
  const lastUsedAt = isoString(value.lastUsedAt, "lastUsedAt");

  if (clientTemplateId.ok === false) return clientTemplateId;
  if (title.ok === false) return title;
  if (mealType.ok === false) return mealType;
  if (note.ok === false) return note;
  if (totals.ok === false) return totals;
  if (ingredients.ok === false) return ingredients;
  if (usageCount.ok === false) return usageCount;
  if (lastUsedAt.ok === false) return lastUsedAt;

  return {
    ok: true,
    value: {
      userId,
      profileId: nonEmptyString(value.profileId),
      clientTemplateId: clientTemplateId.value,
      title: title.value,
      mealType: mealType.value,
      note: note.value,
      totals: totals.value,
      ingredients: ingredients.value,
      usageCount: usageCount.value,
      lastUsedAt: lastUsedAt.value,
    },
  };
}

function parseMealListQuery(input: {
  date: string | undefined;
  from: string | undefined;
  limit: string | undefined;
  profileId: string | undefined;
  timezone: string | undefined;
  to: string | undefined;
}): ValidationResult<{
  range?: Readonly<{ from: string; to: string }>;
  profileId?: string | undefined;
  limit?: number;
}> {
  const limit = parseLimit(input.limit, 250, 1_000);

  if (limit.ok === false) {
    return limit;
  }

  if (input.date !== undefined) {
    if (input.from !== undefined || input.to !== undefined) {
      return invalid("Query must provide either date or from/to, not both.");
    }

    try {
      const range = normalizeMcpDateRange({
        date: input.date,
        timezone: input.timezone ?? "Asia/Jerusalem",
      });

      return {
        ok: true,
        value: {
          limit: limit.value,
          profileId: input.profileId,
          range: {
            from: range.from,
            to: range.to,
          },
        },
      };
    } catch (error) {
      return invalid(
        error instanceof Error ? error.message : "Invalid local food date.",
      );
    }
  }

  if (input.from === undefined && input.to === undefined) {
    return {
      ok: true,
      value: {
        limit: limit.value,
        profileId: input.profileId,
      },
    };
  }

  const from = isoString(input.from, "from");
  const to = isoString(input.to, "to");

  if (from.ok === false) {
    return from;
  }

  if (to.ok === false) {
    return to;
  }

  if (Date.parse(from.value) >= Date.parse(to.value)) {
    return invalid("Query from must be before to.");
  }

  return {
    ok: true,
    value: {
      limit: limit.value,
      profileId: input.profileId,
      range: {
        from: from.value,
        to: to.value,
      },
    },
  };
}

function parseTotals(value: unknown): ValidationResult<MealMacroTotals> {
  if (!isRecord(value)) {
    return invalid("Payload totals must be an object.");
  }

  const calories = finiteNonnegativeNumber(value.calories, "totals.calories");
  const proteinGrams = finiteNonnegativeNumber(
    value.proteinGrams,
    "totals.proteinGrams",
  );
  const carbsGrams = finiteNonnegativeNumber(
    value.carbsGrams,
    "totals.carbsGrams",
  );
  const fatGrams = finiteNonnegativeNumber(value.fatGrams, "totals.fatGrams");
  const fiberGrams = finiteNonnegativeNumber(
    value.fiberGrams,
    "totals.fiberGrams",
  );

  if (calories.ok === false) return calories;
  if (proteinGrams.ok === false) return proteinGrams;
  if (carbsGrams.ok === false) return carbsGrams;
  if (fatGrams.ok === false) return fatGrams;
  if (fiberGrams.ok === false) return fiberGrams;

  return {
    ok: true,
    value: {
      calories: calories.value,
      proteinGrams: proteinGrams.value,
      carbsGrams: carbsGrams.value,
      fatGrams: fatGrams.value,
      fiberGrams: fiberGrams.value,
    },
  };
}

function parseIngredients(
  value: unknown,
): ValidationResult<readonly MealIngredientInput[]> {
  if (value === undefined) {
    return { ok: true, value: [] };
  }

  if (!Array.isArray(value)) {
    return invalid("Payload ingredients must be an array.");
  }

  if (value.length > maxIngredients) {
    return payloadTooLarge(
      `At most ${maxIngredients} ingredients can be saved.`,
    );
  }

  const ingredients: MealIngredientInput[] = [];

  for (const [index, ingredient] of value.entries()) {
    if (!isRecord(ingredient)) {
      return invalid(`Ingredient ${index + 1} must be an object.`);
    }

    const clientIngredientId = boundedOptionalString(
      ingredient.clientIngredientId,
      `ingredients[${index}].clientIngredientId`,
      120,
    );
    const name = boundedString(
      ingredient.name,
      `ingredients[${index}].name`,
      maxIngredientNameChars,
    );
    const quantity = finiteNonnegativeNumber(
      ingredient.quantity,
      `ingredients[${index}].quantity`,
    );
    const unit = boundedString(
      ingredient.unit,
      `ingredients[${index}].unit`,
      maxIngredientUnitChars,
    );
    const grams = optionalNumberRange(
      ingredient.grams,
      `ingredients[${index}].grams`,
      0,
      100_000,
    );
    const totals = parseTotals(ingredient.totals);

    if (clientIngredientId.ok === false) return clientIngredientId;
    if (name.ok === false) return name;
    if (quantity.ok === false) return quantity;
    if (unit.ok === false) return unit;
    if (grams.ok === false) return grams;
    if (totals.ok === false) return totals;

    ingredients.push({
      clientIngredientId: clientIngredientId.value,
      name: name.value,
      quantity: quantity.value,
      unit: unit.value,
      grams: grams.value,
      totals: totals.value,
    });
  }

  return {
    ok: true,
    value: ingredients,
  };
}

function parseEstimateStatus(
  value: unknown,
): ValidationResult<MealLogInput["estimateStatus"]> {
  if (
    value === "manual" ||
    value === "ai_estimated" ||
    value === "estimation_failed"
  ) {
    return {
      ok: true,
      value,
    };
  }

  return invalid(
    "Payload estimateStatus must be manual, ai_estimated, or estimation_failed.",
  );
}

function parseLimit(
  value: string | undefined,
  defaultValue: number,
  maxValue: number,
): ValidationResult<number> {
  if (value === undefined) {
    return { ok: true, value: defaultValue };
  }

  return integerRange(value, "limit", 1, maxValue);
}

function integerRange(
  value: unknown,
  name: string,
  min: number,
  max: number,
): ValidationResult<number> {
  const parsed = typeof value === "number" ? value : Number(value);

  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return invalid(`Payload ${name} must be an integer from ${min} to ${max}.`);
  }

  return { ok: true, value: parsed };
}

function finiteNonnegativeNumber(
  value: unknown,
  name: string,
): ValidationResult<number> {
  if (value === undefined || value === null) {
    return invalid(`Payload ${name} is required.`);
  }

  const parsed = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100_000) {
    return invalid(`Payload ${name} must be a number from 0 to 100000.`);
  }

  return { ok: true, value: parsed };
}

function optionalNumberRange(
  value: unknown,
  name: string,
  min: number,
  max: number,
): ValidationResult<number | undefined> {
  if (value === undefined || value === null) {
    return { ok: true, value: undefined };
  }

  const parsed = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    return invalid(`Payload ${name} must be a number from ${min} to ${max}.`);
  }

  return { ok: true, value: parsed };
}

function boundedString(
  value: unknown,
  name: string,
  maxChars: number,
): ValidationResult<string> {
  if (typeof value !== "string") {
    return invalid(`Payload ${name} is required.`);
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return invalid(`Payload ${name} is required.`);
  }

  if (trimmed.length > maxChars) {
    return invalid(`Payload ${name} must be at most ${maxChars} characters.`);
  }

  return { ok: true, value: trimmed };
}

function boundedOptionalString(
  value: unknown,
  name: string,
  maxChars: number,
): ValidationResult<string | undefined> {
  if (value === undefined || value === null) {
    return { ok: true, value: undefined };
  }

  if (typeof value !== "string") {
    return invalid(`Payload ${name} must be a string.`);
  }

  const trimmed = value.trim();

  if (trimmed.length > maxChars) {
    return invalid(`Payload ${name} must be at most ${maxChars} characters.`);
  }

  return { ok: true, value: trimmed.length === 0 ? undefined : trimmed };
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function isoString(value: unknown, name: string): ValidationResult<string> {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    return invalid(`Payload ${name} must be a valid ISO timestamp.`);
  }

  return { ok: true, value: new Date(value).toISOString() };
}

function mealOccurredAt(
  value: Record<string, unknown>,
  timezone: string,
): ValidationResult<string> {
  const hasOccurredAt =
    value.occurredAt !== undefined && value.occurredAt !== null;
  const hasLocalFoodDate =
    value.localFoodDate !== undefined && value.localFoodDate !== null;

  if (hasOccurredAt && hasLocalFoodDate) {
    return invalid(
      "Payload must provide either occurredAt or localFoodDate, not both.",
    );
  }

  if (hasLocalFoodDate) {
    const localFoodDate = boundedString(
      value.localFoodDate,
      "localFoodDate",
      10,
    );
    const localTime = boundedOptionalString(value.localTime, "localTime", 5);

    if (localFoodDate.ok === false) return localFoodDate;
    if (localTime.ok === false) return localTime;

    try {
      return {
        ok: true,
        value: localFoodDateTimeToUtc({
          localFoodDate: localFoodDate.value,
          localTime: localTime.value,
          timezone,
        }),
      };
    } catch (error) {
      return invalid(
        error instanceof Error ? error.message : "Invalid local food date.",
      );
    }
  }

  return isoString(value.occurredAt, "occurredAt");
}

function invalid(message: string): ValidationResult<never> {
  return {
    ok: false,
    error: "invalid-payload",
    message,
    status: 400,
  };
}

function payloadTooLarge(message: string): ValidationResult<never> {
  return {
    ok: false,
    error: "payload-too-large",
    message,
    status: 413,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

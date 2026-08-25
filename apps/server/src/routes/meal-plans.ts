import type { Context, Hono } from "hono";
import type { ServerEnv } from "../auth.js";
import type { AuditPort } from "../services/audit.js";
import {
  MealPlanServiceError,
  type MealPlanAccessContext,
  type MealPlanService,
  type PlannedMealDraft,
  type PlannedMealIngredientDraft,
} from "../services/meal-plans.js";
import type { ProfileContext, ProfileService } from "../services/profiles.js";
import { resolveRouteProfileContext } from "./profile-context.js";

export type MealPlanRouteServices = Readonly<{
  audit: AuditPort;
  mealPlans: MealPlanService;
  profiles: ProfileService;
}>;

export function registerMealPlanRoutes(
  app: Hono<ServerEnv>,
  services: MealPlanRouteServices,
): void {
  app.get("/api/meals/plans", async (context) => {
    const auth = context.get("auth");
    if (!auth.scopes.includes("meal:write")) {
      return context.json({ error: "missing-scope" }, 403);
    }
    const profile = await routeProfile(
      services.profiles,
      auth.actorUserId,
      context.req.query("profileId"),
    );
    if (profile.ok === false) {
      return context.json({ error: profile.error }, profile.status);
    }
    const access = mealPlanAccess(profile.value);
    const date = context.req.query("date");
    const from = context.req.query("from");
    const to = context.req.query("to");
    try {
      if (date !== undefined) {
        const result = await services.mealPlans.getDailyPlan({
          access,
          localFoodDate: date,
        });
        return result === undefined
          ? context.json({ error: "MEAL_PLAN_NOT_FOUND" }, 404)
          : context.json(result);
      }
      if (from === undefined || to === undefined) {
        return context.json(
          { error: "invalid-payload", message: "Provide date or from and to." },
          400,
        );
      }
      return context.json({
        plans: await services.mealPlans.getPlanRange({
          access,
          fromLocalFoodDate: from,
          toLocalFoodDate: to,
          includeArchived: context.req.query("includeArchived") === "true",
        }),
      });
    } catch (error) {
      return mealPlanError(context, error);
    }
  });

  app.post("/api/meals/plans", async (context) => {
    const prepared = await mutationContext(context, services);
    if (prepared.ok === false) return prepared.response;
    const payload = await jsonObject(context);
    if (payload.ok === false) return payload.response;
    const meals = parseMealDrafts(payload.value.meals);
    if (meals.ok === false) return context.json(meals.error, 400);
    try {
      const result = await services.mealPlans.upsertDailyPlan({
        access: prepared.access,
        localFoodDate: requiredString(payload.value.localFoodDate),
        timezone: requiredString(payload.value.timezone),
        status: optionalString(payload.value.status) as
          | "draft"
          | "active"
          | "completed"
          | "archived"
          | undefined,
        title: optionalString(payload.value.title),
        note: optionalString(payload.value.note),
        meals: meals.value,
        idempotencyKey: requiredString(payload.value.idempotencyKey),
        expectedVersion: optionalNumber(payload.value.expectedVersion),
        confirmReplace: payload.value.confirmReplace === true,
      });
      await auditPlan(
        services.audit,
        prepared.profile,
        "meal.plan.upsert",
        result.plan,
        {
          mealCount: result.plan.meals.length,
        },
      );
      return context.json(result);
    } catch (error) {
      return mealPlanError(context, error);
    }
  });

  app.post("/api/meals/plans/copy", async (context) => {
    const prepared = await mutationContext(context, services);
    if (prepared.ok === false) return prepared.response;
    const payload = await jsonObject(context);
    if (payload.ok === false) return payload.response;
    try {
      const result = await services.mealPlans.copyDailyPlan({
        access: prepared.access,
        sourceLocalFoodDate: requiredString(payload.value.sourceLocalFoodDate),
        destinationLocalFoodDate: requiredString(
          payload.value.destinationLocalFoodDate,
        ),
        timezone: requiredString(payload.value.timezone),
        idempotencyKey: requiredString(payload.value.idempotencyKey),
        confirmReplace: payload.value.confirmReplace === true,
        expectedDestinationVersion: optionalNumber(
          payload.value.expectedDestinationVersion,
        ),
      });
      await auditPlan(
        services.audit,
        prepared.profile,
        "meal.plan.copy",
        result.plan,
        {
          sourceLocalFoodDate: payload.value.sourceLocalFoodDate,
        },
      );
      return context.json(result);
    } catch (error) {
      return mealPlanError(context, error);
    }
  });

  app.post("/api/meals/plans/copy-range", async (context) => {
    const prepared = await mutationContext(context, services);
    if (prepared.ok === false) return prepared.response;
    const payload = await jsonObject(context);
    if (payload.ok === false) return payload.response;
    try {
      const plans = await services.mealPlans.copyPlanRange({
        access: prepared.access,
        sourceFromLocalFoodDate: requiredString(
          payload.value.sourceFromLocalFoodDate,
        ),
        sourceToLocalFoodDate: requiredString(
          payload.value.sourceToLocalFoodDate,
        ),
        destinationStartLocalFoodDate: requiredString(
          payload.value.destinationStartLocalFoodDate,
        ),
        timezone: requiredString(payload.value.timezone),
        idempotencyKey: requiredString(payload.value.idempotencyKey),
        confirmReplace: payload.value.confirmReplace === true,
      });
      await services.audit.create({
        action: "meal.plan.copy_range",
        actor: { type: "user", id: prepared.access.actorUserId },
        target: {
          type: "daily_meal_plan_range",
          id: requiredString(payload.value.idempotencyKey),
        },
        userId: prepared.access.subjectUserId,
        profileId: prepared.access.profileId,
        metadata: {
          planCount: plans.length,
          profileId: prepared.access.profileId,
        },
      });
      return context.json({ plans });
    } catch (error) {
      return mealPlanError(context, error);
    }
  });

  app.post("/api/meals/plans/clear-future", async (context) => {
    const prepared = await mutationContext(context, services);
    if (prepared.ok === false) return prepared.response;
    const payload = await jsonObject(context);
    if (payload.ok === false) return payload.response;
    try {
      const plans = await services.mealPlans.clearFuturePlans({
        access: prepared.access,
        fromLocalFoodDate: requiredString(payload.value.fromLocalFoodDate),
        confirmClear: payload.value.confirmClear === true,
      });
      await services.audit.create({
        action: "meal.plan.clear_future",
        actor: { type: "user", id: prepared.access.actorUserId },
        target: {
          type: "daily_meal_plan_range",
          id: requiredString(payload.value.fromLocalFoodDate),
        },
        userId: prepared.access.subjectUserId,
        profileId: prepared.access.profileId,
        metadata: {
          planCount: plans.length,
          profileId: prepared.access.profileId,
        },
      });
      return context.json({ plans });
    } catch (error) {
      return mealPlanError(context, error);
    }
  });

  app.post("/api/meals/plans/:date/archive", async (context) => {
    const prepared = await mutationContext(context, services);
    if (prepared.ok === false) return prepared.response;
    const payload = await jsonObject(context);
    if (payload.ok === false) return payload.response;
    try {
      const result = await services.mealPlans.archivePlan({
        access: prepared.access,
        localFoodDate: context.req.param("date"),
        expectedVersion: requiredNumber(payload.value.expectedVersion),
      });
      await auditPlan(
        services.audit,
        prepared.profile,
        "meal.plan.archive",
        result.plan,
      );
      return context.json(result);
    } catch (error) {
      return mealPlanError(context, error);
    }
  });

  app.delete("/api/meals/plans/:date", async (context) => {
    const prepared = await mutationContext(context, services);
    if (prepared.ok === false) return prepared.response;
    try {
      const deleted = await services.mealPlans.deleteDraftPlan({
        access: prepared.access,
        localFoodDate: context.req.param("date"),
        expectedVersion: requiredNumber(context.req.query("expectedVersion")),
        confirmDelete: context.req.query("confirmDelete") === "true",
      });
      await services.audit.create({
        action: "meal.plan.delete",
        actor: { type: "user", id: prepared.access.actorUserId },
        target: { type: "daily_meal_plan", id: context.req.param("date") },
        userId: prepared.access.subjectUserId,
        profileId: prepared.access.profileId,
        metadata: { profileId: prepared.access.profileId },
      });
      return context.json({ deleted });
    } catch (error) {
      return mealPlanError(context, error);
    }
  });

  app.get("/api/meals/planned/:id", async (context) => {
    const auth = context.get("auth");
    if (!auth.scopes.includes("meal:write")) {
      return context.json({ error: "missing-scope" }, 403);
    }
    const profile = await routeProfile(
      services.profiles,
      auth.actorUserId,
      context.req.query("profileId"),
    );
    if (profile.ok === false)
      return context.json({ error: profile.error }, profile.status);
    try {
      const result = await services.mealPlans.getPlannedMeal({
        access: mealPlanAccess(profile.value),
        plannedMealId: context.req.param("id"),
      });
      return result === undefined
        ? context.json({ error: "PLANNED_MEAL_NOT_FOUND" }, 404)
        : context.json(result);
    } catch (error) {
      return mealPlanError(context, error);
    }
  });

  app.patch("/api/meals/planned/:id", async (context) => {
    const prepared = await mutationContext(context, services);
    if (prepared.ok === false) return prepared.response;
    const payload = await jsonObject(context);
    if (payload.ok === false) return payload.response;
    const patch = parseMealDraft(payload.value.patch, false);
    if (patch.ok === false) return context.json(patch.error, 400);
    try {
      const result = await services.mealPlans.updatePlannedMeal({
        access: prepared.access,
        plannedMealId: context.req.param("id"),
        expectedPlanVersion: requiredNumber(payload.value.expectedPlanVersion),
        expectedMealVersion: requiredNumber(payload.value.expectedMealVersion),
        patch: patch.value,
      });
      await auditPlan(
        services.audit,
        prepared.profile,
        "meal.plan.meal_update",
        result.plan,
        {
          plannedMealId: result.plannedMeal.id,
          status: result.plannedMeal.status,
        },
      );
      return context.json(result);
    } catch (error) {
      return mealPlanError(context, error);
    }
  });

  app.post("/api/meals/planned/:id/replace", async (context) => {
    const prepared = await mutationContext(context, services);
    if (prepared.ok === false) return prepared.response;
    const payload = await jsonObject(context);
    if (payload.ok === false) return payload.response;
    const replacement = parseMealDraft(payload.value.replacement, true);
    if (replacement.ok === false) return context.json(replacement.error, 400);
    try {
      const result = await services.mealPlans.replacePlannedMeal({
        access: prepared.access,
        plannedMealId: context.req.param("id"),
        expectedPlanVersion: requiredNumber(payload.value.expectedPlanVersion),
        expectedMealVersion: requiredNumber(payload.value.expectedMealVersion),
        replacement: replacement.value as PlannedMealDraft,
        reason: optionalString(payload.value.reason),
        confirmReplace: payload.value.confirmReplace === true,
      });
      await auditPlan(
        services.audit,
        prepared.profile,
        "meal.plan.replace",
        result.plan,
        {
          plannedMealId: result.originalMeal.id,
          replacementMealId: result.replacementMeal.id,
        },
      );
      return context.json(result);
    } catch (error) {
      return mealPlanError(context, error);
    }
  });

  app.post("/api/meals/planned/:id/status", async (context) => {
    const prepared = await mutationContext(context, services);
    if (prepared.ok === false) return prepared.response;
    const payload = await jsonObject(context);
    if (payload.ok === false) return payload.response;
    try {
      const result = await services.mealPlans.markPlannedMealStatus({
        access: prepared.access,
        plannedMealId: context.req.param("id"),
        status: requiredString(payload.value.status) as
          | "planned"
          | "skipped"
          | "unconfirmed"
          | "not_confirmed",
        expectedPlanVersion: requiredNumber(payload.value.expectedPlanVersion),
        expectedMealVersion: requiredNumber(payload.value.expectedMealVersion),
        coachNote: optionalString(payload.value.coachNote),
      });
      await auditPlan(
        services.audit,
        prepared.profile,
        "meal.plan.status",
        result.plan,
        {
          plannedMealId: result.plannedMeal.id,
          status: result.plannedMeal.status,
        },
      );
      return context.json(result);
    } catch (error) {
      return mealPlanError(context, error);
    }
  });

  app.post("/api/meals/planned/:id/convert", async (context) => {
    const prepared = await mutationContext(context, services);
    if (prepared.ok === false) return prepared.response;
    const payload = await jsonObject(context);
    if (payload.ok === false) return payload.response;
    const actualIngredients = parseIngredientDrafts(
      payload.value.actualIngredients,
    );
    if (actualIngredients.ok === false)
      return context.json(actualIngredients.error, 400);
    try {
      const result = await services.mealPlans.convertPlannedMealToLog({
        access: prepared.access,
        plannedMealId: context.req.param("id"),
        status: requiredString(payload.value.status) as
          | "confirmed"
          | "eaten_as_planned"
          | "partially_eaten"
          | "replaced",
        expectedPlanVersion: requiredNumber(payload.value.expectedPlanVersion),
        expectedMealVersion: requiredNumber(payload.value.expectedMealVersion),
        actualIngredients: actualIngredients.value,
        actualTitle: optionalString(payload.value.actualTitle),
        actualDescription: optionalString(payload.value.actualDescription),
        replacementReason: optionalString(payload.value.replacementReason),
        idempotencyKey: optionalString(payload.value.idempotencyKey),
        origin: (optionalString(payload.value.origin) ?? "ios") as
          | "ios"
          | "web"
          | "mcp",
      });
      await auditPlan(
        services.audit,
        prepared.profile,
        "meal.plan.convert",
        result.plan,
        {
          plannedMealId: result.plannedMeal.id,
          mealLogId: result.mealLog.id,
          status: result.plannedMeal.status,
          idempotentReplay: result.idempotentReplay,
        },
      );
      return context.json(result);
    } catch (error) {
      return mealPlanError(context, error);
    }
  });

  app.get("/api/meals/plans/:date/comparison", async (context) => {
    const auth = context.get("auth");
    if (!auth.scopes.includes("meal:write")) {
      return context.json({ error: "missing-scope" }, 403);
    }
    const profile = await routeProfile(
      services.profiles,
      auth.actorUserId,
      context.req.query("profileId"),
    );
    if (profile.ok === false)
      return context.json({ error: profile.error }, profile.status);
    try {
      const comparison = await services.mealPlans.comparePlanToActual({
        access: mealPlanAccess(profile.value),
        localFoodDate: context.req.param("date"),
      });
      return comparison === undefined
        ? context.json({ error: "MEAL_PLAN_NOT_FOUND" }, 404)
        : context.json({ comparison });
    } catch (error) {
      return mealPlanError(context, error);
    }
  });
}

function mealPlanAccess(profile: ProfileContext): MealPlanAccessContext {
  return {
    actorUserId: profile.actorUserId,
    subjectUserId: profile.subjectUserId,
    profileId: profile.profileId,
    permissions: profile.permissions,
  };
}

async function mutationContext(
  context: Context<ServerEnv>,
  services: MealPlanRouteServices,
): Promise<
  | Readonly<{
      ok: true;
      access: MealPlanAccessContext;
      profile: ProfileContext;
    }>
  | Readonly<{ ok: false; response: Response }>
> {
  const auth = context.get("auth");
  if (!auth.scopes.includes("meal:write")) {
    return {
      ok: false,
      response: context.json({ error: "missing-scope" }, 403),
    };
  }
  const payload = await safeJson(context);
  const profileId = isRecord(payload)
    ? optionalString(payload.profileId)
    : undefined;
  const profile = await routeProfile(
    services.profiles,
    auth.actorUserId,
    profileId,
  );
  if (profile.ok === false) {
    return {
      ok: false,
      response: context.json({ error: profile.error }, profile.status),
    };
  }
  return {
    ok: true,
    access: mealPlanAccess(profile.value),
    profile: profile.value,
  };
}

async function routeProfile(
  profiles: ProfileService,
  actorUserId: string,
  profileId: string | undefined,
) {
  return resolveRouteProfileContext(profiles, actorUserId, profileId);
}

async function jsonObject(
  context: Context<ServerEnv>,
): Promise<
  | Readonly<{ ok: true; value: Record<string, unknown> }>
  | Readonly<{ ok: false; response: Response }>
> {
  const value = await safeJson(context);
  return isRecord(value)
    ? { ok: true, value }
    : {
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

async function safeJson(context: Context<ServerEnv>): Promise<unknown> {
  try {
    return await context.req.json();
  } catch {
    return undefined;
  }
}

function parseMealDrafts(
  value: unknown,
): ParseResult<readonly PlannedMealDraft[] | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  if (!Array.isArray(value)) return invalidParse("meals must be an array.");
  const drafts: PlannedMealDraft[] = [];
  for (const item of value) {
    const parsed = parseMealDraft(item, true);
    if (parsed.ok === false) return parsed;
    drafts.push(parsed.value as PlannedMealDraft);
  }
  return { ok: true, value: drafts };
}

function parseMealDraft(
  value: unknown,
  required: boolean,
): ParseResult<Partial<PlannedMealDraft>> {
  if (!isRecord(value)) return invalidParse("planned meal must be an object.");
  const ingredients = parseIngredientDrafts(value.ingredients);
  if (ingredients.ok === false) return ingredients;
  if (
    required &&
    (typeof value.title !== "string" || typeof value.mealType !== "string")
  ) {
    return invalidParse("planned meal requires title and mealType.");
  }
  return {
    ok: true,
    value: compactObject({
      id: optionalString(value.id),
      mealSlotId: optionalString(value.mealSlotId),
      mealType: optionalString(value.mealType),
      plannedTime: optionalString(value.plannedTime),
      title: optionalString(value.title),
      description: optionalString(value.description),
      instructions: optionalString(value.instructions),
      status: optionalString(value.status),
      linkedMealLogId: optionalString(value.linkedMealLogId),
      replacementReason: optionalString(value.replacementReason),
      coachNote: optionalString(value.coachNote),
      alternativeGroup: optionalString(value.alternativeGroup),
      sortOrder: optionalNumber(value.sortOrder),
      ingredients: ingredients.value,
      version: optionalNumber(value.version),
    }) as Partial<PlannedMealDraft>,
  };
}

function parseIngredientDrafts(
  value: unknown,
): ParseResult<readonly PlannedMealIngredientDraft[] | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  if (!Array.isArray(value))
    return invalidParse("ingredients must be an array.");
  const ingredients: PlannedMealIngredientDraft[] = [];
  for (const item of value) {
    if (!isRecord(item) || !isRecord(item.totals)) {
      return invalidParse("ingredient and totals must be objects.");
    }
    if (typeof item.displayName !== "string" || typeof item.unit !== "string") {
      return invalidParse("ingredient requires displayName and unit.");
    }
    try {
      ingredients.push({
        id: optionalString(item.id),
        foodReferenceType: optionalString(item.foodReferenceType),
        foodReferenceId: optionalString(item.foodReferenceId),
        displayName: item.displayName,
        quantity: requiredNumber(item.quantity),
        unit: item.unit,
        grams: optionalNumber(item.grams),
        totals: {
          calories: requiredNumber(item.totals.calories),
          proteinGrams: requiredNumber(item.totals.proteinGrams),
          carbsGrams: requiredNumber(item.totals.carbsGrams),
          fatGrams: requiredNumber(item.totals.fatGrams),
          fiberGrams: requiredNumber(item.totals.fiberGrams),
        },
        alternativeGroup: optionalString(item.alternativeGroup),
        notes: optionalString(item.notes),
        sortOrder: optionalNumber(item.sortOrder),
      });
    } catch {
      return invalidParse(
        "ingredient quantities and nutrition must be numeric.",
      );
    }
  }
  return { ok: true, value: ingredients };
}

type ParseResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: { error: string; message: string } }>;

function invalidParse(message: string): ParseResult<never> {
  return { ok: false, error: { error: "invalid-payload", message } };
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new MealPlanServiceError(
      "MEAL_PLAN_INVALID_INPUT",
      "Required string is missing.",
    );
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function requiredNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new MealPlanServiceError(
      "MEAL_PLAN_INVALID_INPUT",
      "Required number is missing.",
    );
  }
  return parsed;
}

function optionalNumber(value: unknown): number | undefined {
  return value === undefined || value === null || value === ""
    ? undefined
    : requiredNumber(value);
}

function compactObject(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, nested]) => nested !== undefined),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function auditPlan(
  audit: AuditPort,
  profile: ProfileContext,
  action: string,
  plan: { id: string; version: number; localFoodDate: string },
  metadata: Readonly<Record<string, unknown>> = {},
): Promise<void> {
  await audit.create({
    action,
    actor: { type: "user", id: profile.actorUserId },
    target: { type: "daily_meal_plan", id: plan.id },
    userId: profile.subjectUserId,
    profileId: profile.profileId,
    metadata: {
      ...metadata,
      localFoodDate: plan.localFoodDate,
      profileId: profile.profileId,
      version: plan.version,
    },
  });
}

function mealPlanError(context: Context<ServerEnv>, error: unknown): Response {
  if (!(error instanceof MealPlanServiceError)) throw error;
  const status =
    error.code === "MEAL_PLAN_PERMISSION_DENIED"
      ? 403
      : error.code === "MEAL_PLAN_NOT_FOUND" ||
          error.code === "PLANNED_MEAL_NOT_FOUND"
        ? 404
        : error.code === "MEAL_PLAN_VERSION_CONFLICT" ||
            error.code === "MEAL_PLAN_ALREADY_EXISTS" ||
            error.code === "MEAL_PLAN_CONFIRMATION_REQUIRED"
          ? 409
          : 400;
  return context.json(
    { error: error.code, message: error.message, details: error.details },
    status,
  );
}

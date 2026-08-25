import type { CoachGoal, CoachMealSlot, CoachProfileInput } from "@fitness/db";
import { calculateNutritionTargets } from "@fitness/domain";
import type { Hono } from "hono";
import type { ServerEnv } from "../auth.js";
import type { CoachService } from "../services/coach.js";
import type { AuditPort } from "../services/audit.js";
import type { AuthorizationService } from "../services/authorization.js";
import type { ProfileService } from "../services/profiles.js";
import type { TargetPlanService } from "../services/target-plans.js";
import {
  resolveRouteProfileContext,
  routeProfileErrorBody,
} from "./profile-context.js";

export type CoachRoutesServices = Readonly<{
  audit: AuditPort;
  authorization: AuthorizationService;
  coach: CoachService;
  profiles: ProfileService;
  targetPlans: TargetPlanService;
}>;

type JsonRequest = Readonly<{
  json(): Promise<unknown>;
}>;

type ValidationResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; status: 400; message: string }>;

const maxSlotCount = 12;

export function registerCoachRoutes(
  app: Hono<ServerEnv>,
  services: CoachRoutesServices,
): void {
  app.get("/api/coach/profile", async (context) => {
    const auth = context.get("auth");

    if (!hasAnyScope(auth.scopes, ["coach:read", "coach:write"])) {
      return context.json({ error: "missing-scope" }, 403);
    }

    const profileContext = await resolveRouteProfileContext(
      services.profiles,
      auth.actorUserId,
      context.req.query("profileId"),
      services.authorization,
      "target.read",
      "coach.profile.read",
      context.req.header("x-request-id"),
    );

    if (profileContext.ok === false) {
      return context.json(
        routeProfileErrorBody(profileContext),
        profileContext.status,
      );
    }

    const storedProfile = await services.coach.getProfile(
      profileContext.value.subjectUserId,
      profileContext.value.profileId,
    );
    const activePlan = await services.targetPlans.getActivePlan(
      profileContext.value,
    );
    const profile =
      storedProfile === undefined
        ? undefined
        : overlayActiveTargets(storedProfile, activePlan?.targets);

    return context.json({
      profile: profile ?? null,
      targetPlan: activePlan ?? null,
    });
  });

  app.put("/api/coach/profile", async (context) => {
    const auth = context.get("auth");

    if (!auth.scopes.includes("coach:write")) {
      return context.json({ error: "missing-scope" }, 403);
    }

    const payload = await parseProfileRequest(context.req, auth.userId);

    if (payload.ok === false) {
      return context.json(
        { error: "invalid-payload", message: payload.message },
        payload.status,
      );
    }

    const profileContext = await resolveRouteProfileContext(
      services.profiles,
      auth.actorUserId,
      payload.value.profileId,
      services.authorization,
      "target.write",
      "coach.profile.update",
      context.req.header("x-request-id"),
    );

    if (profileContext.ok === false) {
      return context.json(
        routeProfileErrorBody(profileContext),
        profileContext.status,
      );
    }

    const profile = await services.coach.upsertProfile({
      ...payload.value,
      userId: profileContext.value.subjectUserId,
      profileId: profileContext.value.profileId,
    });
    const targetPlan = await services.targetPlans.activateCompatibility(
      profileContext.value,
      {
        goal: profile.goal,
        calculationMode: "automatic",
        reason: "Updated through the deprecated coach profile target adapter.",
        targets: {
          maintenanceCalories: profile.targets.maintenanceCalories,
          selectedCalories: profile.targets.selectedCalories,
          proteinGrams: profile.targets.proteinGrams,
          carbohydratesGrams: profile.targets.carbsGrams,
          fatGrams: profile.targets.fatGrams,
          fiberGrams: profile.targets.fiberGrams,
          steps: profile.estimatedStepsPerDay,
        },
      },
    );

    await services.audit.create({
      action: "coach.profile.upsert",
      actor: auth.actor,
      target: {
        type: "coach_profile",
        id: profileContext.value.profileId,
      },
      userId: profileContext.value.subjectUserId,
      profileId: profileContext.value.profileId,
      metadata: {
        goal: profile.goal,
        mealSlotCount: profile.mealSlots.length,
        profileId: profileContext.value.profileId,
        source: profile.source,
        selectedCalories: profile.targets.selectedCalories,
      },
    });

    return context.json({
      profile: overlayActiveTargets(profile, targetPlan.targets),
      targetPlan,
      deprecationWarning:
        "Coach profile target updates now create a versioned TargetPlan. Use /api/targets for new integrations.",
    });
  });
}

function overlayActiveTargets(
  profile: CoachProfileInput & {
    createdAt: string;
    updatedAt: string;
  },
  targets: import("@fitness/domain").TargetPlanTargets | undefined,
) {
  if (targets === undefined) return profile;
  return {
    ...profile,
    estimatedStepsPerDay: targets.steps,
    targets: {
      ...profile.targets,
      maintenanceCalories: targets.maintenanceCalories,
      selectedCalories: targets.selectedCalories,
      proteinGrams: targets.proteinGrams,
      carbsGrams: targets.carbohydratesGrams,
      fatGrams: targets.fatGrams,
      fiberGrams: targets.fiberGrams,
    },
  };
}

async function parseProfileRequest(
  request: JsonRequest,
  userId: string,
): Promise<ValidationResult<CoachProfileInput>> {
  try {
    return parseProfilePayload(await request.json(), userId);
  } catch {
    return invalid("Request body must be valid JSON.");
  }
}

function parseProfilePayload(
  value: unknown,
  userId: string,
): ValidationResult<CoachProfileInput> {
  if (!isRecord(value)) {
    return invalid("Payload must be an object.");
  }

  const goal = coachGoal(value.goal);
  const weightKg = numberRange(value.weightKg, "weightKg", 20, 400);
  const estimatedStepsPerDay = integerRange(
    value.estimatedStepsPerDay,
    "estimatedStepsPerDay",
    0,
    100_000,
  );
  const estimatedActiveCaloriesPerDay = optionalNumberRange(
    value.estimatedActiveCaloriesPerDay,
    "estimatedActiveCaloriesPerDay",
    0,
    10_000,
  );
  const estimatedRestingCaloriesPerDay = optionalNumberRange(
    value.estimatedRestingCaloriesPerDay,
    "estimatedRestingCaloriesPerDay",
    500,
    5_000,
  );
  const wakeTimeMinutes = integerRange(
    value.wakeTimeMinutes,
    "wakeTimeMinutes",
    0,
    1_439,
  );
  const sleepTimeMinutes = integerRange(
    value.sleepTimeMinutes,
    "sleepTimeMinutes",
    0,
    1_439,
  );
  const mealRemindersEnabled = booleanValue(
    value.mealRemindersEnabled ?? true,
    "mealRemindersEnabled",
  );
  const mealSlots = parseMealSlots(value.mealSlots);
  const completedAt = isoString(
    value.completedAt ?? new Date().toISOString(),
    "completedAt",
  );

  if (goal.ok === false) return goal;
  if (weightKg.ok === false) return weightKg;
  if (estimatedStepsPerDay.ok === false) return estimatedStepsPerDay;
  if (estimatedActiveCaloriesPerDay.ok === false) {
    return estimatedActiveCaloriesPerDay;
  }
  if (estimatedRestingCaloriesPerDay.ok === false) {
    return estimatedRestingCaloriesPerDay;
  }
  if (wakeTimeMinutes.ok === false) return wakeTimeMinutes;
  if (sleepTimeMinutes.ok === false) return sleepTimeMinutes;
  if (mealRemindersEnabled.ok === false) return mealRemindersEnabled;
  if (mealSlots.ok === false) return mealSlots;
  if (completedAt.ok === false) return completedAt;

  return {
    ok: true,
    value: {
      userId,
      profileId: nonEmptyString(value.profileId),
      goal: goal.value,
      weightKg: weightKg.value,
      estimatedStepsPerDay: estimatedStepsPerDay.value,
      estimatedActiveCaloriesPerDay: estimatedActiveCaloriesPerDay.value,
      estimatedRestingCaloriesPerDay: estimatedRestingCaloriesPerDay.value,
      wakeTimeMinutes: wakeTimeMinutes.value,
      sleepTimeMinutes: sleepTimeMinutes.value,
      mealRemindersEnabled: mealRemindersEnabled.value,
      mealSlots: mealSlots.value,
      targets: calculateNutritionTargets({
        estimatedStepsPerDay: estimatedStepsPerDay.value,
        estimatedActiveCaloriesPerDay: estimatedActiveCaloriesPerDay.value,
        estimatedRestingCaloriesPerDay: estimatedRestingCaloriesPerDay.value,
        goal: goal.value,
        weightKg: weightKg.value,
      }),
      source: sourceValue(value.source),
      completedAt: completedAt.value,
    },
  };
}

function parseMealSlots(
  value: unknown,
): ValidationResult<readonly CoachMealSlot[]> {
  if (value === undefined) {
    return { ok: true, value: [] };
  }

  if (!Array.isArray(value)) {
    return invalid("Payload mealSlots must be an array.");
  }

  if (value.length > maxSlotCount) {
    return invalid(
      `Payload mealSlots can include at most ${maxSlotCount} slots.`,
    );
  }

  const slots: CoachMealSlot[] = [];

  for (const [index, slot] of value.entries()) {
    if (!isRecord(slot)) {
      return invalid(`Meal slot ${index + 1} must be an object.`);
    }

    const id = boundedString(slot.id, `mealSlots[${index}].id`, 120);
    const name = boundedString(slot.name, `mealSlots[${index}].name`, 80);
    const timeMinutes = integerRange(
      slot.timeMinutes,
      `mealSlots[${index}].timeMinutes`,
      0,
      1_439,
    );
    const remindersEnabled = booleanValue(
      slot.remindersEnabled ?? true,
      `mealSlots[${index}].remindersEnabled`,
    );

    if (id.ok === false) return id;
    if (name.ok === false) return name;
    if (timeMinutes.ok === false) return timeMinutes;
    if (remindersEnabled.ok === false) return remindersEnabled;

    slots.push({
      id: id.value,
      name: name.value,
      timeMinutes: timeMinutes.value,
      remindersEnabled: remindersEnabled.value,
    });
  }

  return { ok: true, value: slots };
}

function coachGoal(value: unknown): ValidationResult<CoachGoal> {
  switch (value) {
    case "lose_weight":
    case "loseWeight":
      return { ok: true, value: "lose_weight" };
    case "maintain":
      return { ok: true, value: "maintain" };
    case "gain_mass":
    case "gainMass":
      return { ok: true, value: "gain_mass" };
    default:
      return invalid(
        "Payload goal must be lose_weight, maintain, or gain_mass.",
      );
  }
}

function sourceValue(value: unknown): "ios" | "web" | "mcp" {
  return value === "ios" || value === "mcp" ? value : "web";
}

function hasAnyScope(
  scopes: readonly string[],
  required: readonly string[],
): boolean {
  return required.some((scope) => scopes.includes(scope));
}

function isoString(value: unknown, name: string): ValidationResult<string> {
  if (typeof value !== "string") {
    return invalid(`Payload ${name} is required.`);
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return invalid(`Payload ${name} must be an ISO timestamp.`);
  }

  return { ok: true, value: parsed.toISOString() };
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

  if (trimmed.length === 0 || trimmed.length > maxChars) {
    return invalid(`Payload ${name} must be 1-${maxChars} characters.`);
  }

  return { ok: true, value: trimmed };
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed.length === 0 ? undefined : trimmed;
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

function numberRange(
  value: unknown,
  name: string,
  min: number,
  max: number,
): ValidationResult<number> {
  const parsed = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    return invalid(`Payload ${name} must be a number from ${min} to ${max}.`);
  }

  return { ok: true, value: Math.round(parsed * 10) / 10 };
}

function booleanValue(value: unknown, name: string): ValidationResult<boolean> {
  if (typeof value !== "boolean") {
    return invalid(`Payload ${name} must be a boolean.`);
  }

  return { ok: true, value };
}

function optionalNumberRange(
  value: unknown,
  name: string,
  min: number,
  max: number,
): ValidationResult<number | undefined> {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: undefined };
  }

  return numberRange(value, name, min, max);
}

function invalid(message: string): ValidationResult<never> {
  return { ok: false, status: 400, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

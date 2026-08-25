import { randomUUID } from "node:crypto";
import type {
  DailyMealPlan,
  DailyMealPlanRepository,
  DailyMealPlanStatus,
  PlannedMeal,
  PlannedMealIngredient,
  PlannedMealStatus,
} from "@fitness/db/dist/meal-plans.js";
import {
  DAILY_MEAL_PLAN_STATUSES,
  PLANNED_MEAL_STATUSES,
} from "@fitness/db/dist/meal-plans.js";
import type {
  MealIngredientInput,
  MealLog,
  MealMacroTotals,
} from "@fitness/db/dist/meals.js";
import { localFoodDateTimeToUtc } from "../mcp/tools/date-range.js";
import type { CoachService } from "./coach.js";
import type { MealLogService } from "./meals.js";
import type { ProfileService } from "./profiles.js";
import type { TargetPlanService } from "./target-plans.js";

export const MEAL_PLAN_PERMISSIONS = [
  "meal.plan.read",
  "meal.plan.write",
  "meal.plan.delete",
  "meal.read",
  "meal.write",
] as const;
export type MealPlanPermission = (typeof MEAL_PLAN_PERMISSIONS)[number];

export type MealPlanAccessContext = Readonly<{
  actorUserId: string;
  subjectUserId: string;
  profileId: string;
  permissions: readonly string[];
}>;

export type MealPlanTargetProvider = Readonly<{
  getTargetsForDate(input: {
    subjectUserId: string;
    profileId: string;
    localFoodDate: string;
  }): Promise<MealMacroTotals | undefined>;
}>;

export type MealPlanPermissionAdapter = Readonly<{
  can(input: {
    access: MealPlanAccessContext;
    permission: MealPlanPermission;
  }): boolean;
}>;

export type PlannedMealIngredientDraft = Readonly<{
  id?: string | undefined;
  foodReferenceType?: string | undefined;
  foodReferenceId?: string | undefined;
  displayName: string;
  quantity: number;
  unit: string;
  grams?: number | undefined;
  totals: MealMacroTotals;
  alternativeGroup?: string | undefined;
  notes?: string | undefined;
  sortOrder?: number | undefined;
}>;

export type PlannedMealDraft = Readonly<{
  id?: string | undefined;
  mealSlotId?: string | undefined;
  mealType: string;
  plannedTime?: string | undefined;
  title: string;
  description?: string | undefined;
  instructions?: string | undefined;
  status?: PlannedMealStatus | "eaten_as_planned" | "not_confirmed" | undefined;
  linkedMealLogId?: string | undefined;
  replacementReason?: string | undefined;
  coachNote?: string | undefined;
  alternativeGroup?: string | undefined;
  sortOrder?: number | undefined;
  ingredients: readonly PlannedMealIngredientDraft[];
  version?: number | undefined;
}>;

export type DailyMealPlanUpsertInput = Readonly<{
  access: MealPlanAccessContext;
  localFoodDate: string;
  timezone: string;
  status?: DailyMealPlanStatus | undefined;
  title?: string | undefined;
  note?: string | undefined;
  meals?: readonly PlannedMealDraft[] | undefined;
  idempotencyKey: string;
  expectedVersion?: number | undefined;
  confirmReplace?: boolean | undefined;
}>;

export type MealPlanWithSummary = Readonly<{
  plan: DailyMealPlan;
  plannedTotals: MealMacroTotals;
  effectiveTargets?: MealMacroTotals | undefined;
  plannedRemaining?: MealMacroTotals | undefined;
}>;

export type IngredientComparison = Readonly<{
  plannedIngredientId: string;
  displayName: string;
  planned: MealMacroTotals;
  actual?: MealMacroTotals | undefined;
  difference?: MealMacroTotals | undefined;
}>;

export type PlannedMealComparison = Readonly<{
  plannedMealId: string;
  title: string;
  status: PlannedMealStatus;
  planned: MealMacroTotals;
  actual?: MealMacroTotals | undefined;
  difference?: MealMacroTotals | undefined;
  linkedMealLogStatus: "linked" | "missing" | "not_applicable";
  ingredientDifferences: readonly IngredientComparison[];
}>;

export type MealPlanComparison = Readonly<{
  profileId: string;
  localFoodDate: string;
  timezone: string;
  planVersion: number;
  meals: readonly PlannedMealComparison[];
  plannedTotals: MealMacroTotals;
  actualTotals: MealMacroTotals;
  effectiveTargets?: MealMacroTotals | undefined;
  plannedRemaining?: MealMacroTotals | undefined;
  actualRemaining?: MealMacroTotals | undefined;
  counts: Readonly<{
    eatenAsPlanned: number;
    changed: number;
    skipped: number;
    unconfirmed: number;
  }>;
}>;

export type PlannedMealConversionResult = Readonly<{
  plan: DailyMealPlan;
  plannedMeal: PlannedMeal;
  mealLog: MealLog;
  idempotentReplay: boolean;
}>;

export type MealPlanService = Readonly<{
  getDailyPlan(input: {
    access: MealPlanAccessContext;
    localFoodDate: string;
  }): Promise<MealPlanWithSummary | undefined>;
  getPlanRange(input: {
    access: MealPlanAccessContext;
    fromLocalFoodDate: string;
    toLocalFoodDate: string;
    includeArchived?: boolean | undefined;
  }): Promise<readonly MealPlanWithSummary[]>;
  upsertDailyPlan(
    input: DailyMealPlanUpsertInput,
  ): Promise<MealPlanWithSummary>;
  archivePlan(input: {
    access: MealPlanAccessContext;
    localFoodDate: string;
    expectedVersion: number;
  }): Promise<MealPlanWithSummary>;
  deleteDraftPlan(input: {
    access: MealPlanAccessContext;
    localFoodDate: string;
    expectedVersion: number;
    confirmDelete: boolean;
  }): Promise<boolean>;
  copyDailyPlan(input: {
    access: MealPlanAccessContext;
    sourceLocalFoodDate: string;
    destinationLocalFoodDate: string;
    timezone: string;
    idempotencyKey: string;
    confirmReplace?: boolean | undefined;
    expectedDestinationVersion?: number | undefined;
  }): Promise<MealPlanWithSummary>;
  copyPlanRange(input: {
    access: MealPlanAccessContext;
    sourceFromLocalFoodDate: string;
    sourceToLocalFoodDate: string;
    destinationStartLocalFoodDate: string;
    timezone: string;
    idempotencyKey: string;
    confirmReplace?: boolean | undefined;
  }): Promise<readonly MealPlanWithSummary[]>;
  clearFuturePlans(input: {
    access: MealPlanAccessContext;
    fromLocalFoodDate: string;
    confirmClear: boolean;
  }): Promise<readonly DailyMealPlan[]>;
  getPlannedMeal(input: {
    access: MealPlanAccessContext;
    plannedMealId: string;
  }): Promise<
    Readonly<{ plan: DailyMealPlan; plannedMeal: PlannedMeal }> | undefined
  >;
  updatePlannedMeal(input: {
    access: MealPlanAccessContext;
    plannedMealId: string;
    expectedPlanVersion: number;
    expectedMealVersion: number;
    patch: Partial<Omit<PlannedMealDraft, "id">>;
  }): Promise<Readonly<{ plan: DailyMealPlan; plannedMeal: PlannedMeal }>>;
  replacePlannedMeal(input: {
    access: MealPlanAccessContext;
    plannedMealId: string;
    expectedPlanVersion: number;
    expectedMealVersion: number;
    replacement: PlannedMealDraft;
    reason?: string | undefined;
    confirmReplace: boolean;
  }): Promise<
    Readonly<{
      plan: DailyMealPlan;
      originalMeal: PlannedMeal;
      replacementMeal: PlannedMeal;
    }>
  >;
  markPlannedMealStatus(input: {
    access: MealPlanAccessContext;
    plannedMealId: string;
    status: "planned" | "skipped" | "unconfirmed" | "not_confirmed";
    expectedPlanVersion: number;
    expectedMealVersion: number;
    coachNote?: string | undefined;
  }): Promise<Readonly<{ plan: DailyMealPlan; plannedMeal: PlannedMeal }>>;
  convertPlannedMealToLog(input: {
    access: MealPlanAccessContext;
    plannedMealId: string;
    status: "confirmed" | "eaten_as_planned" | "partially_eaten" | "replaced";
    expectedPlanVersion: number;
    expectedMealVersion: number;
    actualIngredients?: readonly PlannedMealIngredientDraft[] | undefined;
    actualTitle?: string | undefined;
    actualDescription?: string | undefined;
    replacementReason?: string | undefined;
    idempotencyKey?: string | undefined;
    origin: "ios" | "web" | "mcp";
  }): Promise<PlannedMealConversionResult>;
  comparePlanToActual(input: {
    access: MealPlanAccessContext;
    localFoodDate: string;
  }): Promise<MealPlanComparison | undefined>;
}>;

export class MealPlanServiceError extends Error {
  constructor(
    readonly code:
      | "MEAL_PLAN_NOT_FOUND"
      | "PLANNED_MEAL_NOT_FOUND"
      | "MEAL_PLAN_ALREADY_EXISTS"
      | "MEAL_PLAN_CONFIRMATION_REQUIRED"
      | "MEAL_PLAN_PERMISSION_DENIED"
      | "MEAL_PLAN_VERSION_CONFLICT"
      | "MEAL_PLAN_INVALID_INPUT",
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "MealPlanServiceError";
  }
}

const ZERO_TOTALS: MealMacroTotals = Object.freeze({
  calories: 0,
  proteinGrams: 0,
  carbsGrams: 0,
  fatGrams: 0,
  fiberGrams: 0,
});

const defaultTargetProvider: MealPlanTargetProvider = {
  async getTargetsForDate() {
    return undefined;
  },
};

const defaultPermissionAdapter: MealPlanPermissionAdapter = {
  can({ access, permission }) {
    return (
      access.permissions.length === 0 || access.permissions.includes(permission)
    );
  },
};

export function createCoachMealPlanTargetProvider(
  coach: CoachService,
): MealPlanTargetProvider {
  return {
    async getTargetsForDate(input) {
      const target = (
        await coach.getProfile(input.subjectUserId, input.profileId)
      )?.targets;
      return target === undefined
        ? undefined
        : {
            calories: target.selectedCalories,
            proteinGrams: target.proteinGrams,
            carbsGrams: target.carbsGrams,
            fatGrams: target.fatGrams,
            fiberGrams: target.fiberGrams,
          };
    },
  };
}

export function createVersionedMealPlanTargetProvider(
  targetPlans: TargetPlanService,
  profiles: ProfileService,
  fallback?: MealPlanTargetProvider | undefined,
): MealPlanTargetProvider {
  return {
    async getTargetsForDate(input) {
      const context = await profiles.requireProfileContext(
        input.subjectUserId,
        input.profileId,
      );
      const plan = await targetPlans.getEffectivePlan(
        context,
        input.localFoodDate,
      );
      if (plan === undefined) {
        return fallback?.getTargetsForDate(input);
      }
      return {
        calories: plan.targets.selectedCalories,
        proteinGrams: plan.targets.proteinGrams,
        carbsGrams: plan.targets.carbohydratesGrams,
        fatGrams: plan.targets.fatGrams,
        fiberGrams: plan.targets.fiberGrams,
      };
    },
  };
}

export function createInMemoryMealPlanService(options: {
  meals: MealLogService;
  targets?: MealPlanTargetProvider | undefined;
  permissionAdapter?: MealPlanPermissionAdapter | undefined;
  now?: (() => Date) | undefined;
}): MealPlanService {
  return createMealPlanService(createInMemoryMealPlanRepository(), options);
}

export function createRepositoryMealPlanService(
  repository: DailyMealPlanRepository,
  options: {
    meals: MealLogService;
    targets?: MealPlanTargetProvider | undefined;
    permissionAdapter?: MealPlanPermissionAdapter | undefined;
    now?: (() => Date) | undefined;
  },
): MealPlanService {
  return createMealPlanService(repository, options);
}

function createMealPlanService(
  repository: DailyMealPlanRepository,
  options: {
    meals: MealLogService;
    targets?: MealPlanTargetProvider | undefined;
    permissionAdapter?: MealPlanPermissionAdapter | undefined;
    now?: (() => Date) | undefined;
  },
): MealPlanService {
  const targets = options.targets ?? defaultTargetProvider;
  const permissionAdapter =
    options.permissionAdapter ?? defaultPermissionAdapter;
  const now = options.now ?? (() => new Date());

  async function summary(
    access: MealPlanAccessContext,
    plan: DailyMealPlan,
  ): Promise<MealPlanWithSummary> {
    const plannedTotals = sumPlannedMeals(plan.meals);
    const effectiveTargets = await targets.getTargetsForDate({
      subjectUserId: access.subjectUserId,
      profileId: access.profileId,
      localFoodDate: plan.localFoodDate,
    });
    return {
      plan,
      plannedTotals,
      effectiveTargets,
      plannedRemaining:
        effectiveTargets === undefined
          ? undefined
          : subtractTotals(effectiveTargets, plannedTotals),
    };
  }

  async function requirePlanByDate(
    access: MealPlanAccessContext,
    localFoodDate: string,
  ): Promise<DailyMealPlan> {
    const plan = await repository.getPlan(access.profileId, localFoodDate);
    if (plan === undefined) {
      throw new MealPlanServiceError(
        "MEAL_PLAN_NOT_FOUND",
        `No daily meal plan exists for ${localFoodDate}.`,
        { localFoodDate },
      );
    }
    return plan;
  }

  async function findPlannedMeal(
    access: MealPlanAccessContext,
    plannedMealId: string,
  ): Promise<{ plan: DailyMealPlan; meal: PlannedMeal } | undefined> {
    const plans = await repository.listPlans({
      profileId: access.profileId,
      fromLocalFoodDate: "0001-01-01",
      toLocalFoodDate: "9999-12-31",
      includeArchived: true,
    });
    for (const plan of plans) {
      const meal = plan.meals.find(
        (candidate) => candidate.id === plannedMealId,
      );
      if (meal !== undefined) return { plan, meal };
    }
    return undefined;
  }

  function requirePermission(
    access: MealPlanAccessContext,
    permission: MealPlanPermission,
  ): void {
    if (!permissionAdapter.can({ access, permission })) {
      throw new MealPlanServiceError(
        "MEAL_PLAN_PERMISSION_DENIED",
        `Profile access is missing ${permission}.`,
        { permission, profileId: access.profileId },
      );
    }
  }

  async function saveChangedPlan(
    plan: DailyMealPlan,
    expectedVersion: number,
  ): Promise<DailyMealPlan> {
    try {
      return await repository.savePlan({
        plan: { ...plan, updatedAt: now().toISOString() },
        expectedVersion,
      });
    } catch (error) {
      if (isVersionConflict(error)) {
        throw versionConflict(plan.id, expectedVersion);
      }
      throw error;
    }
  }

  const service: MealPlanService = {
    async getDailyPlan(input) {
      requirePermission(input.access, "meal.plan.read");
      assertLocalFoodDate(input.localFoodDate);
      const plan = await repository.getPlan(
        input.access.profileId,
        input.localFoodDate,
      );
      return plan === undefined ? undefined : summary(input.access, plan);
    },
    async getPlanRange(input) {
      requirePermission(input.access, "meal.plan.read");
      assertDateRange(input.fromLocalFoodDate, input.toLocalFoodDate);
      const plans = await repository.listPlans({
        profileId: input.access.profileId,
        fromLocalFoodDate: input.fromLocalFoodDate,
        toLocalFoodDate: input.toLocalFoodDate,
        includeArchived: input.includeArchived,
      });
      return Promise.all(plans.map((plan) => summary(input.access, plan)));
    },
    async upsertDailyPlan(input) {
      requirePermission(input.access, "meal.plan.write");
      assertLocalFoodDate(input.localFoodDate);
      assertTimezone(input.timezone);
      assertNonEmpty(input.idempotencyKey, "idempotencyKey");
      if (input.status !== undefined) {
        assertStatus(input.status, DAILY_MEAL_PLAN_STATUSES, "plan status");
      }
      const replay = await repository.getPlanByIdempotencyKey(
        input.access.profileId,
        input.idempotencyKey,
      );
      if (replay !== undefined) return summary(input.access, replay);

      const existing = await repository.getPlan(
        input.access.profileId,
        input.localFoodDate,
      );
      if (existing !== undefined) {
        if (input.expectedVersion !== existing.version) {
          throw versionConflict(existing.id, input.expectedVersion);
        }
        if (
          input.meals !== undefined &&
          existing.meals.length > 0 &&
          input.confirmReplace !== true
        ) {
          throw confirmationRequired("replace", existing);
        }
      }

      const timestamp = now().toISOString();
      const planId = existing?.id ?? randomUUID();
      const plan: DailyMealPlan = {
        id: planId,
        profileId: input.access.profileId,
        localFoodDate: input.localFoodDate,
        timezone: input.timezone,
        status: input.status ?? existing?.status ?? "draft",
        title: input.title ?? existing?.title,
        note: input.note ?? existing?.note,
        createdByUserId: existing?.createdByUserId ?? input.access.actorUserId,
        idempotencyKey: input.idempotencyKey,
        meals:
          input.meals === undefined
            ? (existing?.meals ?? [])
            : materializeMeals(
                input.meals,
                planId,
                input.access.profileId,
                timestamp,
                existing,
              ),
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
        version: existing?.version ?? 1,
      };

      try {
        return summary(
          input.access,
          await repository.savePlan({
            plan,
            expectedVersion: existing?.version,
          }),
        );
      } catch (error) {
        if (isVersionConflict(error)) {
          throw versionConflict(plan.id, input.expectedVersion);
        }
        throw error;
      }
    },
    async archivePlan(input) {
      requirePermission(input.access, "meal.plan.write");
      const plan = await requirePlanByDate(input.access, input.localFoodDate);
      assertVersion(plan.version, input.expectedVersion, plan.id);
      return summary(
        input.access,
        await saveChangedPlan({ ...plan, status: "archived" }, plan.version),
      );
    },
    async deleteDraftPlan(input) {
      requirePermission(input.access, "meal.plan.delete");
      const plan = await requirePlanByDate(input.access, input.localFoodDate);
      if (input.confirmDelete !== true)
        throw confirmationRequired("delete", plan);
      if (plan.status !== "draft") {
        throw new MealPlanServiceError(
          "MEAL_PLAN_INVALID_INPUT",
          "Only draft meal plans can be deleted; archive other plans instead.",
          { status: plan.status },
        );
      }
      assertVersion(plan.version, input.expectedVersion, plan.id);
      const deleted = await repository.deleteDraftPlan({
        profileId: input.access.profileId,
        planId: plan.id,
        expectedVersion: plan.version,
      });
      if (!deleted) throw versionConflict(plan.id, input.expectedVersion);
      return true;
    },
    async copyDailyPlan(input) {
      requirePermission(input.access, "meal.plan.write");
      assertLocalFoodDate(input.sourceLocalFoodDate);
      assertLocalFoodDate(input.destinationLocalFoodDate);
      if (input.sourceLocalFoodDate === input.destinationLocalFoodDate) {
        throw new MealPlanServiceError(
          "MEAL_PLAN_INVALID_INPUT",
          "Source and destination dates must differ.",
        );
      }
      const source = await requirePlanByDate(
        input.access,
        input.sourceLocalFoodDate,
      );
      const destination = await repository.getPlan(
        input.access.profileId,
        input.destinationLocalFoodDate,
      );
      if (destination !== undefined && input.confirmReplace !== true) {
        throw confirmationRequired("replace", destination);
      }
      return service.upsertDailyPlan({
        access: input.access,
        localFoodDate: input.destinationLocalFoodDate,
        timezone: input.timezone,
        status: "draft",
        title: source.title,
        note: source.note,
        meals: copiedMealDrafts(source.meals),
        idempotencyKey: input.idempotencyKey,
        expectedVersion:
          destination === undefined
            ? undefined
            : (input.expectedDestinationVersion ?? destination.version),
        confirmReplace: input.confirmReplace,
      });
    },
    async copyPlanRange(input) {
      requirePermission(input.access, "meal.plan.write");
      assertDateRange(
        input.sourceFromLocalFoodDate,
        input.sourceToLocalFoodDate,
      );
      assertLocalFoodDate(input.destinationStartLocalFoodDate);
      const sources = await repository.listPlans({
        profileId: input.access.profileId,
        fromLocalFoodDate: input.sourceFromLocalFoodDate,
        toLocalFoodDate: input.sourceToLocalFoodDate,
        includeArchived: false,
      });
      if (sources.length === 0) {
        throw new MealPlanServiceError(
          "MEAL_PLAN_NOT_FOUND",
          "No source plans exist in the selected range.",
        );
      }
      const destinations = sources.map((source) => ({
        source,
        date: addDays(
          input.destinationStartLocalFoodDate,
          daysBetween(input.sourceFromLocalFoodDate, source.localFoodDate),
        ),
      }));
      const existing = await Promise.all(
        destinations.map(({ date }) =>
          repository.getPlan(input.access.profileId, date),
        ),
      );
      if (
        existing.some((plan) => plan !== undefined) &&
        input.confirmReplace !== true
      ) {
        throw new MealPlanServiceError(
          "MEAL_PLAN_CONFIRMATION_REQUIRED",
          "Copying this range would replace one or more existing plans.",
          {
            operation: "copy_range",
            destinationDates: destinations.map(({ date }) => date),
          },
        );
      }
      const results: MealPlanWithSummary[] = [];
      for (const [index, destination] of destinations.entries()) {
        results.push(
          await service.upsertDailyPlan({
            access: input.access,
            localFoodDate: destination.date,
            timezone: input.timezone,
            status: "draft",
            title: destination.source.title,
            note: destination.source.note,
            meals: copiedMealDrafts(destination.source.meals),
            idempotencyKey: `${input.idempotencyKey}:${destination.date}`,
            confirmReplace: input.confirmReplace,
            expectedVersion: existing[index]?.version,
          }),
        );
      }
      return results;
    },
    async clearFuturePlans(input) {
      requirePermission(input.access, "meal.plan.delete");
      if (!input.confirmClear) {
        throw new MealPlanServiceError(
          "MEAL_PLAN_CONFIRMATION_REQUIRED",
          "Clearing future plans requires explicit confirmation.",
          { operation: "clear_future" },
        );
      }
      const plans = await repository.listPlans({
        profileId: input.access.profileId,
        fromLocalFoodDate: input.fromLocalFoodDate,
        toLocalFoodDate: "9999-12-31",
        includeArchived: false,
      });
      const cleared: DailyMealPlan[] = [];
      for (const plan of plans) {
        if (plan.status === "draft") {
          await repository.deleteDraftPlan({
            profileId: plan.profileId,
            planId: plan.id,
            expectedVersion: plan.version,
          });
          cleared.push(plan);
        } else {
          cleared.push(
            await saveChangedPlan(
              { ...plan, status: "archived" },
              plan.version,
            ),
          );
        }
      }
      return cleared;
    },
    async getPlannedMeal(input) {
      requirePermission(input.access, "meal.plan.read");
      const found = await findPlannedMeal(input.access, input.plannedMealId);
      return found === undefined
        ? undefined
        : { plan: found.plan, plannedMeal: found.meal };
    },
    async updatePlannedMeal(input) {
      requirePermission(input.access, "meal.plan.write");
      const found = await findPlannedMeal(input.access, input.plannedMealId);
      if (found === undefined) throw plannedMealNotFound(input.plannedMealId);
      assertVersion(
        found.plan.version,
        input.expectedPlanVersion,
        found.plan.id,
      );
      assertVersion(
        found.meal.version,
        input.expectedMealVersion,
        found.meal.id,
      );
      const timestamp = now().toISOString();
      const changed = materializeMeal(
        {
          ...plannedMealDraft(found.meal),
          ...input.patch,
          id: found.meal.id,
          version: found.meal.version + 1,
          ingredients:
            input.patch.ingredients ?? ingredientDrafts(found.meal.ingredients),
        },
        found.plan.id,
        found.plan.profileId,
        timestamp,
        found.meal,
      );
      const saved = await saveChangedPlan(
        {
          ...found.plan,
          meals: found.plan.meals.map((meal) =>
            meal.id === found.meal.id ? changed : meal,
          ),
        },
        found.plan.version,
      );
      return {
        plan: saved,
        plannedMeal: requireMeal(saved, found.meal.id),
      };
    },
    async replacePlannedMeal(input) {
      requirePermission(input.access, "meal.plan.write");
      if (!input.confirmReplace) {
        throw new MealPlanServiceError(
          "MEAL_PLAN_CONFIRMATION_REQUIRED",
          "Replacing a planned meal requires explicit confirmation.",
          { operation: "replace_meal", plannedMealId: input.plannedMealId },
        );
      }
      const found = await findPlannedMeal(input.access, input.plannedMealId);
      if (found === undefined) throw plannedMealNotFound(input.plannedMealId);
      assertVersion(
        found.plan.version,
        input.expectedPlanVersion,
        found.plan.id,
      );
      assertVersion(
        found.meal.version,
        input.expectedMealVersion,
        found.meal.id,
      );
      const timestamp = now().toISOString();
      const original: PlannedMeal = {
        ...found.meal,
        status: "replaced",
        replacementReason: input.reason,
        updatedAt: timestamp,
        version: found.meal.version + 1,
      };
      const replacement = materializeMeal(
        {
          ...input.replacement,
          alternativeGroup:
            input.replacement.alternativeGroup ??
            `replacement:${found.meal.id}`,
          status: input.replacement.status ?? "planned",
          sortOrder: input.replacement.sortOrder ?? found.meal.sortOrder + 1,
        },
        found.plan.id,
        found.plan.profileId,
        timestamp,
      );
      const saved = await saveChangedPlan(
        {
          ...found.plan,
          meals: [
            ...found.plan.meals.map((meal) =>
              meal.id === found.meal.id ? original : meal,
            ),
            replacement,
          ].sort((left, right) => left.sortOrder - right.sortOrder),
        },
        found.plan.version,
      );
      return {
        plan: saved,
        originalMeal: requireMeal(saved, original.id),
        replacementMeal: requireMeal(saved, replacement.id),
      };
    },
    async markPlannedMealStatus(input) {
      const result = await service.updatePlannedMeal({
        access: input.access,
        plannedMealId: input.plannedMealId,
        expectedPlanVersion: input.expectedPlanVersion,
        expectedMealVersion: input.expectedMealVersion,
        patch: { status: input.status, coachNote: input.coachNote },
      });
      return result;
    },
    async convertPlannedMealToLog(input) {
      requirePermission(input.access, "meal.plan.write");
      requirePermission(input.access, "meal.write");
      const found = await findPlannedMeal(input.access, input.plannedMealId);
      if (found === undefined) throw plannedMealNotFound(input.plannedMealId);

      const dayMeals = await listActualMealsForDay(
        options.meals,
        input.access,
        found.plan.localFoodDate,
        found.plan.timezone,
      );
      if (found.meal.linkedMealLogId !== undefined) {
        const linked = dayMeals.find(
          (meal) => meal.id === found.meal.linkedMealLogId,
        );
        if (linked !== undefined) {
          return {
            plan: found.plan,
            plannedMeal: found.meal,
            mealLog: linked,
            idempotentReplay: true,
          };
        }
      }

      assertVersion(
        found.plan.version,
        input.expectedPlanVersion,
        found.plan.id,
      );
      assertVersion(
        found.meal.version,
        input.expectedMealVersion,
        found.meal.id,
      );
      const actualIngredients =
        input.actualIngredients ?? ingredientDrafts(found.meal.ingredients);
      if (
        input.status === "partially_eaten" &&
        input.actualIngredients === undefined
      ) {
        throw new MealPlanServiceError(
          "MEAL_PLAN_INVALID_INPUT",
          "Partially eaten meals require actual ingredient quantities.",
        );
      }
      const mealLog = await options.meals.upsertMeal({
        userId: input.access.subjectUserId,
        profileId: input.access.profileId,
        idempotencyKey:
          input.idempotencyKey ?? `planned-meal-conversion:${found.meal.id}`,
        clientMealId: `planned-meal:${found.meal.id}`,
        occurredAt: localFoodDateTimeToUtc({
          localFoodDate: found.plan.localFoodDate,
          localTime: found.meal.plannedTime ?? "12:00",
          timezone: found.plan.timezone,
        }),
        timezone: found.plan.timezone,
        title: input.actualTitle ?? found.meal.title,
        mealType: found.meal.mealType,
        note: input.actualDescription ?? found.meal.description,
        totals: sumIngredientDrafts(actualIngredients),
        ingredients: actualIngredients.map(actualIngredientInput),
        photoCount: 0,
        estimateStatus: "manual",
        origin: input.origin,
        provenance: {
          plannedMealId: found.meal.id,
          dailyMealPlanId: found.plan.id,
          plannedMealVersion: found.meal.version,
          conversionStatus: input.status,
        },
      });
      const timestamp = now().toISOString();
      const converted: PlannedMeal = {
        ...found.meal,
        status: normalizePlannedMealStatus(input.status),
        linkedMealLogId: mealLog.id,
        replacementReason:
          input.replacementReason ?? found.meal.replacementReason,
        updatedAt: timestamp,
        version: found.meal.version + 1,
      };
      const saved = await saveChangedPlan(
        {
          ...found.plan,
          meals: found.plan.meals.map((meal) =>
            meal.id === converted.id ? converted : meal,
          ),
        },
        found.plan.version,
      );
      return {
        plan: saved,
        plannedMeal: requireMeal(saved, converted.id),
        mealLog,
        idempotentReplay: false,
      };
    },
    async comparePlanToActual(input) {
      requirePermission(input.access, "meal.plan.read");
      requirePermission(input.access, "meal.read");
      const plan = await repository.getPlan(
        input.access.profileId,
        input.localFoodDate,
      );
      if (plan === undefined) return undefined;
      const actualMeals = await listActualMealsForDay(
        options.meals,
        input.access,
        plan.localFoodDate,
        plan.timezone,
      );
      const effectiveTargets = await targets.getTargetsForDate({
        subjectUserId: input.access.subjectUserId,
        profileId: input.access.profileId,
        localFoodDate: plan.localFoodDate,
      });
      const plannedTotals = sumPlannedMeals(plan.meals);
      const actualTotals = sumActualMeals(actualMeals);
      return {
        profileId: plan.profileId,
        localFoodDate: plan.localFoodDate,
        timezone: plan.timezone,
        planVersion: plan.version,
        meals: plan.meals.map((meal) => compareMeal(meal, actualMeals)),
        plannedTotals,
        actualTotals,
        effectiveTargets,
        plannedRemaining:
          effectiveTargets === undefined
            ? undefined
            : subtractTotals(effectiveTargets, plannedTotals),
        actualRemaining:
          effectiveTargets === undefined
            ? undefined
            : subtractTotals(effectiveTargets, actualTotals),
        counts: {
          eatenAsPlanned: plan.meals.filter(
            (meal) => meal.status === "confirmed",
          ).length,
          changed: plan.meals.filter(
            (meal) =>
              meal.status === "partially_eaten" || meal.status === "replaced",
          ).length,
          skipped: plan.meals.filter((meal) => meal.status === "skipped")
            .length,
          unconfirmed: plan.meals.filter(
            (meal) =>
              meal.status === "planned" || meal.status === "unconfirmed",
          ).length,
        },
      };
    },
  };

  return service;
}

function createInMemoryMealPlanRepository(): DailyMealPlanRepository {
  const plans = new Map<string, DailyMealPlan>();
  return {
    async getPlan(profileId, localFoodDate) {
      return copyOptionalPlan(plans.get(planKey(profileId, localFoodDate)));
    },
    async getPlanById(profileId, planId) {
      return copyOptionalPlan(
        Array.from(plans.values()).find(
          (plan) => plan.profileId === profileId && plan.id === planId,
        ),
      );
    },
    async getPlanByIdempotencyKey(profileId, idempotencyKey) {
      return copyOptionalPlan(
        Array.from(plans.values()).find(
          (plan) =>
            plan.profileId === profileId &&
            plan.idempotencyKey === idempotencyKey,
        ),
      );
    },
    async listPlans(input) {
      return Array.from(plans.values())
        .filter(
          (plan) =>
            plan.profileId === input.profileId &&
            plan.localFoodDate >= input.fromLocalFoodDate &&
            plan.localFoodDate <= input.toLocalFoodDate &&
            (input.includeArchived === true || plan.status !== "archived"),
        )
        .sort((left, right) =>
          left.localFoodDate.localeCompare(right.localFoodDate),
        )
        .map(copyPlan);
    },
    async savePlan(input) {
      const key = planKey(input.plan.profileId, input.plan.localFoodDate);
      const existing = plans.get(key);
      if (
        (existing === undefined && input.expectedVersion !== undefined) ||
        (existing !== undefined && existing.version !== input.expectedVersion)
      ) {
        throw { code: "MEAL_PLAN_VERSION_CONFLICT" };
      }
      const saved = copyPlan({
        ...input.plan,
        version: existing === undefined ? 1 : existing.version + 1,
      });
      plans.set(key, saved);
      return copyPlan(saved);
    },
    async deleteDraftPlan(input) {
      const entry = Array.from(plans.entries()).find(
        ([, plan]) =>
          plan.profileId === input.profileId && plan.id === input.planId,
      );
      if (
        entry === undefined ||
        entry[1].status !== "draft" ||
        entry[1].version !== input.expectedVersion
      ) {
        return false;
      }
      plans.delete(entry[0]);
      return true;
    },
  };
}

function materializeMeals(
  drafts: readonly PlannedMealDraft[],
  planId: string,
  profileId: string,
  timestamp: string,
  existing?: DailyMealPlan | undefined,
): readonly PlannedMeal[] {
  return drafts
    .map((draft, index) =>
      materializeMeal(
        { ...draft, sortOrder: draft.sortOrder ?? index },
        planId,
        profileId,
        timestamp,
        draft.id === undefined
          ? undefined
          : existing?.meals.find((meal) => meal.id === draft.id),
      ),
    )
    .sort((left, right) => left.sortOrder - right.sortOrder);
}

function materializeMeal(
  draft: PlannedMealDraft,
  planId: string,
  profileId: string,
  timestamp: string,
  existing?: PlannedMeal | undefined,
): PlannedMeal {
  assertNonEmpty(draft.title, "meal title");
  assertNonEmpty(draft.mealType, "meal type");
  const status =
    draft.status === undefined
      ? undefined
      : normalizePlannedMealStatus(draft.status);
  if (status !== undefined) {
    assertStatus(status, PLANNED_MEAL_STATUSES, "planned meal status");
  }
  if (
    draft.plannedTime !== undefined &&
    !/^([01]\d|2[0-3]):[0-5]\d$/u.test(draft.plannedTime)
  ) {
    throw new MealPlanServiceError(
      "MEAL_PLAN_INVALID_INPUT",
      "plannedTime must use HH:MM in local time.",
    );
  }
  const mealId = draft.id ?? randomUUID();
  return {
    id: mealId,
    dailyMealPlanId: planId,
    profileId,
    mealSlotId: draft.mealSlotId,
    mealType: draft.mealType,
    plannedTime: draft.plannedTime,
    title: draft.title,
    description: draft.description ?? "",
    instructions: draft.instructions ?? "",
    status: status ?? "planned",
    linkedMealLogId: draft.linkedMealLogId,
    replacementReason: draft.replacementReason,
    coachNote: draft.coachNote,
    alternativeGroup: draft.alternativeGroup,
    sortOrder: draft.sortOrder ?? 0,
    ingredients: draft.ingredients.map((ingredient, index) =>
      materializeIngredient(
        ingredient,
        mealId,
        timestamp,
        existing?.ingredients.find(
          (candidate) => candidate.id === ingredient.id,
        ),
        index,
      ),
    ),
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    version:
      draft.version ?? (existing === undefined ? 1 : existing.version + 1),
  };
}

function assertStatus(
  value: string,
  allowed: readonly string[],
  label: string,
): void {
  if (!allowed.includes(value)) {
    throw new MealPlanServiceError(
      "MEAL_PLAN_INVALID_INPUT",
      `${label} is invalid.`,
      { allowed, value },
    );
  }
}

function normalizePlannedMealStatus(
  status: PlannedMealStatus | "eaten_as_planned" | "not_confirmed",
): PlannedMealStatus {
  if (status === "eaten_as_planned") return "confirmed";
  if (status === "not_confirmed") return "unconfirmed";
  return status;
}

function materializeIngredient(
  draft: PlannedMealIngredientDraft,
  plannedMealId: string,
  timestamp: string,
  existing: PlannedMealIngredient | undefined,
  index: number,
): PlannedMealIngredient {
  assertNonEmpty(draft.displayName, "ingredient display name");
  assertNonEmpty(draft.unit, "ingredient unit");
  assertNonNegative(draft.quantity, "ingredient quantity");
  if (draft.grams !== undefined)
    assertNonNegative(draft.grams, "ingredient grams");
  assertTotals(draft.totals);
  return {
    id: draft.id ?? randomUUID(),
    plannedMealId,
    foodReferenceType: draft.foodReferenceType,
    foodReferenceId: draft.foodReferenceId,
    displayName: draft.displayName,
    quantity: draft.quantity,
    unit: draft.unit,
    grams: draft.grams,
    totals: { ...draft.totals },
    alternativeGroup: draft.alternativeGroup,
    notes: draft.notes,
    sortOrder: draft.sortOrder ?? index,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
}

function copiedMealDrafts(
  meals: readonly PlannedMeal[],
): readonly PlannedMealDraft[] {
  return meals.map((meal) => ({
    mealSlotId: meal.mealSlotId,
    mealType: meal.mealType,
    plannedTime: meal.plannedTime,
    title: meal.title,
    description: meal.description,
    instructions: meal.instructions,
    status: "planned",
    coachNote: meal.coachNote,
    alternativeGroup: meal.alternativeGroup,
    sortOrder: meal.sortOrder,
    ingredients: ingredientDrafts(meal.ingredients).map((ingredient) => ({
      ...ingredient,
      id: undefined,
    })),
  }));
}

function plannedMealDraft(meal: PlannedMeal): PlannedMealDraft {
  return {
    id: meal.id,
    mealSlotId: meal.mealSlotId,
    mealType: meal.mealType,
    plannedTime: meal.plannedTime,
    title: meal.title,
    description: meal.description,
    instructions: meal.instructions,
    status: meal.status,
    linkedMealLogId: meal.linkedMealLogId,
    replacementReason: meal.replacementReason,
    coachNote: meal.coachNote,
    alternativeGroup: meal.alternativeGroup,
    sortOrder: meal.sortOrder,
    ingredients: ingredientDrafts(meal.ingredients),
    version: meal.version,
  };
}

function ingredientDrafts(
  ingredients: readonly PlannedMealIngredient[],
): readonly PlannedMealIngredientDraft[] {
  return ingredients.map((ingredient) => ({
    id: ingredient.id,
    foodReferenceType: ingredient.foodReferenceType,
    foodReferenceId: ingredient.foodReferenceId,
    displayName: ingredient.displayName,
    quantity: ingredient.quantity,
    unit: ingredient.unit,
    grams: ingredient.grams,
    totals: { ...ingredient.totals },
    alternativeGroup: ingredient.alternativeGroup,
    notes: ingredient.notes,
    sortOrder: ingredient.sortOrder,
  }));
}

function actualIngredientInput(
  ingredient: PlannedMealIngredientDraft,
): MealIngredientInput {
  return {
    clientIngredientId: ingredient.id,
    name: ingredient.displayName,
    quantity: ingredient.quantity,
    unit: ingredient.unit,
    grams: ingredient.grams,
    totals: { ...ingredient.totals },
  };
}

async function listActualMealsForDay(
  meals: MealLogService,
  access: MealPlanAccessContext,
  localFoodDate: string,
  timezone: string,
): Promise<readonly MealLog[]> {
  return meals.listMeals({
    userId: access.subjectUserId,
    profileId: access.profileId,
    range: {
      from: localFoodDateTimeToUtc({
        localFoodDate,
        localTime: "00:00",
        timezone,
      }),
      to: localFoodDateTimeToUtc({
        localFoodDate: addDays(localFoodDate, 1),
        localTime: "00:00",
        timezone,
      }),
    },
    limit: 1_000,
  });
}

function compareMeal(
  meal: PlannedMeal,
  actualMeals: readonly MealLog[],
): PlannedMealComparison {
  const planned = sumPlannedIngredients(meal.ingredients);
  const actual =
    meal.linkedMealLogId === undefined
      ? undefined
      : actualMeals.find((candidate) => candidate.id === meal.linkedMealLogId);
  const notApplicable =
    meal.status === "skipped" ||
    meal.status === "planned" ||
    meal.status === "unconfirmed";
  return {
    plannedMealId: meal.id,
    title: meal.title,
    status: meal.status,
    planned,
    actual: actual?.totals,
    difference:
      actual === undefined ? undefined : subtractTotals(actual.totals, planned),
    linkedMealLogStatus:
      actual !== undefined
        ? "linked"
        : notApplicable
          ? "not_applicable"
          : "missing",
    ingredientDifferences: meal.ingredients.map((ingredient) => {
      const actualIngredient = actual?.ingredients.find(
        (candidate) =>
          normalizeFoodName(candidate.name) ===
          normalizeFoodName(ingredient.displayName),
      );
      return {
        plannedIngredientId: ingredient.id,
        displayName: ingredient.displayName,
        planned: ingredient.totals,
        actual: actualIngredient?.totals,
        difference:
          actualIngredient === undefined
            ? undefined
            : subtractTotals(actualIngredient.totals, ingredient.totals),
      };
    }),
  };
}

function sumPlannedMeals(meals: readonly PlannedMeal[]): MealMacroTotals {
  return sumTotals(
    meals.map((meal) => sumPlannedIngredients(meal.ingredients)),
  );
}

function sumPlannedIngredients(
  ingredients: readonly PlannedMealIngredient[],
): MealMacroTotals {
  return sumTotals(ingredients.map((ingredient) => ingredient.totals));
}

function sumIngredientDrafts(
  ingredients: readonly PlannedMealIngredientDraft[],
): MealMacroTotals {
  return sumTotals(ingredients.map((ingredient) => ingredient.totals));
}

function sumActualMeals(meals: readonly MealLog[]): MealMacroTotals {
  return sumTotals(meals.map((meal) => meal.totals));
}

function sumTotals(totals: readonly MealMacroTotals[]): MealMacroTotals {
  return totals.reduce(
    (sum, value) => ({
      calories: sum.calories + value.calories,
      proteinGrams: sum.proteinGrams + value.proteinGrams,
      carbsGrams: sum.carbsGrams + value.carbsGrams,
      fatGrams: sum.fatGrams + value.fatGrams,
      fiberGrams: sum.fiberGrams + value.fiberGrams,
    }),
    ZERO_TOTALS,
  );
}

function subtractTotals(
  left: MealMacroTotals,
  right: MealMacroTotals,
): MealMacroTotals {
  return {
    calories: left.calories - right.calories,
    proteinGrams: left.proteinGrams - right.proteinGrams,
    carbsGrams: left.carbsGrams - right.carbsGrams,
    fatGrams: left.fatGrams - right.fatGrams,
    fiberGrams: left.fiberGrams - right.fiberGrams,
  };
}

function assertTotals(totals: MealMacroTotals): void {
  for (const [name, value] of Object.entries(totals)) {
    assertNonNegative(value, name);
  }
}

function assertNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new MealPlanServiceError(
      "MEAL_PLAN_INVALID_INPUT",
      `${name} must be a finite non-negative number.`,
    );
  }
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new MealPlanServiceError(
      "MEAL_PLAN_INVALID_INPUT",
      `${name} must not be empty.`,
    );
  }
}

function assertTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format(new Date());
  } catch {
    throw new MealPlanServiceError(
      "MEAL_PLAN_INVALID_INPUT",
      "timezone must be a valid IANA timezone.",
    );
  }
}

function assertLocalFoodDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new MealPlanServiceError(
      "MEAL_PLAN_INVALID_INPUT",
      "localFoodDate must use YYYY-MM-DD.",
    );
  }
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year ?? 0, (month ?? 0) - 1, day ?? 0));
  if (parsed.toISOString().slice(0, 10) !== value) {
    throw new MealPlanServiceError(
      "MEAL_PLAN_INVALID_INPUT",
      "localFoodDate must be a real calendar date.",
    );
  }
}

function assertDateRange(from: string, to: string): void {
  assertLocalFoodDate(from);
  assertLocalFoodDate(to);
  if (from > to) {
    throw new MealPlanServiceError(
      "MEAL_PLAN_INVALID_INPUT",
      "Date range start must not be after its end.",
    );
  }
}

function assertVersion(
  actual: number,
  expected: number | undefined,
  id: string,
): void {
  if (actual !== expected) throw versionConflict(id, expected);
}

function versionConflict(
  resourceId: string,
  expectedVersion: number | undefined,
): MealPlanServiceError {
  return new MealPlanServiceError(
    "MEAL_PLAN_VERSION_CONFLICT",
    "The meal plan changed since it was loaded.",
    { resourceId, expectedVersion },
  );
}

function confirmationRequired(
  operation: "delete" | "replace",
  plan: DailyMealPlan,
): MealPlanServiceError {
  return new MealPlanServiceError(
    "MEAL_PLAN_CONFIRMATION_REQUIRED",
    `${operation === "delete" ? "Deleting" : "Replacing"} this meal plan requires explicit confirmation.`,
    {
      operation,
      planId: plan.id,
      localFoodDate: plan.localFoodDate,
      mealCount: plan.meals.length,
      version: plan.version,
    },
  );
}

function plannedMealNotFound(plannedMealId: string): MealPlanServiceError {
  return new MealPlanServiceError(
    "PLANNED_MEAL_NOT_FOUND",
    "The planned meal was not found in this profile.",
    { plannedMealId },
  );
}

function isVersionConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "MEAL_PLAN_VERSION_CONFLICT"
  );
}

function requireMeal(plan: DailyMealPlan, mealId: string): PlannedMeal {
  const meal = plan.meals.find((candidate) => candidate.id === mealId);
  if (meal === undefined) throw plannedMealNotFound(mealId);
  return meal;
}

function normalizeFoodName(value: string): string {
  return value.trim().toLocaleLowerCase("en-US").replace(/\s+/gu, " ");
}

function addDays(localFoodDate: string, days: number): string {
  const date = new Date(`${localFoodDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) /
      86_400_000,
  );
}

function planKey(profileId: string, localFoodDate: string): string {
  return `${profileId}\u0000${localFoodDate}`;
}

function copyOptionalPlan(
  plan: DailyMealPlan | undefined,
): DailyMealPlan | undefined {
  return plan === undefined ? undefined : copyPlan(plan);
}

function copyPlan(plan: DailyMealPlan): DailyMealPlan {
  return {
    ...plan,
    meals: plan.meals.map((meal) => ({
      ...meal,
      ingredients: meal.ingredients.map((ingredient) => ({
        ...ingredient,
        totals: { ...ingredient.totals },
      })),
    })),
  };
}

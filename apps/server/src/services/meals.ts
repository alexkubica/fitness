import type {
  MealDeleteInput,
  MealIngredientInput,
  MealLog,
  MealLogInput,
  MealLogListInput,
  MealLogSnapshot,
  MealLogSnapshotInput,
  MealLogSnapshotListInput,
  MealLogSnapshotState,
  MealLogUpsertResult,
  MealMacroTotals,
  NeonMealRepository,
  SavedMealTemplate,
  SavedMealTemplateInput,
} from "@fitness/db/dist/meals.js";

export type MealLogService = Readonly<{
  upsertMeal(input: MealLogInput): Promise<MealLog>;
  upsertMealWithResult(input: MealLogInput): Promise<MealLogUpsertResult>;
  deleteMeal(input: MealDeleteInput): Promise<MealLog | undefined>;
  listMeals(input: MealLogListInput): Promise<readonly MealLog[]>;
  upsertTemplate(input: SavedMealTemplateInput): Promise<SavedMealTemplate>;
  listTemplates(input: {
    userId: string;
    profileId?: string | undefined;
    limit?: number;
  }): Promise<readonly SavedMealTemplate[]>;
}>;

export type MealLogSnapshotService = Readonly<{
  createSnapshot(input: MealLogSnapshotInput): Promise<MealLogSnapshot>;
  getSnapshot(input: {
    userId: string;
    profileId?: string | undefined;
    snapshotId: string;
  }): Promise<MealLogSnapshot | undefined>;
  listSnapshots(
    input: MealLogSnapshotListInput,
  ): Promise<readonly MealLogSnapshot[]>;
}>;

export type MealRepositoryPort = Pick<
  NeonMealRepository,
  | "createSnapshot"
  | "deleteMeal"
  | "getSnapshot"
  | "listMeals"
  | "listSnapshots"
  | "listTemplates"
  | "upsertMeal"
  | "upsertMealWithResult"
  | "upsertTemplate"
>;

export function createInMemoryMealLogService(
  initialMeals: readonly MealLog[] = [],
  initialTemplates: readonly SavedMealTemplate[] = [],
): MealLogService {
  const meals = initialMeals.map(copyMeal);
  const templates = initialTemplates.map(copyTemplate);

  async function upsertMealWithResult(
    input: MealLogInput,
  ): Promise<MealLogUpsertResult> {
    const now = new Date().toISOString();
    const idempotentReplay = meals.find(
      (meal) =>
        meal.userId === input.userId &&
        sameProfile(meal.profileId, input.profileId) &&
        meal.idempotencyKey === input.idempotencyKey,
    );

    if (idempotentReplay !== undefined) {
      const meal = copyMeal(idempotentReplay);
      return {
        meal,
        operation: "unchanged",
        mealId: meal.id,
      };
    }

    const existingIndex = meals.findIndex(
      (meal) =>
        meal.userId === input.userId &&
        sameProfile(meal.profileId, input.profileId) &&
        input.clientMealId !== undefined &&
        meal.clientMealId === input.clientMealId &&
        meal.origin === input.origin,
    );
    const meal: MealLog = {
      id:
        existingIndex >= 0
          ? (meals[existingIndex]?.id ?? crypto.randomUUID())
          : crypto.randomUUID(),
      userId: input.userId,
      profileId: input.profileId,
      idempotencyKey: input.idempotencyKey,
      clientMealId: input.clientMealId,
      occurredAt: new Date(input.occurredAt).toISOString(),
      timezone: input.timezone,
      title: input.title,
      mealType: input.mealType,
      note: input.note ?? "",
      totals: { ...input.totals },
      ingredients: input.ingredients.map((ingredient, position) => ({
        ...ingredient,
        id: ingredient.clientIngredientId ?? crypto.randomUUID(),
        position,
        totals: { ...ingredient.totals },
      })),
      photoCount: input.photoCount,
      estimateStatus: input.estimateStatus,
      estimateConfidence: input.estimateConfidence,
      estimateSummary: input.estimateSummary,
      origin: input.origin,
      createdAt:
        existingIndex >= 0 ? (meals[existingIndex]?.createdAt ?? now) : now,
      updatedAt: now,
    };

    if (existingIndex >= 0) {
      meals[existingIndex] = meal;
    } else {
      meals.push(meal);
    }

    meals.sort(compareMealsDesc);

    return {
      meal: copyMeal(meal),
      operation: existingIndex >= 0 ? "updated" : "created",
      mealId: meal.id,
    };
  }

  return {
    async upsertMeal(input) {
      return (await upsertMealWithResult(input)).meal;
    },
    upsertMealWithResult,
    async deleteMeal(input) {
      const index = meals.findIndex(
        (meal) =>
          meal.userId === input.userId &&
          sameProfile(meal.profileId, input.profileId) &&
          (meal.id === input.id || meal.clientMealId === input.id),
      );

      if (index < 0) {
        return undefined;
      }

      const [deleted] = meals.splice(index, 1);

      return deleted === undefined ? undefined : copyMeal(deleted);
    },
    async listMeals(input) {
      const fromTime =
        input.range === undefined ? undefined : Date.parse(input.range.from);
      const toTime =
        input.range === undefined ? undefined : Date.parse(input.range.to);

      return meals
        .filter((meal) => meal.userId === input.userId)
        .filter((meal) => sameProfile(meal.profileId, input.profileId))
        .filter((meal) => {
          const time = Date.parse(meal.occurredAt);

          return (
            (fromTime === undefined || time >= fromTime) &&
            (toTime === undefined || time < toTime)
          );
        })
        .sort(compareMealsDesc)
        .slice(0, Math.min(Math.max(input.limit ?? 250, 1), 1_000))
        .map(copyMeal);
    },
    async upsertTemplate(input) {
      const now = new Date().toISOString();
      const existingIndex = templates.findIndex(
        (template) =>
          template.userId === input.userId &&
          sameProfile(template.profileId, input.profileId) &&
          template.clientTemplateId === input.clientTemplateId,
      );
      const template: SavedMealTemplate = {
        id:
          existingIndex >= 0
            ? (templates[existingIndex]?.id ?? crypto.randomUUID())
            : crypto.randomUUID(),
        userId: input.userId,
        profileId: input.profileId,
        clientTemplateId: input.clientTemplateId,
        title: input.title,
        mealType: input.mealType,
        note: input.note ?? "",
        totals: { ...input.totals },
        ingredients: input.ingredients.map((ingredient) => ({
          ...ingredient,
          totals: { ...ingredient.totals },
        })),
        usageCount: Math.max(
          input.usageCount ?? 0,
          existingIndex >= 0 ? (templates[existingIndex]?.usageCount ?? 0) : 0,
        ),
        lastUsedAt:
          existingIndex >= 0
            ? maxIso(templates[existingIndex]?.lastUsedAt, input.lastUsedAt)
            : new Date(input.lastUsedAt).toISOString(),
        createdAt:
          existingIndex >= 0
            ? (templates[existingIndex]?.createdAt ?? now)
            : now,
        updatedAt: now,
      };

      if (existingIndex >= 0) {
        templates[existingIndex] = template;
      } else {
        templates.push(template);
      }

      templates.sort(compareTemplatesDesc);

      return copyTemplate(template);
    },
    async listTemplates(input) {
      return templates
        .filter((template) => template.userId === input.userId)
        .filter((template) => sameProfile(template.profileId, input.profileId))
        .sort(compareTemplatesDesc)
        .slice(0, Math.min(Math.max(input.limit ?? 50, 1), 200))
        .map(copyTemplate);
    },
  };
}

export function createInMemoryMealLogSnapshotService(
  initialSnapshots: readonly MealLogSnapshot[] = [],
): MealLogSnapshotService {
  const snapshots = initialSnapshots.map(copySnapshot);

  return {
    async createSnapshot(input) {
      const createdAt = new Date(input.createdAt ?? Date.now()).toISOString();
      const snapshot: MealLogSnapshot = {
        ...input,
        id: crypto.randomUUID(),
        beforeState: copySnapshotState(input.beforeState),
        afterState:
          input.afterState === undefined
            ? undefined
            : copySnapshotState(input.afterState),
        createdAt,
        expiresAt:
          input.expiresAt ??
          new Date(Date.parse(createdAt) + 24 * 60 * 60 * 1_000).toISOString(),
      };

      snapshots.push(snapshot);
      snapshots.sort(compareSnapshotsDesc);

      return copySnapshot(snapshot);
    },
    async getSnapshot(input) {
      const snapshot = snapshots.find(
        (candidate) =>
          candidate.userId === input.userId &&
          sameProfile(candidate.profileId, input.profileId) &&
          candidate.id === input.snapshotId,
      );

      return snapshot === undefined ? undefined : copySnapshot(snapshot);
    },
    async listSnapshots(input) {
      const now = Date.parse(input.now ?? new Date().toISOString());

      return snapshots
        .filter((snapshot) => snapshot.userId === input.userId)
        .filter((snapshot) => sameProfile(snapshot.profileId, input.profileId))
        .filter(
          (snapshot) =>
            input.date === undefined ||
            snapshot.affectedLocalDate === input.date,
        )
        .filter(
          (snapshot) =>
            input.includeExpired === true ||
            Date.parse(snapshot.expiresAt) > now,
        )
        .sort(compareSnapshotsDesc)
        .slice(0, Math.min(Math.max(input.limit ?? 20, 1), 100))
        .map(copySnapshot);
    },
  };
}

export function createSnapshottingMealLogService(
  meals: MealLogService,
  snapshots: MealLogSnapshotService,
): MealLogService {
  async function upsertMealWithResult(
    input: MealLogInput,
  ): Promise<MealLogUpsertResult> {
    const timezone = input.timezone || "Asia/Jerusalem";
    const affectedLocalDate = localDateForTimestamp(input.occurredAt, timezone);
    const beforeState = await dayState(meals, {
      userId: input.userId,
      profileId: input.profileId,
      localDate: affectedLocalDate,
      timezone,
    });
    const replay = beforeState.meals.find(
      (meal) => meal.idempotencyKey === input.idempotencyKey,
    );

    if (replay !== undefined) {
      return {
        meal: replay,
        operation: "unchanged",
        mealId: replay.id,
      };
    }

    const existing = beforeState.meals.find(
      (meal) =>
        input.clientMealId !== undefined &&
        meal.clientMealId === input.clientMealId &&
        meal.origin === input.origin,
    );
    const result = await meals.upsertMealWithResult(input);
    const afterState = await dayState(meals, {
      userId: input.userId,
      profileId: input.profileId,
      localDate: affectedLocalDate,
      timezone,
    });

    await createSnapshotIfAvailable(snapshots, {
      userId: input.userId,
      profileId: input.profileId,
      operationType: existing === undefined ? "upsert_create" : "upsert_update",
      affectedLocalDate,
      timezone,
      beforeState,
      afterState,
      source: snapshotSourceForOrigin(input.origin),
      description:
        existing === undefined
          ? `Created meal "${input.title}" on ${affectedLocalDate}.`
          : `Updated meal "${existing.title}" on ${affectedLocalDate}.`,
    });

    return result;
  }

  return {
    async upsertMeal(input) {
      return (await upsertMealWithResult(input)).meal;
    },
    upsertMealWithResult,
    async deleteMeal(input) {
      const candidate = await findMealForDelete(meals, input);

      if (candidate === undefined) {
        return meals.deleteMeal(input);
      }

      const timezone = candidate.timezone || "Asia/Jerusalem";
      const affectedLocalDate = localDateForTimestamp(
        candidate.occurredAt,
        timezone,
      );
      const beforeState = await dayState(meals, {
        userId: input.userId,
        profileId: input.profileId,
        localDate: affectedLocalDate,
        timezone,
      });
      const deleted = await meals.deleteMeal(input);
      const afterState = await dayState(meals, {
        userId: input.userId,
        profileId: input.profileId,
        localDate: affectedLocalDate,
        timezone,
      });

      if (deleted !== undefined) {
        await createSnapshotIfAvailable(snapshots, {
          userId: input.userId,
          profileId: input.profileId,
          operationType: "delete",
          affectedLocalDate,
          timezone,
          beforeState,
          afterState,
          source: snapshotSourceForOrigin(deleted.origin),
          description: `Deleted meal "${deleted.title}" from ${affectedLocalDate}.`,
        });
      }

      return deleted;
    },
    listMeals(input) {
      return meals.listMeals(input);
    },
    listTemplates(input) {
      return meals.listTemplates(input);
    },
    upsertTemplate(input) {
      return meals.upsertTemplate(input);
    },
  };
}

export function createRepositoryMealLogService(
  repository: MealRepositoryPort,
): MealLogService {
  return {
    deleteMeal(input) {
      return repository.deleteMeal(input);
    },
    listMeals(input) {
      return repository.listMeals(input);
    },
    listTemplates(input) {
      return repository.listTemplates(input);
    },
    upsertMeal(input) {
      return repository.upsertMeal(input);
    },
    upsertMealWithResult(input) {
      return repository.upsertMealWithResult(input);
    },
    upsertTemplate(input) {
      return repository.upsertTemplate(input);
    },
  };
}

export function createRepositoryMealLogSnapshotService(
  repository: MealRepositoryPort,
): MealLogSnapshotService {
  return {
    createSnapshot(input) {
      return repository.createSnapshot(input);
    },
    getSnapshot(input) {
      return repository.getSnapshot(input);
    },
    listSnapshots(input) {
      return repository.listSnapshots(input);
    },
  };
}

function compareMealsDesc(left: MealLog, right: MealLog): number {
  return Date.parse(right.occurredAt) - Date.parse(left.occurredAt);
}

function compareTemplatesDesc(
  left: SavedMealTemplate,
  right: SavedMealTemplate,
): number {
  return Date.parse(right.lastUsedAt) - Date.parse(left.lastUsedAt);
}

function compareSnapshotsDesc(
  left: MealLogSnapshot,
  right: MealLogSnapshot,
): number {
  return Date.parse(right.createdAt) - Date.parse(left.createdAt);
}

function copyMeal(meal: MealLog): MealLog {
  return {
    ...meal,
    totals: { ...meal.totals },
    ingredients: meal.ingredients.map((ingredient) => ({
      ...ingredient,
      totals: { ...ingredient.totals },
    })),
  };
}

function copyTemplate(template: SavedMealTemplate): SavedMealTemplate {
  return {
    ...template,
    totals: { ...template.totals },
    ingredients: template.ingredients.map((ingredient) => ({
      ...ingredient,
      totals: { ...ingredient.totals },
    })),
  };
}

export async function restoreMealLogSnapshot(input: {
  meals: MealLogService;
  snapshots: MealLogSnapshotService;
  snapshot: MealLogSnapshot;
  source: MealLogSnapshotInput["source"];
}): Promise<MealLogSnapshotState> {
  const currentState = await dayState(input.meals, {
    userId: input.snapshot.userId,
    profileId: input.snapshot.profileId,
    localDate: input.snapshot.affectedLocalDate,
    timezone: input.snapshot.timezone,
  });

  await createSnapshotIfAvailable(input.snapshots, {
    userId: input.snapshot.userId,
    profileId: input.snapshot.profileId,
    operationType: "rollback",
    affectedLocalDate: input.snapshot.affectedLocalDate,
    timezone: input.snapshot.timezone,
    beforeState: currentState,
    source: input.source,
    description: `Rollback snapshot before restoring ${input.snapshot.id}.`,
  });

  const beforeIds = new Set(
    input.snapshot.beforeState.meals.flatMap((meal) => [
      meal.id,
      meal.clientMealId ?? "",
    ]),
  );

  for (const meal of currentState.meals) {
    if (!beforeIds.has(meal.id) && !beforeIds.has(meal.clientMealId ?? "")) {
      await input.meals.deleteMeal({
        userId: meal.userId,
        profileId: meal.profileId,
        id: meal.id,
        deletedAt: new Date().toISOString(),
      });
    }
  }

  for (const meal of input.snapshot.beforeState.meals) {
    await input.meals.upsertMeal(mealToInput(meal));
  }

  return dayState(input.meals, {
    userId: input.snapshot.userId,
    profileId: input.snapshot.profileId,
    localDate: input.snapshot.affectedLocalDate,
    timezone: input.snapshot.timezone,
  });
}

async function createSnapshotIfAvailable(
  snapshots: MealLogSnapshotService,
  input: MealLogSnapshotInput,
): Promise<MealLogSnapshot | undefined> {
  try {
    return await snapshots.createSnapshot(input);
  } catch (error) {
    if (isMissingSnapshotInfrastructure(error)) {
      return undefined;
    }

    throw error;
  }
}

export function isMissingSnapshotInfrastructure(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const candidate = error as { code?: unknown; message?: unknown };

  return (
    candidate.code === "42P01" ||
    (typeof candidate.message === "string" &&
      candidate.message.includes(
        'relation "meal_log_snapshots" does not exist',
      ))
  );
}

function mealToInput(meal: MealLog): MealLogInput {
  return {
    userId: meal.userId,
    profileId: meal.profileId,
    idempotencyKey: meal.idempotencyKey,
    clientMealId: meal.clientMealId,
    occurredAt: meal.occurredAt,
    timezone: meal.timezone,
    title: meal.title,
    mealType: meal.mealType,
    note: meal.note,
    totals: { ...meal.totals },
    ingredients: meal.ingredients.map(
      (ingredient): MealIngredientInput => ({
        clientIngredientId: ingredient.clientIngredientId ?? ingredient.id,
        name: ingredient.name,
        quantity: ingredient.quantity,
        unit: ingredient.unit,
        grams: ingredient.grams,
        totals: { ...ingredient.totals },
      }),
    ),
    photoCount: meal.photoCount,
    estimateStatus: meal.estimateStatus,
    estimateConfidence: meal.estimateConfidence,
    estimateSummary: meal.estimateSummary,
    origin: meal.origin as MealLogInput["origin"],
  };
}

async function findMealForDelete(
  meals: MealLogService,
  input: MealDeleteInput,
): Promise<MealLog | undefined> {
  const candidates = await meals.listMeals({
    userId: input.userId,
    profileId: input.profileId,
    limit: 1_000,
  });

  return candidates.find(
    (meal) => meal.id === input.id || meal.clientMealId === input.id,
  );
}

async function dayState(
  meals: MealLogService,
  input: {
    userId: string;
    profileId?: string | undefined;
    localDate: string;
    timezone: string;
  },
): Promise<MealLogSnapshotState> {
  const range = localDayRange(input.localDate, input.timezone);
  const dayMeals = await meals.listMeals({
    userId: input.userId,
    profileId: input.profileId,
    range,
    limit: 1_000,
  });

  return {
    meals: dayMeals,
    totals: sumMealTotals(dayMeals),
  };
}

function sumMealTotals(meals: readonly MealLog[]): MealMacroTotals {
  return meals.reduce<MealMacroTotals>(
    (totals, meal) => ({
      calories: round(totals.calories + meal.totals.calories),
      proteinGrams: round(totals.proteinGrams + meal.totals.proteinGrams),
      carbsGrams: round(totals.carbsGrams + meal.totals.carbsGrams),
      fatGrams: round(totals.fatGrams + meal.totals.fatGrams),
      fiberGrams: round(totals.fiberGrams + meal.totals.fiberGrams),
    }),
    {
      calories: 0,
      proteinGrams: 0,
      carbsGrams: 0,
      fatGrams: 0,
      fiberGrams: 0,
    },
  );
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function copySnapshot(snapshot: MealLogSnapshot): MealLogSnapshot {
  return {
    ...snapshot,
    beforeState: copySnapshotState(snapshot.beforeState),
    afterState:
      snapshot.afterState === undefined
        ? undefined
        : copySnapshotState(snapshot.afterState),
  };
}

function copySnapshotState(state: MealLogSnapshotState): MealLogSnapshotState {
  return {
    meals: state.meals.map(copyMeal),
    totals: { ...state.totals },
  };
}

function snapshotSourceForOrigin(
  origin: string,
): MealLogSnapshotInput["source"] {
  if (
    origin === "ios" ||
    origin === "web" ||
    origin === "mcp" ||
    origin === "telegram"
  ) {
    return origin;
  }

  return "server";
}

function sameProfile(
  rowProfileId: string | undefined,
  inputProfileId: string | undefined,
): boolean {
  return inputProfileId === undefined || rowProfileId === inputProfileId;
}

function localDateForTimestamp(timestamp: string, timezone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      day: "2-digit",
      month: "2-digit",
      timeZone: timezone,
      year: "numeric",
    })
      .formatToParts(new Date(timestamp))
      .map((part) => [part.type, part.value]),
  );

  return `${parts.year}-${parts.month}-${parts.day}`;
}

function localDayRange(
  localDate: string,
  timezone: string,
): { from: string; to: string } {
  const [yearText, monthText, dayText] = localDate.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const from = zonedDateTimeToUtc(year, month, day, 0, 0, timezone);
  const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
  const to = zonedDateTimeToUtc(
    nextDay.getUTCFullYear(),
    nextDay.getUTCMonth() + 1,
    nextDay.getUTCDate(),
    0,
    0,
    timezone,
  );

  return { from: from.toISOString(), to: to.toISOString() };
}

function zonedDateTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string,
): Date {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const offset = timezoneOffsetMs(utcGuess, timezone);

  return new Date(utcGuess.getTime() - offset);
}

function timezoneOffsetMs(date: Date, timezone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
      minute: "2-digit",
      month: "2-digit",
      second: "2-digit",
      timeZone: timezone,
      year: "numeric",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );

  return asUtc - date.getTime();
}

function maxIso(left: string | undefined, right: string): string {
  if (left === undefined) {
    return new Date(right).toISOString();
  }

  return Date.parse(left) >= Date.parse(right)
    ? new Date(left).toISOString()
    : new Date(right).toISOString();
}

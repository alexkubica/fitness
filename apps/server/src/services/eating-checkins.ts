import { randomUUID } from "node:crypto";
import type {
  EatingCheckIn,
  EatingCheckInInput,
  EatingCheckInListInput,
  EatingCheckInPatch,
  EatingCheckInRepository,
  EatingContext,
} from "@fitness/db";
import { EATING_CONTEXTS } from "@fitness/db";

export type EatingCheckInUpsertResult = Readonly<{
  checkIn: EatingCheckIn;
  operation: "created" | "unchanged";
}>;

export type EatingTriggerSummary = Readonly<{
  checkInCount: number;
  triggerCounts: readonly PatternCount[];
  emotionCounts: readonly PatternCount[];
  contextCounts: readonly PatternCount[];
  averageHungerBefore?: number | undefined;
  averageUrgeIntensity?: number | undefined;
  screenEatingCount: number;
  secondServingCount: number;
  ateUntilPainCount: number;
  lossOfControlCount: number;
  copingActionsThatHelped: readonly PatternCount[];
  safetyNote: string;
}>;

export type BingePatternSummary = Readonly<{
  episodeCount: number;
  commonEpisodeHours: readonly PatternCount[];
  averageHungerBeforeEpisode?: number | undefined;
  averageUrgeIntensityEpisode?: number | undefined;
  emotionalTriggerCounts: readonly PatternCount[];
  screenRelatedEpisodes: number;
  secondServingEpisodes: number;
  eatingUntilPainEpisodes: number;
  copingActionsThatHelped: readonly PatternCount[];
  professionalAssessmentPrompt?: string | undefined;
  safetyNote: string;
}>;

export type CbtWeeklyReport = Readonly<{
  from: string;
  to: string;
  metrics: Readonly<{
    checkIns: number;
    unplannedEatingEvents: number;
    averageHungerBeforeMeals?: number | undefined;
    averageFullnessAfterMeals?: number | undefined;
    urgesDelayedSuccessfully: number;
    eatingWithScreens: number;
    secondServings: number;
    eatingUntilDiscomfortOrPain: number;
    lossOfControlEpisodes: number;
    averageUrgeDelayMinutes?: number | undefined;
  }>;
  triggerSummary: EatingTriggerSummary;
  bingePatternSummary: BingePatternSummary;
  defaultAfterOvereatingGuidance: readonly string[];
  safetyNote: string;
}>;

export type PatternCount = Readonly<{
  value: string;
  count: number;
}>;

export type EatingCheckInService = Readonly<{
  createCheckIn(input: EatingCheckInInput): Promise<EatingCheckInUpsertResult>;
  updateCheckIn(input: {
    userId: string;
    profileId?: string | undefined;
    checkInId: string;
    patch: EatingCheckInPatch;
  }): Promise<EatingCheckIn | undefined>;
  getCheckIns(input: EatingCheckInListInput): Promise<readonly EatingCheckIn[]>;
  getLatestCheckIn(input: {
    userId: string;
    profileId?: string | undefined;
  }): Promise<EatingCheckIn | undefined>;
  linkCheckInToMeal(input: {
    userId: string;
    profileId?: string | undefined;
    checkInId: string;
    linkedMealId?: string | undefined;
    linkedPlannedMealId?: string | undefined;
  }): Promise<EatingCheckIn | undefined>;
  getTriggerSummary(
    input: EatingCheckInListInput,
  ): Promise<EatingTriggerSummary>;
  getBingePatternSummary(
    input: EatingCheckInListInput,
  ): Promise<BingePatternSummary>;
  getWeeklyReport(input: EatingCheckInListInput): Promise<CbtWeeklyReport>;
}>;

const safetyNote =
  "These are behavioral eating patterns, not a medical diagnosis. If episodes feel frequent, distressing, or hard to control, consider professional assessment.";

const defaultAfterOvereatingGuidance = [
  "Record the context without guilt or moral labels.",
  "Avoid fasting, skipping meals, punitive exercise, or extreme restriction to compensate.",
  "Return to the normal next planned meal.",
  "Choose one small adjustment for the next similar situation.",
] as const;

export function createInMemoryEatingCheckInService(
  initialCheckIns: readonly EatingCheckIn[] = [],
): EatingCheckInService {
  const checkIns = initialCheckIns.map(copyCheckIn);

  const repository: EatingCheckInRepository = {
    async createCheckIn(input) {
      const replay =
        input.idempotencyKey === undefined
          ? undefined
          : checkIns.find(
              (checkIn) =>
                checkIn.userId === input.userId &&
                sameProfile(checkIn.profileId, input.profileId) &&
                checkIn.idempotencyKey === input.idempotencyKey,
            );

      if (replay !== undefined) return copyCheckIn(replay);

      const now = new Date().toISOString();
      const checkIn: EatingCheckIn = {
        id: randomUUID(),
        userId: input.userId,
        profileId: input.profileId,
        idempotencyKey: input.idempotencyKey,
        occurredAt: new Date(input.occurredAt).toISOString(),
        timezone: input.timezone,
        linkedMealId: input.linkedMealId,
        linkedPlannedMealId: input.linkedPlannedMealId,
        hungerBefore: input.hungerBefore,
        fullnessAfter: input.fullnessAfter,
        urgeIntensity: input.urgeIntensity,
        emotionIntensity: input.emotionIntensity,
        emotions: [...(input.emotions ?? [])],
        triggers: [...(input.triggers ?? [])],
        automaticThought: input.automaticThought,
        balancedResponse: input.balancedResponse,
        eatingContext: input.eatingContext,
        lossOfControl: input.lossOfControl,
        ateUntilPain: input.ateUntilPain,
        ateWithScreen: input.ateWithScreen,
        ateFromPackage: input.ateFromPackage,
        tookSecondServing: input.tookSecondServing,
        copingAction: input.copingAction,
        urgeDelayMinutes: input.urgeDelayMinutes,
        outcome: input.outcome,
        note: input.note,
        createdAt: now,
        updatedAt: now,
      };

      checkIns.push(checkIn);
      checkIns.sort(compareCheckInsDesc);
      return copyCheckIn(checkIn);
    },
    async updateCheckIn(input) {
      const index = checkIns.findIndex(
        (checkIn) =>
          checkIn.userId === input.userId &&
          sameProfile(checkIn.profileId, input.profileId) &&
          checkIn.id === input.checkInId,
      );
      if (index < 0) return undefined;
      const existing = checkIns[index];
      if (existing === undefined) return undefined;
      const updated = copyCheckIn({
        ...existing,
        ...input.patch,
        emotions: input.patch.emotions ?? existing.emotions,
        triggers: input.patch.triggers ?? existing.triggers,
        occurredAt:
          input.patch.occurredAt === undefined
            ? existing.occurredAt
            : new Date(input.patch.occurredAt).toISOString(),
        updatedAt: new Date().toISOString(),
      });
      checkIns[index] = updated;
      checkIns.sort(compareCheckInsDesc);
      return copyCheckIn(updated);
    },
    async listCheckIns(input) {
      const fromTime =
        input.range === undefined ? undefined : Date.parse(input.range.from);
      const toTime =
        input.range === undefined ? undefined : Date.parse(input.range.to);
      return checkIns
        .filter((checkIn) => checkIn.userId === input.userId)
        .filter((checkIn) => sameProfile(checkIn.profileId, input.profileId))
        .filter((checkIn) => {
          const time = Date.parse(checkIn.occurredAt);
          return (
            (fromTime === undefined || time >= fromTime) &&
            (toTime === undefined || time < toTime)
          );
        })
        .filter(
          (checkIn) =>
            input.linkedMealId === undefined ||
            checkIn.linkedMealId === input.linkedMealId,
        )
        .filter(
          (checkIn) =>
            input.linkedPlannedMealId === undefined ||
            checkIn.linkedPlannedMealId === input.linkedPlannedMealId,
        )
        .slice(0, Math.min(Math.max(input.limit ?? 100, 1), 500))
        .map(copyCheckIn);
    },
    async getLatestCheckIn(input) {
      return (
        checkIns
          .filter((checkIn) => checkIn.userId === input.userId)
          .filter((checkIn) => sameProfile(checkIn.profileId, input.profileId))
          .sort(compareCheckInsDesc)
          .map(copyCheckIn)[0] ?? undefined
      );
    },
    async linkCheckInToMeal(input) {
      return this.updateCheckIn({
        userId: input.userId,
        profileId: input.profileId,
        checkInId: input.checkInId,
        patch: {
          linkedMealId: input.linkedMealId,
          linkedPlannedMealId: input.linkedPlannedMealId,
        },
      });
    },
  };

  return createRepositoryEatingCheckInService(repository);
}

export function createRepositoryEatingCheckInService(
  repository: EatingCheckInRepository,
): EatingCheckInService {
  return {
    async createCheckIn(input) {
      validateInput(input);
      const replay =
        input.idempotencyKey === undefined
          ? undefined
          : (
              await repository.listCheckIns({
                userId: input.userId,
                profileId: input.profileId,
                limit: 500,
              })
            ).find(
              (checkIn) => checkIn.idempotencyKey === input.idempotencyKey,
            );
      const checkIn = await repository.createCheckIn({
        ...input,
        emotions: normalizeTags(input.emotions),
        triggers: normalizeTags(input.triggers),
      });
      return {
        checkIn,
        operation: replay === undefined ? "created" : "unchanged",
      };
    },
    async updateCheckIn(input) {
      validatePatch(input.patch);
      return repository.updateCheckIn({
        ...input,
        patch: {
          ...input.patch,
          emotions:
            input.patch.emotions === undefined
              ? undefined
              : normalizeTags(input.patch.emotions),
          triggers:
            input.patch.triggers === undefined
              ? undefined
              : normalizeTags(input.patch.triggers),
        },
      });
    },
    getCheckIns(input) {
      return repository.listCheckIns(input);
    },
    getLatestCheckIn(input) {
      return repository.getLatestCheckIn(input);
    },
    linkCheckInToMeal(input) {
      return repository.linkCheckInToMeal(input);
    },
    async getTriggerSummary(input) {
      return triggerSummary(await repository.listCheckIns(input));
    },
    async getBingePatternSummary(input) {
      return bingePatternSummary(await repository.listCheckIns(input));
    },
    async getWeeklyReport(input) {
      const checkIns = await repository.listCheckIns(input);
      const trigger = triggerSummary(checkIns);
      const binge = bingePatternSummary(checkIns);
      return {
        from: input.range?.from ?? "",
        to: input.range?.to ?? "",
        metrics: {
          checkIns: checkIns.length,
          unplannedEatingEvents: checkIns.filter(
            (checkIn) =>
              checkIn.linkedMealId === undefined &&
              checkIn.linkedPlannedMealId === undefined,
          ).length,
          averageHungerBeforeMeals: average(
            checkIns.flatMap((checkIn) =>
              checkIn.hungerBefore === undefined ? [] : [checkIn.hungerBefore],
            ),
          ),
          averageFullnessAfterMeals: average(
            checkIns.flatMap((checkIn) =>
              checkIn.fullnessAfter === undefined
                ? []
                : [checkIn.fullnessAfter],
            ),
          ),
          urgesDelayedSuccessfully: checkIns.filter(
            (checkIn) =>
              (checkIn.urgeDelayMinutes ?? 0) > 0 &&
              positiveOutcome(checkIn.outcome),
          ).length,
          eatingWithScreens: checkIns.filter(
            (checkIn) => checkIn.ateWithScreen === true,
          ).length,
          secondServings: checkIns.filter(
            (checkIn) => checkIn.tookSecondServing === true,
          ).length,
          eatingUntilDiscomfortOrPain: checkIns.filter(
            (checkIn) => checkIn.ateUntilPain === true,
          ).length,
          lossOfControlEpisodes: checkIns.filter(
            (checkIn) => checkIn.lossOfControl === true,
          ).length,
          averageUrgeDelayMinutes: average(
            checkIns.flatMap((checkIn) =>
              checkIn.urgeDelayMinutes === undefined
                ? []
                : [checkIn.urgeDelayMinutes],
            ),
          ),
        },
        triggerSummary: trigger,
        bingePatternSummary: binge,
        defaultAfterOvereatingGuidance,
        safetyNote,
      };
    },
  };
}

function triggerSummary(
  checkIns: readonly EatingCheckIn[],
): EatingTriggerSummary {
  return {
    checkInCount: checkIns.length,
    triggerCounts: topCounts(checkIns.flatMap((checkIn) => checkIn.triggers)),
    emotionCounts: topCounts(checkIns.flatMap((checkIn) => checkIn.emotions)),
    contextCounts: topCounts(
      checkIns.flatMap((checkIn) =>
        checkIn.eatingContext === undefined ? [] : [checkIn.eatingContext],
      ),
    ),
    averageHungerBefore: average(
      checkIns.flatMap((checkIn) =>
        checkIn.hungerBefore === undefined ? [] : [checkIn.hungerBefore],
      ),
    ),
    averageUrgeIntensity: average(
      checkIns.flatMap((checkIn) =>
        checkIn.urgeIntensity === undefined ? [] : [checkIn.urgeIntensity],
      ),
    ),
    screenEatingCount: checkIns.filter(
      (checkIn) => checkIn.ateWithScreen === true,
    ).length,
    secondServingCount: checkIns.filter(
      (checkIn) => checkIn.tookSecondServing === true,
    ).length,
    ateUntilPainCount: checkIns.filter(
      (checkIn) => checkIn.ateUntilPain === true,
    ).length,
    lossOfControlCount: checkIns.filter(
      (checkIn) => checkIn.lossOfControl === true,
    ).length,
    copingActionsThatHelped: topCounts(
      checkIns.flatMap((checkIn) =>
        checkIn.copingAction !== undefined && positiveOutcome(checkIn.outcome)
          ? [checkIn.copingAction]
          : [],
      ),
    ),
    safetyNote,
  };
}

function bingePatternSummary(
  checkIns: readonly EatingCheckIn[],
): BingePatternSummary {
  const episodes = checkIns.filter(
    (checkIn) =>
      checkIn.lossOfControl === true || checkIn.ateUntilPain === true,
  );
  return {
    episodeCount: episodes.length,
    commonEpisodeHours: topCounts(
      episodes.map((checkIn) => new Date(checkIn.occurredAt).getUTCHours()),
    ).map((entry) => ({ value: `${entry.value}:00`, count: entry.count })),
    averageHungerBeforeEpisode: average(
      episodes.flatMap((checkIn) =>
        checkIn.hungerBefore === undefined ? [] : [checkIn.hungerBefore],
      ),
    ),
    averageUrgeIntensityEpisode: average(
      episodes.flatMap((checkIn) =>
        checkIn.urgeIntensity === undefined ? [] : [checkIn.urgeIntensity],
      ),
    ),
    emotionalTriggerCounts: topCounts(
      episodes.flatMap((checkIn) => [...checkIn.emotions, ...checkIn.triggers]),
    ),
    screenRelatedEpisodes: episodes.filter(
      (checkIn) => checkIn.ateWithScreen === true,
    ).length,
    secondServingEpisodes: episodes.filter(
      (checkIn) => checkIn.tookSecondServing === true,
    ).length,
    eatingUntilPainEpisodes: episodes.filter(
      (checkIn) => checkIn.ateUntilPain === true,
    ).length,
    copingActionsThatHelped: topCounts(
      episodes.flatMap((checkIn) =>
        checkIn.copingAction !== undefined && positiveOutcome(checkIn.outcome)
          ? [checkIn.copingAction]
          : [],
      ),
    ),
    professionalAssessmentPrompt: episodes.length >= 2 ? safetyNote : undefined,
    safetyNote,
  };
}

function validateInput(input: EatingCheckInInput): void {
  validateIsoDate(input.occurredAt, "occurredAt");
  assertTimezone(input.timezone);
  validateScale(input.hungerBefore, "hungerBefore");
  validateScale(input.fullnessAfter, "fullnessAfter");
  validateScale(input.urgeIntensity, "urgeIntensity");
  validateScale(input.emotionIntensity, "emotionIntensity");
  validateEatingContext(input.eatingContext);
  validateNonNegative(input.urgeDelayMinutes, "urgeDelayMinutes");
}

function validatePatch(patch: EatingCheckInPatch): void {
  if (patch.occurredAt !== undefined)
    validateIsoDate(patch.occurredAt, "occurredAt");
  if (patch.timezone !== undefined) assertTimezone(patch.timezone);
  validateScale(patch.hungerBefore, "hungerBefore");
  validateScale(patch.fullnessAfter, "fullnessAfter");
  validateScale(patch.urgeIntensity, "urgeIntensity");
  validateScale(patch.emotionIntensity, "emotionIntensity");
  validateEatingContext(patch.eatingContext);
  validateNonNegative(patch.urgeDelayMinutes, "urgeDelayMinutes");
}

function validateIsoDate(value: string, label: string): void {
  if (Number.isNaN(Date.parse(value))) {
    throw new Error(`${label} must be a valid ISO timestamp.`);
  }
}

function assertTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format(new Date());
  } catch {
    throw new Error("timezone must be a valid IANA timezone.");
  }
}

function validateScale(value: number | undefined, label: string): void {
  if (
    value !== undefined &&
    (!Number.isInteger(value) || value < 0 || value > 10)
  ) {
    throw new Error(`${label} must be an integer from 0 to 10.`);
  }
}

function validateEatingContext(value: EatingContext | undefined): void {
  if (value !== undefined && !EATING_CONTEXTS.includes(value)) {
    throw new Error("eatingContext is invalid.");
  }
}

function validateNonNegative(value: number | undefined, label: string): void {
  if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
    throw new Error(`${label} must be non-negative.`);
  }
}

function normalizeTags(
  values: readonly string[] | undefined,
): readonly string[] {
  return Array.from(
    new Set(
      (values ?? [])
        .map((value) => value.trim().toLocaleLowerCase("en-US"))
        .filter((value) => value.length > 0),
    ),
  ).slice(0, 40);
}

function topCounts(
  values: readonly (number | string)[],
): readonly PatternCount[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = String(value).trim();
    if (key.length === 0) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([value, count]) => ({ value, count }))
    .sort(
      (left, right) =>
        right.count - left.count || left.value.localeCompare(right.value),
    )
    .slice(0, 10);
}

function average(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  return (
    Math.round(
      (values.reduce((sum, value) => sum + value, 0) / values.length) * 10,
    ) / 10
  );
}

function positiveOutcome(value: string | undefined): boolean {
  return value === undefined
    ? false
    : /worked|helped|better|successful|success|ok|okay|calmer|stopped/iu.test(
        value,
      );
}

function compareCheckInsDesc(
  left: EatingCheckIn,
  right: EatingCheckIn,
): number {
  return Date.parse(right.occurredAt) - Date.parse(left.occurredAt);
}

function copyCheckIn(checkIn: EatingCheckIn): EatingCheckIn {
  return {
    ...checkIn,
    emotions: [...checkIn.emotions],
    triggers: [...checkIn.triggers],
  };
}

function sameProfile(
  left: string | undefined,
  right: string | undefined,
): boolean {
  return left === right || (left === undefined && right === undefined);
}

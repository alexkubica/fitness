import {
  formatDailyCoachReportText,
  generateDailyCoachReport,
  type CoachReportCheckIn,
  type CoachReportMealLog,
  type CoachReportRange,
  type DailyCoachReport,
  localDateInTimezone,
} from "@fitness/domain";
import type { MealLog, TargetPlanRepository } from "@fitness/db";
import type { HealthReadService } from "./health-read.js";
import type { MealLogService } from "./meals.js";
import type {
  TelegramBotStorage,
  TelegramCheckIn,
  TelegramMealLog,
} from "../telegram/bot.js";

export type CoachReportResult = Readonly<{
  report: DailyCoachReport;
  text: string;
}>;

export type CoachReportInput = Readonly<{
  userId: string;
  profileId?: string | undefined;
  range: CoachReportRange;
  timezone?: string | undefined;
}>;

export type CoachReportPort = Readonly<{
  generateDailyReport(input: CoachReportInput): Promise<CoachReportResult>;
}>;

export type CoachReportServiceOptions = Readonly<{
  healthRead: HealthReadService;
  meals?: MealLogService | undefined;
  now?: () => Date;
  telegramStorage: TelegramBotStorage;
  targetPlans?: TargetPlanRepository | undefined;
}>;

export function createCoachReportService(
  options: CoachReportServiceOptions,
): CoachReportPort {
  const now = options.now ?? (() => new Date());

  return {
    async generateDailyReport(input) {
      const [
        healthSamples,
        storedCheckIns,
        storedTelegramMealLogs,
        storedAccountMealLogs,
        targetPlanHistory,
      ] = await Promise.all([
        options.healthRead.listSamples({
          userId: input.userId,
          profileId: input.profileId,
          range: input.range,
        }),
        options.telegramStorage.listCheckIns({
          userId: input.userId,
          profileId: input.profileId,
          range: input.range,
        }),
        options.telegramStorage.listMealLogs({
          userId: input.userId,
          profileId: input.profileId,
          range: input.range,
        }),
        options.meals?.listMeals({
          userId: input.userId,
          profileId: input.profileId,
          range: input.range,
          limit: 100,
        }) ?? Promise.resolve([]),
        input.profileId === undefined
          ? Promise.resolve([])
          : (options.targetPlans?.listHistory(input.profileId) ??
            Promise.resolve([])),
      ]);
      const checkIns = storedCheckIns
        .filter((checkIn) => checkIn.userId === input.userId)
        .filter((checkIn) => isWithinRange(checkIn.createdAt, input.range))
        .map(checkInForReport);
      const telegramMealLogs = storedTelegramMealLogs
        .filter((mealLog) => mealLog.userId === input.userId)
        .filter((mealLog) => isWithinRange(mealLog.createdAt, input.range))
        .map(mealLogForReport);
      const accountMealLogs = storedAccountMealLogs
        .filter((mealLog) => mealLog.userId === input.userId)
        .filter((mealLog) => isWithinRange(mealLog.occurredAt, input.range))
        .map(accountMealLogForReport);
      const report = generateDailyCoachReport({
        generatedAt: now().toISOString(),
        range: input.range,
        healthSamples,
        checkIns,
        mealLogs: [...telegramMealLogs, ...accountMealLogs],
        targetPeriods: targetPlanHistory
          .filter(
            (plan) => plan.status === "active" || plan.status === "superseded",
          )
          .filter((plan) => {
            const timezone = input.timezone ?? "UTC";
            const fromDate = localDateInTimezone(
              new Date(input.range.from),
              timezone,
            );
            const throughDate = localDateInTimezone(
              new Date(Date.parse(input.range.to) - 1),
              timezone,
            );
            return (
              plan.effectiveFrom <= throughDate &&
              (plan.effectiveUntil === undefined ||
                plan.effectiveUntil > fromDate)
            );
          })
          .sort((left, right) =>
            left.effectiveFrom.localeCompare(right.effectiveFrom),
          )
          .map((plan) => ({
            planId: plan.id,
            version: plan.version,
            effectiveFrom: plan.effectiveFrom,
            ...(plan.effectiveUntil === undefined
              ? {}
              : { effectiveUntil: plan.effectiveUntil }),
            targets: plan.targets,
          })),
      });

      return {
        report,
        text: formatDailyCoachReportText(report),
      };
    },
  };
}

export function lastTwentyFourHoursRange(now: Date): CoachReportRange {
  const to = now.toISOString();
  const from = new Date(now.getTime() - 24 * 60 * 60 * 1_000).toISOString();

  return {
    from,
    to,
  };
}

function checkInForReport(checkIn: TelegramCheckIn): CoachReportCheckIn {
  return {
    hunger: checkIn.hunger,
    mood: checkIn.mood,
    energy: checkIn.energy,
    stress: checkIn.stress,
    cravings: checkIn.cravings,
    notes: checkIn.notes,
    createdAt: checkIn.createdAt,
  };
}

function mealLogForReport(mealLog: TelegramMealLog): CoachReportMealLog {
  return {
    text: mealLog.text,
    createdAt: mealLog.createdAt,
  };
}

function accountMealLogForReport(mealLog: MealLog): CoachReportMealLog {
  const macrosArePresent =
    mealLog.totals.calories > 0 ||
    mealLog.totals.proteinGrams > 0 ||
    mealLog.totals.carbsGrams > 0 ||
    mealLog.totals.fatGrams > 0 ||
    mealLog.totals.fiberGrams > 0;

  return {
    text: mealLog.note.length > 0 ? mealLog.note : mealLog.title,
    createdAt: mealLog.occurredAt,
    hasMacroEstimate: macrosArePresent,
  };
}

function isWithinRange(timestamp: string, range: CoachReportRange): boolean {
  const time = Date.parse(timestamp);
  const from = Date.parse(range.from);
  const to = Date.parse(range.to);

  return (
    Number.isFinite(time) &&
    Number.isFinite(from) &&
    Number.isFinite(to) &&
    time >= from &&
    time < to
  );
}

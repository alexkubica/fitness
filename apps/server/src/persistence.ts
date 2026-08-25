import {
  createNeonClient,
  createNeonAuditRepository,
  createNeonCoachRepository,
  createNeonEatingCheckInRepository,
  createNeonHealthSampleRepository,
  createNeonMealRepository,
  createNeonDailyMealPlanRepository,
  createNeonOAuthRepository,
  createNeonProfileRepository,
  createNeonTelegramCoachRepository,
  createNeonTelegramLinkingRepository,
  createNeonTelegramReminderRepository,
  createNeonTargetPlanRepository,
  getDatabaseUrl,
  type SqlQueryExecutor,
} from "@fitness/db";
import type { AppServices } from "./app.js";
import { createRepositoryAuditService } from "./services/audit.js";
import { createAuthorizationService } from "./services/authorization.js";
import { createRepositoryCoachService } from "./services/coach.js";
import { createRepositoryHealthReadService } from "./services/health-read.js";
import { createRepositoryEatingCheckInService } from "./services/eating-checkins.js";
import { createRepositoryHealthSyncService } from "./services/health-sync.js";
import { createCoachReportService } from "./services/coach-report.js";
import {
  createRepositoryMealLogService,
  createRepositoryMealLogSnapshotService,
  createSnapshottingMealLogService,
} from "./services/meals.js";
import {
  createCoachMealPlanTargetProvider,
  createRepositoryMealPlanService,
  createVersionedMealPlanTargetProvider,
} from "./services/meal-plans.js";
import { createRepositoryProfileService } from "./services/profiles.js";
import { createTargetPlanService } from "./services/target-plans.js";
import { createRepositoryTelegramBotStorage } from "./telegram/bot.js";
import { createRepositoryTelegramLinkingService } from "./telegram/linking.js";
import { createRepositoryTelegramReminderPreferenceStore } from "./telegram/reminders.js";

export type PersistenceMode = "memory" | "neon";

export type PersistenceEnvironment = Readonly<
  Record<string, string | undefined>
>;

export function resolvePersistenceMode(
  env: PersistenceEnvironment = envRecord(),
): PersistenceMode {
  const mode = env.FITNESS_PERSISTENCE ?? "memory";

  if (mode === "memory" || mode === "neon") {
    return mode;
  }

  throw new Error("FITNESS_PERSISTENCE must be either 'memory' or 'neon'.");
}

export function createPersistenceServices(
  env: PersistenceEnvironment = envRecord(),
): Partial<AppServices> {
  const mode = resolvePersistenceMode(env);

  if (mode === "memory") {
    return {};
  }

  assertFakeAuthIsNotPointedAtLiveDatabase(env);

  const sql = createNeonClient(getDatabaseUrl(env)) as SqlQueryExecutor;
  const audit = createNeonAuditRepository(sql);
  const healthSamples = createNeonHealthSampleRepository(sql);
  const eatingCheckIns = createNeonEatingCheckInRepository(sql);
  const meals = createNeonMealRepository(sql);
  const dailyMealPlans = createNeonDailyMealPlanRepository(sql);
  const coach = createNeonCoachRepository(sql);
  const telegramLinking = createNeonTelegramLinkingRepository(sql);
  const telegramCoach = createNeonTelegramCoachRepository(sql);
  const telegramReminders = createNeonTelegramReminderRepository(sql);
  const oauth = createNeonOAuthRepository(sql);
  const profiles = createNeonProfileRepository(sql);
  const targetPlans = createNeonTargetPlanRepository(sql);
  const profileService = createRepositoryProfileService(profiles);
  const mealSnapshots = createRepositoryMealLogSnapshotService(meals);
  const mealLogService = createSnapshottingMealLogService(
    createRepositoryMealLogService(meals),
    mealSnapshots,
  );
  const coachService = createRepositoryCoachService(coach);
  const targetPlanService = createTargetPlanService(targetPlans);

  return {
    audit: createRepositoryAuditService(audit),
    authorization: createAuthorizationService(profileService),
    coach: coachService,
    eatingCheckIns: createRepositoryEatingCheckInService(eatingCheckIns),
    healthRead: createRepositoryHealthReadService(healthSamples),
    healthSync: createRepositoryHealthSyncService(healthSamples),
    meals: mealLogService,
    mealPlans: createRepositoryMealPlanService(dailyMealPlans, {
      meals: mealLogService,
      targets: createVersionedMealPlanTargetProvider(
        targetPlanService,
        profileService,
        createCoachMealPlanTargetProvider(coachService),
      ),
    }),
    mealSnapshots,
    oauth,
    profiles: profileService,
    reports: createCoachReportService({
      healthRead: createRepositoryHealthReadService(healthSamples),
      meals: mealLogService,
      targetPlans,
      telegramStorage: createRepositoryTelegramBotStorage(telegramCoach),
    }),
    telegramLinking: createRepositoryTelegramLinkingService(telegramLinking),
    telegramReminders:
      createRepositoryTelegramReminderPreferenceStore(telegramReminders),
    telegramStorage: createRepositoryTelegramBotStorage(telegramCoach),
    targetPlans: targetPlanService,
  };
}

function assertFakeAuthIsNotPointedAtLiveDatabase(
  env: PersistenceEnvironment,
): void {
  if (env.ALLOW_FAKE_AUTH_TOKENS !== "1") {
    return;
  }

  const databaseUrl = env.DATABASE_URL;

  if (databaseUrl === undefined || databaseUrl.length === 0) {
    return;
  }

  if (isDisposableDatabaseUrl(databaseUrl)) {
    return;
  }

  throw new Error(
    "Fake auth tokens cannot be enabled with Neon persistence against a non-local DATABASE_URL.",
  );
}

function isDisposableDatabaseUrl(databaseUrl: string): boolean {
  try {
    const url = new URL(databaseUrl);

    return ["127.0.0.1", "::1", "localhost"].includes(
      url.hostname.toLowerCase(),
    );
  } catch {
    return false;
  }
}

function envRecord(): PersistenceEnvironment {
  const globalWithProcess = globalThis as typeof globalThis & {
    process?: {
      env?: Record<string, string | undefined>;
    };
  };

  return globalWithProcess.process?.env ?? {};
}

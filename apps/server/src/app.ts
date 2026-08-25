import { Hono } from "hono";
import {
  requireHealthSyncAuth,
  resolveServerAuthConfig,
  type ServerAuthConfig,
  type ServerEnv,
} from "./auth.js";
import {
  resolveGoogleAuthConfig,
  type GoogleAuthConfig,
} from "./auth/google.js";
import {
  registerMcpOAuthMetadataRoutes,
  resolveMcpOAuthConfig,
  type McpOAuthConfig,
} from "./mcp/oauth-metadata.js";
import { registerMcpRoutes } from "./mcp/server.js";
import { registerOAuthRoutes } from "./oauth/routes.js";
import { createInMemoryOAuthStore, type OAuthStore } from "./oauth/store.js";
import {
  resolveOAuthRouteConfig,
  type OAuthRouteConfig,
} from "./oauth/service.js";
import { registerCoachRoutes } from "./routes/coach.js";
import { registerEatingCheckInRoutes } from "./routes/eating-checkins.js";
import { registerHealthSyncRoutes } from "./routes/health-sync.js";
import { registerGoogleAuthRoutes } from "./routes/google-auth.js";
import { registerMealEstimateRoutes } from "./routes/meal-estimate.js";
import { registerMealPlanRoutes } from "./routes/meal-plans.js";
import { registerMealRoutes } from "./routes/meals.js";
import { registerProfileRoutes } from "./routes/profiles.js";
import { registerTargetPlanRoutes } from "./routes/target-plans.js";
import { registerServiceHealthRoutes } from "./routes/service-health.js";
import {
  registerTelegramRoutes,
  resolveTelegramRouteConfig,
  type TelegramRouteConfig,
} from "./routes/telegram.js";
import {
  registerTelegramReminderJobRoutes,
  resolveTelegramReminderJobRouteConfig,
  type TelegramReminderJobRouteConfig,
} from "./routes/telegram-reminders.js";
import { createAuditService, type AuditPort } from "./services/audit.js";
import {
  createAuthorizationService,
  type AuthorizationService,
} from "./services/authorization.js";
import {
  createInMemoryCoachService,
  type CoachService,
} from "./services/coach.js";
import {
  createCoachReportService,
  type CoachReportPort,
} from "./services/coach-report.js";
import {
  createInMemoryHealthReadService,
  type HealthReadService,
} from "./services/health-read.js";
import {
  createInMemoryEatingCheckInService,
  type EatingCheckInService,
} from "./services/eating-checkins.js";
import {
  createHealthSyncService,
  type HealthSyncService,
} from "./services/health-sync.js";
import {
  createInMemoryMealLogService,
  createInMemoryMealLogSnapshotService,
  createSnapshottingMealLogService,
  type MealLogService,
  type MealLogSnapshotService,
} from "./services/meals.js";
import {
  createCoachMealPlanTargetProvider,
  createInMemoryMealPlanService,
  createVersionedMealPlanTargetProvider,
  type MealPlanService,
} from "./services/meal-plans.js";
import {
  createInMemoryProfileService,
  type ProfileService,
} from "./services/profiles.js";
import {
  createInMemoryTargetPlanService,
  type TargetPlanService,
} from "./services/target-plans.js";
import {
  resolveMealNutritionEstimator,
  type MealNutritionEstimator,
} from "./services/meal-estimate.js";
import {
  createInMemoryTelegramBotStorage,
  type TelegramBotStorage,
} from "./telegram/bot.js";
import {
  type AsyncTelegramLinkingService,
  createTelegramLinkingService,
} from "./telegram/linking.js";
import {
  createInMemoryTelegramReminderPreferenceStore,
  type TelegramReminderPreferenceStore,
} from "./telegram/reminders.js";

export type AppServices = Readonly<{
  audit: AuditPort;
  authorization: AuthorizationService;
  coach: CoachService;
  healthRead: HealthReadService;
  healthSync: HealthSyncService;
  eatingCheckIns: EatingCheckInService;
  mealEstimator?: MealNutritionEstimator | undefined;
  meals: MealLogService;
  mealPlans: MealPlanService;
  mealSnapshots: MealLogSnapshotService;
  profiles: ProfileService;
  reports: CoachReportPort;
  oauth: OAuthStore;
  telegramLinking: AsyncTelegramLinkingService;
  telegramReminders: TelegramReminderPreferenceStore;
  telegramStorage: TelegramBotStorage;
  targetPlans: TargetPlanService;
}>;

export type AppOptions = Readonly<{
  auth?: Partial<ServerAuthConfig>;
  googleAuth?: Partial<GoogleAuthConfig>;
  mcp?: Partial<McpOAuthConfig>;
  oauth?: Partial<OAuthRouteConfig>;
  telegram?: Partial<TelegramRouteConfig>;
  telegramReminderJob?: Partial<TelegramReminderJobRouteConfig>;
  services?: Partial<AppServices>;
}>;

export function createApp(options: AppOptions = {}): Hono<ServerEnv> {
  const app = new Hono<ServerEnv>();
  const healthRead =
    options.services?.healthRead ?? createInMemoryHealthReadService();
  const telegramStorage =
    options.services?.telegramStorage ?? createInMemoryTelegramBotStorage();
  const mealSnapshots =
    options.services?.mealSnapshots ?? createInMemoryMealLogSnapshotService();
  const rawMeals = options.services?.meals ?? createInMemoryMealLogService();
  const meals =
    options.services?.meals !== undefined &&
    options.services.mealSnapshots !== undefined
      ? options.services.meals
      : createSnapshottingMealLogService(rawMeals, mealSnapshots);
  const profiles = options.services?.profiles ?? createInMemoryProfileService();
  const authorization =
    options.services?.authorization ?? createAuthorizationService(profiles);
  const coach = options.services?.coach ?? createInMemoryCoachService();
  const eatingCheckIns =
    options.services?.eatingCheckIns ?? createInMemoryEatingCheckInService();
  const targetPlans =
    options.services?.targetPlans ?? createInMemoryTargetPlanService();
  const services: AppServices = {
    audit: options.services?.audit ?? createAuditService(),
    authorization,
    coach,
    eatingCheckIns,
    healthRead,
    healthSync: options.services?.healthSync ?? createHealthSyncService(),
    mealEstimator:
      options.services?.mealEstimator ?? resolveMealNutritionEstimator(),
    meals,
    mealPlans:
      options.services?.mealPlans ??
      createInMemoryMealPlanService({
        meals,
        targets: createVersionedMealPlanTargetProvider(
          targetPlans,
          profiles,
          createCoachMealPlanTargetProvider(coach),
        ),
      }),
    mealSnapshots,
    profiles,
    oauth: options.services?.oauth ?? createInMemoryOAuthStore(),
    reports:
      options.services?.reports ??
      createCoachReportService({
        healthRead,
        meals,
        telegramStorage,
      }),
    telegramLinking:
      options.services?.telegramLinking ?? createTelegramLinkingService(),
    telegramReminders:
      options.services?.telegramReminders ??
      createInMemoryTelegramReminderPreferenceStore(),
    telegramStorage,
    targetPlans,
  };
  const serverAuthConfig = resolveServerAuthConfig(options.auth);
  const mcpConfig = resolveMcpOAuthConfig(options.mcp);
  const oauthConfig = resolveOAuthRouteConfig(
    options.oauth,
    mcpConfig,
    serverAuthConfig,
  );
  const googleConfig = resolveGoogleAuthConfig(options.googleAuth, oauthConfig);
  const telegramConfig = resolveTelegramRouteConfig(options.telegram);
  const telegramReminderJobConfig = resolveTelegramReminderJobRouteConfig(
    options.telegramReminderJob,
  );

  registerServiceHealthRoutes(app);
  app.use("/api/health/*", requireHealthSyncAuth(serverAuthConfig));
  app.use("/api/coach/*", requireHealthSyncAuth(serverAuthConfig));
  app.use("/api/eating-checkins", requireHealthSyncAuth(serverAuthConfig));
  app.use("/api/eating-checkins/*", requireHealthSyncAuth(serverAuthConfig));
  app.use("/api/meals/*", requireHealthSyncAuth(serverAuthConfig));
  app.use("/api/profiles", requireHealthSyncAuth(serverAuthConfig));
  app.use("/api/profiles/*", requireHealthSyncAuth(serverAuthConfig));
  app.use("/api/targets/*", requireHealthSyncAuth(serverAuthConfig));
  registerMcpOAuthMetadataRoutes(app, mcpConfig);
  registerOAuthRoutes(
    app,
    services.oauth,
    oauthConfig,
    services.audit,
    googleConfig,
  );
  registerGoogleAuthRoutes(
    app,
    {
      audit: services.audit,
      telegramBotUsername: telegramConfig.botUsername,
      telegramLinking: services.telegramLinking,
    },
    services.oauth,
    oauthConfig,
    googleConfig,
  );
  registerMcpRoutes(app, services, mcpConfig);
  registerTelegramRoutes(app, services, telegramConfig);
  registerTelegramReminderJobRoutes(
    app,
    {
      audit: services.audit,
      telegramReminders: services.telegramReminders,
    },
    telegramReminderJobConfig,
  );
  registerHealthSyncRoutes(app, services);
  registerCoachRoutes(app, services);
  registerEatingCheckInRoutes(app, services);
  registerMealEstimateRoutes(app, services);
  registerMealPlanRoutes(app, services);
  registerMealRoutes(app, services);
  registerProfileRoutes(app, services);
  registerTargetPlanRoutes(app, services);

  return app;
}

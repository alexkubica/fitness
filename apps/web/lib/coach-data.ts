import { createNeonClient, getDatabaseUrl } from "@fitness/db/dist/client.js";
import {
  createNeonCoachRepository,
  type CoachProfile,
  type SqlQueryExecutor,
} from "@fitness/db/dist/coach.js";
import { getSelfProfileId } from "./profile-data";
import {
  createNeonTargetPlanRepository,
  type TargetPlanRepository,
} from "@fitness/db/dist/target-plans.js";
import type { TargetPlan } from "@fitness/domain";
import { createNeonProfileRepository } from "@fitness/db/dist/profiles.js";

export type CoachDashboardData = Readonly<{
  profile: CoachProfile | undefined;
  profileId: string;
  activePlan: TargetPlan | undefined;
  proposedPlans: readonly TargetPlan[];
  targetHistory: readonly TargetPlan[];
}>;

export async function getCoachDashboardData(
  userId: string,
): Promise<CoachDashboardData> {
  const sql = createNeonClient(getDatabaseUrl()) as SqlQueryExecutor;
  const repository = createNeonCoachRepository(sql);
  const profileId = await getSelfProfileId(sql, userId);
  const profile = await repository.getProfile(userId, profileId);
  const targets: TargetPlanRepository = createNeonTargetPlanRepository(sql);
  const profileAccess = await createNeonProfileRepository(sql).getProfileAccess(
    {
      userId,
      profileId,
    },
  );
  const targetHistory = await targets.listHistory(profileId);
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: profileAccess?.profile.timezone ?? "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const activePlan = await targets.getActivePlan(profileId, today);

  return {
    profile,
    profileId,
    activePlan,
    proposedPlans: targetHistory.filter((plan) => plan.status === "proposed"),
    targetHistory,
  };
}

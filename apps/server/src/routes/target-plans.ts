import {
  assertLocalDate,
  assertTargetPlanTargets,
  type NutritionGoal,
  type TargetPlanCalculationMode,
  type TargetPlanTargets,
  type TargetRecommendationInput,
} from "@fitness/domain";
import type { Context, Hono } from "hono";
import type { ServerEnv } from "../auth.js";
import type { AuditPort } from "../services/audit.js";
import {
  TargetPlanAccessError,
  TargetPlanStateError,
  type TargetPlanService,
} from "../services/target-plans.js";
import type { ProfileContext, ProfileService } from "../services/profiles.js";
import { resolveRouteProfileContext } from "./profile-context.js";

export type TargetPlanRouteServices = Readonly<{
  audit: AuditPort;
  profiles: ProfileService;
  targetPlans: TargetPlanService;
}>;

export function registerTargetPlanRoutes(
  app: Hono<ServerEnv>,
  services: TargetPlanRouteServices,
): void {
  app.get("/api/targets/active", async (context) => {
    return withProfile(context, services, async (profile) => ({
      plan: (await services.targetPlans.getActivePlan(profile)) ?? null,
    }));
  });

  app.get("/api/targets/history", async (context) => {
    return withProfile(context, services, async (profile) => ({
      plans: await services.targetPlans.listHistory(profile),
    }));
  });

  app.get("/api/targets/:planId", async (context) => {
    return withProfile(context, services, async (profile) => ({
      plan:
        (await services.targetPlans.getPlan(
          profile,
          context.req.param("planId"),
        )) ?? null,
    }));
  });

  app.post("/api/targets/recommend", async (context) => {
    return withProfile(context, services, async (profile) => ({
      recommendation: services.targetPlans.calculateRecommendation(
        profile,
        (await context.req.json()) as TargetRecommendationInput,
      ),
    }));
  });

  for (const [path, proposed] of [
    ["/api/targets/drafts", false],
    ["/api/targets/proposals", true],
  ] as const) {
    app.post(path, async (context) => {
      return withProfile(context, services, async (profile) => {
        const payload = await parseCreatePayload(context.req);
        const plan = proposed
          ? await services.targetPlans.createProposal(profile, payload)
          : await services.targetPlans.createDraft(profile, payload);
        await auditMutation(services.audit, profile, plan.id, "created", {
          status: plan.status,
          version: plan.version,
        });
        return { plan };
      });
    });
  }

  for (const action of [
    "propose",
    "approve",
    "reject",
    "activate",
    "archive",
  ] as const) {
    app.post(`/api/targets/:planId/${action}`, async (context) => {
      return withProfile(context, services, async (profile) => {
        const body = await readObject(context.req);
        if (
          ["approve", "activate", "archive"].includes(action) &&
          body.confirm !== true
        ) {
          return {
            confirmationRequired: true,
            comparison:
              action === "archive"
                ? []
                : await services.targetPlans.compare(
                    profile,
                    context.req.param("planId"),
                  ),
          };
        }
        const base = {
          profileId: profile.profileId,
          planId: context.req.param("planId"),
          actorUserId: profile.actorUserId,
          reason: optionalString(body.reason),
          ownerResponse: optionalString(body.ownerResponse),
          idempotencyKey: optionalString(body.idempotencyKey),
        };
        const effectiveFrom = optionalString(body.effectiveFrom);
        if (
          (action === "approve" || action === "activate") &&
          effectiveFrom === undefined
        ) {
          throw new Error("effectiveFrom is required.");
        }
        if (effectiveFrom !== undefined) assertLocalDate(effectiveFrom);
        const plan =
          action === "propose"
            ? await services.targetPlans.propose(profile, base)
            : action === "approve"
              ? await services.targetPlans.approve(profile, {
                  ...base,
                  effectiveFrom: effectiveFrom!,
                })
              : action === "reject"
                ? await services.targetPlans.reject(profile, base)
                : action === "activate"
                  ? await services.targetPlans.activate(profile, {
                      ...base,
                      effectiveFrom: effectiveFrom!,
                    })
                  : await services.targetPlans.archive(profile, base);
        await auditMutation(services.audit, profile, plan.id, action, {
          effectiveFrom: plan.effectiveFrom,
          status: plan.status,
          version: plan.version,
        });
        return { plan };
      });
    });
  }
}

async function withProfile(
  context: Context<ServerEnv>,
  services: TargetPlanRouteServices,
  action: (profile: ProfileContext) => Promise<Record<string, unknown>>,
) {
  const auth = context.get("auth");
  if (
    !auth.scopes.some(
      (scope: string) => scope === "coach:read" || scope === "coach:write",
    )
  ) {
    return context.json({ error: "missing-scope" }, 403);
  }
  const resolved = await resolveRouteProfileContext(
    services.profiles,
    auth.actorUserId,
    context.req.query("profileId"),
  );
  if (resolved.ok === false)
    return context.json({ error: resolved.error }, resolved.status);
  try {
    return context.json(await action(resolved.value));
  } catch (error) {
    if (error instanceof TargetPlanAccessError) {
      return context.json({ error: error.code, message: error.message }, 403);
    }
    if (error instanceof TargetPlanStateError) {
      return context.json({ error: error.code, message: error.message }, 409);
    }
    return context.json(
      {
        error: "invalid-target-plan",
        message:
          error instanceof Error ? error.message : "Invalid target plan.",
      },
      400,
    );
  }
}

async function parseCreatePayload(request: { json(): Promise<unknown> }) {
  const body = await readObject(request);
  const targets = body.targets as TargetPlanTargets;
  assertTargetPlanTargets(targets);
  const effectiveFrom = optionalString(body.effectiveFrom);
  if (effectiveFrom !== undefined) assertLocalDate(effectiveFrom);
  const goal = requiredString(body.goal, "goal") as NutritionGoal;
  if (!["lose_weight", "maintain", "gain_mass"].includes(goal)) {
    throw new Error("goal is invalid.");
  }
  const calculationMode = requiredString(
    body.calculationMode,
    "calculationMode",
  ) as TargetPlanCalculationMode;
  return {
    goal,
    calculationMode,
    effectiveFrom,
    reason: requiredString(body.reason, "reason"),
    targets,
    idempotencyKey: optionalString(body.idempotencyKey),
  };
}

async function readObject(request: {
  json(): Promise<unknown>;
}): Promise<Record<string, unknown>> {
  const body = await request.json();
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new Error("Request body must be an object.");
  }
  return body as Record<string, unknown>;
}

function requiredString(value: unknown, field: string): string {
  const parsed = optionalString(value);
  if (parsed === undefined) throw new Error(`${field} is required.`);
  return parsed;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

async function auditMutation(
  audit: AuditPort,
  profile: ProfileContext,
  planId: string,
  action: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await audit.create({
    action: `target_plan.${action}`,
    actor: { type: "user", id: profile.actorUserId },
    target: { type: "target_plan", id: planId },
    userId: profile.subjectUserId,
    profileId: profile.profileId,
    metadata,
  });
}

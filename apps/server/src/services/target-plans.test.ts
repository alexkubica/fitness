import type { ProfilePermission } from "@fitness/auth";
import type {
  CreateTargetPlanRecord,
  TargetPlanMutation,
  TargetPlanRepository,
} from "@fitness/db";
import type { TargetPlan, TargetPlanTargets } from "@fitness/domain";
import { describe, expect, it } from "vitest";
import type { ProfileContext } from "./profiles.js";
import {
  createTargetPlanService,
  TargetPlanAccessError,
} from "./target-plans.js";

const targets: TargetPlanTargets = {
  maintenanceCalories: 2_400,
  selectedCalories: 2_000,
  proteinGrams: 140,
  carbohydratesGrams: 210,
  fatGrams: 65,
  fiberGrams: 30,
  steps: 8_000,
};

describe("target plan service", () => {
  it("creates, proposes, approves, and supersedes immutable versions", async () => {
    const repository = memoryRepository();
    const service = createTargetPlanService(repository, {
      now: () => new Date("2026-07-15T12:00:00Z"),
    });
    const context = profileContext();

    const initial = await service.activateCompatibility(context, {
      goal: "lose_weight",
      calculationMode: "imported_legacy",
      effectiveFrom: "2026-07-01",
      reason: "Legacy import",
      targets,
    });
    const proposal = await service.createProposal(context, {
      goal: "lose_weight",
      calculationMode: "coach_manual",
      reason: "Increase protein and steps",
      targets: { ...targets, proteinGrams: 155, steps: 10_000 },
    });
    const approved = await service.approve(context, {
      planId: proposal.id,
      effectiveFrom: "2026-07-20",
      ownerResponse: "Approved",
      reason: "Owner approved proposal",
    });

    expect(initial.version).toBe(1);
    expect(proposal.version).toBe(2);
    expect(approved).toMatchObject({
      status: "active",
      effectiveFrom: "2026-07-20",
      ownerResponse: "Approved",
      version: 2,
    });
    expect(await service.getEffectivePlan(context, "2026-07-19")).toMatchObject(
      {
        id: initial.id,
        status: "superseded",
        effectiveUntil: "2026-07-20",
      },
    );
    expect(await service.getEffectivePlan(context, "2026-07-20")).toMatchObject(
      {
        id: proposal.id,
      },
    );
  });

  it("supports draft, proposal, rejection, archive, and idempotency", async () => {
    const repository = memoryRepository();
    const service = createTargetPlanService(repository);
    const context = profileContext();
    const draft = await service.createDraft(context, {
      goal: "maintain",
      calculationMode: "manual",
      reason: "Draft",
      targets,
      idempotencyKey: "draft-1",
    });
    const sameDraft = await service.createDraft(context, {
      goal: "maintain",
      calculationMode: "manual",
      reason: "Duplicate retry",
      targets,
      idempotencyKey: "draft-1",
    });
    const proposed = await service.propose(context, {
      profileId: context.profileId,
      planId: draft.id,
      actorUserId: context.actorUserId,
    });
    const rejected = await service.reject(context, {
      profileId: context.profileId,
      planId: proposed.id,
      actorUserId: context.actorUserId,
      ownerResponse: "Not yet",
    });
    const archived = await service.archive(context, {
      profileId: context.profileId,
      planId: rejected.id,
      actorUserId: context.actorUserId,
    });

    expect(sameDraft.id).toBe(draft.id);
    expect(archived.status).toBe("archived");
    expect(await service.listHistory(context)).toHaveLength(1);
  });

  it("does not activate recommendations and returns canonical comparisons", async () => {
    const repository = memoryRepository();
    const service = createTargetPlanService(repository);
    const context = profileContext();
    const active = await service.activateCompatibility(context, {
      goal: "lose_weight",
      calculationMode: "manual",
      reason: "Current",
      targets,
    });
    const recommendation = service.calculateRecommendation(context, {
      goal: "lose_weight",
      currentWeightKg: 80,
      averageSteps: 9_000,
      existingTargets: active.targets,
    });

    expect(recommendation).not.toHaveProperty("status");
    expect(await service.listHistory(context)).toHaveLength(1);

    const proposed = await service.createProposal(context, {
      goal: "lose_weight",
      calculationMode: "automatic",
      reason: "Recommendation preview",
      targets: recommendation.targets,
    });
    expect(
      (await service.compare(context, proposed.id)).map(
        (item) => item.metricKey,
      ),
    ).toContain("steps");
  });

  it("enforces profile isolation and fine-grained permissions", async () => {
    const repository = memoryRepository();
    const service = createTargetPlanService(repository);
    const allowed = profileContext();
    const plan = await service.createDraft(allowed, {
      goal: "maintain",
      calculationMode: "manual",
      reason: "Private plan",
      targets,
    });
    const other = profileContext({
      profileId: "22222222-2222-4222-8222-222222222222",
    });
    expect(await service.getPlan(other, plan.id)).toBeUndefined();

    const denied = profileContext({ permissions: ["target.read"] });
    expect(() =>
      service.createProposal(denied, {
        goal: "maintain",
        calculationMode: "manual",
        reason: "Not allowed",
        targets,
      }),
    ).toThrow(TargetPlanAccessError);
  });

  it("uses the profile timezone when selecting the current plan", async () => {
    const repository = memoryRepository();
    const service = createTargetPlanService(repository, {
      now: () => new Date("2026-07-14T21:30:00Z"),
    });
    const context = profileContext();
    await service.activateCompatibility(context, {
      goal: "maintain",
      calculationMode: "manual",
      effectiveFrom: "2026-07-15",
      reason: "Starts at local midnight",
      targets,
    });

    expect(await service.getActivePlan(context)).toMatchObject({
      effectiveFrom: "2026-07-15",
    });
  });
});

function memoryRepository(): TargetPlanRepository {
  let plans: TargetPlan[] = [];
  const idempotency = new Map<string, string>();

  function get(profileId: string, planId: string): TargetPlan | undefined {
    return plans.find(
      (plan) => plan.profileId === profileId && plan.id === planId,
    );
  }

  function transition(
    input: TargetPlanMutation,
    allowed: readonly TargetPlan["status"][],
    status: TargetPlan["status"],
  ): TargetPlan | undefined {
    const plan = get(input.profileId, input.planId);
    if (plan === undefined || !allowed.includes(plan.status)) return undefined;
    const changed: TargetPlan = {
      ...plan,
      status,
      ...(input.ownerResponse === undefined
        ? {}
        : { ownerResponse: input.ownerResponse }),
      updatedAt: new Date().toISOString(),
    };
    plans = plans.map((candidate) =>
      candidate.id === changed.id ? changed : candidate,
    );
    return changed;
  }

  return {
    async createPlan(input: CreateTargetPlanRecord) {
      const key =
        input.idempotencyKey &&
        `${input.profileId}:${input.createdByUserId}:${input.idempotencyKey}`;
      if (key !== undefined) {
        const existingId = idempotency.get(key);
        const existing =
          existingId === undefined
            ? undefined
            : get(input.profileId, existingId);
        if (existing !== undefined) return existing;
      }
      const timestamp = new Date().toISOString();
      const plan: TargetPlan = {
        id: `plan-${plans.length + 1}`,
        profileId: input.profileId,
        version:
          Math.max(
            0,
            ...plans
              .filter((item) => item.profileId === input.profileId)
              .map((item) => item.version),
          ) + 1,
        goal: input.goal,
        status: input.status,
        calculationMode: input.calculationMode,
        effectiveFrom: input.effectiveFrom,
        createdByUserId: input.createdByUserId,
        creatorRelationship: input.creatorRelationship,
        source: input.source,
        reason: input.reason,
        targets: input.targets,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      plans.push(plan);
      if (key !== undefined) idempotency.set(key, plan.id);
      return plan;
    },
    async getPlan(profileId, planId) {
      return get(profileId, planId);
    },
    async getActivePlan(profileId, localDate) {
      return effective(profileId, localDate);
    },
    async getEffectivePlan(profileId, localDate) {
      return effective(profileId, localDate);
    },
    async listHistory(profileId) {
      return plans
        .filter((plan) => plan.profileId === profileId)
        .sort((a, b) => b.version - a.version);
    },
    async proposePlan(input) {
      return transition(input, ["draft"], "proposed");
    },
    async rejectPlan(input) {
      return transition(input, ["proposed"], "rejected");
    },
    async archivePlan(input) {
      return transition(input, ["draft", "proposed", "rejected"], "archived");
    },
    async activatePlan(input) {
      const selected = get(input.profileId, input.planId);
      if (
        selected === undefined ||
        !["draft", "proposed", "active"].includes(selected.status)
      ) {
        return undefined;
      }
      plans = plans.map((plan) => {
        if (
          plan.profileId !== input.profileId ||
          plan.status !== "active" ||
          plan.id === selected.id
        ) {
          return plan;
        }
        return plan.effectiveFrom < input.effectiveFrom
          ? {
              ...plan,
              status: "superseded" as const,
              effectiveUntil: input.effectiveFrom,
            }
          : { ...plan, status: "archived" as const };
      });
      const activated: TargetPlan = {
        ...selected,
        status: "active",
        effectiveFrom: input.effectiveFrom,
        effectiveUntil: undefined,
        ownerResponse: input.ownerResponse,
      };
      plans = plans.map((plan) =>
        plan.id === activated.id ? activated : plan,
      );
      return activated;
    },
  };

  function effective(
    profileId: string,
    localDate: string,
  ): TargetPlan | undefined {
    return plans
      .filter(
        (plan) =>
          plan.profileId === profileId &&
          (plan.status === "active" || plan.status === "superseded") &&
          plan.effectiveFrom <= localDate &&
          (plan.effectiveUntil === undefined ||
            localDate < plan.effectiveUntil),
      )
      .sort((a, b) => b.version - a.version)[0];
  }
}

function profileContext(
  overrides: {
    profileId?: string;
    permissions?: readonly ProfilePermission[];
  } = {},
): ProfileContext {
  const profileId =
    overrides.profileId ?? "11111111-1111-4111-8111-111111111111";
  return {
    actorUserId: "user-alex",
    profileId,
    subjectUserId: "user-alex",
    profile: {
      id: profileId,
      displayName: "Alex",
      linkedUserId: "user-alex",
      ownerUserId: "user-alex",
      profileType: "self",
      timezone: "Asia/Jerusalem",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
    access: {
      id: "access-1",
      userId: "user-alex",
      profileId,
      relationship: "self",
      roleIdentifier: "owner.v1",
      status: "active",
      accessVersion: 1,
      permissionOverrides: [],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
    permissions:
      overrides.permissions ??
      ([
        "target.read",
        "target.propose",
        "target.write",
        "target.archive",
      ] satisfies readonly ProfilePermission[]),
  };
}

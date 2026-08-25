import type { ProfilePermission } from "@fitness/auth";
import { randomUUID } from "node:crypto";
import type {
  CreateTargetPlanRecord,
  TargetPlanMutation,
  TargetPlanRepository,
} from "@fitness/db";
import {
  calculateTargetRecommendation,
  compareTargetPlans,
  localDateInTimezone,
  type NutritionGoal,
  type TargetPlan,
  type TargetPlanCalculationMode,
  type TargetPlanTargets,
  type TargetRecommendationInput,
} from "@fitness/domain";
import type { ProfileContext } from "./profiles.js";

export const TARGET_PLAN_PERMISSIONS = {
  read: "target.read",
  propose: "target.propose",
  write: "target.write",
  archive: "target.archive",
} as const satisfies Readonly<Record<string, ProfilePermission>>;

export type CreatePlanInput = Readonly<{
  goal: NutritionGoal;
  calculationMode: TargetPlanCalculationMode;
  effectiveFrom?: string | undefined;
  reason: string;
  targets: TargetPlanTargets;
  idempotencyKey?: string | undefined;
}>;

export type ActivatePlanInput = Readonly<{
  planId: string;
  effectiveFrom: string;
  reason?: string | undefined;
  ownerResponse?: string | undefined;
  idempotencyKey?: string | undefined;
}>;

export type TargetPlanService = Readonly<{
  getPlan(
    context: ProfileContext,
    planId: string,
  ): Promise<TargetPlan | undefined>;
  getActivePlan(
    context: ProfileContext,
    at?: Date,
  ): Promise<TargetPlan | undefined>;
  getEffectivePlan(
    context: ProfileContext,
    localDate: string,
  ): Promise<TargetPlan | undefined>;
  listHistory(context: ProfileContext): Promise<readonly TargetPlan[]>;
  calculateRecommendation(
    context: ProfileContext,
    input: TargetRecommendationInput,
  ): ReturnType<typeof calculateTargetRecommendation>;
  createDraft(
    context: ProfileContext,
    input: CreatePlanInput,
  ): Promise<TargetPlan>;
  createProposal(
    context: ProfileContext,
    input: CreatePlanInput,
  ): Promise<TargetPlan>;
  propose(
    context: ProfileContext,
    mutation: TargetPlanMutation,
  ): Promise<TargetPlan>;
  approve(
    context: ProfileContext,
    input: ActivatePlanInput,
  ): Promise<TargetPlan>;
  reject(
    context: ProfileContext,
    mutation: TargetPlanMutation,
  ): Promise<TargetPlan>;
  activate(
    context: ProfileContext,
    input: ActivatePlanInput,
  ): Promise<TargetPlan>;
  archive(
    context: ProfileContext,
    mutation: TargetPlanMutation,
  ): Promise<TargetPlan>;
  activateCompatibility(
    context: ProfileContext,
    input: CreatePlanInput,
  ): Promise<TargetPlan>;
  compare(
    context: ProfileContext,
    planId: string,
  ): Promise<ReturnType<typeof compareTargetPlans>>;
}>;

export class TargetPlanAccessError extends Error {
  readonly code = "target-permission-denied";
}

export class TargetPlanStateError extends Error {
  constructor(
    public readonly code:
      | "target-plan-not-found"
      | "target-plan-invalid-transition",
    message: string,
  ) {
    super(message);
  }
}

export function createTargetPlanService(
  repository: TargetPlanRepository,
  options: { now?: () => Date } = {},
): TargetPlanService {
  const now = options.now ?? (() => new Date());

  async function requirePlan(
    value: Promise<TargetPlan | undefined>,
    message: string,
  ): Promise<TargetPlan> {
    const plan = await value;
    if (plan === undefined) {
      throw new TargetPlanStateError("target-plan-invalid-transition", message);
    }
    return plan;
  }

  function create(
    context: ProfileContext,
    input: CreatePlanInput,
    status: "draft" | "proposed",
  ): Promise<TargetPlan> {
    requirePermission(
      context,
      status === "draft" &&
        context.permissions.includes(TARGET_PLAN_PERMISSIONS.write)
        ? TARGET_PLAN_PERMISSIONS.write
        : TARGET_PLAN_PERMISSIONS.propose,
    );
    const record: CreateTargetPlanRecord = {
      profileId: context.profileId,
      goal: input.goal,
      status,
      calculationMode: input.calculationMode,
      effectiveFrom:
        input.effectiveFrom ??
        localDateInTimezone(now(), context.profile.timezone),
      createdByUserId: context.actorUserId,
      creatorRelationship: context.access.relationship,
      source: "api",
      reason: input.reason,
      targets: input.targets,
      ...(input.idempotencyKey === undefined
        ? {}
        : { idempotencyKey: input.idempotencyKey }),
    };
    return repository.createPlan(record);
  }

  function mutationFor(
    context: ProfileContext,
    input: Omit<TargetPlanMutation, "profileId" | "actorUserId">,
  ): TargetPlanMutation {
    return {
      ...input,
      profileId: context.profileId,
      actorUserId: context.actorUserId,
    };
  }

  return {
    getPlan(context, planId) {
      requirePermission(context, TARGET_PLAN_PERMISSIONS.read);
      return repository.getPlan(context.profileId, planId);
    },
    getActivePlan(context, at = now()) {
      requirePermission(context, TARGET_PLAN_PERMISSIONS.read);
      return repository.getActivePlan(
        context.profileId,
        localDateInTimezone(at, context.profile.timezone),
      );
    },
    getEffectivePlan(context, localDate) {
      requirePermission(context, TARGET_PLAN_PERMISSIONS.read);
      return repository.getEffectivePlan(context.profileId, localDate);
    },
    listHistory(context) {
      requirePermission(context, TARGET_PLAN_PERMISSIONS.read);
      return repository.listHistory(context.profileId);
    },
    calculateRecommendation(context, input) {
      requirePermission(context, TARGET_PLAN_PERMISSIONS.read);
      return calculateTargetRecommendation(input);
    },
    createDraft(context, input) {
      return create(context, input, "draft");
    },
    createProposal(context, input) {
      return create(context, input, "proposed");
    },
    propose(context, mutation) {
      requirePermission(context, TARGET_PLAN_PERMISSIONS.propose);
      return requirePlan(
        repository.proposePlan(mutationFor(context, mutation)),
        "Only a draft target plan can be proposed.",
      );
    },
    approve(context, input) {
      requirePermission(context, TARGET_PLAN_PERMISSIONS.write);
      return requirePlan(
        repository.activatePlan({
          ...mutationFor(context, input),
          effectiveFrom: input.effectiveFrom,
        }),
        "Only a proposed target plan can be approved.",
      );
    },
    reject(context, mutation) {
      requirePermission(context, TARGET_PLAN_PERMISSIONS.write);
      return requirePlan(
        repository.rejectPlan(mutationFor(context, mutation)),
        "Only a proposed target plan can be rejected.",
      );
    },
    activate(context, input) {
      requirePermission(context, TARGET_PLAN_PERMISSIONS.write);
      return requirePlan(
        repository.activatePlan({
          ...mutationFor(context, input),
          effectiveFrom: input.effectiveFrom,
        }),
        "The target plan could not be activated.",
      );
    },
    archive(context, mutation) {
      requirePermission(context, TARGET_PLAN_PERMISSIONS.archive);
      return requirePlan(
        repository.archivePlan(mutationFor(context, mutation)),
        "Only an inactive target plan can be archived.",
      );
    },
    async activateCompatibility(context, input) {
      requirePermission(context, TARGET_PLAN_PERMISSIONS.write);
      const draft = await repository.createPlan({
        profileId: context.profileId,
        goal: input.goal,
        status: "draft",
        calculationMode: input.calculationMode,
        effectiveFrom:
          input.effectiveFrom ??
          localDateInTimezone(now(), context.profile.timezone),
        createdByUserId: context.actorUserId,
        creatorRelationship: context.access.relationship,
        source: "coach_profile_compatibility",
        reason: input.reason,
        targets: input.targets,
        ...(input.idempotencyKey === undefined
          ? {}
          : { idempotencyKey: input.idempotencyKey }),
      });
      return requirePlan(
        repository.activatePlan({
          profileId: context.profileId,
          planId: draft.id,
          actorUserId: context.actorUserId,
          effectiveFrom: draft.effectiveFrom,
          reason: input.reason,
          ...(input.idempotencyKey === undefined
            ? {}
            : { idempotencyKey: `${input.idempotencyKey}:activate` }),
        }),
        "The compatibility target plan could not be activated.",
      );
    },
    async compare(context, planId) {
      requirePermission(context, TARGET_PLAN_PERMISSIONS.read);
      const [active, proposed] = await Promise.all([
        repository.getActivePlan(
          context.profileId,
          localDateInTimezone(now(), context.profile.timezone),
        ),
        repository.getPlan(context.profileId, planId),
      ]);
      if (proposed === undefined) {
        throw new TargetPlanStateError(
          "target-plan-not-found",
          "Target plan was not found.",
        );
      }
      return compareTargetPlans(
        active?.targets ?? proposed.targets,
        proposed.targets,
      );
    },
  };
}

export function createInMemoryTargetPlanService(
  options: { now?: () => Date } = {},
): TargetPlanService {
  const now = options.now ?? (() => new Date());
  let plans: TargetPlan[] = [];
  const idempotency = new Map<string, string>();

  const repository: TargetPlanRepository = {
    async getPlan(profileId, planId) {
      return plans.find(
        (plan) => plan.profileId === profileId && plan.id === planId,
      );
    },
    async getActivePlan(profileId, localDate) {
      return effectivePlan(plans, profileId, localDate);
    },
    async getEffectivePlan(profileId, localDate) {
      return effectivePlan(plans, profileId, localDate);
    },
    async listHistory(profileId) {
      return plans
        .filter((plan) => plan.profileId === profileId)
        .sort((left, right) => right.version - left.version);
    },
    async createPlan(input) {
      const key =
        input.idempotencyKey === undefined
          ? undefined
          : `${input.profileId}:${input.createdByUserId}:${input.idempotencyKey}`;
      const existing =
        key === undefined
          ? undefined
          : plans.find((plan) => plan.id === idempotency.get(key));
      if (existing !== undefined) return existing;
      const timestamp = now().toISOString();
      const plan: TargetPlan = {
        id: randomUUID(),
        profileId: input.profileId,
        version:
          Math.max(
            0,
            ...plans
              .filter((candidate) => candidate.profileId === input.profileId)
              .map((candidate) => candidate.version),
          ) + 1,
        goal: input.goal,
        status: input.status,
        calculationMode: input.calculationMode,
        effectiveFrom: input.effectiveFrom,
        createdByUserId: input.createdByUserId,
        ...(input.creatorRelationship === undefined
          ? {}
          : { creatorRelationship: input.creatorRelationship }),
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
    async proposePlan(input) {
      return transitionMemoryPlan(input, ["draft"], "proposed");
    },
    async rejectPlan(input) {
      return transitionMemoryPlan(input, ["proposed"], "rejected");
    },
    async archivePlan(input) {
      return transitionMemoryPlan(
        input,
        ["draft", "proposed", "rejected"],
        "archived",
      );
    },
    async activatePlan(input) {
      const selected = plans.find(
        (plan) =>
          plan.profileId === input.profileId && plan.id === input.planId,
      );
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
        ...(input.ownerResponse === undefined
          ? {}
          : { ownerResponse: input.ownerResponse }),
        updatedAt: now().toISOString(),
      };
      delete (activated as { effectiveUntil?: string }).effectiveUntil;
      plans = plans.map((plan) =>
        plan.id === activated.id ? activated : plan,
      );
      return activated;
    },
  };

  function transitionMemoryPlan(
    input: TargetPlanMutation,
    allowed: readonly TargetPlan["status"][],
    status: TargetPlan["status"],
  ): TargetPlan | undefined {
    const existing = plans.find(
      (plan) => plan.profileId === input.profileId && plan.id === input.planId,
    );
    if (existing === undefined || !allowed.includes(existing.status)) {
      return undefined;
    }
    const changed: TargetPlan = {
      ...existing,
      status,
      ...(input.ownerResponse === undefined
        ? {}
        : { ownerResponse: input.ownerResponse }),
      updatedAt: now().toISOString(),
    };
    plans = plans.map((plan) => (plan.id === changed.id ? changed : plan));
    return changed;
  }

  return createTargetPlanService(repository, { now });
}

function effectivePlan(
  plans: readonly TargetPlan[],
  profileId: string,
  localDate: string,
): TargetPlan | undefined {
  return plans
    .filter(
      (plan) =>
        plan.profileId === profileId &&
        (plan.status === "active" || plan.status === "superseded") &&
        plan.effectiveFrom <= localDate &&
        (plan.effectiveUntil === undefined || localDate < plan.effectiveUntil),
    )
    .sort((left, right) => right.version - left.version)[0];
}

function requirePermission(
  context: ProfileContext,
  permission: ProfilePermission,
): void {
  if (!context.permissions.includes(permission)) {
    throw new TargetPlanAccessError(
      `Profile access does not grant ${permission}.`,
    );
  }
}

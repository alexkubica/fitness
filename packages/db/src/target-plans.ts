import type {
  NutritionGoal,
  TargetPlan,
  TargetPlanCalculationMode,
  TargetPlanStatus,
  TargetPlanTargets,
} from "@fitness/domain";
import { assertLocalDate, assertTargetPlanTargets } from "@fitness/domain";
import type { SqlQueryExecutor } from "./health-samples.js";

export type CreateTargetPlanRecord = Readonly<{
  profileId: string;
  goal: NutritionGoal;
  status: Extract<TargetPlanStatus, "draft" | "proposed">;
  calculationMode: TargetPlanCalculationMode;
  effectiveFrom: string;
  createdByUserId: string;
  creatorRelationship?: string | undefined;
  source: string;
  reason: string;
  targets: TargetPlanTargets;
  idempotencyKey?: string | undefined;
}>;

export type TargetPlanMutation = Readonly<{
  profileId: string;
  planId: string;
  actorUserId: string;
  reason?: string | undefined;
  ownerResponse?: string | undefined;
  effectiveFrom?: string | undefined;
  idempotencyKey?: string | undefined;
}>;

export type TargetPlanRepository = Readonly<{
  getPlan(profileId: string, planId: string): Promise<TargetPlan | undefined>;
  getActivePlan(
    profileId: string,
    localDate: string,
  ): Promise<TargetPlan | undefined>;
  getEffectivePlan(
    profileId: string,
    localDate: string,
  ): Promise<TargetPlan | undefined>;
  listHistory(profileId: string): Promise<readonly TargetPlan[]>;
  createPlan(input: CreateTargetPlanRecord): Promise<TargetPlan>;
  proposePlan(input: TargetPlanMutation): Promise<TargetPlan | undefined>;
  rejectPlan(input: TargetPlanMutation): Promise<TargetPlan | undefined>;
  activatePlan(
    input: TargetPlanMutation & { effectiveFrom: string },
  ): Promise<TargetPlan | undefined>;
  archivePlan(input: TargetPlanMutation): Promise<TargetPlan | undefined>;
}>;

export function createNeonTargetPlanRepository(
  sql: SqlQueryExecutor,
): TargetPlanRepository {
  return {
    async getPlan(profileId, planId) {
      const rows = await sql`
        select plan.*
        from target_plans plan
        where plan.profile_id = ${profileId}::uuid
          and plan.id = ${planId}::uuid
        limit 1
      `;
      return rows[0] === undefined ? undefined : mapPlan(rows[0]);
    },

    async getActivePlan(profileId, localDate) {
      return getEffective(sql, profileId, localDate, true);
    },

    async getEffectivePlan(profileId, localDate) {
      return getEffective(sql, profileId, localDate, false);
    },

    async listHistory(profileId) {
      const rows = await sql`
        select plan.*
        from target_plans plan
        where plan.profile_id = ${profileId}::uuid
        order by plan.version desc
      `;
      return rows.map(mapPlan);
    },

    async createPlan(input) {
      assertLocalDate(input.effectiveFrom);
      assertTargetPlanTargets(input.targets);
      const rows = await sql`
        with locked_profile as (
          select id
          from health_profiles
          where id = ${input.profileId}::uuid
          for update
        ), existing_event as (
          select target_plan_id
          from target_plan_events
          where profile_id = ${input.profileId}::uuid
            and actor_user_id = ${input.createdByUserId}
            and idempotency_key = ${input.idempotencyKey ?? null}
          limit 1
        ), inserted as (
          insert into target_plans (
            profile_id, version, goal, status, calculation_mode,
            effective_from, created_by_user_id, creator_relationship,
            source, reason, targets
          )
          select
            locked_profile.id,
            coalesce((select max(version) from target_plans where profile_id = locked_profile.id), 0) + 1,
            ${input.goal},
            ${input.status},
            ${input.calculationMode},
            ${input.effectiveFrom}::date,
            ${input.createdByUserId},
            ${input.creatorRelationship ?? null},
            ${input.source},
            ${input.reason},
            ${JSON.stringify(input.targets)}::jsonb
          from locked_profile
          where not exists (select 1 from existing_event)
          returning *
        ), inserted_event as (
          insert into target_plan_events (
            target_plan_id, profile_id, action, actor_user_id, reason,
            idempotency_key, metadata
          )
          select id, profile_id, 'created', ${input.createdByUserId}, ${input.reason},
            ${input.idempotencyKey ?? null}, jsonb_build_object('version', version)
          from inserted
        )
        select plan.*
        from target_plans plan
        where plan.id = coalesce(
          (select id from inserted),
          (select target_plan_id from existing_event)
        )
      `;
      const row = rows[0];
      if (row === undefined)
        throw new Error("Target plan could not be created.");
      return mapPlan(row);
    },

    proposePlan(input) {
      return transitionPlan(sql, input, "proposed", ["draft"], "proposed");
    },

    rejectPlan(input) {
      return transitionPlan(sql, input, "rejected", ["proposed"], "rejected");
    },

    async activatePlan(input) {
      assertLocalDate(input.effectiveFrom);
      const rows = await sql`
        with locked_profile as (
          select id
          from health_profiles
          where id = ${input.profileId}::uuid
          for update
        ), selected as (
          select plan.*
          from target_plans plan
          join locked_profile on locked_profile.id = plan.profile_id
          where plan.id = ${input.planId}::uuid
            and plan.status in ('draft', 'proposed', 'active')
        ), existing_event as (
          select target_plan_id
          from target_plan_events
          where profile_id = ${input.profileId}::uuid
            and actor_user_id = ${input.actorUserId}
            and idempotency_key = ${input.idempotencyKey ?? null}
          limit 1
        ), closed as (
          update target_plans previous
          set
            status = case
              when previous.effective_from < ${input.effectiveFrom}::date then 'superseded'
              else 'archived'
            end,
            effective_until = case
              when previous.effective_from < ${input.effectiveFrom}::date then ${input.effectiveFrom}::date
              else previous.effective_until
            end
          from selected
          where previous.profile_id = selected.profile_id
            and previous.id <> selected.id
            and previous.status = 'active'
            and not exists (select 1 from existing_event)
          returning previous.id, previous.profile_id, previous.version
        ), activated as (
          update target_plans plan
          set status = 'active',
              effective_from = ${input.effectiveFrom}::date,
              effective_until = null,
              owner_response = coalesce(${input.ownerResponse ?? null}, plan.owner_response),
              activated_at = coalesce(plan.activated_at, now()),
              activated_by_user_id = ${input.actorUserId}
          from selected
          where plan.id = selected.id
            and not exists (select 1 from existing_event)
            and (select count(*) from closed) >= 0
          returning plan.*
        ), closed_events as (
          insert into target_plan_events (
            target_plan_id, profile_id, action, actor_user_id, reason, metadata
          )
          select id, profile_id, 'superseded', ${input.actorUserId}, ${input.reason ?? null},
            jsonb_build_object('version', version, 'effectiveUntil', ${input.effectiveFrom})
          from closed
        ), activation_event as (
          insert into target_plan_events (
            target_plan_id, profile_id, action, actor_user_id, reason,
            owner_response, idempotency_key, metadata
          )
          select activated.id, activated.profile_id,
            case when selected.status = 'proposed' then 'approved' else 'activated' end,
            ${input.actorUserId}, ${input.reason ?? null}, ${input.ownerResponse ?? null},
            ${input.idempotencyKey ?? null},
            jsonb_build_object('version', activated.version, 'effectiveFrom', ${input.effectiveFrom})
          from activated
          join selected on selected.id = activated.id
        )
        select plan.*
        from target_plans plan
        where plan.id = coalesce(
          (select id from activated),
          (select target_plan_id from existing_event)
        )
      `;
      return rows[0] === undefined ? undefined : mapPlan(rows[0]);
    },

    archivePlan(input) {
      return transitionPlan(
        sql,
        input,
        "archived",
        ["draft", "proposed", "rejected"],
        "archived",
      );
    },
  };
}

async function getEffective(
  sql: SqlQueryExecutor,
  profileId: string,
  localDate: string,
  preferActive: boolean,
): Promise<TargetPlan | undefined> {
  assertLocalDate(localDate);
  const rows = await sql`
    select plan.*
    from target_plans plan
    where plan.profile_id = ${profileId}::uuid
      and plan.status in ('active', 'superseded')
      and plan.effective_from <= ${localDate}::date
      and (plan.effective_until is null or ${localDate}::date < plan.effective_until)
    order by
      case when ${preferActive} and plan.status = 'active' then 0 else 1 end,
      plan.version desc
    limit 1
  `;
  return rows[0] === undefined ? undefined : mapPlan(rows[0]);
}

async function transitionPlan(
  sql: SqlQueryExecutor,
  input: TargetPlanMutation,
  nextStatus: TargetPlanStatus,
  allowedStatuses: readonly TargetPlanStatus[],
  action: string,
): Promise<TargetPlan | undefined> {
  const rows = await sql`
    with existing_event as (
      select target_plan_id
      from target_plan_events
      where profile_id = ${input.profileId}::uuid
        and actor_user_id = ${input.actorUserId}
        and idempotency_key = ${input.idempotencyKey ?? null}
      limit 1
    ), changed as (
      update target_plans plan
      set status = ${nextStatus},
          owner_response = coalesce(${input.ownerResponse ?? null}, plan.owner_response)
      where plan.profile_id = ${input.profileId}::uuid
        and plan.id = ${input.planId}::uuid
        and plan.status = any(${allowedStatuses}::text[])
        and not exists (select 1 from existing_event)
      returning plan.*
    ), inserted_event as (
      insert into target_plan_events (
        target_plan_id, profile_id, action, actor_user_id, reason,
        owner_response, idempotency_key, metadata
      )
      select id, profile_id, ${action}, ${input.actorUserId}, ${input.reason ?? null},
        ${input.ownerResponse ?? null}, ${input.idempotencyKey ?? null},
        jsonb_build_object('version', version)
      from changed
    )
    select plan.*
    from target_plans plan
    where plan.id = coalesce(
      (select id from changed),
      (select target_plan_id from existing_event)
    )
  `;
  return rows[0] === undefined ? undefined : mapPlan(rows[0]);
}

function mapPlan(row: Record<string, unknown>): TargetPlan {
  const targets = objectColumn(row, "targets") as TargetPlanTargets;
  assertTargetPlanTargets(targets);
  return {
    id: stringColumn(row, "id"),
    profileId: stringColumn(row, "profile_id"),
    version: numberColumn(row, "version"),
    goal: stringColumn(row, "goal") as NutritionGoal,
    status: stringColumn(row, "status") as TargetPlanStatus,
    calculationMode: stringColumn(
      row,
      "calculation_mode",
    ) as TargetPlanCalculationMode,
    effectiveFrom: dateColumn(row, "effective_from"),
    ...(nullableDateColumn(row, "effective_until") === undefined
      ? {}
      : { effectiveUntil: nullableDateColumn(row, "effective_until") }),
    createdByUserId: stringColumn(row, "created_by_user_id"),
    ...(nullableStringColumn(row, "creator_relationship") === undefined
      ? {}
      : {
          creatorRelationship: nullableStringColumn(
            row,
            "creator_relationship",
          ),
        }),
    source: stringColumn(row, "source"),
    reason: stringColumn(row, "reason"),
    ...(nullableStringColumn(row, "owner_response") === undefined
      ? {}
      : { ownerResponse: nullableStringColumn(row, "owner_response") }),
    targets,
    createdAt: dateTimeColumn(row, "created_at"),
    updatedAt: dateTimeColumn(row, "updated_at"),
  };
}

function stringColumn(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string")
    throw new Error(`Expected ${key} to be a string.`);
  return value;
}

function nullableStringColumn(
  row: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = row[key];
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string")
    throw new Error(`Expected ${key} to be a string.`);
  return value;
}

function numberColumn(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed))
    throw new Error(`Expected ${key} to be a number.`);
  return parsed;
}

function objectColumn(
  row: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const value = row[key];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Expected ${key} to be an object.`);
  }
  return value as Record<string, unknown>;
}

function dateColumn(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return stringColumn(row, key).slice(0, 10);
}

function nullableDateColumn(
  row: Record<string, unknown>,
  key: string,
): string | undefined {
  return row[key] === null || row[key] === undefined
    ? undefined
    : dateColumn(row, key);
}

function dateTimeColumn(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (value instanceof Date) return value.toISOString();
  return stringColumn(row, key);
}

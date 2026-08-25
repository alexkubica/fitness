import { describe, expect, it } from "vitest";
import type { SqlQueryExecutor } from "./health-samples.js";
import { createNeonTargetPlanRepository } from "./target-plans.js";

describe("Neon target plan repository", () => {
  it("closes the previous active version before activating its replacement", async () => {
    const sql = fakeSql([planRow()]);
    const repository = createNeonTargetPlanRepository(sql);

    await repository.activatePlan({
      profileId: "11111111-1111-4111-8111-111111111111",
      planId: "22222222-2222-4222-8222-222222222222",
      actorUserId: "user_alex",
      effectiveFrom: "2026-07-20",
      reason: "Approved",
    });

    expect(sql.calls[0]).toContain("with locked_profile as");
    expect(sql.calls[0]).toContain("closed as");
    expect(sql.calls[0]).toContain("(select count(*) from closed) >= 0");
    expect(sql.calls[0]).toContain("previous.status = 'active'");
  });
});

function planRow(): Record<string, unknown> {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    profile_id: "11111111-1111-4111-8111-111111111111",
    version: 2,
    goal: "lose_weight",
    status: "active",
    calculation_mode: "manual",
    effective_from: "2026-07-20",
    effective_until: null,
    created_by_user_id: "user_alex",
    creator_relationship: "self",
    source: "test",
    reason: "Approved",
    owner_response: null,
    targets: {
      maintenanceCalories: 2_400,
      selectedCalories: 2_000,
      proteinGrams: 150,
      carbohydratesGrams: 200,
      fatGrams: 65,
      fiberGrams: 30,
      steps: 10_000,
    },
    created_at: "2026-07-15T00:00:00.000Z",
    updated_at: "2026-07-15T00:00:00.000Z",
  };
}

function fakeSql(
  rows: readonly Record<string, unknown>[],
): SqlQueryExecutor & { calls: string[] } {
  const calls: string[] = [];
  const sql = (async (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<readonly Record<string, unknown>[]> => {
    calls.push(
      strings
        .reduce(
          (text, chunk, index) =>
            `${text}${chunk}${index < values.length ? `$${index + 1}` : ""}`,
          "",
        )
        .replace(/\s+/gu, " ")
        .trim()
        .toLowerCase(),
    );
    return rows;
  }) as SqlQueryExecutor & { calls: string[] };
  sql.calls = calls;
  return sql;
}

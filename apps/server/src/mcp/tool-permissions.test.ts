import { describe, expect, it } from "vitest";
import {
  MCP_TOOL_PERMISSION_REQUIREMENTS,
  availableMcpToolsForPermissions,
  requiredPermissionForMcpTool,
  requiredPermissionsForMcpTool,
} from "./tool-permissions.js";

describe("MCP profile permission mapping", () => {
  it("centrally maps every existing profile-scoped tool", () => {
    expect(MCP_TOOL_PERMISSION_REQUIREMENTS).toMatchObject({
      get_health_summary: "health.summary.read",
      get_metric_timeseries: "health.detailed.read",
      generate_report: "report.create",
      get_meal_log: "meal.read",
      upsert_meal_log: "meal.write",
      delete_meal_log: "meal.delete",
      get_coach_profile: "target.read",
      upsert_coach_profile: "target.write",
    });
  });

  it("filters capabilities by effective profile permissions", () => {
    expect(
      availableMcpToolsForPermissions(["profile.read", "meal.read"]),
    ).toEqual([
      "get_mcp_capabilities",
      "list_accessible_profiles",
      "get_profile",
      "get_profile_access",
      "get_meal_log",
      "get_food_database",
      "get_food_aggregations",
      "list_meal_log_snapshots",
      "get_meal_log_snapshot",
    ]);
    expect(requiredPermissionForMcpTool("unknown_tool")).toBeUndefined();
    expect(
      requiredPermissionsForMcpTool("convert_planned_meal_to_log"),
    ).toEqual(["meal.plan.write", "meal.write"]);
    expect(requiredPermissionsForMcpTool("compare_plan_to_actual")).toEqual([
      "meal.plan.read",
      "meal.read",
    ]);
  });
});

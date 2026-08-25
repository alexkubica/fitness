import type { ProfilePermission } from "@fitness/auth";

export const MCP_TOOL_PERMISSION_REQUIREMENTS = {
  get_mcp_capabilities: "profile.read",
  list_accessible_profiles: "profile.read",
  get_profile: "profile.read",
  get_profile_access: "profile.read",
  get_health_summary: "health.summary.read",
  get_metric_timeseries: "health.detailed.read",
  generate_report: "report.create",
  get_meal_log: "meal.read",
  get_food_database: "meal.read",
  get_food_aggregations: "meal.read",
  upsert_meal_log: "meal.write",
  delete_meal_log: "meal.delete",
  list_meal_log_snapshots: "meal.read",
  get_meal_log_snapshot: "meal.read",
  rollback_meal_log_snapshot: "meal.write",
  get_coach_profile: "target.read",
  upsert_coach_profile: "target.write",
  get_active_target_plan: "target.read",
  get_target_plan: "target.read",
  list_target_plan_history: "target.read",
  calculate_recommended_targets: "target.read",
  create_target_plan_draft: "target.propose",
  propose_target_plan: "target.propose",
  approve_target_plan: "target.write",
  reject_target_plan: "target.write",
  activate_target_plan: "target.write",
  archive_target_plan: "target.archive",
  get_daily_meal_plan: "meal.plan.read",
  get_meal_plan_range: "meal.plan.read",
  upsert_daily_meal_plan: "meal.plan.write",
  copy_daily_meal_plan: "meal.plan.write",
  copy_meal_plan_range: "meal.plan.write",
  delete_daily_meal_plan: "meal.plan.delete",
  get_planned_meal: "meal.plan.read",
  update_planned_meal: "meal.plan.write",
  replace_planned_meal: "meal.plan.write",
  mark_planned_meal_status: "meal.plan.write",
  convert_planned_meal_to_log: ["meal.plan.write", "meal.write"],
  compare_plan_to_actual: ["meal.plan.read", "meal.read"],
  create_eating_checkin: "checkin.write",
  update_eating_checkin: "checkin.write",
  get_eating_checkins: "checkin.read",
  get_latest_eating_checkin: "checkin.read",
  link_checkin_to_meal: "checkin.write",
  get_eating_trigger_summary: "checkin.read",
  get_binge_pattern_summary: "checkin.read",
  get_cbt_weekly_report: "report.read",
} as const satisfies Readonly<
  Record<string, ProfilePermission | readonly ProfilePermission[]>
>;

export type PermissionMappedMcpToolName =
  keyof typeof MCP_TOOL_PERMISSION_REQUIREMENTS;

export function requiredPermissionForMcpTool(
  toolName: string,
): ProfilePermission | undefined {
  return requiredPermissionsForMcpTool(toolName)?.[0];
}

export function requiredPermissionsForMcpTool(
  toolName: string,
): readonly ProfilePermission[] | undefined {
  const requirement = Reflect.get(
    MCP_TOOL_PERMISSION_REQUIREMENTS,
    toolName,
  ) as ProfilePermission | readonly ProfilePermission[] | undefined;

  return requirement === undefined
    ? undefined
    : Array.isArray(requirement)
      ? requirement
      : [requirement as ProfilePermission];
}

export function availableMcpToolsForPermissions(
  permissions: readonly ProfilePermission[],
): readonly PermissionMappedMcpToolName[] {
  const effective = new Set(permissions);

  return (
    Object.keys(
      MCP_TOOL_PERMISSION_REQUIREMENTS,
    ) as PermissionMappedMcpToolName[]
  ).filter((toolName) =>
    requiredPermissionsForMcpTool(toolName)?.every((permission) =>
      effective.has(permission),
    ),
  );
}

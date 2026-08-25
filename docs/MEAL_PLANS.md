# Daily Meal Plans

Daily meal plans describe intended meals. They are deliberately separate from actual meal logs, which remain the only source for consumed calories, macros, food aggregations, and intake reports.

## Data model

- `daily_meal_plans` owns one versioned plan per `profile_id` and `local_food_date`, including its timezone, lifecycle status, creator, and write idempotency key.
- `planned_meals` owns scheduled meal details, stable status, ordering, optional replacement reason, and an optional link to one actual `meals` row.
- `planned_meal_ingredients` stores the display quantity plus a calories/macros snapshot. A mutable saved-food reference may be retained as metadata, but never replaces the snapshot.

Plan statuses are `draft`, `active`, `completed`, and `archived`. Planned-meal statuses are `planned`, `eaten_as_planned`, `partially_eaten`, `replaced`, `skipped`, and `not_confirmed`. Time passing never changes a status automatically.

All reads and writes are scoped by `profileId`. The feature has no account-ownership assumptions and relies on the existing profile context for self-profile fallback and delegated access.

## Planned versus actual

Converting a planned meal creates an ordinary actual meal log through the existing snapshotting meal-log service. The conversion:

1. Copies planned ingredient nutrition snapshots.
2. Accepts adjusted actual ingredient quantities for partial or replacement consumption.
3. Writes a deterministic `planned-meal-conversion:<plannedMealId>` idempotency key.
4. Links the resulting actual log to the planned meal and updates its stable status.
5. Leaves every original planned quantity and nutrition snapshot unchanged.

Repeating a conversion returns the linked log instead of creating a duplicate. Skipping a planned meal only changes its status and never creates a zero-calorie log. Existing meal-log rollback snapshots apply to planned-to-actual conversion because the conversion uses the same meal-log service.

## Targets and permissions

The service consumes the narrow `MealPlanTargetProvider.getTargetsForDate` interface. It resolves the effective versioned target plan for the selected profile and local date, then falls back to the compatibility coach target only when no versioned plan is effective.

The permission adapter checks these identifiers:

- `meal.plan.read`
- `meal.plan.write`
- `meal.plan.delete`
- `meal.read`
- `meal.write`

REST and MCP profile resolution use the shared authorization service and pass its effective permissions into the meal-plan service. The web action adapter resolves the same effective profile permissions before mutation. Empty permissions remain supported only for legacy/internal adapters and isolated tests.

## APIs and clients

The REST boundary is under `/api/meals/plans` and `/api/meals/planned`. Mutations require current plan and meal versions. Replacing populated plans, replacing whole meals, and deleting drafts require explicit confirmation.

MCP exposes:

- `get_daily_meal_plan`, `get_meal_plan_range`, and `get_planned_meal`
- `upsert_daily_meal_plan`, `copy_daily_meal_plan`, and `copy_meal_plan_range`
- `delete_daily_meal_plan`, `update_planned_meal`, and `replace_planned_meal`
- `mark_planned_meal_status` and `convert_planned_meal_to_log`
- `compare_plan_to_actual`

Every tool accepts explicit profile context, and date-oriented tools accept a local food date and timezone. The web and iOS clients label plan state with text—not color alone—and keep plan totals visually separate from logged totals.

## Adding plan behavior

Keep new operations inside the meal-plan service and repository boundary. Preserve the following rules:

- Never add planned rows to actual meal queries or reports.
- Preserve ingredient nutrition snapshots when copying or replacing.
- Require resource versions for updates.
- Use write idempotency keys for bulk operations and conversions.
- Apply existing profile authorization and meal-log rollback services instead of creating parallel systems.
- Treat `localFoodDate` in the plan timezone as the date boundary; do not derive it from a server-local clock.

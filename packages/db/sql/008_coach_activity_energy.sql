alter table coach_profiles
  add column if not exists estimated_active_calories_per_day numeric(8, 2),
  add column if not exists estimated_resting_calories_per_day numeric(8, 2);

alter table coach_profiles
  drop constraint if exists coach_profiles_estimated_active_calories_per_day_check,
  add constraint coach_profiles_estimated_active_calories_per_day_check
    check (
      estimated_active_calories_per_day is null
      or (
        estimated_active_calories_per_day >= 0
        and estimated_active_calories_per_day <= 10000
      )
    );

alter table coach_profiles
  drop constraint if exists coach_profiles_estimated_resting_calories_per_day_check,
  add constraint coach_profiles_estimated_resting_calories_per_day_check
    check (
      estimated_resting_calories_per_day is null
      or (
        estimated_resting_calories_per_day >= 500
        and estimated_resting_calories_per_day <= 5000
      )
    );

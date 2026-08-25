insert into health_metric_definitions (metric_name, unit, description, source)
values
  ('dietary_energy', 'kcal', 'Dietary energy consumed from HealthKit.', 'system'),
  ('protein', 'g', 'Dietary protein consumed from HealthKit.', 'system'),
  ('carbs', 'g', 'Dietary carbohydrates consumed from HealthKit.', 'system'),
  ('fat', 'g', 'Dietary fat consumed from HealthKit.', 'system'),
  ('fiber', 'g', 'Dietary fiber consumed from HealthKit.', 'system')
on conflict (metric_name, unit) do update
set
  description = excluded.description,
  source = excluded.source,
  updated_at = now();

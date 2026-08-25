insert into health_metric_definitions (metric_name, unit, description, source)
values
  ('weight', 'kg', 'Body mass from HealthKit bodyMass.', 'system'),
  ('steps', 'count', 'Step count from HealthKit stepCount.', 'system'),
  ('active_energy', 'kcal', 'Active energy burned.', 'system'),
  ('resting_energy', 'kcal', 'Basal/resting energy burned.', 'system'),
  ('sleep', 'minute', 'Sleep duration derived from sleep analysis.', 'system'),
  ('heart_rate', 'bpm', 'Heart-rate samples.', 'system'),
  ('resting_heart_rate', 'bpm', 'Resting heart rate.', 'system'),
  ('walking_heart_rate', 'bpm', 'Walking heart-rate average.', 'system'),
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

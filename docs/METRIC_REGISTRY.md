# Metric Registry

The additive metric registry in `@fitness/domain` is the canonical description of metrics that Fitness can present across web, native clients, reports, charts, synchronization adapters, and future MCP discovery. It is metadata and presentation logic, not a storage schema or an ingestion allowlist.

## Registration and availability

Every definition has an `availability` value:

- `currently_available`: normalized data already exists through the current first-slice ingestion contract. Some registry keys map to legacy storage keys through `LEGACY_HEALTH_METRIC_TO_REGISTRY_KEY`.
- `source_dependent`: the metric is defined, but availability depends on a device, permission, source, or a future source adapter. Registration does not make ingestion work.
- `planned_unavailable`: the semantic contract is reserved, but the application does not currently produce the metric.

`isSupportedMetric()` means that a key is registered. Callers must inspect `availability` before claiming that data can currently be collected or shown. A registered source is descriptive metadata; it does not grant permission, create a database column, enable a HealthKit query, or authorize a write.

The existing `HealthMetricName` contract remains the ingestion/storage allowlist. Do not add a registry metric to HealthKit, API validation, persistence, reports, or MCP solely because it appears in this registry.

## Naming conventions

- Keys are stable, lowercase `snake_case` identifiers.
- Prefer a precise noun phrase such as `sleep_duration` or `calories_consumed`.
- Include a qualifier when otherwise ambiguous, such as `walking_heart_rate`.
- Do not encode a unit, platform, account, or profile in the key.
- Never rename a published key casually. Add compatibility mapping or a new key when semantics genuinely change.

Unsupported keys throw `UnsupportedMetricError` with code `UNSUPPORTED_METRIC`, the invalid key, suggested keys, and `listMetricDefinitions` as the discovery method. Aliases are suggestion inputs only and must not silently broaden ingestion validation.

## Adding a metric

1. Add a complete immutable definition to `packages/domain/src/metric-registry.ts`.
2. Choose the canonical unit and list every accepted source unit explicitly.
3. Select aggregation, value type, granularities, partial-day behavior, formatter, precision, chart type, privacy category, sources, goal support, and honest availability.
4. Add directionality only when a general interpretation is safe. Prefer `target_range` for metrics where simply higher or lower is misleading.
5. Add registry, formatter, conversion, serialization, and suggestion tests as relevant.
6. Add a separate source adapter and its own authorization, ingestion, persistence, and platform tests only when that collection work is intentionally in scope.

## Raw and formatted values

`formatMetricValue(metricKey, value, options)` returns both `rawValue` and `formattedValue`. It never mutates or destructively rounds the input. `displayValue` is a converted presentation value and may differ from the canonical raw value.

- `null` and `undefined` are missing and format as `N/A` by default.
- `NaN` and infinite numbers are invalid and format safely as unavailable.
- Numeric zero remains a real value and never becomes missing.
- Cumulative counts such as steps and workout count display as whole numbers even when an upstream aggregate contains a fractional value.

API and storage contracts should keep numeric raw values separate from presentation strings. Formatting belongs at UI, report-text, notification, or other presentation boundaries.

## Unit conversion

`convertMetricValue(metricKey, value, sourceUnit, targetUnit)` uses explicit deterministic factors. Current conversion families cover:

- kilograms and pounds;
- metres, kilometres, and miles;
- kilocalories and kilojoules;
- millilitres and litres;
- minutes and hours.

Both units must be known, accepted by the metric definition, and dimensionally compatible. Unknown, unaccepted, incompatible, or non-finite conversions throw `MetricUnitConversionError`; they are never treated as identity conversions. Calculations retain JavaScript number precision, and rounding happens only when a value is formatted for display.

## Partial-day semantics and precision

`partialDayValuesExpected` identifies metrics whose current-day value is normally incomplete, such as steps, active energy, nutrition, and sleep accumulated so far. A partial value is still data; callers should label its period rather than interpret it as a final daily total.

`displayPrecision` is presentation metadata, not storage precision. Formatter options may override weight to one or two decimals. Counts, workout counts, and calories use whole-number display by default; percentages are consistent; durations can use minutes or hours/minutes; heart rate includes `bpm`; distance can select metric or imperial display; and water can use millilitres or litres.

The TypeScript registry is the initial shared backend/web foundation. A future cross-platform generation step may emit equivalent Swift definitions for iOS and watchOS. Until then, HealthKit identifiers remain in the iOS adapter and must not be inferred from registry availability.

## Internal APIs

- `listMetricDefinitions()`
- `getMetricDefinition(metricKey)`
- `isSupportedMetric(metricKey)`
- `formatMetricValue(metricKey, value, options)`
- `convertMetricValue(metricKey, value, sourceUnit, targetUnit)`
- `suggestMetricKeys(invalidKey)`

These APIs contain no account-level or profile-level ownership assumptions.

#!/usr/bin/env node
/* global console, process */
import { createReadStream } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { neon } from "@neondatabase/serverless";

const DEFAULT_EXPORT_XML = join(
  homedir(),
  "Downloads",
  "apple_health_export",
  "export.xml",
);
const DEFAULT_USER_ID = "user_alex";

const RECORD_TYPES = new Map([
  [
    "HKQuantityTypeIdentifierBodyMass",
    { metricName: "weight", unit: "kg", aggregation: "weightMode" },
  ],
  [
    "HKQuantityTypeIdentifierStepCount",
    { metricName: "steps", unit: "count", aggregation: "sum" },
  ],
  [
    "HKQuantityTypeIdentifierActiveEnergyBurned",
    { metricName: "active_energy", unit: "kcal", aggregation: "sum" },
  ],
  [
    "HKQuantityTypeIdentifierBasalEnergyBurned",
    { metricName: "resting_energy", unit: "kcal", aggregation: "sum" },
  ],
  [
    "HKQuantityTypeIdentifierHeartRate",
    { metricName: "heart_rate", unit: "bpm", aggregation: "average" },
  ],
  [
    "HKQuantityTypeIdentifierRestingHeartRate",
    { metricName: "resting_heart_rate", unit: "bpm", aggregation: "average" },
  ],
  [
    "HKQuantityTypeIdentifierWalkingHeartRateAverage",
    { metricName: "walking_heart_rate", unit: "bpm", aggregation: "average" },
  ],
]);

const METRICS = [
  "weight",
  "steps",
  "active_energy",
  "resting_energy",
  "sleep",
  "heart_rate",
  "resting_heart_rate",
  "walking_heart_rate",
];

const RECORD_TYPES_BY_METRIC = new Map(
  [...RECORD_TYPES.values()].map((config) => [
    config.metricName,
    config.aggregation,
  ]),
);

const SLEEP_VALUES = new Set([
  "HKCategoryValueSleepAnalysisAsleep",
  "HKCategoryValueSleepAnalysisAsleepUnspecified",
  "HKCategoryValueSleepAnalysisAsleepCore",
  "HKCategoryValueSleepAnalysisAsleepDeep",
  "HKCategoryValueSleepAnalysisAsleepREM",
]);

const TOLERANCES = {
  weight: 0.05,
  steps: 1,
  active_energy: 5,
  resting_energy: 5,
  sleep: 2,
  heart_rate: 0.5,
  resting_heart_rate: 0.5,
  walking_heart_rate: 0.5,
};

const options = parseArgs(process.argv.slice(2));

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required.");
}

const exportAggregates = await parseAppleHealthExport(options);
const dbRows = await readDatabaseRows(options);
const report = buildReport({
  dbRows,
  exportAggregates,
  options,
});

console.log(JSON.stringify(report, null, 2));

function parseArgs(args) {
  return {
    exportPath: valueAfter(args, "--export") ?? DEFAULT_EXPORT_XML,
    userId: valueAfter(args, "--user-id") ?? DEFAULT_USER_ID,
    from: valueAfter(args, "--from"),
    to: valueAfter(args, "--to"),
    limitExamples: Number(valueAfter(args, "--examples") ?? 8),
  };
}

function valueAfter(args, name) {
  const index = args.indexOf(name);

  if (index === -1) {
    return undefined;
  }

  const value = args[index + 1];

  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }

  return value;
}

async function parseAppleHealthExport(input) {
  const state = createAggregateState();
  let buffer = "";

  for await (const chunk of createReadStream(input.exportPath, {
    encoding: "utf8",
  })) {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      parseExportLine(line, state, input);
    }
  }

  if (buffer.length > 0) {
    parseExportLine(buffer, state, input);
  }

  return finalizeAggregates(state);
}

function createAggregateState() {
  return {
    values: new Map(),
    weights: new Map(),
    activitySummaryActiveEnergy: new Map(),
    parsedRecords: 0,
    parsedActivitySummaries: 0,
  };
}

function parseExportLine(line, state, options) {
  const trimmed = line.trimStart();

  if (trimmed.startsWith("<Record ")) {
    parseRecordLine(trimmed, state, options);
    return;
  }

  if (trimmed.startsWith("<ActivitySummary ")) {
    parseActivitySummaryLine(trimmed, state, options);
  }
}

function parseRecordLine(line, state, options) {
  const attrs = parseAttributes(line);
  const type = attrs.type;

  if (type === "HKCategoryTypeIdentifierSleepAnalysis") {
    parseSleepRecord(attrs, state, options);
    return;
  }

  const config = RECORD_TYPES.get(type);

  if (config === undefined || attrs.value === undefined) {
    return;
  }

  const value = Number(attrs.value);

  if (!Number.isFinite(value)) {
    return;
  }

  const date = localDateFromAppleDate(attrs.startDate);

  if (!dateInRange(date, options)) {
    return;
  }

  state.parsedRecords += 1;

  if (config.aggregation === "weightMode") {
    addWeight(state.weights, config.metricName, date, value, attrs.endDate);
    return;
  }

  addValue(state.values, config.metricName, date, value);
}

function parseSleepRecord(attrs, state, options) {
  if (!SLEEP_VALUES.has(attrs.value)) {
    return;
  }

  const date = localDateFromAppleDate(attrs.endDate);

  if (!dateInRange(date, options)) {
    return;
  }

  const start = appleDateToEpochMs(attrs.startDate);
  const end = appleDateToEpochMs(attrs.endDate);
  const minutes = (end - start) / 60_000;

  if (!Number.isFinite(minutes) || minutes <= 0) {
    return;
  }

  state.parsedRecords += 1;
  addValue(state.values, "sleep", date, minutes);
}

function parseActivitySummaryLine(line, state, options) {
  const attrs = parseAttributes(line);
  const date = attrs.dateComponents;

  if (!dateInRange(date, options)) {
    return;
  }

  const value = Number(attrs.activeEnergyBurned);

  if (!Number.isFinite(value)) {
    return;
  }

  state.parsedActivitySummaries += 1;
  state.activitySummaryActiveEnergy.set(date, roundToTwoDecimals(value));
}

function addValue(values, metricName, date, value) {
  const key = aggregateKey(metricName, date);
  const current = values.get(key) ?? {
    metricName,
    date,
    total: 0,
    count: 0,
  };

  current.total += value;
  current.count += 1;
  values.set(key, current);
}

function addWeight(weights, metricName, date, value, endDate) {
  const key = aggregateKey(metricName, date);
  const roundedValue = roundToTwoDecimals(value);
  const weightKey = roundedValue.toFixed(2);
  const current = weights.get(key) ?? {
    metricName,
    date,
    candidates: new Map(),
  };
  const candidate = current.candidates.get(weightKey) ?? {
    value: roundedValue,
    count: 0,
    latestEndMs: Number.NEGATIVE_INFINITY,
  };

  candidate.count += 1;
  candidate.latestEndMs = Math.max(
    candidate.latestEndMs,
    appleDateToEpochMs(endDate),
  );
  current.candidates.set(weightKey, candidate);
  weights.set(key, current);
}

function finalizeAggregates(state) {
  const rows = new Map();

  for (const item of state.values.values()) {
    const aggregation = RECORD_TYPES_BY_METRIC.get(item.metricName) ?? "sum";
    const value =
      aggregation === "average" ? item.total / item.count : item.total;

    rows.set(aggregateKey(item.metricName, item.date), {
      metricName: item.metricName,
      date: item.date,
      value: roundToTwoDecimals(value),
      count: item.count,
      source: "raw_export",
    });
  }

  for (const item of state.weights.values()) {
    const selected = [...item.candidates.values()].sort(
      compareWeightCandidate,
    )[0];

    if (selected !== undefined) {
      rows.set(aggregateKey(item.metricName, item.date), {
        metricName: item.metricName,
        date: item.date,
        value: selected.value,
        count: selected.count,
        source: "raw_export",
      });
    }
  }

  return {
    activitySummaryActiveEnergy: state.activitySummaryActiveEnergy,
    parsedActivitySummaries: state.parsedActivitySummaries,
    parsedRecords: state.parsedRecords,
    rows,
  };
}

function compareWeightCandidate(left, right) {
  if (left.count !== right.count) {
    return right.count - left.count;
  }

  if (left.latestEndMs !== right.latestEndMs) {
    return right.latestEndMs - left.latestEndMs;
  }

  return right.value - left.value;
}

async function readDatabaseRows(options) {
  const sql = neon(process.env.DATABASE_URL);
  const rows = await sql`
    select
      metric_name,
      value,
      unit,
      timezone,
      (start_time at time zone timezone)::date::text as local_date,
      source_sample_id
    from health_metric_samples
    where user_id = ${options.userId}
      and deleted_at is null
      and source = 'apple_health_daily'
      and metric_name = any(${METRICS})
      and (${options.from ?? null}::date is null or (start_time at time zone timezone)::date >= ${options.from ?? null}::date)
      and (${options.to ?? null}::date is null or (start_time at time zone timezone)::date < ${options.to ?? null}::date)
    order by metric_name, local_date
  `;
  const mapped = new Map();

  for (const row of rows) {
    mapped.set(aggregateKey(row.metric_name, row.local_date), {
      metricName: row.metric_name,
      date: row.local_date,
      value: Number(row.value),
      unit: row.unit,
      timezone: row.timezone,
      sourceSampleId: row.source_sample_id,
    });
  }

  return mapped;
}

function buildReport({ dbRows, exportAggregates, options }) {
  const perMetric = Object.fromEntries(
    METRICS.map((metricName) => [
      metricName,
      compareMetric({
        dbRows,
        exportRows: exportAggregates.rows,
        metricName,
        limitExamples: options.limitExamples,
      }),
    ]),
  );
  const activitySummaryComparison = compareActivitySummaryActiveEnergy({
    activitySummary: exportAggregates.activitySummaryActiveEnergy,
    dbRows,
    limitExamples: options.limitExamples,
  });

  return {
    exportPath: options.exportPath,
    range: {
      from: options.from ?? null,
      to: options.to ?? null,
    },
    caveat:
      "Apple XML contains raw records. Raw export sums can differ from Health app totals when HealthKit de-duplicates overlapping sources. Active energy is also compared to ActivitySummary where available.",
    parsed: {
      records: exportAggregates.parsedRecords,
      activitySummaries: exportAggregates.parsedActivitySummaries,
      exportDailyRows: exportAggregates.rows.size,
      databaseDailyRows: dbRows.size,
    },
    perMetric,
    activeEnergyActivitySummary: activitySummaryComparison,
  };
}

function compareMetric({ dbRows, exportRows, metricName, limitExamples }) {
  const tolerance = TOLERANCES[metricName] ?? 0.01;
  const exportMetricRows = rowsForMetric(exportRows, metricName);
  const dbMetricRows = rowsForMetric(dbRows, metricName);
  const dates = new Set([...exportMetricRows.keys(), ...dbMetricRows.keys()]);
  const missingInDb = [];
  const extraInDb = [];
  const mismatches = [];
  let matched = 0;
  let totalAbsDelta = 0;
  let maxAbsDelta = 0;

  for (const date of [...dates].sort()) {
    const exportRow = exportMetricRows.get(date);
    const dbRow = dbMetricRows.get(date);

    if (exportRow === undefined && dbRow !== undefined) {
      extraInDb.push(exampleRow(date, undefined, dbRow));
      continue;
    }

    if (exportRow !== undefined && dbRow === undefined) {
      missingInDb.push(exampleRow(date, exportRow, undefined));
      continue;
    }

    if (exportRow === undefined || dbRow === undefined) {
      continue;
    }

    const delta = roundToTwoDecimals(dbRow.value - exportRow.value);
    const absDelta = Math.abs(delta);

    matched += 1;
    totalAbsDelta += absDelta;
    maxAbsDelta = Math.max(maxAbsDelta, absDelta);

    if (absDelta > tolerance) {
      mismatches.push({
        date,
        exportValue: exportRow.value,
        dbValue: roundToTwoDecimals(dbRow.value),
        delta,
      });
    }
  }

  return {
    exportDays: exportMetricRows.size,
    dbDays: dbMetricRows.size,
    matchedDays: matched,
    missingInDb: missingInDb.length,
    extraInDb: extraInDb.length,
    mismatchedDays: mismatches.length,
    meanAbsDelta:
      matched === 0 ? null : roundToTwoDecimals(totalAbsDelta / matched),
    maxAbsDelta: roundToTwoDecimals(maxAbsDelta),
    tolerance,
    examples: {
      missingInDb: missingInDb.slice(0, limitExamples),
      extraInDb: extraInDb.slice(0, limitExamples),
      mismatches: mismatches
        .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta))
        .slice(0, limitExamples),
    },
  };
}

function compareActivitySummaryActiveEnergy({
  activitySummary,
  dbRows,
  limitExamples,
}) {
  const dbMetricRows = rowsForMetric(dbRows, "active_energy");
  const dates = new Set([...activitySummary.keys(), ...dbMetricRows.keys()]);
  const mismatches = [];
  let matched = 0;
  let totalAbsDelta = 0;
  let maxAbsDelta = 0;

  for (const date of [...dates].sort()) {
    const exportValue = activitySummary.get(date);
    const dbRow = dbMetricRows.get(date);

    if (exportValue === undefined || dbRow === undefined) {
      continue;
    }

    const delta = roundToTwoDecimals(dbRow.value - exportValue);
    const absDelta = Math.abs(delta);

    matched += 1;
    totalAbsDelta += absDelta;
    maxAbsDelta = Math.max(maxAbsDelta, absDelta);

    if (absDelta > TOLERANCES.active_energy) {
      mismatches.push({
        date,
        activitySummaryValue: exportValue,
        dbValue: roundToTwoDecimals(dbRow.value),
        delta,
      });
    }
  }

  return {
    exportDays: activitySummary.size,
    dbDays: dbMetricRows.size,
    matchedDays: matched,
    mismatchedDays: mismatches.length,
    meanAbsDelta:
      matched === 0 ? null : roundToTwoDecimals(totalAbsDelta / matched),
    maxAbsDelta: roundToTwoDecimals(maxAbsDelta),
    tolerance: TOLERANCES.active_energy,
    examples: mismatches
      .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta))
      .slice(0, limitExamples),
  };
}

function rowsForMetric(rows, metricName) {
  const mapped = new Map();

  for (const row of rows.values()) {
    if (row.metricName === metricName) {
      mapped.set(row.date, row);
    }
  }

  return mapped;
}

function exampleRow(date, exportRow, dbRow) {
  return {
    date,
    exportValue: exportRow?.value,
    dbValue:
      dbRow?.value === undefined ? undefined : roundToTwoDecimals(dbRow.value),
  };
}

function parseAttributes(line) {
  const attrs = {};
  const pattern = /([A-Za-z0-9_:-]+)="([^"]*)"/gu;

  for (const match of line.matchAll(pattern)) {
    attrs[match[1]] = decodeXmlEntities(match[2]);
  }

  return attrs;
}

function decodeXmlEntities(value) {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function localDateFromAppleDate(value) {
  return value?.slice(0, 10);
}

function appleDateToEpochMs(value) {
  if (value === undefined) {
    return Number.NaN;
  }

  const normalized = value.replace(
    /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})$/u,
    "$1T$2$3:$4",
  );

  return Date.parse(normalized);
}

function dateInRange(date, options) {
  if (date === undefined) {
    return false;
  }

  if (options.from !== undefined && date < options.from) {
    return false;
  }

  return !(options.to !== undefined && date >= options.to);
}

function aggregateKey(metricName, date) {
  return `${metricName}\t${date}`;
}

function roundToTwoDecimals(value) {
  return Math.round(value * 100) / 100;
}

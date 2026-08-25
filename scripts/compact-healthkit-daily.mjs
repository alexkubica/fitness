#!/usr/bin/env node
/* global console, process */
import { neon } from "@neondatabase/serverless";

const DEFAULT_USER_ID = "user_alex";
const FIRST_SLICE_METRICS = [
  "weight",
  "steps",
  "active_energy",
  "resting_energy",
  "sleep",
  "heart_rate",
  "resting_heart_rate",
  "walking_heart_rate",
];

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;

  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new Error("DATABASE_URL is required.");
  }

  const sql = neon(databaseUrl);
  const query = (text, params) => sql.query(text, params);

  console.log(
    JSON.stringify(
      {
        mode: options.apply ? "apply" : "dry-run",
        userId: options.userId,
        vacuum: options.vacuum,
      },
      null,
      2,
    ),
  );

  console.log(
    JSON.stringify(
      {
        before: {
          database: await databaseSize(query),
          healthMetricSamples: await relationSize(
            query,
            "health_metric_samples",
          ),
          healthSyncBatches: await relationSize(query, "health_sync_batches"),
          rows: await sampleRowsBySourceMetric(query, options.userId),
          dailyPreview: await dailyPreview(query, options.userId),
        },
      },
      null,
      2,
    ),
  );

  if (!options.apply) {
    console.log("Dry run only. Re-run with --apply to compact live rows.");
    return;
  }

  const upsertedRows = await query(UPSERT_DAILY_SQL, [options.userId]);
  const deletedRows = await query(DELETE_RAW_SQL, [options.userId]);

  await query("analyze health_metric_samples");

  if (options.vacuum) {
    await query("vacuum (full, analyze) health_metric_samples");
    await query("vacuum (full, analyze) health_sync_batches");
  }

  console.log(
    JSON.stringify(
      {
        compacted: {
          upsertedDailyRows: upsertedRows,
          deletedRawRows: deletedRows,
        },
        after: {
          database: await databaseSize(query),
          healthMetricSamples: await relationSize(
            query,
            "health_metric_samples",
          ),
          healthSyncBatches: await relationSize(query, "health_sync_batches"),
          rows: await sampleRowsBySourceMetric(query, options.userId),
        },
      },
      null,
      2,
    ),
  );
}

function parseArgs(args) {
  return {
    apply: args.includes("--apply"),
    vacuum: args.includes("--vacuum"),
    userId: valueAfter(args, "--user-id") ?? DEFAULT_USER_ID,
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

async function databaseSize(query) {
  const rows = await query(`
    select
      pg_database_size(current_database())::bigint as bytes,
      pg_size_pretty(pg_database_size(current_database())) as pretty
  `);

  return firstRow(rows);
}

async function relationSize(query, relationName) {
  const rows = await query(
    `
      select
        pg_total_relation_size($1::regclass)::bigint as bytes,
        pg_size_pretty(pg_total_relation_size($1::regclass)) as pretty
    `,
    [relationName],
  );

  return firstRow(rows);
}

async function sampleRowsBySourceMetric(query, userId) {
  return query(
    `
      select
        source,
        metric_name as "metricName",
        count(*)::bigint as rows,
        min(start_time)::text as "firstStartTime",
        max(end_time)::text as "lastEndTime"
      from health_metric_samples
      where user_id = $1
        and metric_name = any($2)
      group by source, metric_name
      order by source, metric_name
    `,
    [userId, FIRST_SLICE_METRICS],
  );
}

async function dailyPreview(query, userId) {
  return query(DAILY_PREVIEW_SQL, [userId]);
}

function firstRow(rows) {
  const row = rows[0];

  if (row === undefined) {
    throw new Error("Expected one database row.");
  }

  return row;
}

const DAILY_ROWS_CTE = `
  with source_rows as (
    select
      user_id,
      metric_name,
      value,
      unit,
      timezone,
      start_time,
      end_time
    from health_metric_samples
    where user_id = $1
      and source = 'apple_health'
      and metric_name = any(array[
        'weight',
        'steps',
        'active_energy',
        'resting_energy',
        'sleep',
        'heart_rate',
        'resting_heart_rate',
        'walking_heart_rate'
      ])
      and deleted_at is null
  ),
  daily_base as (
    select
      user_id,
      metric_name,
      value,
      unit,
      timezone,
      start_time,
      end_time,
      case
        when metric_name = 'sleep' then (end_time at time zone timezone)::date
        else (start_time at time zone timezone)::date
      end as local_date
    from source_rows
  ),
  sum_daily as (
    select
      user_id,
      metric_name,
      round(sum(value), 2) as value,
      unit,
      timezone,
      local_date,
      count(*)::integer as sample_count,
      'sum'::text as aggregation
    from daily_base
    where metric_name in ('steps', 'active_energy', 'resting_energy', 'sleep')
    group by user_id, metric_name, unit, timezone, local_date
  ),
  average_daily as (
    select
      user_id,
      metric_name,
      round(avg(value), 2) as value,
      unit,
      timezone,
      local_date,
      count(*)::integer as sample_count,
      'average'::text as aggregation
    from daily_base
    where metric_name in (
      'heart_rate',
      'resting_heart_rate',
      'walking_heart_rate'
    )
    group by user_id, metric_name, unit, timezone, local_date
  ),
  weight_counts as (
    select
      user_id,
      metric_name,
      round(value, 2) as value,
      unit,
      timezone,
      local_date,
      count(*)::integer as sample_count,
      max(end_time) as latest_end_time
    from daily_base
    where metric_name = 'weight'
    group by user_id, metric_name, round(value, 2), unit, timezone, local_date
  ),
  weight_ranked as (
    select
      *,
      row_number() over (
        partition by user_id, metric_name, unit, timezone, local_date
        order by sample_count desc, latest_end_time desc, value desc
      ) as rank
    from weight_counts
  ),
  weight_daily as (
    select
      user_id,
      metric_name,
      value,
      unit,
      timezone,
      local_date,
      sample_count,
      'mode'::text as aggregation
    from weight_ranked
    where rank = 1
  ),
  daily_rows as (
    select * from sum_daily
    union all
    select * from average_daily
    union all
    select * from weight_daily
  )
`;

const DAILY_PREVIEW_SQL = `
  ${DAILY_ROWS_CTE},
  source_counts as (
    select
      metric_name,
      count(*)::bigint as source_rows
    from daily_base
    group by metric_name
  )
  select
    daily_rows.metric_name as "metricName",
    daily_rows.aggregation,
    count(*)::bigint as "dailyRows",
    source_counts.source_rows as "sourceRows"
  from daily_rows
  join source_counts
    on source_counts.metric_name = daily_rows.metric_name
  group by
    daily_rows.metric_name,
    daily_rows.aggregation,
    source_counts.source_rows
  order by daily_rows.metric_name
`;

const UPSERT_DAILY_SQL = `
  ${DAILY_ROWS_CTE},
  upserted as (
    insert into health_metric_samples (
      user_id,
      metric_name,
      value,
      unit,
      source,
      source_sample_id,
      start_time,
      end_time,
      timezone,
      metadata
    )
    select
      user_id,
      metric_name,
      value,
      unit,
      'apple_health_daily',
      concat(
        'apple-health-daily:',
        metric_name,
        ':',
        local_date::text,
        ':',
        replace(timezone, '/', '_')
      ),
      local_date::timestamp at time zone timezone,
      (local_date + 1)::timestamp at time zone timezone,
      timezone,
      jsonb_build_object(
        'aggregation',
        aggregation,
        'sampleCount',
        sample_count,
        'compactedFromSource',
        'apple_health'
      )
    from daily_rows
    on conflict (user_id, source, source_sample_id, metric_name)
    do update set
      value = excluded.value,
      unit = excluded.unit,
      start_time = excluded.start_time,
      end_time = excluded.end_time,
      timezone = excluded.timezone,
      deleted_at = null,
      metadata = excluded.metadata
    returning metric_name
  )
  select
    metric_name as "metricName",
    count(*)::bigint as rows
  from upserted
  group by metric_name
  order by metric_name
`;

const DELETE_RAW_SQL = `
  with deleted as (
    delete from health_metric_samples
    where user_id = $1
      and source = 'apple_health'
      and metric_name = any(array[
        'weight',
        'steps',
        'active_energy',
        'resting_energy',
        'sleep',
        'heart_rate',
        'resting_heart_rate',
        'walking_heart_rate'
      ])
    returning metric_name
  )
  select
    metric_name as "metricName",
    count(*)::bigint as rows
  from deleted
  group by metric_name
  order by metric_name
`;

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

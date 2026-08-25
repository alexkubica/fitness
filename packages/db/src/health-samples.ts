import type { HealthMetricName, HealthMetricUnit } from "@fitness/domain";

export type SqlQueryExecutor = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<readonly Record<string, unknown>[]>;

export type HealthMetricSampleInput = Readonly<{
  metricName: HealthMetricName;
  unit: HealthMetricUnit;
  value: number;
  startTime: string;
  endTime: string;
  timezone: string;
  source: string;
  sourceSampleId: string;
}>;

export type HealthMetricDeletedSampleInput = Readonly<{
  metricName: HealthMetricName;
  source: string;
  sourceSampleId: string;
}>;

export type HealthMetricSample = HealthMetricSampleInput &
  Readonly<{
    userId: string;
    profileId?: string | undefined;
  }>;

export type HealthSyncIngestInput = Readonly<{
  userId: string;
  profileId?: string | undefined;
  idempotencyKey: string;
  samples: readonly HealthMetricSampleInput[];
  deletedSamples?: readonly HealthMetricDeletedSampleInput[];
}>;

export type HealthSyncSampleResult = Readonly<{
  id: string;
  metricName: HealthMetricName;
  sourceSampleId: string;
  status: "created" | "duplicate";
}>;

export type HealthSyncDeletedSampleResult = Readonly<{
  id: string | null;
  metricName: HealthMetricName;
  sourceSampleId: string;
  status: "deleted" | "already_deleted" | "missing";
}>;

export type HealthSyncResponse = Readonly<{
  status: "ok";
  idempotencyKey: string;
  accepted: number;
  created: number;
  duplicate: number;
  deleted: number;
  alreadyDeleted: number;
  missingDeleted: number;
  samples: readonly HealthSyncSampleResult[];
  deletedSamples: readonly HealthSyncDeletedSampleResult[];
}>;

export type HealthSyncIngestResult = Readonly<{
  response: HealthSyncResponse;
  createdBatch: boolean;
}>;

export type HealthReadListInput = Readonly<{
  userId: string;
  profileId?: string | undefined;
  range: Readonly<{
    from: string;
    to: string;
  }>;
  metricName?: HealthMetricName;
}>;

export type NeonHealthSampleRepository = Readonly<{
  ingestSamples(input: HealthSyncIngestInput): Promise<HealthSyncIngestResult>;
  listSamples(
    input: HealthReadListInput,
  ): Promise<readonly HealthMetricSample[]>;
}>;

type HealthMetricSampleJson = HealthMetricSampleInput &
  Readonly<{
    ordinal: number;
  }>;

type HealthMetricDeletedSampleJson = HealthMetricDeletedSampleInput &
  Readonly<{
    ordinal: number;
  }>;

export function createNeonHealthSampleRepository(
  sql: SqlQueryExecutor,
): NeonHealthSampleRepository {
  return {
    async ingestSamples(input) {
      const samplesJson = JSON.stringify(samplesForJson(input.samples));
      const deletedSamplesJson = JSON.stringify(
        deletedSamplesForJson(input.deletedSamples ?? []),
      );
      const rows = await sql`
        with existing_batch as (
          select response
          from health_sync_batches
          where (
              profile_id = ${input.profileId ?? null}::uuid
              or (
                ${input.profileId ?? null}::uuid is null
                and profile_id is null
                and user_id = ${input.userId}::text
              )
            )
            and idempotency_key = ${input.idempotencyKey}::text
        ),
        ensure_user as (
          insert into users (id)
          select ${input.userId}::text
          where not exists (select 1 from existing_batch)
          on conflict (id) do nothing
        ),
        input_samples as (
          select *
          from jsonb_to_recordset(${samplesJson}::jsonb) as sample(
            ordinal integer,
            "metricName" text,
            unit text,
            value numeric,
            "startTime" timestamptz,
            "endTime" timestamptz,
            timezone text,
            source text,
            "sourceSampleId" text
          )
          where not exists (select 1 from existing_batch)
        ),
        input_deleted_samples as (
          select *
          from jsonb_to_recordset(${deletedSamplesJson}::jsonb) as deleted_sample(
            ordinal integer,
            "metricName" text,
            source text,
            "sourceSampleId" text
          )
          where not exists (select 1 from existing_batch)
        ),
        inserted_samples as (
          insert into health_metric_samples (
            user_id,
            profile_id,
            metric_name,
            value,
            unit,
            source,
            source_sample_id,
            start_time,
            end_time,
            timezone
          )
          select
            ${input.userId}::text,
            ${input.profileId ?? null}::uuid,
            "metricName",
            value,
            unit,
            source,
            "sourceSampleId",
            "startTime",
            "endTime",
            timezone
          from input_samples
          on conflict (profile_id, source, source_sample_id, metric_name)
          where profile_id is not null
          do update set
            value = excluded.value,
            unit = excluded.unit,
            start_time = excluded.start_time,
            end_time = excluded.end_time,
            timezone = excluded.timezone,
            deleted_at = null,
            metadata = excluded.metadata
          where health_metric_samples.source = 'apple_health_daily'
          returning id::text, metric_name, source_sample_id
        ),
        resolved_samples as (
          select
            input_samples.ordinal,
            inserted_samples.id,
            inserted_samples.metric_name,
            inserted_samples.source_sample_id,
            'created' as status
          from input_samples
          join inserted_samples
            on inserted_samples.source_sample_id = input_samples."sourceSampleId"
           and inserted_samples.metric_name = input_samples."metricName"
          union all
          select
            input_samples.ordinal,
            health_metric_samples.id::text as id,
            input_samples."metricName" as metric_name,
            input_samples."sourceSampleId" as source_sample_id,
            'duplicate' as status
          from input_samples
          join health_metric_samples
            on (
              health_metric_samples.profile_id = ${input.profileId ?? null}::uuid
              or (
                ${input.profileId ?? null}::uuid is null
                and health_metric_samples.profile_id is null
                and health_metric_samples.user_id = ${input.userId}::text
              )
            )
           and health_metric_samples.source = input_samples.source
           and health_metric_samples.source_sample_id = input_samples."sourceSampleId"
           and health_metric_samples.metric_name = input_samples."metricName"
          left join inserted_samples
            on inserted_samples.id = health_metric_samples.id::text
          where inserted_samples.id is null
        ),
        updated_deleted_samples as (
          update health_metric_samples
          set deleted_at = coalesce(deleted_at, now())
          from input_deleted_samples
          where health_metric_samples.user_id = ${input.userId}::text
            and (
              health_metric_samples.profile_id = ${input.profileId ?? null}::uuid
              or (
                ${input.profileId ?? null}::uuid is null
                and health_metric_samples.profile_id is null
              )
            )
            and health_metric_samples.source = input_deleted_samples.source
            and health_metric_samples.source_sample_id = input_deleted_samples."sourceSampleId"
            and health_metric_samples.metric_name = input_deleted_samples."metricName"
            and health_metric_samples.deleted_at is null
          returning
            input_deleted_samples.ordinal,
            health_metric_samples.id::text as id,
            health_metric_samples.metric_name,
            health_metric_samples.source_sample_id,
            'deleted' as status
        ),
        already_deleted_samples as (
          select
            input_deleted_samples.ordinal,
            health_metric_samples.id::text as id,
            input_deleted_samples."metricName" as metric_name,
            input_deleted_samples."sourceSampleId" as source_sample_id,
            'already_deleted' as status
          from input_deleted_samples
          join health_metric_samples
            on (
              health_metric_samples.profile_id = ${input.profileId ?? null}::uuid
              or (
                ${input.profileId ?? null}::uuid is null
                and health_metric_samples.profile_id is null
                and health_metric_samples.user_id = ${input.userId}::text
              )
            )
           and health_metric_samples.source = input_deleted_samples.source
           and health_metric_samples.source_sample_id = input_deleted_samples."sourceSampleId"
           and health_metric_samples.metric_name = input_deleted_samples."metricName"
          left join updated_deleted_samples
            on updated_deleted_samples.id = health_metric_samples.id::text
          where health_metric_samples.deleted_at is not null
            and updated_deleted_samples.id is null
        ),
        missing_deleted_samples as (
          select
            input_deleted_samples.ordinal,
            null::text as id,
            input_deleted_samples."metricName" as metric_name,
            input_deleted_samples."sourceSampleId" as source_sample_id,
            'missing' as status
          from input_deleted_samples
          left join health_metric_samples
            on (
              health_metric_samples.profile_id = ${input.profileId ?? null}::uuid
              or (
                ${input.profileId ?? null}::uuid is null
                and health_metric_samples.profile_id is null
                and health_metric_samples.user_id = ${input.userId}::text
              )
            )
           and health_metric_samples.source = input_deleted_samples.source
           and health_metric_samples.source_sample_id = input_deleted_samples."sourceSampleId"
           and health_metric_samples.metric_name = input_deleted_samples."metricName"
          where health_metric_samples.id is null
        ),
        resolved_deleted_samples as (
          select * from updated_deleted_samples
          union all
          select * from already_deleted_samples
          union all
          select * from missing_deleted_samples
        ),
        new_response as (
          select jsonb_build_object(
            'status',
            'ok',
            'idempotencyKey',
            ${input.idempotencyKey}::text,
            'accepted',
            (select count(*) from input_samples) + (select count(*) from input_deleted_samples),
            'created',
            (select count(*) from resolved_samples where status = 'created'),
            'duplicate',
            (select count(*) from resolved_samples where status = 'duplicate'),
            'deleted',
            (select count(*) from resolved_deleted_samples where status = 'deleted'),
            'alreadyDeleted',
            (select count(*) from resolved_deleted_samples where status = 'already_deleted'),
            'missingDeleted',
            (select count(*) from resolved_deleted_samples where status = 'missing'),
            'samples',
            coalesce(
              (
                select jsonb_agg(
                  jsonb_build_object(
                    'id',
                    id,
                    'metricName',
                    metric_name,
                    'sourceSampleId',
                    source_sample_id,
                    'status',
                    status
                  )
                  order by ordinal
                )
                from resolved_samples
              ),
              '[]'::jsonb
            ),
            'deletedSamples',
            coalesce(
              (
                select jsonb_agg(
                  jsonb_build_object(
                    'id',
                    id,
                    'metricName',
                    metric_name,
                    'sourceSampleId',
                    source_sample_id,
                    'status',
                    status
                  )
                  order by ordinal
                )
                from resolved_deleted_samples
              ),
              '[]'::jsonb
            )
          ) as response
        ),
        inserted_batch as (
          insert into health_sync_batches (
            user_id,
            profile_id,
            idempotency_key,
            response
          )
          select
            ${input.userId}::text,
            ${input.profileId ?? null}::uuid,
            ${input.idempotencyKey}::text,
            response || jsonb_build_object(
              'samples',
              '[]'::jsonb,
              'deletedSamples',
              '[]'::jsonb
            )
          from new_response
          on conflict (profile_id, idempotency_key)
          where profile_id is not null
          do nothing
          returning response
        )
        select false as created_batch, response
        from existing_batch
        union all
        select true as created_batch, response
        from new_response
        where exists (select 1 from inserted_batch)
        limit 1
      `;

      return parseIngestResult(rows[0]);
    },
    async listSamples(input) {
      const rows = await sql`
        with read_input as (
          select
            ${input.userId}::text as user_id,
            ${input.profileId ?? null}::uuid as profile_id,
            ${input.range.from}::timestamptz as from_time,
            ${input.range.to}::timestamptz as to_time,
            ${input.metricName ?? null}::text as metric_name
        )
        select
          health_metric_samples.user_id,
          health_metric_samples.profile_id::text as profile_id,
          health_metric_samples.metric_name,
          health_metric_samples.unit,
          health_metric_samples.value,
          health_metric_samples.start_time,
          health_metric_samples.end_time,
          health_metric_samples.timezone,
          health_metric_samples.source,
          health_metric_samples.source_sample_id
        from health_metric_samples, read_input
        where (
            health_metric_samples.profile_id = read_input.profile_id
            or (
              read_input.profile_id is null
              and health_metric_samples.user_id = read_input.user_id
            )
          )
          and health_metric_samples.deleted_at is null
          and (
            (
              health_metric_samples.start_time = health_metric_samples.end_time
              and health_metric_samples.start_time >= read_input.from_time
              and health_metric_samples.start_time < read_input.to_time
            )
            or (
              health_metric_samples.start_time <> health_metric_samples.end_time
              and health_metric_samples.start_time < read_input.to_time
              and health_metric_samples.end_time > read_input.from_time
            )
          )
          and (
            read_input.metric_name is null
            or health_metric_samples.metric_name = read_input.metric_name
          )
        order by start_time asc
      `;

      return rows.map(rowToHealthMetricSample);
    },
  };
}

function samplesForJson(
  samples: readonly HealthMetricSampleInput[],
): readonly HealthMetricSampleJson[] {
  return samples.map((sample, ordinal) => ({
    ...sample,
    ordinal,
  }));
}

function deletedSamplesForJson(
  samples: readonly HealthMetricDeletedSampleInput[],
): readonly HealthMetricDeletedSampleJson[] {
  return samples.map((sample, ordinal) => ({
    ...sample,
    ordinal,
  }));
}

function parseIngestResult(row: Record<string, unknown> | undefined) {
  if (row === undefined) {
    throw new Error("Health sync repository did not return a batch response.");
  }

  return {
    createdBatch: row.created_batch === true,
    response: parseHealthSyncResponse(row.response),
  };
}

function parseHealthSyncResponse(value: unknown): HealthSyncResponse {
  const parsed =
    typeof value === "string" ? (JSON.parse(value) as unknown) : value;

  if (!isRecord(parsed) || parsed.status !== "ok") {
    throw new Error("Health sync repository returned an invalid response.");
  }

  return parsed as HealthSyncResponse;
}

function rowToHealthMetricSample(
  row: Record<string, unknown>,
): HealthMetricSample {
  return {
    userId: stringColumn(row, "user_id"),
    profileId: optionalStringColumn(row, "profile_id"),
    metricName: stringColumn(row, "metric_name") as HealthMetricName,
    unit: stringColumn(row, "unit") as HealthMetricUnit,
    value: numberColumn(row, "value"),
    startTime: timestampColumn(row, "start_time"),
    endTime: timestampColumn(row, "end_time"),
    timezone: stringColumn(row, "timezone"),
    source: stringColumn(row, "source"),
    sourceSampleId: stringColumn(row, "source_sample_id"),
  };
}

function optionalStringColumn(
  row: Record<string, unknown>,
  column: string,
): string | undefined {
  const value = row[column];

  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`Expected ${column} to be a string.`);
  }

  return value;
}

function stringColumn(row: Record<string, unknown>, column: string): string {
  const value = row[column];

  if (typeof value !== "string") {
    throw new Error(`Expected ${column} to be a string.`);
  }

  return value;
}

function numberColumn(row: Record<string, unknown>, column: string): number {
  const value = row[column];
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(parsed)) {
    throw new Error(`Expected ${column} to be a finite number.`);
  }

  return parsed;
}

function timestampColumn(row: Record<string, unknown>, column: string): string {
  const value = row[column];

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string" && Number.isFinite(Date.parse(value))) {
    return new Date(value).toISOString();
  }

  throw new Error(`Expected ${column} to be a timestamp.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

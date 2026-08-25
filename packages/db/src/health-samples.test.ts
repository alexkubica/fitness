import { describe, expect, it } from "vitest";
import {
  createNeonHealthSampleRepository,
  type SqlQueryExecutor,
} from "./health-samples.js";

const sample = {
  metricName: "weight",
  unit: "kg",
  value: 87.4,
  startTime: "2026-06-11T06:00:00.000Z",
  endTime: "2026-06-11T06:00:00.000Z",
  timezone: "Asia/Jerusalem",
  source: "apple_health_daily",
  sourceSampleId: "apple-health-daily:weight:2026-06-11:Asia_Jerusalem",
} as const;

describe("Neon health sample repository", () => {
  it("uses a durable health sync batch response for idempotent ingestion", async () => {
    const response = {
      status: "ok",
      idempotencyKey: "healthkit-batch-1",
      accepted: 1,
      created: 1,
      duplicate: 0,
      deleted: 0,
      alreadyDeleted: 0,
      missingDeleted: 0,
      samples: [
        {
          id: "db-health-sample-1",
          metricName: "weight",
          sourceSampleId: "apple-health-daily:weight:2026-06-11:Asia_Jerusalem",
          status: "created",
        },
      ],
      deletedSamples: [],
    };
    const sql = createFakeSql([[{ created_batch: true, response }]]);
    const repository = createNeonHealthSampleRepository(sql);

    const result = await repository.ingestSamples({
      userId: "user_alex",
      idempotencyKey: "healthkit-batch-1",
      samples: [sample],
    });

    expect(result).toEqual({
      createdBatch: true,
      response,
    });
    expect(sql.calls).toHaveLength(1);
    expect(sql.calls[0]?.text).toContain("health_sync_batches");
    expect(sql.calls[0]?.text).toContain("jsonb_to_recordset");
    expect(sql.calls[0]?.text).toContain("on conflict");
    expect(sql.calls[0]?.text).toContain("do update set");
    expect(sql.calls[0]?.text).toContain(
      "where health_metric_samples.source = 'apple_health_daily'",
    );
    expect(sql.calls[0]?.text).toContain("'idempotencykey'");
    expect(sql.calls[0]?.text).toContain("'created' as status");
    expect(sql.calls[0]?.text).toContain("'duplicate' as status");
    expect(sql.calls[0]?.text).toContain("'deleted' as status");
    expect(sql.calls[0]?.text).toContain("response || jsonb_build_object");
    expect(sql.calls[0]?.text).toContain("'samples'");
    expect(sql.calls[0]?.text).toContain("'deletedsamples'");
    expect(sql.calls[0]?.values).toContain("user_alex");
    expect(sql.calls[0]?.values).toContain("healthkit-batch-1");
    expect(sql.calls[0]?.values).toContain(JSON.stringify([sampleWithOrdinal]));
    expect(sql.calls[0]?.values).toContain(JSON.stringify([]));
  });

  it("soft-deletes existing samples idempotently through the health sync batch", async () => {
    const deletedSample = {
      metricName: "weight",
      source: "apple_health",
      sourceSampleId: "hk-weight-sample-1",
    } as const;
    const response = {
      status: "ok",
      idempotencyKey: "healthkit-delete-1",
      accepted: 1,
      created: 0,
      duplicate: 0,
      deleted: 1,
      alreadyDeleted: 0,
      missingDeleted: 0,
      samples: [],
      deletedSamples: [
        {
          id: "db-health-sample-1",
          metricName: "weight",
          sourceSampleId: "hk-weight-sample-1",
          status: "deleted",
        },
      ],
    };
    const sql = createFakeSql([[{ created_batch: true, response }]]);
    const repository = createNeonHealthSampleRepository(sql);

    const result = await repository.ingestSamples({
      userId: "user_alex",
      idempotencyKey: "healthkit-delete-1",
      samples: [],
      deletedSamples: [deletedSample],
    });

    expect(result).toEqual({
      createdBatch: true,
      response,
    });
    expect(sql.calls).toHaveLength(1);
    expect(sql.calls[0]?.text).toContain("deleted_at = coalesce");
    expect(sql.calls[0]?.text).toContain("'already_deleted' as status");
    expect(sql.calls[0]?.text).toContain("'missing' as status");
    expect(sql.calls[0]?.values).toContain(
      JSON.stringify([deletedSampleWithOrdinal]),
    );
  });

  it("lists non-deleted samples that overlap a requested range", async () => {
    const sql = createFakeSql([
      [
        {
          user_id: "user_alex",
          metric_name: "weight",
          unit: "kg",
          value: "87.4000",
          start_time: new Date("2026-06-11T06:00:00.000Z"),
          end_time: new Date("2026-06-11T06:00:00.000Z"),
          timezone: "Asia/Jerusalem",
          source: "apple_health",
          source_sample_id: "hk-weight-sample-1",
        },
      ],
    ]);
    const repository = createNeonHealthSampleRepository(sql);

    const samples = await repository.listSamples({
      userId: "user_alex",
      metricName: "weight",
      range: {
        from: "2026-06-11T00:00:00.000Z",
        to: "2026-06-12T00:00:00.000Z",
      },
    });

    expect(samples).toEqual([
      {
        userId: "user_alex",
        metricName: "weight",
        unit: "kg",
        value: 87.4,
        startTime: "2026-06-11T06:00:00.000Z",
        endTime: "2026-06-11T06:00:00.000Z",
        timezone: "Asia/Jerusalem",
        source: "apple_health",
        sourceSampleId: "hk-weight-sample-1",
      },
    ]);
    expect(sql.calls).toHaveLength(1);
    expect(sql.calls[0]?.text).toContain("deleted_at is null");
    expect(sql.calls[0]?.text).toContain(
      "health_metric_samples.start_time = health_metric_samples.end_time",
    );
    expect(sql.calls[0]?.text).toContain("order by start_time asc");
    expect(sql.calls[0]?.values).toEqual([
      "user_alex",
      null,
      "2026-06-11T00:00:00.000Z",
      "2026-06-12T00:00:00.000Z",
      "weight",
    ]);
  });
});

const sampleWithOrdinal = {
  ...sample,
  ordinal: 0,
};

const deletedSampleWithOrdinal = {
  metricName: "weight",
  source: "apple_health",
  sourceSampleId: "hk-weight-sample-1",
  ordinal: 0,
};

function createFakeSql(
  rowsByCall: readonly (readonly Record<string, unknown>[])[],
): SqlQueryExecutor & {
  calls: { text: string; values: readonly unknown[] }[];
} {
  const calls: { text: string; values: readonly unknown[] }[] = [];

  const sql = (async (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<readonly Record<string, unknown>[]> => {
    calls.push({
      text: templateText(strings, values.length).toLowerCase(),
      values,
    });

    return rowsByCall[calls.length - 1] ?? [];
  }) as SqlQueryExecutor & {
    calls: { text: string; values: readonly unknown[] }[];
  };

  sql.calls = calls;

  return sql;
}

function templateText(
  strings: TemplateStringsArray,
  valueCount: number,
): string {
  return strings.reduce((text, chunk, index) => {
    const placeholder = index < valueCount ? `$${index + 1}` : "";

    return `${text}${chunk}${placeholder}`;
  }, "");
}

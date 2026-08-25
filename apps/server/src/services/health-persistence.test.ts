import { describe, expect, it } from "vitest";
import { createRepositoryHealthReadService } from "./health-read.js";
import { createRepositoryHealthSyncService } from "./health-sync.js";

const repositorySample = {
  userId: "user_alex",
  metricName: "weight" as const,
  unit: "kg" as const,
  value: 87.4,
  startTime: "2026-06-11T06:00:00.000Z",
  endTime: "2026-06-11T06:00:00.000Z",
  timezone: "Asia/Jerusalem",
  source: "apple_health",
  sourceSampleId: "hk-weight-sample-1",
};

describe("repository-backed health services", () => {
  it("delegates ingestion to a durable repository", async () => {
    const calls: unknown[] = [];
    const healthSync = createRepositoryHealthSyncService({
      async ingestSamples(input) {
        calls.push(input);

        return {
          createdBatch: true,
          response: {
            status: "ok",
            idempotencyKey: input.idempotencyKey,
            accepted: input.samples.length,
            created: 1,
            duplicate: 0,
            deleted: 0,
            alreadyDeleted: 0,
            missingDeleted: 0,
            samples: [
              {
                id: "db-health-sample-1",
                metricName: "weight",
                sourceSampleId: "hk-weight-sample-1",
                status: "created",
              },
            ],
            deletedSamples: [],
          },
        };
      },
    });

    const result = await healthSync.ingest({
      userId: "user_alex",
      idempotencyKey: "healthkit-batch-1",
      samples: [
        {
          metricName: "weight",
          unit: "kg",
          value: 87.4,
          startTime: "2026-06-11T06:00:00.000Z",
          endTime: "2026-06-11T06:00:00.000Z",
          timezone: "Asia/Jerusalem",
          source: "apple_health",
          sourceSampleId: "hk-weight-sample-1",
        },
      ],
    });

    expect(result.response.samples[0]?.id).toBe("db-health-sample-1");
    expect(calls).toHaveLength(1);
  });

  it("delegates MCP health reads to the same durable repository", async () => {
    const calls: unknown[] = [];
    const healthRead = createRepositoryHealthReadService({
      async listSamples(input) {
        calls.push(input);

        return [repositorySample];
      },
    });

    const result = await healthRead.listSamples({
      userId: "user_alex",
      metricName: "weight",
      range: {
        from: "2026-06-11T00:00:00.000Z",
        to: "2026-06-12T00:00:00.000Z",
      },
    });

    expect(result).toEqual([repositorySample]);
    expect(calls).toEqual([
      {
        userId: "user_alex",
        metricName: "weight",
        range: {
          from: "2026-06-11T00:00:00.000Z",
          to: "2026-06-12T00:00:00.000Z",
        },
      },
    ]);
  });
});

import type { HealthMetricName, HealthMetricUnit } from "@fitness/domain";
import type { NeonHealthSampleRepository } from "@fitness/db";

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

export type HealthSyncService = Readonly<{
  ingest(
    input: HealthSyncIngestInput,
  ): HealthSyncIngestResult | Promise<HealthSyncIngestResult>;
}>;

export type HealthSyncRepository = Pick<
  NeonHealthSampleRepository,
  "ingestSamples"
>;

export function createHealthSyncService(): HealthSyncService {
  const batchResponses = new Map<string, HealthSyncResponse>();
  const sampleIds = new Map<string, string>();
  const deletedSampleKeys = new Set<string>();
  let nextSampleId = 1;

  return {
    ingest(input) {
      const batchKey = batchIdempotencyKey(input);
      const existingResponse = batchResponses.get(batchKey);

      if (existingResponse !== undefined) {
        return {
          response: copyResponse(existingResponse),
          createdBatch: false,
        };
      }

      let created = 0;
      let duplicate = 0;
      let deleted = 0;
      let alreadyDeleted = 0;
      let missingDeleted = 0;
      const samples: HealthSyncSampleResult[] = [];
      const deletedSamples: HealthSyncDeletedSampleResult[] = [];

      for (const sample of input.samples) {
        const dedupeKey = sampleDedupeKey(input, sample);
        const existingSampleId = sampleIds.get(dedupeKey);

        if (existingSampleId !== undefined) {
          duplicate += 1;
          samples.push({
            id: existingSampleId,
            metricName: sample.metricName,
            sourceSampleId: sample.sourceSampleId,
            status: "duplicate",
          });
          continue;
        }

        const id = `health_sample_${nextSampleId}`;

        nextSampleId += 1;
        created += 1;
        sampleIds.set(dedupeKey, id);
        samples.push({
          id,
          metricName: sample.metricName,
          sourceSampleId: sample.sourceSampleId,
          status: "created",
        });
      }

      for (const deletedSample of input.deletedSamples ?? []) {
        const dedupeKey = deletedSampleDedupeKey(input, deletedSample);
        const existingSampleId = sampleIds.get(dedupeKey);

        if (existingSampleId === undefined) {
          missingDeleted += 1;
          deletedSamples.push({
            id: null,
            metricName: deletedSample.metricName,
            sourceSampleId: deletedSample.sourceSampleId,
            status: "missing",
          });
          continue;
        }

        if (deletedSampleKeys.has(dedupeKey)) {
          alreadyDeleted += 1;
          deletedSamples.push({
            id: existingSampleId,
            metricName: deletedSample.metricName,
            sourceSampleId: deletedSample.sourceSampleId,
            status: "already_deleted",
          });
          continue;
        }

        deleted += 1;
        deletedSampleKeys.add(dedupeKey);
        deletedSamples.push({
          id: existingSampleId,
          metricName: deletedSample.metricName,
          sourceSampleId: deletedSample.sourceSampleId,
          status: "deleted",
        });
      }

      const response: HealthSyncResponse = {
        status: "ok",
        idempotencyKey: input.idempotencyKey,
        accepted: input.samples.length + (input.deletedSamples ?? []).length,
        created,
        duplicate,
        deleted,
        alreadyDeleted,
        missingDeleted,
        samples,
        deletedSamples,
      };

      batchResponses.set(batchKey, response);

      return {
        response: copyResponse(response),
        createdBatch: true,
      };
    },
  };
}

export function createRepositoryHealthSyncService(
  repository: HealthSyncRepository,
): HealthSyncService {
  return {
    ingest(input) {
      return repository.ingestSamples(input);
    },
  };
}

function batchIdempotencyKey(input: {
  userId: string;
  profileId?: string | undefined;
  idempotencyKey: string;
}): string {
  return `${input.profileId ?? `legacy:${input.userId}`}\u0000${input.idempotencyKey}`;
}

function sampleDedupeKey(
  input: { userId: string; profileId?: string | undefined },
  sample: HealthMetricSampleInput,
): string {
  return [
    input.profileId ?? `legacy:${input.userId}`,
    sample.source,
    sample.sourceSampleId,
    sample.metricName,
  ].join("\u0000");
}

function deletedSampleDedupeKey(
  input: { userId: string; profileId?: string | undefined },
  sample: HealthMetricDeletedSampleInput,
): string {
  return [
    input.profileId ?? `legacy:${input.userId}`,
    sample.source,
    sample.sourceSampleId,
    sample.metricName,
  ].join("\u0000");
}

function copyResponse(response: HealthSyncResponse): HealthSyncResponse {
  return {
    ...response,
    samples: response.samples.map((sample) => ({ ...sample })),
    deletedSamples: response.deletedSamples.map((sample) => ({ ...sample })),
  };
}

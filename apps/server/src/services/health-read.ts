import type { NeonHealthSampleRepository } from "@fitness/db";
import type { HealthMetricName, HealthMetricUnit } from "@fitness/domain";

export type HealthMetricSample = Readonly<{
  userId: string;
  profileId?: string | undefined;
  metricName: HealthMetricName;
  unit: HealthMetricUnit;
  value: number;
  startTime: string;
  endTime: string;
  timezone: string;
  source: string;
  sourceSampleId: string;
}>;

export type HealthReadRange = Readonly<{
  from: string;
  to: string;
}>;

export type HealthReadListInput = Readonly<{
  userId: string;
  profileId?: string | undefined;
  range: HealthReadRange;
  metricName?: HealthMetricName;
}>;

export type HealthReadService = Readonly<{
  listSamples(
    input: HealthReadListInput,
  ): Promise<readonly HealthMetricSample[]>;
}>;

export type HealthReadRepository = Pick<
  NeonHealthSampleRepository,
  "listSamples"
>;

export type NormalizedHealthReadRange = Readonly<{
  from: string;
  to: string;
  fromTime: number;
  toTime: number;
}>;

export function createInMemoryHealthReadService(
  initialSamples: readonly HealthMetricSample[] = [],
): HealthReadService {
  const samples = initialSamples.map(copySample);

  return {
    async listSamples(input) {
      const range = normalizeHealthReadRange(input.range);

      return samples
        .filter((sample) =>
          input.profileId === undefined
            ? sample.userId === input.userId
            : sample.profileId === input.profileId ||
              (sample.profileId === undefined &&
                sample.userId === input.userId),
        )
        .filter((sample) =>
          input.metricName === undefined
            ? true
            : sample.metricName === input.metricName,
        )
        .filter((sample) => sampleOverlapsRange(sample, range))
        .sort(compareSamplesByStartTime)
        .map(copySample);
    },
  };
}

export function createRepositoryHealthReadService(
  repository: HealthReadRepository,
): HealthReadService {
  return {
    listSamples(input) {
      return repository.listSamples(input);
    },
  };
}

export function normalizeHealthReadRange(
  range: HealthReadRange,
): NormalizedHealthReadRange {
  const fromTime = Date.parse(range.from);
  const toTime = Date.parse(range.to);

  if (!Number.isFinite(fromTime) || !Number.isFinite(toTime)) {
    throw new Error("Range timestamps must be valid ISO date strings.");
  }

  if (fromTime >= toTime) {
    throw new Error("Range 'from' must be before range 'to'.");
  }

  return {
    from: new Date(fromTime).toISOString(),
    to: new Date(toTime).toISOString(),
    fromTime,
    toTime,
  };
}

function sampleOverlapsRange(
  sample: HealthMetricSample,
  range: NormalizedHealthReadRange,
): boolean {
  const sampleStartTime = Date.parse(sample.startTime);
  const sampleEndTime = Date.parse(sample.endTime);

  if (!Number.isFinite(sampleStartTime) || !Number.isFinite(sampleEndTime)) {
    return false;
  }

  if (sampleStartTime === sampleEndTime) {
    return sampleStartTime >= range.fromTime && sampleStartTime < range.toTime;
  }

  return sampleStartTime < range.toTime && sampleEndTime > range.fromTime;
}

function compareSamplesByStartTime(
  left: HealthMetricSample,
  right: HealthMetricSample,
): number {
  return Date.parse(left.startTime) - Date.parse(right.startTime);
}

function copySample(sample: HealthMetricSample): HealthMetricSample {
  return { ...sample };
}

import type { HealthMetricName, HealthMetricUnit } from "./metrics.js";
import type { TargetPlanTargets } from "./target-plans.js";

export type CoachReportRange = Readonly<{
  from: string;
  to: string;
}>;

export type CoachReportHealthSample = Readonly<{
  metricName: HealthMetricName;
  unit: HealthMetricUnit;
  value: number;
  startTime: string;
  endTime: string;
}>;

export type CoachReportCheckIn = Readonly<{
  hunger: number;
  mood: number;
  energy: number;
  stress: number;
  cravings: number;
  notes: string;
  createdAt: string;
}>;

export type CoachReportMealLog = Readonly<{
  text: string;
  createdAt: string;
  hasMacroEstimate?: boolean | undefined;
}>;

export type DailyCoachReportMetrics = Readonly<{
  latestWeightKg?: number;
  totalSteps?: number;
  activeEnergyKcal?: number;
  restingEnergyKcal?: number;
  totalEnergyKcal?: number;
  sleepMinutes?: number;
  averageHeartRateBpm?: number;
  averageRestingHeartRateBpm?: number;
  averageWalkingHeartRateBpm?: number;
}>;

export type DailyCoachReportCheckIns = Readonly<{
  count: number;
  averages?: Readonly<{
    hunger: number;
    mood: number;
    energy: number;
    stress: number;
    cravings: number;
  }>;
}>;

export type DailyCoachReportMeals = Readonly<{
  count: number;
  hasMacroEstimates: boolean;
}>;

export type DailyCoachReport = Readonly<{
  generatedAt: string;
  range: CoachReportRange;
  metrics: DailyCoachReportMetrics;
  checkIns: DailyCoachReportCheckIns;
  meals: DailyCoachReportMeals;
  highlights: readonly string[];
  guidance: readonly string[];
  dataQuality: readonly string[];
  safetyNote: string;
  targetPeriods: readonly CoachReportTargetPeriod[];
  targetChanges: readonly string[];
}>;

export type CoachReportTargetPeriod = Readonly<{
  planId: string;
  version: number;
  effectiveFrom: string;
  effectiveUntil?: string | undefined;
  targets: TargetPlanTargets;
}>;

export type DailyCoachReportInput = Readonly<{
  generatedAt: string;
  range: CoachReportRange;
  healthSamples: readonly CoachReportHealthSample[];
  checkIns: readonly CoachReportCheckIn[];
  mealLogs: readonly CoachReportMealLog[];
  targetPeriods?: readonly CoachReportTargetPeriod[] | undefined;
}>;

const safetyNote =
  "This is wellness coaching from wearable and self-reported data, not a medical diagnosis. Seek medical care for chest pain, fainting, severe shortness of breath, unusual heart symptoms, or other concerning symptoms.";

export function generateDailyCoachReport(
  input: DailyCoachReportInput,
): DailyCoachReport {
  const metrics = summarizeReportMetrics(input.healthSamples);
  const checkIns = summarizeCheckIns(input.checkIns);
  const meals = {
    count: input.mealLogs.length,
    hasMacroEstimates: input.mealLogs.some(
      (mealLog) => mealLog.hasMacroEstimate === true,
    ),
  };
  const dataQuality = dataQualityNotes(input);
  const targetPeriods = input.targetPeriods ?? [];
  const targetChanges = targetPeriods
    .slice(1)
    .map(
      (period) =>
        `Targets changed to v${period.version} on ${period.effectiveFrom}; adherence is evaluated within each versioned period.`,
    );

  return {
    generatedAt: input.generatedAt,
    range: input.range,
    metrics,
    checkIns,
    meals,
    highlights: buildHighlights(metrics, checkIns, meals),
    guidance: buildGuidance(
      metrics,
      checkIns,
      input.healthSamples.length,
      targetPeriods,
    ),
    dataQuality,
    safetyNote,
    targetPeriods,
    targetChanges,
  };
}

export function formatDailyCoachReportText(report: DailyCoachReport): string {
  const lines = [
    "Daily coach report",
    `Range: ${report.range.from} to ${report.range.to}`,
    "",
    ...metricLines(report.metrics),
    `Check-ins: ${formatCount(report.checkIns.count)}`,
    `Meals: ${formatCount(report.meals.count)}${report.meals.hasMacroEstimates ? " with macros" : " (macros not estimated yet)"}`,
    ...report.targetChanges,
    "",
    "Guidance:",
    ...report.guidance.map((item) => `- ${item}`),
  ];

  if (report.dataQuality.length > 0) {
    lines.push(
      "",
      "Data notes:",
      ...report.dataQuality.map((item) => `- ${item}`),
    );
  }

  lines.push("", `Safety: ${report.safetyNote}`);

  return lines.join("\n");
}

function summarizeReportMetrics(
  samples: readonly CoachReportHealthSample[],
): DailyCoachReportMetrics {
  const latestWeightKg = latestValue(samples, "weight");
  const totalSteps = sumMetric(samples, "steps");
  const activeEnergyKcal = sumMetric(samples, "active_energy");
  const restingEnergyKcal = sumMetric(samples, "resting_energy");
  const totalEnergyKcal =
    activeEnergyKcal === undefined && restingEnergyKcal === undefined
      ? undefined
      : round((activeEnergyKcal ?? 0) + (restingEnergyKcal ?? 0));
  const sleepMinutes = sumMetric(samples, "sleep");
  const averageHeartRateBpm = averageMetric(samples, "heart_rate");
  const averageRestingHeartRateBpm = averageMetric(
    samples,
    "resting_heart_rate",
  );
  const averageWalkingHeartRateBpm = averageMetric(
    samples,
    "walking_heart_rate",
  );

  return {
    ...(latestWeightKg === undefined ? {} : { latestWeightKg }),
    ...(totalSteps === undefined ? {} : { totalSteps }),
    ...(activeEnergyKcal === undefined ? {} : { activeEnergyKcal }),
    ...(restingEnergyKcal === undefined ? {} : { restingEnergyKcal }),
    ...(totalEnergyKcal === undefined ? {} : { totalEnergyKcal }),
    ...(sleepMinutes === undefined ? {} : { sleepMinutes }),
    ...(averageHeartRateBpm === undefined ? {} : { averageHeartRateBpm }),
    ...(averageRestingHeartRateBpm === undefined
      ? {}
      : { averageRestingHeartRateBpm }),
    ...(averageWalkingHeartRateBpm === undefined
      ? {}
      : { averageWalkingHeartRateBpm }),
  };
}

function summarizeCheckIns(
  checkIns: readonly CoachReportCheckIn[],
): DailyCoachReportCheckIns {
  if (checkIns.length === 0) {
    return {
      count: 0,
    };
  }

  return {
    count: checkIns.length,
    averages: {
      hunger: averageScore(checkIns.map((checkIn) => checkIn.hunger)),
      mood: averageScore(checkIns.map((checkIn) => checkIn.mood)),
      energy: averageScore(checkIns.map((checkIn) => checkIn.energy)),
      stress: averageScore(checkIns.map((checkIn) => checkIn.stress)),
      cravings: averageScore(checkIns.map((checkIn) => checkIn.cravings)),
    },
  };
}

function buildHighlights(
  metrics: DailyCoachReportMetrics,
  checkIns: DailyCoachReportCheckIns,
  meals: DailyCoachReportMeals,
): readonly string[] {
  const highlights: string[] = [];

  if (metrics.latestWeightKg !== undefined) {
    highlights.push(
      `Weight: ${formatNumber(metrics.latestWeightKg)} kg latest.`,
    );
  }

  if (metrics.totalSteps !== undefined) {
    highlights.push(`Steps: ${formatNumber(metrics.totalSteps)}.`);
  }

  if (metrics.totalEnergyKcal !== undefined) {
    highlights.push(
      `Estimated energy burn: ${formatNumber(metrics.totalEnergyKcal)} kcal.`,
    );
  }

  if (metrics.sleepMinutes !== undefined) {
    highlights.push(`Sleep: ${formatDuration(metrics.sleepMinutes)}.`);
  }

  if (checkIns.count > 0) {
    highlights.push(`Check-ins logged: ${formatCount(checkIns.count)}.`);
  }

  if (meals.count > 0) {
    highlights.push(`Meals logged: ${formatCount(meals.count)}.`);
  }

  return highlights;
}

function buildGuidance(
  metrics: DailyCoachReportMetrics,
  checkIns: DailyCoachReportCheckIns,
  healthSampleCount: number,
  targetPeriods: readonly CoachReportTargetPeriod[],
): readonly string[] {
  if (healthSampleCount === 0) {
    return [
      "Not enough synced data yet; keep logging normally and review again after the next sync.",
    ];
  }

  const guidance: string[] = [];

  if (metrics.totalSteps !== undefined) {
    const stepTarget =
      targetPeriods.length === 1 ? targetPeriods[0]?.targets.steps : undefined;
    if (targetPeriods.length > 1) {
      guidance.push(
        "Step targets changed during this range; review activity within each target period rather than against one averaged target.",
      );
    } else if (stepTarget !== undefined && metrics.totalSteps >= stepTarget) {
      guidance.push(
        `Activity met the ${formatNumber(stepTarget)} step target; keep it steady.`,
      );
    } else if (
      stepTarget !== undefined &&
      metrics.totalSteps < stepTarget * 0.7
    ) {
      guidance.push(
        "Activity is below target; add an easy walk if recovery feels normal.",
      );
    } else if (stepTarget !== undefined) {
      guidance.push(
        "Activity is close to target; a short walk would close the gap.",
      );
    } else {
      guidance.push(
        "No historical step target is available for this range; activity is shown without an adherence judgment.",
      );
    }
  }

  if (metrics.sleepMinutes !== undefined) {
    if (metrics.sleepMinutes < 420) {
      guidance.push(
        "Sleep is the main recovery gap; aim for 30-60 minutes more tonight.",
      );
    } else if (metrics.sleepMinutes <= 480) {
      guidance.push(
        "Sleep is in the useful 7-8 hour range; keep the timing consistent.",
      );
    }
  }

  if (checkIns.averages !== undefined) {
    if (checkIns.averages.stress >= 7 || checkIns.averages.cravings >= 7) {
      guidance.push(
        "Stress or cravings look elevated; keep the next meal normal rather than compensating.",
      );
    } else if (checkIns.averages.energy <= 4) {
      guidance.push(
        "Energy looks low; keep training easy unless recovery improves.",
      );
    }
  }

  if (metrics.averageRestingHeartRateBpm !== undefined) {
    guidance.push(
      `Resting heart-rate average is ${formatNumber(metrics.averageRestingHeartRateBpm)} bpm; use it as trend context, not diagnosis.`,
    );
  }

  if (guidance.length === 0) {
    guidance.push(
      "Keep the current plan steady and focus on consistent logging.",
    );
  }

  return guidance;
}

function dataQualityNotes(input: DailyCoachReportInput): readonly string[] {
  const notes: string[] = [];

  if (input.healthSamples.length === 0) {
    notes.push("No health samples found for this range.");
  }

  if (input.checkIns.length === 0) {
    notes.push("No check-ins logged for this range.");
  }

  if (input.mealLogs.length === 0) {
    notes.push("No meals logged for this range.");
  }

  return notes;
}

function metricLines(metrics: DailyCoachReportMetrics): readonly string[] {
  const lines: string[] = [];

  if (metrics.latestWeightKg !== undefined) {
    lines.push(`Weight: ${formatNumber(metrics.latestWeightKg)} kg`);
  }

  if (metrics.totalSteps !== undefined) {
    lines.push(`Steps: ${formatNumber(metrics.totalSteps)}`);
  }

  if (metrics.totalEnergyKcal !== undefined) {
    lines.push(
      `Energy: ${formatNumber(metrics.totalEnergyKcal)} kcal${energyParts(metrics)}`,
    );
  }

  if (metrics.sleepMinutes !== undefined) {
    lines.push(`Sleep: ${formatDuration(metrics.sleepMinutes)}`);
  }

  if (metrics.averageRestingHeartRateBpm !== undefined) {
    lines.push(
      `Resting HR: ${formatNumber(metrics.averageRestingHeartRateBpm)} bpm`,
    );
  }

  if (metrics.averageWalkingHeartRateBpm !== undefined) {
    lines.push(
      `Walking HR: ${formatNumber(metrics.averageWalkingHeartRateBpm)} bpm`,
    );
  }

  if (lines.length === 0) {
    lines.push("No health metrics available for this range.");
  }

  return lines;
}

function latestValue(
  samples: readonly CoachReportHealthSample[],
  metricName: HealthMetricName,
): number | undefined {
  return [...samples]
    .filter((sample) => sample.metricName === metricName)
    .sort(compareSamplesByEndTimeDesc)[0]?.value;
}

function sumMetric(
  samples: readonly CoachReportHealthSample[],
  metricName: HealthMetricName,
): number | undefined {
  const values = samples
    .filter((sample) => sample.metricName === metricName)
    .map((sample) => sample.value);

  if (values.length === 0) {
    return undefined;
  }

  return round(values.reduce((sum, value) => sum + value, 0));
}

function averageMetric(
  samples: readonly CoachReportHealthSample[],
  metricName: HealthMetricName,
): number | undefined {
  const values = samples
    .filter((sample) => sample.metricName === metricName)
    .map((sample) => sample.value);

  if (values.length === 0) {
    return undefined;
  }

  return round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function compareSamplesByEndTimeDesc(
  left: CoachReportHealthSample,
  right: CoachReportHealthSample,
): number {
  return Date.parse(right.endTime) - Date.parse(left.endTime);
}

function averageScore(values: readonly number[]): number {
  return round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function energyParts(metrics: DailyCoachReportMetrics): string {
  const parts = [
    metrics.activeEnergyKcal === undefined
      ? undefined
      : `active ${formatNumber(metrics.activeEnergyKcal)}`,
    metrics.restingEnergyKcal === undefined
      ? undefined
      : `resting ${formatNumber(metrics.restingEnergyKcal)}`,
  ].filter((part): part is string => part !== undefined);

  return parts.length === 0 ? "" : ` (${parts.join(", ")})`;
}

function formatDuration(minutes: number): string {
  const roundedMinutes = Math.round(minutes);
  const hours = Math.floor(roundedMinutes / 60);
  const remainingMinutes = roundedMinutes % 60;

  if (hours === 0) {
    return `${remainingMinutes}m`;
  }

  if (remainingMinutes === 0) {
    return `${hours}h`;
  }

  return `${hours}h ${remainingMinutes}m`;
}

function formatCount(count: number): string {
  return formatNumber(count);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(value);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

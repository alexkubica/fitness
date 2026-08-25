import type { DashboardPoint } from "@/lib/health-data";

type SparklineProps = Readonly<{
  points: readonly DashboardPoint[];
  tone: "lime" | "sky" | "coral" | "violet";
}>;

const STROKES: Record<SparklineProps["tone"], string> = {
  coral: "#ff5c05",
  lime: "#c2f500",
  sky: "#7df5ff",
  violet: "#ad8aff",
};

export function Sparkline({ points, tone }: SparklineProps) {
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const width = 240;
  const height = 72;
  const path = points
    .map((point, index) => {
      const x =
        points.length <= 1 ? width : (index / (points.length - 1)) * width;
      const y =
        max === min
          ? height / 2
          : height - ((point.value - min) / (max - min)) * height;

      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  if (points.length < 2) {
    return (
      <div className="flex h-[72px] items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground">
        Not enough data
      </div>
    );
  }

  return (
    <svg
      aria-label={`${points.length} day trend`}
      className="h-[72px] w-full overflow-visible"
      preserveAspectRatio="none"
      role="img"
      viewBox={`0 0 ${width} ${height}`}
    >
      <path
        d={path}
        fill="none"
        stroke={STROKES[tone]}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="3"
      />
    </svg>
  );
}

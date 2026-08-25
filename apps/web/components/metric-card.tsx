import type { DashboardMetric } from "@/lib/health-data";
import { formatDate, formatDelta, formatMetricValue } from "@/lib/format";
import { Sparkline } from "@/components/sparkline";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type MetricCardProps = Readonly<{
  metric: DashboardMetric;
}>;

export function MetricCard({ metric }: MetricCardProps) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle>{metric.label}</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Latest {formatDate(metric.latestDate)}
            </p>
          </div>
          <Badge variant={badgeVariant(metric.tone)}>
            {metric.coveredDays}d
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <Stat
            label="Latest"
            value={formatMetricValue(metric.latest, metric.unit, metric.name)}
          />
          <Stat
            label="30D Avg"
            value={formatMetricValue(
              metric.average30d,
              metric.unit,
              metric.name,
            )}
          />
          <Stat
            label="30D"
            value={formatDelta(metric.delta30d, metric.unit, metric.name)}
          />
        </div>
        <Sparkline points={metric.points} tone={metric.tone} />
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="min-w-0">
      <div className="text-[0.65rem] font-semibold uppercase text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 truncate text-sm font-black">{value}</div>
    </div>
  );
}

function badgeVariant(
  tone: DashboardMetric["tone"],
): "default" | "cyan" | "orange" | "violet" {
  switch (tone) {
    case "coral":
      return "orange";
    case "sky":
      return "cyan";
    case "violet":
      return "violet";
    case "lime":
      return "default";
  }
}

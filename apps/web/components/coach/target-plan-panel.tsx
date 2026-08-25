import {
  calculateTargetRecommendation,
  compareTargetPlans,
  type TargetPlan,
} from "@fitness/domain";
import {
  approveTargetPlanAction,
  proposeRecommendationAction,
  rejectTargetPlanAction,
} from "@/app/target-plan-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import type { CoachDashboardData } from "@/lib/coach-data";

export function TargetPlanPanel({
  data,
}: Readonly<{ data: CoachDashboardData }>) {
  const active = data.activePlan;
  const recommendation = data.profile
    ? calculateTargetRecommendation({
        goal: data.profile.goal,
        currentWeightKg: data.profile.weightKg,
        estimatedMaintenanceCalories: data.profile.targets.maintenanceCalories,
        averageSteps: data.profile.estimatedStepsPerDay,
        existingTargets: active?.targets,
      })
    : undefined;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Active targets</CardTitle>
          <CardDescription>
            {active
              ? `Version ${active.version}, effective ${active.effectiveFrom}. Created by ${active.creatorRelationship ?? active.source}.`
              : "No versioned target plan is active yet."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {active ? (
            <TargetGrid plan={active} />
          ) : (
            <EmptyState text="Saving the coach profile will create the initial version." />
          )}
          {active ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Reason: {active.reason}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {data.proposedPlans.map((proposal) => (
        <Card key={proposal.id}>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>Proposed plan v{proposal.version}</CardTitle>
              <Badge variant="secondary">Owner review required</Badge>
            </div>
            <CardDescription>
              {proposal.reason} · Created by{" "}
              {proposal.creatorRelationship ?? proposal.source}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Comparison current={active} proposed={proposal} />
            <div className="grid gap-4 lg:grid-cols-2">
              <form
                action={approveTargetPlanAction}
                className="grid gap-3 rounded-md border p-4"
              >
                <input name="profile_id" type="hidden" value={data.profileId} />
                <input name="plan_id" type="hidden" value={proposal.id} />
                <label className="grid gap-1 text-sm font-medium">
                  Effective start date
                  <Input
                    defaultValue={proposal.effectiveFrom || today}
                    name="effective_from"
                    required
                    type="date"
                  />
                </label>
                <label className="grid gap-1 text-sm font-medium">
                  Owner response
                  <Textarea
                    name="owner_response"
                    placeholder="Optional approval note"
                  />
                </label>
                <Button className="min-h-11 w-fit" type="submit">
                  Approve and activate
                </Button>
              </form>
              <form
                action={rejectTargetPlanAction}
                className="grid gap-3 rounded-md border p-4"
              >
                <input name="profile_id" type="hidden" value={data.profileId} />
                <input name="plan_id" type="hidden" value={proposal.id} />
                <label className="grid gap-1 text-sm font-medium">
                  Rejection response
                  <Textarea
                    name="owner_response"
                    placeholder="Explain what should change"
                    required
                  />
                </label>
                <Button
                  className="min-h-11 w-fit"
                  type="submit"
                  variant="outline"
                >
                  Reject proposal
                </Button>
              </form>
            </div>
          </CardContent>
        </Card>
      ))}

      {recommendation && data.profile ? (
        <Card>
          <CardHeader>
            <CardTitle>Recommendation preview</CardTitle>
            <CardDescription>
              Deterministic {recommendation.calculationVersion}. Preview
              only—never activated automatically.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Comparison
              current={active}
              proposed={{
                id: "recommendation",
                profileId: data.profileId,
                version: (active?.version ?? 0) + 1,
                goal: data.profile.goal,
                status: "draft",
                calculationMode: "automatic",
                effectiveFrom: today,
                createdByUserId: "recommendation-service",
                source: "automatic",
                reason: recommendation.explanation.join(" "),
                targets: recommendation.targets,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              }}
            />
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {recommendation.explanation.map((item) => (
                <li key={item}>{item}</li>
              ))}
              {recommendation.warnings.map((item) => (
                <li key={item}>Warning: {item}</li>
              ))}
            </ul>
            <form
              action={proposeRecommendationAction}
              className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] sm:items-end"
            >
              <input name="profile_id" type="hidden" value={data.profileId} />
              <input
                name="idempotency_key"
                type="hidden"
                value={`recommendation:${active?.version ?? 0}:${data.profile.updatedAt}`}
              />
              <label className="grid gap-1 text-sm font-medium">
                Effective date
                <Input
                  defaultValue={today}
                  name="effective_from"
                  required
                  type="date"
                />
              </label>
              <label className="grid gap-1 text-sm font-medium">
                Reason
                <Input
                  defaultValue="Updated deterministic recommendation"
                  name="reason"
                  required
                />
              </label>
              <Button className="min-h-11" type="submit">
                Create proposal
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Target history</CardTitle>
          <CardDescription>
            Complete version and effective-date history for this profile.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.targetHistory.length === 0 ? (
            <EmptyState text="No target history yet." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Version</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Effective range</TableHead>
                  <TableHead>Creator</TableHead>
                  <TableHead>Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.targetHistory.map((plan) => (
                  <TableRow key={plan.id}>
                    <TableCell>v{plan.version}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{plan.status}</Badge>
                    </TableCell>
                    <TableCell>
                      {plan.effectiveFrom} → {plan.effectiveUntil ?? "current"}
                    </TableCell>
                    <TableCell>
                      {plan.creatorRelationship ?? plan.source}
                    </TableCell>
                    <TableCell>{plan.reason}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Comparison({
  current,
  proposed,
}: Readonly<{ current: TargetPlan | undefined; proposed: TargetPlan }>) {
  const changes = current
    ? compareTargetPlans(current.targets, proposed.targets)
    : [];
  if (changes.length === 0) return <TargetGrid plan={proposed} />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Target</TableHead>
          <TableHead>Current</TableHead>
          <TableHead>Proposed</TableHead>
          <TableHead>Change</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {changes.map((change) => (
          <TableRow key={String(change.targetKey)}>
            <TableCell>{change.displayLabel}</TableCell>
            <TableCell>
              {formatValue(change.currentValue, change.unit)}
            </TableCell>
            <TableCell>
              {formatValue(change.proposedValue, change.unit)}
            </TableCell>
            <TableCell>
              {change.direction}
              {change.percentageDifference === undefined
                ? ""
                : ` (${change.percentageDifference > 0 ? "+" : ""}${change.percentageDifference}%)`}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function TargetGrid({ plan }: Readonly<{ plan: TargetPlan }>) {
  const items = [
    ["Calories", plan.targets.selectedCalories, "kcal"],
    ["Protein", plan.targets.proteinGrams, "g"],
    ["Carbohydrates", plan.targets.carbohydratesGrams, "g"],
    ["Fat", plan.targets.fatGrams, "g"],
    ["Fiber", plan.targets.fiberGrams, "g"],
    ["Steps", plan.targets.steps, "count"],
  ] as const;
  return (
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map(([label, value, unit]) => (
        <div className="rounded-md border p-3" key={label}>
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="text-xl font-semibold tabular-nums">
            {formatValue(value, unit)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function formatValue(value: number | string | null, unit: string) {
  if (value === null) return "Not set";
  if (typeof value === "string") return value;
  const formatted = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
  }).format(value);
  return unit === "count" ? formatted : `${formatted} ${unit}`;
}

function EmptyState({ text }: Readonly<{ text: string }>) {
  return (
    <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
      {text}
    </p>
  );
}

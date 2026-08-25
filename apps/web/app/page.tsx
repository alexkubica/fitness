import {
  Activity,
  AlertCircle,
  Apple,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleGauge,
  Database,
  Dumbbell,
  Flame,
  Footprints,
  ForkKnife,
  HeartPulse,
  Home,
  LogIn,
  Moon,
  Plus,
  RefreshCw,
  Scale,
  ShieldCheck,
  Sparkles,
  Target,
  Watch,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { FitnessWebSession } from "@fitness/auth";
import type * as React from "react";
import { MealSlotEditor } from "@/components/coach/meal-slot-editor";
import { TargetPlanPanel } from "@/components/coach/target-plan-panel";
import { FoodQuickFillPicker } from "@/components/food-quick-fill-picker";
import { McpSetupCard } from "@/components/mcp-setup-card";
import { MetricCard } from "@/components/metric-card";
import { SiteHeader } from "@/components/site-header";
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
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { currentWebSession } from "@/lib/auth";
import {
  getCoachDashboardData,
  type CoachDashboardData,
} from "@/lib/coach-data";
import {
  googleConfigStatus,
  mcpEndpoint,
  type GoogleConfigStatus,
} from "@/lib/env";
import {
  getHealthDashboardData,
  type DashboardMetric,
  type HealthDashboardData,
} from "@/lib/health-data";
import {
  getNutritionDashboardData,
  type NutritionDashboardData,
} from "@/lib/nutrition-data";
import {
  getMealPlanDashboardData,
  type MealPlanDashboardData,
} from "@/lib/meal-plan-data";
import { formatDate, formatDelta, formatMetricValue } from "@/lib/format";
import { saveCoachProfileAction } from "./coach-actions";
import {
  createMealAction,
  deleteMealAction,
  updateMealAction,
} from "./meal-actions";
import {
  convertPlannedMealAction,
  copyPreviousMealPlanAction,
  markPlannedMealStatusAction,
} from "./meal-plan-actions";

type PageSearchParams = Promise<Record<string, string | string[] | undefined>>;
type AuthError = "google_failed" | "google_not_configured";

const appNav: readonly {
  href: string;
  icon: LucideIcon;
  label: string;
}[] = [
  { href: "#today", icon: Home, label: "Today" },
  { href: "#metrics", icon: Activity, label: "Metrics" },
  { href: "#sync", icon: RefreshCw, label: "Sync" },
  { href: "#coach", icon: Dumbbell, label: "Coach" },
];

export default async function HomePage({
  searchParams,
}: Readonly<{ searchParams?: PageSearchParams }>) {
  const session = await currentWebSession();
  const params = searchParams === undefined ? {} : await searchParams;
  const mealError = params.meal_error === "1";
  const planError = params.plan_error === "1";
  const planDate =
    typeof params.plan_date === "string" ? params.plan_date : undefined;
  const coachError = params.coach_error === "1";
  const authError =
    params.auth_error === "google_not_configured" ||
    params.auth_error === "google_failed"
      ? params.auth_error
      : undefined;

  if (session === undefined) {
    return (
      <SignedOut authError={authError} googleStatus={googleConfigStatus()} />
    );
  }

  return (
    <AppChrome session={session}>
      <Dashboard
        coachError={coachError}
        mealError={mealError}
        planDate={planDate}
        planError={planError}
        userId={session.userId}
      />
    </AppChrome>
  );
}

function AppChrome({
  children,
  session,
}: Readonly<{
  children: React.ReactNode;
  session: FitnessWebSession;
}>) {
  return (
    <>
      <SiteHeader session={session} />
      <div className="mx-auto grid max-w-[1480px] gap-5 px-4 pb-24 pt-5 sm:px-6 lg:grid-cols-[15rem_minmax(0,1fr)] lg:pb-10">
        <aside className="hidden lg:block">
          <nav
            aria-label="App sections"
            className="sticky top-20 grid gap-2 rounded-lg border border-border bg-card p-2"
          >
            {appNav.map((item) => (
              <a
                className="flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                href={item.href}
                key={item.href}
              >
                <item.icon className="size-4" aria-hidden="true" />
                {item.label}
              </a>
            ))}
          </nav>
        </aside>
        <main className="min-w-0">{children}</main>
      </div>
      <nav
        aria-label="App sections"
        className="fixed inset-x-3 bottom-3 z-40 grid grid-cols-4 rounded-lg border border-border bg-popover/95 p-1 shadow-2xl backdrop-blur lg:hidden"
      >
        {appNav.map((item) => (
          <a
            className="flex min-h-12 flex-col items-center justify-center gap-1 rounded-md px-2 text-[0.7rem] font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href={item.href}
            key={item.href}
          >
            <item.icon className="size-4" aria-hidden="true" />
            {item.label}
          </a>
        ))}
      </nav>
    </>
  );
}

function SignedOut({
  authError,
  googleStatus,
}: Readonly<{
  authError: AuthError | undefined;
  googleStatus: GoogleConfigStatus;
}>) {
  const canSignIn = googleStatus === "configured";

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <a className="flex min-w-0 items-center gap-3 font-semibold" href="/">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-primary/40 bg-primary/10 text-primary">
              <Activity className="size-5" aria-hidden="true" />
            </span>
            <span className="truncate">Fitness Coach</span>
          </a>
          <LandingSignInButton canSignIn={canSignIn} size="sm" />
        </div>
      </header>

      <section className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 lg:min-h-[calc(100svh-4.6rem)] lg:grid-cols-[minmax(0,0.95fr)_minmax(26rem,0.8fr)] lg:items-center lg:py-12">
        <div className="min-w-0">
          <Badge className="mb-4 w-fit">Private Apple Health coach</Badge>
          <h1 className="max-w-4xl text-4xl font-black leading-tight sm:text-5xl lg:text-6xl">
            Your iPhone syncs the data. The web app makes it easier to review.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
            A private dashboard for daily health trends, food logging, coach
            targets, and sync status. Built around the same Today, Metrics,
            Sync, and Coach flow as the iOS app.
          </p>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
            <LandingSignInButton canSignIn={canSignIn} size="default" />
            <Button asChild variant="outline">
              <a href="#how-it-works">
                <Sparkles className="size-4" aria-hidden="true" />
                See the flow
              </a>
            </Button>
          </div>

          {authError !== undefined || !canSignIn ? (
            <AuthNotice error={authError} googleStatus={googleStatus} />
          ) : null}

          <div className="mt-8 grid gap-3 text-sm text-muted-foreground sm:grid-cols-3">
            <LandingTrustItem icon={Apple} label="HealthKit stays native" />
            <LandingTrustItem icon={ShieldCheck} label="Google account gate" />
            <LandingTrustItem
              icon={Database}
              label="Backend reads are scoped"
            />
          </div>
        </div>

        <LandingPreview />
      </section>

      <section
        className="border-t border-border bg-card/45 px-4 py-10 sm:px-6"
        id="how-it-works"
      >
        <div className="mx-auto grid max-w-7xl gap-4 md:grid-cols-2 xl:grid-cols-4">
          <LandingFeature
            description="HealthKit permissions and background delivery stay in the iOS app, where Apple requires them."
            icon={Watch}
            title="Native sync"
          />
          <LandingFeature
            description="See daily totals, recent meals, and macro progress without losing the quick mobile workflow."
            icon={ForkKnife}
            title="Food review"
          />
          <LandingFeature
            description="Keep calories, macros, and meal slots aligned with the coach profile used by the app."
            icon={Target}
            title="Coach targets"
          />
          <LandingFeature
            description="Inspect trends and status from the browser without exposing personal data before sign-in."
            icon={HeartPulse}
            title="Private trends"
          />
        </div>
      </section>
    </main>
  );
}

function LandingSignInButton({
  canSignIn,
  size,
}: Readonly<{
  canSignIn: boolean;
  size: "default" | "sm";
}>) {
  if (!canSignIn) {
    return (
      <Button disabled size={size}>
        <LogIn className="size-4" aria-hidden="true" />
        Sign in unavailable
      </Button>
    );
  }

  return (
    <Button asChild size={size}>
      <a href="/api/auth/google/start?return_to=/">
        <LogIn className="size-4" aria-hidden="true" />
        Sign in with Google
      </a>
    </Button>
  );
}

function AuthNotice({
  error,
  googleStatus,
}: Readonly<{
  error: AuthError | undefined;
  googleStatus: GoogleConfigStatus;
}>) {
  const message =
    error === "google_failed"
      ? "Google sign-in was not accepted. Try again with the allowed account."
      : googleStatus === "invalid"
        ? "Google sign-in has partial or invalid configuration in this environment."
        : "Google sign-in is not configured in this running web process.";

  return (
    <div className="mt-5 flex max-w-2xl items-start gap-3 rounded-md border border-fitness-orange/50 bg-fitness-orange/10 p-3 text-sm text-fitness-foreground">
      <AlertCircle
        className="mt-0.5 size-4 shrink-0 text-fitness-orange"
        aria-hidden="true"
      />
      <div>
        <div className="font-semibold">Sign-in needs attention</div>
        <p className="mt-1 text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}

function LandingTrustItem({
  icon: Icon,
  label,
}: Readonly<{
  icon: LucideIcon;
  label: string;
}>) {
  return (
    <div className="flex min-h-11 items-center gap-2 rounded-md border border-border bg-card px-3">
      <Icon className="size-4 text-primary" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

function LandingPreview() {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-2xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Badge>Sample Today</Badge>
          <h2 className="mt-3 text-2xl font-black">Daily workspace</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Same mental model as mobile, widened for faster review on desktop.
          </p>
        </div>
        <span className="grid size-11 shrink-0 place-items-center rounded-lg border border-primary/40 bg-primary/10 text-primary">
          <Home className="size-5" aria-hidden="true" />
        </span>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <PreviewMetric
          icon={Scale}
          label="Weight"
          tone="text-primary"
          value="Trend ready"
        />
        <PreviewMetric
          icon={Footprints}
          label="Steps"
          tone="text-fitness-cyan"
          value="Daily total"
        />
        <PreviewMetric
          icon={Flame}
          label="Energy"
          tone="text-fitness-orange"
          value="Synced"
        />
        <PreviewMetric
          icon={Moon}
          label="Sleep"
          tone="text-fitness-violet"
          value="Recent nights"
        />
      </div>

      <div className="mt-4 rounded-md border border-border bg-secondary p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">Food log</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Meals, macros, and coach targets share one account-backed view.
            </p>
          </div>
          <Badge variant="outline">Review</Badge>
        </div>
        <div className="mt-3 grid gap-2">
          <div className="h-2 rounded-full bg-primary" />
          <div className="grid grid-cols-[0.62fr_0.38fr] gap-2">
            <div className="h-2 rounded-full bg-fitness-cyan" />
            <div className="h-2 rounded-full bg-fitness-orange" />
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewMetric({
  icon: Icon,
  label,
  tone,
  value,
}: Readonly<{
  icon: LucideIcon;
  label: string;
  tone: string;
  value: string;
}>) {
  return (
    <div className="rounded-md border border-border bg-secondary p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold">{label}</span>
        <Icon className={`size-4 ${tone}`} aria-hidden="true" />
      </div>
      <div className="mt-3 font-mono text-lg font-black">{value}</div>
    </div>
  );
}

function LandingFeature({
  description,
  icon: Icon,
  title,
}: Readonly<{
  description: string;
  icon: LucideIcon;
  title: string;
}>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="size-5 text-primary" aria-hidden="true" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm leading-6 text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

async function Dashboard({
  coachError,
  mealError,
  planDate,
  planError,
  userId,
}: Readonly<{
  coachError: boolean;
  mealError: boolean;
  planDate: string | undefined;
  planError: boolean;
  userId: string;
}>) {
  try {
    const [health, nutrition, coach, mealPlan] = await Promise.all([
      getHealthDashboardData(userId),
      getNutritionDashboardData(userId),
      getCoachDashboardData(userId),
      getMealPlanDashboardData(userId, planDate),
    ]);
    const primaryMetrics = orderedMetrics(health, [
      "weight",
      "steps",
      "active_energy",
      "sleep",
    ]);
    const latestDate = latestMetricDate(health.metrics);

    return (
      <div className="grid gap-6">
        <DashboardIntro
          generatedAt={health.generatedAt}
          latestDate={latestDate}
          todayDate={nutrition.todayDate}
        />
        <TodaySection
          coach={coach}
          mealError={mealError}
          mealPlan={mealPlan}
          nutrition={nutrition}
          planError={planError}
          primaryMetrics={primaryMetrics}
        />
        <MetricsSection health={health} primaryMetrics={primaryMetrics} />
        <SyncSection health={health} latestDate={latestDate} />
        <CoachSection coachError={coachError} data={coach} />
      </div>
    );
  } catch (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="size-5 text-destructive" aria-hidden="true" />
            Dashboard data unavailable
          </CardTitle>
          <CardDescription>
            The web app is running, but it cannot read the health aggregate
            store yet.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Check that this deployment has `DATABASE_URL`, the web auth user id
            matches the synced account, and the database package has been built.
          </p>
          <pre className="overflow-auto rounded-md border border-border bg-secondary p-3 text-xs text-muted-foreground">
            {error instanceof Error ? error.message : "Unknown read error"}
          </pre>
          <Button asChild variant="outline">
            <a href="/">
              <RefreshCw className="size-4" aria-hidden="true" />
              Retry
            </a>
          </Button>
        </CardContent>
      </Card>
    );
  }
}

function DashboardIntro({
  generatedAt,
  latestDate,
  todayDate,
}: Readonly<{
  generatedAt: string;
  latestDate: string | undefined;
  todayDate: string;
}>) {
  return (
    <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem] xl:items-end">
      <div className="min-w-0">
        <Badge className="mb-3 w-fit">Today</Badge>
        <h1 className="text-3xl font-black sm:text-4xl">
          Daily health workspace
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
          The web app now follows the iOS app: Today for the daily workspace,
          Metrics for trends, Sync for backend status and MCP, and Coach for
          targets.
        </p>
      </div>
      <div className="grid gap-2 rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground sm:grid-cols-3 xl:grid-cols-1">
        <SummaryPill label="Food day" value={formatDate(todayDate)} />
        <SummaryPill label="Latest health" value={formatDate(latestDate)} />
        <SummaryPill
          label="Generated"
          value={new Date(generatedAt).toLocaleString("en-US")}
        />
      </div>
    </section>
  );
}

function TodaySection({
  coach,
  mealError,
  mealPlan,
  nutrition,
  planError,
  primaryMetrics,
}: Readonly<{
  coach: CoachDashboardData;
  mealError: boolean;
  mealPlan: MealPlanDashboardData;
  nutrition: NutritionDashboardData;
  planError: boolean;
  primaryMetrics: readonly DashboardMetric[];
}>) {
  return (
    <section className="scroll-mt-24" id="today">
      <SectionHeading
        description="The same daily workspace as the iOS Today tab: key metrics, food log, targets, and recent meals."
        icon={Home}
        title="Today"
      />
      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.72fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarDays
                className="size-5 text-primary"
                aria-hidden="true"
              />
              Daily dashboard
            </CardTitle>
            <CardDescription>
              Latest synced HealthKit daily rows plus today&apos;s account meal
              totals.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {primaryMetrics.map((metric) => (
                <TodayMetricTile key={metric.name} metric={metric} />
              ))}
            </div>
            <Separator />
            <MacroPanel coach={coach} nutrition={nutrition} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RefreshCw
                className="size-5 text-fitness-cyan"
                aria-hidden="true"
              />
              Sync state
            </CardTitle>
            <CardDescription>
              Web reads the backend; the iPhone owns HealthKit permission and
              sync.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <StatusRow
              icon={Apple}
              label="HealthKit"
              value="iPhone native app"
            />
            <StatusRow
              icon={Database}
              label="Storage"
              value="Neon daily aggregates"
            />
            <StatusRow
              icon={Watch}
              label="Watch"
              value="Mirrored through iPhone"
            />
            <Button asChild variant="outline">
              <a href="#sync">
                <RefreshCw className="size-4" aria-hidden="true" />
                Open Sync
              </a>
            </Button>
          </CardContent>
        </Card>
      </div>

      <MealPlanPanel coach={coach} data={mealPlan} planError={planError} />
      <FoodLogPanel data={nutrition} mealError={mealError} />
    </section>
  );
}

function MealPlanPanel({
  coach,
  data,
  planError,
}: Readonly<{
  coach: CoachDashboardData;
  data: MealPlanDashboardData;
  planError: boolean;
}>) {
  const targets = coach.profile?.targets;
  const remaining = {
    calories:
      targets === undefined
        ? undefined
        : targets.selectedCalories - data.plannedTotals.calories,
    protein:
      targets === undefined
        ? undefined
        : targets.proteinGrams - data.plannedTotals.proteinGrams,
    carbs:
      targets === undefined
        ? undefined
        : targets.carbsGrams - data.plannedTotals.carbsGrams,
    fat:
      targets === undefined
        ? undefined
        : targets.fatGrams - data.plannedTotals.fatGrams,
  };

  return (
    <Card className="mt-4 scroll-mt-24" id="meal-plan">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <CalendarDays
                className="size-5 text-primary"
                aria-hidden="true"
              />
              Daily meal plan
            </CardTitle>
            <CardDescription>
              Planned meals remain separate from logged intake until you confirm
              what was eaten.
            </CardDescription>
          </div>
          <Badge variant="outline">
            {formatDate(data.selectedDate)} · {data.timezone}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <form className="flex flex-wrap items-end gap-2" method="get">
          <Field
            label="Plan date"
            name="plan_date"
            type="date"
            value={data.selectedDate}
          />
          <Button type="submit" variant="outline">
            Open date
          </Button>
        </form>

        {data.futurePlans.length > 0 ? (
          <div className="flex flex-wrap gap-2" aria-label="Future meal plans">
            {data.futurePlans.map((plan) => (
              <Button
                asChild
                key={plan.id}
                size="sm"
                variant={
                  plan.localFoodDate === data.selectedDate
                    ? "default"
                    : "outline"
                }
              >
                <a href={`/?plan_date=${plan.localFoodDate}#meal-plan`}>
                  {formatDate(plan.localFoodDate)} · {plan.status}
                </a>
              </Button>
            ))}
          </div>
        ) : null}

        {planError ? (
          <p
            className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm"
            role="alert"
          >
            The plan changed before this action completed. Refresh and try again
            with the latest version.
          </p>
        ) : null}

        {data.plan === undefined ? (
          <div className="rounded-md border border-dashed border-border p-4">
            <p className="font-semibold">No plan for this date</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Copy the previous day when one exists; an existing destination is
              never overwritten silently.
            </p>
            <form action={copyPreviousMealPlanAction} className="mt-3">
              <input
                name="local_food_date"
                type="hidden"
                value={data.selectedDate}
              />
              <input name="timezone" type="hidden" value={data.timezone} />
              <Button type="submit" variant="outline">
                Copy previous day
              </Button>
            </form>
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <PlanTotal
                label="Planned calories"
                value={data.plannedTotals.calories}
                unit="kcal"
                remaining={remaining.calories}
              />
              <PlanTotal
                label="Protein"
                value={data.plannedTotals.proteinGrams}
                unit="g"
                remaining={remaining.protein}
              />
              <PlanTotal
                label="Carbohydrates"
                value={data.plannedTotals.carbsGrams}
                unit="g"
                remaining={remaining.carbs}
              />
              <PlanTotal
                label="Fat"
                value={data.plannedTotals.fatGrams}
                unit="g"
                remaining={remaining.fat}
              />
              <PlanTotal
                label="Fiber"
                value={data.plannedTotals.fiberGrams}
                unit="g"
              />
            </div>
            <div className="grid gap-3">
              {data.plan.meals.map((meal) => {
                const status = plannedMealStatusLabel(
                  meal.status,
                  meal.linkedMealLogId !== undefined,
                );
                return (
                  <article
                    className="rounded-md border border-border bg-secondary p-4"
                    key={meal.id}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="font-semibold">{meal.title}</h4>
                          <Badge
                            variant={
                              meal.linkedMealLogId === undefined
                                ? "outline"
                                : "default"
                            }
                          >
                            {status}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {meal.plannedTime ?? "Time open"} · {meal.mealType} ·
                          plan version {meal.version}
                        </p>
                      </div>
                      <span className="font-mono text-sm font-semibold">
                        {formatAmount(
                          meal.ingredients.reduce(
                            (sum, item) => sum + item.totals.calories,
                            0,
                          ),
                        )}{" "}
                        kcal
                      </span>
                    </div>
                    {meal.description ? (
                      <p className="mt-3 text-sm">{meal.description}</p>
                    ) : null}
                    <ul className="mt-3 grid gap-1 text-sm text-muted-foreground">
                      {meal.ingredients.map((ingredient) => (
                        <li key={ingredient.id}>
                          {ingredient.displayName} ·{" "}
                          {formatAmount(ingredient.quantity)} {ingredient.unit}
                        </li>
                      ))}
                    </ul>
                    {meal.linkedMealLogId === undefined &&
                    meal.status !== "skipped" ? (
                      <div className="mt-4 flex flex-wrap gap-2">
                        <PlanMealActionForm
                          action={convertPlannedMealAction}
                          data={data}
                          meal={meal}
                          fraction="1"
                          label="Mark eaten as planned"
                        />
                        <PlanMealActionForm
                          action={convertPlannedMealAction}
                          data={data}
                          meal={meal}
                          fraction="0.5"
                          label="Log half (partial)"
                        />
                        <PlanMealActionForm
                          action={markPlannedMealStatusAction}
                          data={data}
                          meal={meal}
                          label="Skip"
                        />
                      </div>
                    ) : null}
                    {meal.linkedMealLogId !== undefined ? (
                      <p className="mt-3 text-xs text-muted-foreground">
                        Linked actual meal log: {meal.linkedMealLogId}
                      </p>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function PlanTotal({
  label,
  value,
  unit,
  remaining,
}: Readonly<{
  label: string;
  value: number;
  unit: string;
  remaining?: number | undefined;
}>) {
  return (
    <div className="rounded-md border border-border bg-secondary p-3">
      <div className="text-xs font-semibold text-muted-foreground">{label}</div>
      <div className="mt-2 font-mono text-xl font-black">
        {formatAmount(value)}{" "}
        <span className="text-xs font-normal">{unit}</span>
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        {remaining === undefined
          ? "No effective target"
          : `${formatAmount(remaining)} ${unit} remaining`}
      </div>
    </div>
  );
}

function PlanMealActionForm({
  action,
  data,
  meal,
  fraction,
  label,
}: Readonly<{
  action: (formData: FormData) => Promise<void>;
  data: MealPlanDashboardData;
  meal: NonNullable<MealPlanDashboardData["plan"]>["meals"][number];
  fraction?: string | undefined;
  label: string;
}>) {
  return (
    <form action={action}>
      <input name="local_food_date" type="hidden" value={data.selectedDate} />
      <input name="planned_meal_id" type="hidden" value={meal.id} />
      <input name="plan_version" type="hidden" value={data.plan?.version} />
      <input name="meal_version" type="hidden" value={meal.version} />
      {fraction === undefined ? null : (
        <input name="actual_fraction" type="hidden" value={fraction} />
      )}
      <Button size="sm" type="submit" variant="outline">
        {label}
      </Button>
    </form>
  );
}

function plannedMealStatusLabel(status: string, linked: boolean): string {
  if (linked && status === "eaten_as_planned")
    return "Eaten as planned · Logged";
  if (linked && (status === "partially_eaten" || status === "replaced"))
    return "Changed · Logged";
  if (status === "skipped") return "Skipped · Not logged";
  if (status === "not_confirmed") return "Unconfirmed · Not logged";
  return "Planned · Not logged";
}

function MacroPanel({
  coach,
  nutrition,
}: Readonly<{
  coach: CoachDashboardData;
  nutrition: NutritionDashboardData;
}>) {
  const targets = coach.profile?.targets;
  const rows = [
    {
      label: "Calories",
      target: targets?.selectedCalories,
      tone: "bg-primary",
      unit: "kcal",
      value: nutrition.todayTotals.calories,
    },
    {
      label: "Protein",
      target: targets?.proteinGrams,
      tone: "bg-fitness-cyan",
      unit: "g",
      value: nutrition.todayTotals.proteinGrams,
    },
    {
      label: "Carbs",
      target: targets?.carbsGrams,
      tone: "bg-fitness-orange",
      unit: "g",
      value: nutrition.todayTotals.carbsGrams,
    },
    {
      label: "Fat",
      target: targets?.fatGrams,
      tone: "bg-fitness-violet",
      unit: "g",
      value: nutrition.todayTotals.fatGrams,
    },
    {
      label: "Fiber",
      target: targets?.fiberGrams,
      tone: "bg-primary",
      unit: "g",
      value: nutrition.todayTotals.fiberGrams,
    },
  ];

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">Food log</h3>
          <p className="text-xs text-muted-foreground">
            {formatDate(nutrition.todayDate)} totals against the saved coach
            target.
          </p>
        </div>
        <Badge variant={targets === undefined ? "outline" : "default"}>
          {targets === undefined ? "No target" : "Targeted"}
        </Badge>
      </div>
      <div className="grid gap-3 md:grid-cols-5">
        {rows.map((row) => (
          <MacroProgress key={row.label} {...row} />
        ))}
      </div>
    </div>
  );
}

function MacroProgress({
  label,
  target,
  tone,
  unit,
  value,
}: Readonly<{
  label: string;
  target: number | undefined;
  tone: string;
  unit: string;
  value: number;
}>) {
  const percent =
    target === undefined || target <= 0 ? 0 : (value / target) * 100;

  return (
    <div className="rounded-md border border-border bg-secondary p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold text-muted-foreground">
          {label}
        </span>
        <span className="font-mono text-xs text-muted-foreground">
          {target === undefined ? "N/A" : `${Math.round(percent)}%`}
        </span>
      </div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="font-mono text-xl font-black">
          {formatAmount(value)}
        </span>
        <span className="text-xs text-muted-foreground">{unit}</span>
      </div>
      <Progress className="mt-3" indicatorClassName={tone} value={percent} />
      <div className="mt-2 font-mono text-[0.7rem] text-muted-foreground">
        {target === undefined ? "Set in Coach" : `of ${formatAmount(target)}`}
      </div>
    </div>
  );
}

function TodayMetricTile({
  metric,
}: Readonly<{
  metric: DashboardMetric;
}>) {
  const Icon = iconForMetric(metric);
  const toneClass = textClassForTone(metric.tone);

  return (
    <a
      className="grid min-h-32 gap-3 rounded-md border border-border bg-secondary p-3 text-left transition hover:border-primary/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      href="#metrics"
    >
      <div className="flex items-start justify-between gap-3">
        <span
          className={`grid size-10 place-items-center rounded-md border border-border bg-card ${toneClass}`}
        >
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <Badge variant={badgeForTone(metric.tone)}>{metric.coveredDays}d</Badge>
      </div>
      <div>
        <div className="text-sm font-semibold">{metric.label}</div>
        <div className="mt-1 font-mono text-2xl font-black">
          {formatMetricValue(metric.latest, metric.unit, metric.name)}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {formatDelta(metric.delta30d, metric.unit, metric.name)} over 30d
        </div>
      </div>
    </a>
  );
}

function FoodLogPanel({
  data,
  mealError,
}: Readonly<{
  data: NutritionDashboardData;
  mealError: boolean;
}>) {
  return (
    <Card className="mt-4 scroll-mt-24" id="food-log">
      <CardHeader>
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ForkKnife className="size-5 text-primary" aria-hidden="true" />
              Food Log
            </CardTitle>
            <CardDescription>
              Account-backed meals from iOS, web, and MCP. Raw photos stay local
              on iPhone.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              aria-label="Previous day"
              disabled
              size="icon"
              variant="outline"
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
            </Button>
            <Badge>{formatDate(data.todayDate)}</Badge>
            <Button
              aria-label="Next day"
              disabled
              size="icon"
              variant="outline"
            >
              <ChevronRight className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        {mealError ? (
          <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 size-4" aria-hidden="true" />
            Meal change was not saved. Check required fields and confirm
            destructive actions before trying again.
          </div>
        ) : null}

        <details className="rounded-md border border-border bg-secondary p-3">
          <summary className="cursor-pointer text-sm font-semibold text-primary">
            <span className="inline-flex items-center gap-2">
              <Plus className="size-4" aria-hidden="true" />
              Add Food
            </span>
          </summary>
          <form action={createMealAction} className="mt-4 grid gap-4">
            <MealFields foods={data.foodDatabase} />
            <Button className="w-fit" type="submit">
              Save meal
            </Button>
          </form>
        </details>

        <MealList meals={data.recentMeals} />
        <QuickTemplatesPanel data={data} />
      </CardContent>
    </Card>
  );
}

function MealList({
  meals,
}: Readonly<{
  meals: NutritionDashboardData["recentMeals"];
}>) {
  if (meals.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-5 text-center text-sm text-muted-foreground">
        No meals have synced yet.
      </div>
    );
  }

  return (
    <>
      <div className="hidden overflow-hidden rounded-md border border-border md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Meal</TableHead>
              <TableHead>When</TableHead>
              <TableHead className="text-right">Macros</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {meals.map((meal) => (
              <TableRow key={meal.id}>
                <TableCell>
                  <div className="font-semibold">{meal.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {meal.mealType} · {meal.ingredients.length} ingredients ·{" "}
                    {meal.photoCount} photos
                  </div>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {formatMealDate(meal.occurredAt, meal.timezone)}
                </TableCell>
                <TableCell className="text-right text-xs text-muted-foreground">
                  <div className="font-mono text-foreground">
                    {formatAmount(meal.totals.calories)} kcal
                  </div>
                  <div className="font-mono">
                    P {formatAmount(meal.totals.proteinGrams)} · C{" "}
                    {formatAmount(meal.totals.carbsGrams)} · F{" "}
                    {formatAmount(meal.totals.fatGrams)}
                  </div>
                </TableCell>
                <TableCell className="text-right align-top">
                  <MealRowActions meal={meal} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="grid gap-3 md:hidden">
        {meals.map((meal) => (
          <div
            className="rounded-md border border-border bg-secondary p-3"
            key={meal.id}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate font-semibold">{meal.title}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {formatMealDate(meal.occurredAt, meal.timezone)}
                </div>
              </div>
              <Badge variant="secondary">{meal.mealType}</Badge>
            </div>
            <div className="mt-3 font-mono text-xs text-muted-foreground">
              {formatAmount(meal.totals.calories)} kcal · P{" "}
              {formatAmount(meal.totals.proteinGrams)} · C{" "}
              {formatAmount(meal.totals.carbsGrams)} · F{" "}
              {formatAmount(meal.totals.fatGrams)}
            </div>
            <div className="mt-3">
              <MealRowActions meal={meal} />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function MealRowActions({
  meal,
}: Readonly<{ meal: NutritionDashboardData["recentMeals"][number] }>) {
  return (
    <div className="grid justify-end gap-2 text-left">
      <details className="w-80 max-w-[80vw] rounded-md border border-border bg-background p-2">
        <summary className="cursor-pointer text-xs font-semibold text-primary">
          Edit
        </summary>
        <form action={updateMealAction} className="mt-3 grid gap-3">
          <input
            name="idempotency_key"
            type="hidden"
            value={meal.idempotencyKey}
          />
          <input
            name="client_meal_id"
            type="hidden"
            value={meal.clientMealId ?? ""}
          />
          <input name="timezone" type="hidden" value={meal.timezone} />
          <input name="photo_count" type="hidden" value={meal.photoCount} />
          <MealFields foods={[]} meal={meal} />
          <Button size="sm" type="submit">
            Save changes
          </Button>
        </form>
      </details>

      <details className="w-80 max-w-[80vw] rounded-md border border-destructive/50 bg-destructive/10 p-2">
        <summary className="cursor-pointer text-xs font-semibold text-destructive">
          Delete
        </summary>
        <form action={deleteMealAction} className="mt-3 grid gap-3">
          <input name="meal_id" type="hidden" value={meal.id} />
          <label className="flex items-start gap-2 text-xs text-muted-foreground">
            <input
              className="mt-0.5 size-4 accent-[var(--destructive)]"
              name="confirm_delete"
              required
              type="checkbox"
              value="yes"
            />
            Remove this meal from the synced account.
          </label>
          <Button size="sm" type="submit" variant="destructive">
            Delete meal
          </Button>
        </form>
      </details>
    </div>
  );
}

function QuickTemplatesPanel({
  data,
}: Readonly<{
  data: NutritionDashboardData;
}>) {
  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-primary" aria-hidden="true" />
        <h3 className="font-semibold">Quick fills</h3>
      </div>
      {data.savedTemplates.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
          Save reusable meals in the iOS app to build this list.
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-3">
          {data.savedTemplates.map((template) => (
            <div
              className="rounded-md border border-border bg-secondary p-3"
              key={template.id}
            >
              <div className="font-semibold">{template.title}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {template.mealType} · {template.ingredients.length} ingredients
              </div>
              <div className="mt-2 font-mono text-xs text-muted-foreground">
                {formatAmount(template.totals.calories)} kcal · P{" "}
                {formatAmount(template.totals.proteinGrams)} · C{" "}
                {formatAmount(template.totals.carbsGrams)} · F{" "}
                {formatAmount(template.totals.fatGrams)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MetricsSection({
  health,
  primaryMetrics,
}: Readonly<{
  health: HealthDashboardData;
  primaryMetrics: readonly DashboardMetric[];
}>) {
  const primaryNames = new Set(primaryMetrics.map((metric) => metric.name));
  const otherMetrics = health.metrics.filter(
    (metric) => !primaryNames.has(metric.name),
  );

  return (
    <section className="scroll-mt-24" id="metrics">
      <SectionHeading
        description="Desktop keeps every trend visible; mobile stacks the same metric cards used by the iOS Metrics tab."
        icon={Activity}
        title="Metrics"
      />
      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {primaryMetrics.map((metric) => (
          <MetricCard key={metric.name} metric={metric} />
        ))}
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {otherMetrics.map((metric) => (
          <MetricCard key={metric.name} metric={metric} />
        ))}
      </div>
    </section>
  );
}

function SyncSection({
  health,
  latestDate,
}: Readonly<{
  health: HealthDashboardData;
  latestDate: string | undefined;
}>) {
  return (
    <section className="scroll-mt-24" id="sync">
      <SectionHeading
        description="Web is a review surface. HealthKit permission, background delivery, and Apple Health writes stay native."
        icon={RefreshCw}
        title="Sync"
      />
      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="size-5 text-fitness-cyan" aria-hidden="true" />
              Sync Center
            </CardTitle>
            <CardDescription>
              Status mirrors the native Sync tab without pretending web can pull
              Apple Health directly.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <SyncFact
                label="Latest health day"
                value={formatDate(latestDate)}
              />
              <SyncFact
                label="Range"
                value={`${formatDate(health.range.from.slice(0, 10))} - ${formatDate(
                  health.range.to.slice(0, 10),
                )}`}
              />
              <SyncFact
                label="Metrics"
                value={`${health.metrics.length} normalized rows`}
              />
              <SyncFact label="Backend" value="Vercel + Neon" />
            </div>
            <Separator />
            <div className="grid gap-3">
              <StatusRow
                icon={Apple}
                label="Apple Health"
                value="Native iOS client only"
              />
              <StatusRow
                icon={RefreshCw}
                label="Background sync"
                value="iOS opportunistic delivery"
              />
              <StatusRow
                icon={ShieldCheck}
                label="Writeback"
                value="Explicit on-device confirmation"
              />
            </div>
          </CardContent>
        </Card>
        <McpSetupCard endpoint={mcpEndpoint()} />
      </div>
    </section>
  );
}

function CoachSection({
  coachError,
  data,
}: Readonly<{
  coachError: boolean;
  data: CoachDashboardData;
}>) {
  const profile = data.profile;

  return (
    <section className="scroll-mt-24" id="coach">
      <SectionHeading
        description="Shared targets, reminders, and meal structure for iOS, web, and MCP."
        icon={Dumbbell}
        title="Coach"
      />
      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)]">
        <TargetPlanPanel data={data} />

        <Card>
          <CardHeader>
            <CardTitle>Edit profile and targets</CardTitle>
            <CardDescription>
              Changes recalculate targets and persist to the shared coach
              profile.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {coachError ? (
              <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="mt-0.5 size-4" aria-hidden="true" />
                Coach change was not saved. Check required values before trying
                again.
              </div>
            ) : null}
            <form action={saveCoachProfileAction} className="grid gap-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
                  Goal
                  <select
                    className={selectClassName}
                    defaultValue={profile?.goal ?? "lose_weight"}
                    name="goal"
                  >
                    <option value="lose_weight">Lose weight</option>
                    <option value="maintain">Maintain</option>
                    <option value="gain_mass">Gain mass</option>
                  </select>
                </label>
                <Field
                  inputMode="decimal"
                  label="Weight kg"
                  min="20"
                  name="weight_kg"
                  required
                  step="0.1"
                  type="number"
                  value={String(profile?.weightKg ?? 87.5)}
                />
                <Field
                  inputMode="numeric"
                  label="Steps estimate"
                  min="0"
                  name="estimated_steps_per_day"
                  required
                  step="500"
                  type="number"
                  value={String(profile?.estimatedStepsPerDay ?? 10_000)}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  inputMode="decimal"
                  label="Active kcal/day"
                  min="0"
                  name="estimated_active_calories_per_day"
                  placeholder="Optional"
                  step="1"
                  type="number"
                  value={optionalAmount(profile?.estimatedActiveCaloriesPerDay)}
                />
                <Field
                  inputMode="decimal"
                  label="Resting kcal/day"
                  min="500"
                  name="estimated_resting_calories_per_day"
                  placeholder="Optional"
                  step="1"
                  type="number"
                  value={optionalAmount(
                    profile?.estimatedRestingCaloriesPerDay,
                  )}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Targets use weight and steps by default. If active and resting
                calories are filled in, the calculator blends them
                conservatively into the maintenance estimate.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="Wake time"
                  name="wake_time"
                  type="time"
                  value={minutesToTime(profile?.wakeTimeMinutes ?? 450)}
                />
                <Field
                  label="Sleep time"
                  name="sleep_time"
                  type="time"
                  value={minutesToTime(profile?.sleepTimeMinutes ?? 1_410)}
                />
              </div>
              <label className="flex min-h-11 items-center gap-2 rounded-md border border-border bg-secondary px-3 text-sm text-muted-foreground">
                <input
                  className="size-4 accent-[var(--primary)]"
                  defaultChecked={profile?.mealRemindersEnabled ?? true}
                  name="meal_reminders_enabled"
                  type="checkbox"
                />
                Enable meal reminders
              </label>
              <MealSlotEditor initialSlots={mealSlotDefaults(profile)} />
              <Button className="w-fit" type="submit">
                Save coach profile
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

function MealFields({
  foods,
  meal,
}: Readonly<{
  foods: NutritionDashboardData["foodDatabase"];
  meal?: NutritionDashboardData["recentMeals"][number];
}>) {
  const ingredient = meal?.ingredients[0];

  return (
    <div className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Title" name="title" required value={meal?.title ?? ""} />
        <Field label="Type" name="meal_type" value={meal?.mealType ?? "Meal"} />
      </div>
      <Field
        label="Logged at"
        name="occurred_at"
        type="datetime-local"
        value={dateTimeLocalValue(meal?.occurredAt)}
      />
      <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
        Note
        <Textarea defaultValue={meal?.note ?? ""} name="note" />
      </label>
      <FoodQuickFillPicker foods={foods} />
      <div className="grid gap-3 sm:grid-cols-5">
        <Field
          inputMode="decimal"
          label="Calories"
          min="0"
          name="calories"
          required
          step="0.1"
          type="number"
          value={String(meal?.totals.calories ?? "")}
        />
        <Field
          inputMode="decimal"
          label="Protein"
          min="0"
          name="protein_grams"
          required
          step="0.1"
          type="number"
          value={String(meal?.totals.proteinGrams ?? "")}
        />
        <Field
          inputMode="decimal"
          label="Carbs"
          min="0"
          name="carbs_grams"
          required
          step="0.1"
          type="number"
          value={String(meal?.totals.carbsGrams ?? "")}
        />
        <Field
          inputMode="decimal"
          label="Fat"
          min="0"
          name="fat_grams"
          required
          step="0.1"
          type="number"
          value={String(meal?.totals.fatGrams ?? "")}
        />
        <Field
          inputMode="decimal"
          label="Fiber"
          min="0"
          name="fiber_grams"
          required
          step="0.1"
          type="number"
          value={String(meal?.totals.fiberGrams ?? "")}
        />
      </div>
      <div className="grid gap-3 rounded-md border border-border bg-secondary p-3 sm:grid-cols-4">
        <Field
          label="Ingredient"
          name="ingredient_name"
          value={ingredient?.name ?? ""}
        />
        <Field
          inputMode="decimal"
          label="Qty"
          min="0"
          name="ingredient_quantity"
          step="0.1"
          type="number"
          value={String(ingredient?.quantity ?? "")}
        />
        <Field
          label="Unit"
          name="ingredient_unit"
          value={ingredient?.unit ?? ""}
        />
        <Field
          inputMode="decimal"
          label="Grams"
          min="0"
          name="ingredient_grams"
          step="0.1"
          type="number"
          value={String(ingredient?.grams ?? "")}
        />
      </div>
    </div>
  );
}

function Field({
  label,
  name,
  required,
  type = "text",
  value,
  ...props
}: Readonly<
  {
    label: string;
    name: string;
    required?: boolean;
    type?: string;
    value: string;
  } & React.InputHTMLAttributes<HTMLInputElement>
>) {
  return (
    <label className="grid min-w-0 gap-1 text-xs font-semibold text-muted-foreground">
      {label}
      <Input
        defaultValue={value}
        name={name}
        required={required}
        type={type}
        {...props}
      />
    </label>
  );
}

function SectionHeading({
  description,
  icon: Icon,
  title,
}: Readonly<{
  description: string;
  icon: LucideIcon;
  title: string;
}>) {
  return (
    <div className="flex items-start gap-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-primary/35 bg-primary/10 text-primary">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <h2 className="text-2xl font-black">{title}</h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  );
}

function StatusRow({
  icon: Icon,
  label,
  value,
}: Readonly<{
  icon: LucideIcon;
  label: string;
  value: string;
}>) {
  return (
    <div className="flex min-h-12 items-center gap-3 rounded-md border border-border bg-secondary px-3">
      <Icon className="size-4 text-primary" aria-hidden="true" />
      <div className="min-w-0">
        <div className="text-xs font-semibold text-muted-foreground">
          {label}
        </div>
        <div className="truncate text-sm font-semibold">{value}</div>
      </div>
    </div>
  );
}

function SummaryPill({
  label,
  value,
}: Readonly<{
  label: string;
  value: string;
}>) {
  return (
    <div className="min-w-0 rounded-md bg-secondary p-2">
      <div className="text-[0.68rem] font-semibold text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 truncate font-mono text-xs text-foreground">
        {value}
      </div>
    </div>
  );
}

function SyncFact({
  label,
  value,
}: Readonly<{
  label: string;
  value: string;
}>) {
  return (
    <div className="rounded-md border border-border bg-secondary p-3">
      <div className="text-xs font-semibold text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-sm font-semibold">{value}</div>
    </div>
  );
}

function orderedMetrics(
  health: HealthDashboardData,
  names: readonly DashboardMetric["name"][],
): readonly DashboardMetric[] {
  return names
    .map((name) => health.metrics.find((metric) => metric.name === name))
    .filter((metric): metric is DashboardMetric => metric !== undefined);
}

function latestMetricDate(
  metrics: readonly DashboardMetric[],
): string | undefined {
  return metrics
    .map((metric) => metric.latestDate)
    .filter((date): date is string => date !== undefined)
    .sort()
    .at(-1);
}

function iconForMetric(metric: DashboardMetric): LucideIcon {
  switch (metric.name) {
    case "weight":
      return Scale;
    case "steps":
      return Footprints;
    case "active_energy":
    case "resting_energy":
    case "dietary_energy":
      return Flame;
    case "sleep":
      return Moon;
    case "heart_rate":
    case "resting_heart_rate":
    case "walking_heart_rate":
      return HeartPulse;
    case "protein":
    case "carbs":
    case "fat":
    case "fiber":
      return ForkKnife;
    default:
      return CircleGauge;
  }
}

function textClassForTone(tone: DashboardMetric["tone"]): string {
  switch (tone) {
    case "coral":
      return "text-fitness-orange";
    case "sky":
      return "text-fitness-cyan";
    case "violet":
      return "text-fitness-violet";
    case "lime":
      return "text-primary";
  }
}

function badgeForTone(
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

function optionalAmount(value: number | undefined): string {
  return value === undefined ? "" : String(value);
}

function dateTimeLocalValue(iso: string | undefined): string {
  const date = iso === undefined ? new Date() : new Date(iso);

  return date.toISOString().slice(0, 16);
}

function formatAmount(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value >= 100 ? 0 : 1,
  }).format(value);
}

function formatMealDate(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(iso));
}

function mealSlotDefaults(profile: CoachDashboardData["profile"]): readonly {
  name: string;
  timeMinutes: number;
  remindersEnabled: boolean;
}[] {
  if (profile !== undefined && profile.mealSlots.length > 0) {
    return profile.mealSlots.map((slot) => ({
      name: slot.name,
      timeMinutes: slot.timeMinutes,
      remindersEnabled: slot.remindersEnabled,
    }));
  }

  return [
    { name: "Breakfast", timeMinutes: 540, remindersEnabled: true },
    { name: "Lunch", timeMinutes: 780, remindersEnabled: true },
    { name: "Snack", timeMinutes: 990, remindersEnabled: true },
    { name: "Dinner", timeMinutes: 1_200, remindersEnabled: true },
  ];
}

function minutesToTime(minutes: number): string {
  const clamped = Math.min(Math.max(Math.round(minutes), 0), 1_439);
  const hour = Math.floor(clamped / 60);
  const minute = clamped % 60;

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

const selectClassName =
  "min-h-10 rounded-md border border-input bg-secondary px-3 py-2 text-sm text-foreground outline-none transition focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring";

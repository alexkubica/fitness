# Private Health Coach First Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first private alpha slice: npm workspace foundation, domain metric contracts, backend ingestion/auth base, authenticated MCP read tools, Telegram account-link/logging base, and iOS HealthKit sync proof of life.

**Architecture:** iOS owns HealthKit sync; a TypeScript backend owns auth, normalized data, audit logs, Telegram webhook handling, and MCP tools; domain packages own metric names, units, aggregation, and safety rules. All external writes are audited, and Apple Health writeback remains proposal-gated until explicit confirmation UX exists.

**Tech Stack:** npm workspaces, Node 22, TypeScript, Hono, Better Auth OAuth Provider, Neon/Postgres, MCP TypeScript SDK, grammY, SwiftUI, HealthKit.

---

## File Structure

- `.npmrc`: force public npm registry for this repo.
- `package.json`: npm workspace root and shared scripts.
- `tsconfig.base.json`: shared TypeScript settings.
- `apps/server`: first-slice Hono app for API, auth, MCP read tools, Telegram webhook, and jobs. Do not split into `apps/api` and `apps/mcp` until runtime/deployment constraints require it.
- `apps/ios`: SwiftUI HealthKit app.
- `packages/domain`: metric definitions, units, aggregation contracts, and report inputs.
- `packages/db`: Neon/Postgres SQL migrations and database client.
- `packages/auth`: shared scope names, token claims, and authorization helpers.
- `docs/TASKS.md`: durable task board.
- `docs/DEVOPS.md`: environment, secret, and deployment notes.

## Dependency Graph And Subagent Ownership

Execute in this order unless a manager updates `docs/TASKS.md`:

1. Task 2 owns root workspace files and must finish before TypeScript packages.
2. Task 3 owns `packages/domain`.
3. Task 4 owns `packages/db`.
4. Task 5 owns `packages/auth`.
5. Task 6 owns backend ingestion files under `apps/server/src/routes` and `apps/server/src/services`.
6. Task 7 owns MCP OAuth conformance files under `apps/server/src/mcp`.
7. Task 8 owns MCP read-tool files under `apps/server/src/mcp/tools`.
8. Task 9 owns Telegram files under `apps/server/src/telegram` and `apps/server/src/routes/telegram.ts`.
9. Task 10 owns `apps/ios`.
10. Task 11 owns progress docs.

Do not run Tasks 5-9 as parallel write tasks until their dependencies exist. Explorers may review in parallel; workers should avoid simultaneous edits to `package.json`, `package-lock.json`, `apps/server/src/app.ts`, or shared auth files.

## Task 1: Manager And Task Persistence

**Files:**

- Modify: `AGENTS.md`
- Modify: `docs/CURRENT_PROGRESS.md`
- Modify: `docs/DEVOPS.md`
- Modify: `docs/TASKS.md`
- Create or modify: `agents/manager.md`

- [ ] **Step 1: Confirm task board exists**

Run:

```bash
test -f docs/TASKS.md && sed -n '1,220p' docs/TASKS.md
```

Expected: task board exists with `Now`, `Next`, `Blocked`, and `Done` sections.

- [ ] **Step 2: Update current task status**

Move the active task from `Now` to `Done` only after spec, plan, GitHub private repo, local commit, and push have completed.

- [ ] **Step 3: Commit task board changes**

Run:

```bash
git add AGENTS.md docs/CURRENT_PROGRESS.md docs/DEVOPS.md docs/TASKS.md agents/manager.md
git commit -m "docs: add task manager workflow"
```

Expected: commit succeeds, or there are no changes because a prior agent already committed them.

## Task 2: Workspace Tooling Foundation

**Files:**

- Modify: `.npmrc`
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `.prettierrc`
- Create: `.prettierignore`
- Create: `eslint.config.mjs`

- [ ] **Step 1: Verify npm public registry override**

Run:

```bash
npm config get registry --location=project
```

Expected:

```text
https://registry.npmjs.org/
```

- [ ] **Step 2: Create root package manifest**

Create `package.json`:

```json
{
  "name": "fitness",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "lint": "eslint .",
    "typecheck": "tsc -p tsconfig.base.json --noEmit",
    "test": "npm run test --workspaces --if-present",
    "build": "npm run build --workspaces --if-present",
    "verify": "npm run format:check && npm run lint && npm run typecheck && npm test && npm run build"
  },
  "devDependencies": {
    "@eslint/js": "^9.0.0",
    "eslint": "^9.0.0",
    "prettier": "^3.0.0",
    "typescript": "^5.0.0",
    "typescript-eslint": "^8.0.0"
  }
}
```

- [ ] **Step 3: Create shared TypeScript config**

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true
  },
  "include": ["apps/**/*.ts", "packages/**/*.ts"]
}
```

- [ ] **Step 4: Create formatter and lint config**

Create `.prettierrc`:

```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all"
}
```

Create `.prettierignore`:

```text
node_modules/
dist/
build/
coverage/
.next/
DerivedData/
```

Create `eslint.config.mjs`:

```js
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["node_modules/**", "dist/**", "build/**", "coverage/**"],
  },
];
```

- [ ] **Step 5: Install and verify**

Run:

```bash
npm install
npm run format:check
npm run lint
npm run typecheck
git diff --check
```

Expected: all commands pass.

- [ ] **Step 6: Commit**

Run:

```bash
git add .npmrc package.json package-lock.json tsconfig.base.json .prettierrc .prettierignore eslint.config.mjs
git commit -m "chore: add npm workspace tooling"
```

## Task 3: Domain Metric Contracts

**Files:**

- Create: `packages/domain/package.json`
- Create: `packages/domain/src/metrics.ts`
- Create: `packages/domain/src/metrics.test.ts`
- Create: `packages/domain/src/index.ts`
- Create: `packages/domain/tsconfig.json`

- [ ] **Step 1: Write metric contract tests**

Create `packages/domain/src/metrics.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { HEALTH_METRICS, isHealthMetricName, metricByName } from "./metrics.js";

describe("health metric contracts", () => {
  it("contains the first-slice metric set with stable units", () => {
    expect(metricByName("weight").unit).toBe("kg");
    expect(metricByName("steps").unit).toBe("count");
    expect(metricByName("active_energy").unit).toBe("kcal");
    expect(metricByName("resting_energy").unit).toBe("kcal");
    expect(metricByName("sleep").unit).toBe("minute");
    expect(metricByName("heart_rate").unit).toBe("bpm");
    expect(metricByName("resting_heart_rate").unit).toBe("bpm");
    expect(metricByName("walking_heart_rate").unit).toBe("bpm");
  });

  it("rejects unknown metric names", () => {
    expect(isHealthMetricName("weight")).toBe(true);
    expect(isHealthMetricName("body_weight")).toBe(false);
  });

  it("has no duplicate metric names", () => {
    const names = HEALTH_METRICS.map((metric) => metric.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
```

- [ ] **Step 2: Run test and confirm it fails**

Run:

```bash
npm test -w @fitness/domain -- metrics
```

Expected: fails because package and implementation do not exist yet.

- [ ] **Step 3: Implement metric contracts**

Create `packages/domain/src/metrics.ts`:

```ts
export type HealthMetricUnit = "kg" | "count" | "kcal" | "minute" | "bpm";

export type HealthMetricName =
  | "weight"
  | "steps"
  | "active_energy"
  | "resting_energy"
  | "sleep"
  | "heart_rate"
  | "resting_heart_rate"
  | "walking_heart_rate";

export type HealthMetric = {
  name: HealthMetricName;
  unit: HealthMetricUnit;
  description: string;
};

export const HEALTH_METRICS: readonly HealthMetric[] = [
  {
    name: "weight",
    unit: "kg",
    description: "Body mass from HealthKit bodyMass.",
  },
  {
    name: "steps",
    unit: "count",
    description: "Step count from HealthKit stepCount.",
  },
  { name: "active_energy", unit: "kcal", description: "Active energy burned." },
  {
    name: "resting_energy",
    unit: "kcal",
    description: "Basal/resting energy burned.",
  },
  {
    name: "sleep",
    unit: "minute",
    description: "Sleep duration derived from sleep analysis.",
  },
  { name: "heart_rate", unit: "bpm", description: "Heart-rate samples." },
  {
    name: "resting_heart_rate",
    unit: "bpm",
    description: "Resting heart rate.",
  },
  {
    name: "walking_heart_rate",
    unit: "bpm",
    description: "Walking heart-rate average.",
  },
] as const;

export function isHealthMetricName(value: string): value is HealthMetricName {
  return HEALTH_METRICS.some((metric) => metric.name === value);
}

export function metricByName(name: HealthMetricName): HealthMetric {
  return HEALTH_METRICS.find((metric) => metric.name === name)!;
}
```

Create `packages/domain/src/index.ts`:

```ts
export * from "./metrics.js";
```

- [ ] **Step 4: Add package config**

Create `packages/domain/package.json`:

```json
{
  "name": "@fitness/domain",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "devDependencies": {
    "vitest": "^3.0.0"
  }
}
```

Create `packages/domain/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 5: Verify green**

Run:

```bash
npm install
npm test -w @fitness/domain
npm run build -w @fitness/domain
```

Expected: tests and build pass.

- [ ] **Step 6: Commit**

Run:

```bash
git add packages/domain package.json package-lock.json
git commit -m "feat: add health metric domain contracts"
```

## Task 4: Database And Audit Model

**Files:**

- Create: `packages/db/package.json`
- Create: `packages/db/sql/001_initial_schema.sql`
- Create: `packages/db/sql/002_seed_health_metric_definitions.sql`
- Create: `packages/db/src/client.ts`
- Create: `packages/db/src/index.ts`
- Create: `packages/db/src/schema.test.ts`

- [ ] **Step 1: Add Neon/Postgres SQL schema with core entities**

Create `packages/db/sql/001_initial_schema.sql` with tables for `users`, `health_metric_samples`, `daily_health_aggregates`, `health_sync_cursors`, `telegram_accounts`, `telegram_link_tokens`, `meals`, `meal_estimates`, `meal_corrections`, `check_ins`, `coach_memories`, `reports`, `write_proposals`, and `audit_events`.

Required invariants:

- `HealthMetricSample` has unique `(userId, source, sourceSampleId, metricName)`.
- Health samples and daily aggregates must reference a known `(metricName, unit)` definition seeded from `@fitness/domain` before live ingestion.
- `AuditEvent` is append-only at the application layer.
- `WriteProposal` stores `status` as `pending`, `approved`, `rejected`, `committed`, or `expired`.
- `MealEstimate` stores confidence and provenance.
- `TelegramLinkToken` is single-use, expires quickly, and stores nonce/state.
- `TelegramAccount` stores revocation state and unique `(telegramUserId)`.

- [ ] **Step 2: Add db package**

Create package scripts for schema contract tests and `tsc`. Use `@neondatabase/serverless`; do not use Prisma.

- [ ] **Step 3: Verify schema**

Run:

```bash
npm install
npm test -w @fitness/db
npm run build -w @fitness/db
```

Expected: SQL schema contract tests pass and package builds.

- [ ] **Step 4: Commit**

Run:

```bash
git add packages/db package.json package-lock.json
git commit -m "feat: add health data database schema"
```

## Task 5: Auth Scope Contracts

**Files:**

- Create: `packages/auth/package.json`
- Create: `packages/auth/src/scopes.ts`
- Create: `packages/auth/src/token-claims.ts`
- Create: `packages/auth/src/test-tokens.ts`
- Create: `packages/auth/src/index.ts`
- Create: `packages/auth/src/scopes.test.ts`
- Create: `packages/auth/tsconfig.json`

- [ ] **Step 1: Write auth contract tests**

Create tests that prove:

- First-slice MCP scopes are exactly `health:read`, `coach:read`, and `report:read`.
- Deferred scopes are not included in default MCP scope requests.
- Test-token helpers throw unless `NODE_ENV === "test"` or `ALLOW_FAKE_AUTH_TOKENS === "1"`.
- Token validation rejects expired, revoked, wrong-user, wrong-audience/resource, wrong-issuer, malformed JWT/JWKS, missing scope, and overbroad scope fixtures.

- [ ] **Step 2: Run test and confirm it fails**

Run:

```bash
npm test -w @fitness/auth
```

Expected: fails because the package and implementation do not exist yet.

- [ ] **Step 3: Implement scope and claim helpers**

Implement:

- `FIRST_SLICE_MCP_SCOPES = ["health:read", "coach:read", "report:read"]`.
- `DEFERRED_MCP_WRITE_SCOPES = ["meal:write", "checkin:write", "writeback:prepare", "writeback:commit"]`.
- typed token claim shape with `iss`, `aud`, `sub`, `exp`, `iat`, `scope`, and optional `jti`.
- dev/test-only fake token helper guarded by environment.

- [ ] **Step 4: Verify**

Run:

```bash
npm test -w @fitness/auth
npm run build -w @fitness/auth
```

- [ ] **Step 5: Commit**

Run:

```bash
git add packages/auth package.json package-lock.json
git commit -m "feat: add auth scope contracts"
```

## Task 6: Backend Auth And Ingestion Foundation

**Files:**

- Create: `apps/server/package.json`
- Create: `apps/server/src/app.ts`
- Create: `apps/server/src/auth.ts`
- Create: `apps/server/src/routes/health-sync.ts`
- Create: `apps/server/src/services/audit.ts`
- Create: `apps/server/src/services/health-sync.ts`
- Create: `apps/server/src/server.ts`
- Create: `apps/server/src/app.test.ts`

- [ ] **Step 1: Test unauthorized ingestion**

Write a test that `POST /api/health/samples` returns `401` without auth.

- [ ] **Step 2: Test invalid auth cases**

Write tests that ingestion rejects expired, revoked, wrong-user, wrong-audience/resource, wrong-issuer, malformed JWT/JWKS, and missing `health:write` or internal sync scope tokens.

- [ ] **Step 3: Test valid fake ingestion**

Write a test that an authenticated fake user can ingest one `weight` sample and receives an idempotent success response.

- [ ] **Step 4: Implement Hono app and route**

Implement Hono app, auth middleware using `packages/auth`, validated ingestion payload, audit event creation, and service-layer idempotency. Fake tokens must be test/dev-only and fail closed outside explicit dev/test flags.

The auth middleware must pass explicit expected issuer, audience, resource, and allowed scopes into `@fitness/auth`. Do not rely on optional defaults for production-facing server routes.

The audit service must expose create/list behavior only. Do not add public service methods, routes, or MCP/Telegram actions that update or delete `AuditEvent` rows. Add tests or type-level assertions that the application audit service has no update/delete API surface.

- [ ] **Step 5: Verify**

Run:

```bash
npm test -w @fitness/server
npm run build -w @fitness/server
```

- [ ] **Step 6: Commit**

Run:

```bash
git add apps/server package.json package-lock.json
git commit -m "feat: add authenticated health ingestion foundation"
```

## Task 7: MCP OAuth Conformance

**Files:**

- Create: `apps/server/src/mcp/oauth-metadata.ts`
- Create: `apps/server/src/mcp/oauth-metadata.test.ts`
- Create: `apps/server/src/mcp/auth.ts`

- [ ] **Step 1: Test OAuth protected resource metadata**

Write tests that prove:

- Protected resource metadata is served at `/.well-known/oauth-protected-resource`.
- `resource` equals the canonical MCP server URL.
- `authorization_servers` points to the Better Auth issuer.
- `scopes_supported` includes only first-slice MCP scopes.
- `401` responses include `WWW-Authenticate` with `resource_metadata`.

- [ ] **Step 2: Test authorization-server expectations**

Write tests or metadata assertions for:

- OAuth/OIDC discovery document URL is reachable through the auth handler.
- token endpoint auth methods are advertised.
- PKCE `S256` is advertised.
- DCR/CIMD/predefined-client strategy is explicitly configured.
- issued access tokens echo the MCP `resource` into audience/resource validation.

- [ ] **Step 3: Implement conformance layer**

Implement metadata and auth verification helpers. Do not implement MCP tools until these tests pass.

- [ ] **Step 4: Verify**

Run:

```bash
npm test -w @fitness/server -- oauth-metadata
npm run build -w @fitness/server
```

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/server/src/mcp apps/server/src/app.ts
git commit -m "feat: add MCP OAuth conformance checks"
```

## Task 8: MCP Read Tools

**Files:**

- Create: `apps/server/src/mcp/server.ts`
- Create: `apps/server/src/mcp/tools/get-health-summary.ts`
- Create: `apps/server/src/mcp/tools/get-metric-timeseries.ts`
- Create: `apps/server/src/mcp/server.test.ts`

- [ ] **Step 1: Test token enforcement**

Write tests for `401` unauthenticated, `403` missing scope, expired token, wrong-user access, wrong-audience/resource, wrong-issuer, malformed token/JWKS, and happy-path `health:read`.

- [ ] **Step 2: Implement protected resource metadata**

Assert that this task reuses the OAuth conformance layer from Task 7. Do not request or advertise `meal:write`, `checkin:write`, `writeback:prepare`, or `writeback:commit`.

- [ ] **Step 3: Implement read tools**

Implement `get_health_summary(range)` and `get_metric_timeseries(metric, range, granularity)` against fake/test data services.

- [ ] **Step 4: Verify**

Run:

```bash
npm test -w @fitness/server -- mcp
npm run build -w @fitness/server
```

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/server/src/mcp apps/server/src/app.ts
git commit -m "feat: add authenticated MCP health read tools"
```

## Task 9: Telegram Link And Logging

**Files:**

- Create: `apps/server/src/telegram/bot.ts`
- Create: `apps/server/src/telegram/linking.ts`
- Create: `apps/server/src/routes/telegram.ts`
- Create: `apps/server/src/telegram/bot.test.ts`

- [ ] **Step 1: Test unlinked user behavior**

Write a test that `/checkin` from an unlinked Telegram user responds with `/link`.

- [ ] **Step 2: Test link security**

Write tests for short TTL, single-use token consumption, state/nonce validation, replay prevention, account mismatch rejection, relink revocation, unlink revocation, Telegram user ID binding, and webhook `X-Telegram-Bot-Api-Secret-Token` validation.

- [ ] **Step 3: Test linked check-in logging**

Write a test that a linked user can log hunger, mood, energy, stress, cravings, and notes.

- [ ] **Step 4: Implement bot commands**

Implement `/start`, `/link`, `/checkin`, `/log`, `/report`, `/settings`, and `/unlink` command handlers with idempotent update handling.

- [ ] **Step 5: Verify**

Run:

```bash
npm test -w @fitness/server -- telegram
npm run build -w @fitness/server
```

- [ ] **Step 6: Commit**

Run:

```bash
git add apps/server/src/telegram apps/server/src/routes/telegram.ts
git commit -m "feat: add Telegram coach linking and logging"
```

## Task 10: iOS HealthKit Proof Of Life

**Files:**

- Create: `apps/ios/FitnessCoach.xcodeproj`
- Create: `apps/ios/FitnessCoach/FitnessCoachApp.swift`
- Create: `apps/ios/FitnessCoach/HealthKit/HealthKitStore.swift`
- Create: `apps/ios/FitnessCoach/HealthKit/HealthMetricUploader.swift`
- Create: `apps/ios/FitnessCoach/ContentView.swift`

- [ ] **Step 1: Create SwiftUI app**

Create an Xcode SwiftUI project under `apps/ios` named `FitnessCoach`.

- [ ] **Step 2: Add read-only HealthKit capability and usage description**

Add HealthKit capability and `NSHealthShareUsageDescription` explaining private coach sync. Do not add `NSHealthUpdateUsageDescription` or request share/write types in this slice.

- [ ] **Step 3: Implement permission request**

Implement HealthKit permission request for first metric set. Show partial/missing permission state in `ContentView`.

- [ ] **Step 4: Implement one anchored query**

Start with body mass or step count. Persist the anchor locally and upload sample deltas only when the app is pointed at a disposable/local backend and `ALLOW_LIVE_HEALTH_DATA=1` is explicitly configured for real device data. Simulator/fake data remains the default.

- [ ] **Step 5: Verify**

Run:

```bash
xcodebuild -list -project apps/ios/FitnessCoach.xcodeproj
xcodebuild test -project apps/ios/FitnessCoach.xcodeproj -scheme FitnessCoach -destination 'platform=iOS Simulator,name=iPhone 16'
```

Expected: project lists and tests/build pass. If simulator HealthKit automation is limited, record manual verification gaps.

- [ ] **Step 6: Commit**

Run:

```bash
git add apps/ios
git commit -m "feat: add iOS HealthKit sync proof of life"
```

## Task 11: First-Slice Verification And Task Board Update

**Files:**

- Modify: `docs/TASKS.md`
- Modify: `docs/CURRENT_PROGRESS.md`
- Modify: `docs/DEVOPS.md`

- [ ] **Step 1: Run full verification**

Run:

```bash
npm run verify
git diff --check
```

Run iOS verification from Task 8 if the iOS project exists.

- [ ] **Step 2: Update docs**

Move completed tasks in `docs/TASKS.md` to `Done`, update `docs/CURRENT_PROGRESS.md`, and record any environment or deployment changes in `docs/DEVOPS.md`.

- [ ] **Step 3: Commit**

Run:

```bash
git add docs/TASKS.md docs/CURRENT_PROGRESS.md docs/DEVOPS.md
git commit -m "docs: update first slice progress"
```

- [ ] **Step 4: Push**

Run:

```bash
git push origin main
```

Expected: push succeeds to private `alexkubica/fitness`.

## Self-Review Notes

- Spec coverage: manager/task persistence, npm registry override, read-only HealthKit sync, backend ingestion, auth contracts, MCP OAuth/read tools, Telegram linking/logging, auditability, and safety boundaries are covered.
- Scope risk: this first-slice plan touches multiple subsystems. Execute dependency order above and commit after each task to keep integration controlled.
- Known blockers: production hosting/database, Telegram bot token, Apple signing, and deployed ChatGPT connector URL remain blocked until credentials and deployment decisions exist.

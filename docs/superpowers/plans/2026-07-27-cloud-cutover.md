# Baan Ngern Dee Cloud Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the production Local Storage finance runtime with Supabase Email Auth and a Cloudflare Worker-backed, RLS-protected cloud data flow.

**Architecture:** The SPA fetches public Supabase configuration from `/config`, uses `@supabase/supabase-js` only for authentication, and sends the current user JWT to same-origin Worker endpoints. The Worker owns all finance reads and writes; `GET /v1/snapshot` invokes a security-invoker PostgreSQL RPC that returns the complete shared finance read model.

**Tech Stack:** React 19, React Router 7, Vite 7, TypeScript 5.8, Vitest 3, Supabase JS 2, Supabase PostgreSQL 17, Hono 4, Cloudflare Workers/Wrangler 4.

## Global Constraints

- Production is cloud-only; never fall back to Local Storage finance data.
- Do not import or merge `systems-credit:finance:v1`.
- Remove only `systems-credit:session:v1` and `systems-credit:finance:v1`, and only after a valid Supabase session exists.
- Never call `localStorage.clear()`.
- Never use or expose a Supabase `service_role`, a key beginning with `sb_secret_`, a database password, or a connection string.
- Use a browser-safe `sb_publishable_` key plus the signed-in user's JWT for all database access.
- Keep `/health` and `/config` public; require auth for every `/v1/*` route.
- Preserve decimal money strings, financial-date strings, mutation idempotency, and optimistic version checks.
- Keep the SPA and API on the same Worker origin.
- Follow RED → GREEN → REFACTOR for every production behavior change.

---

### Task 1: Shared Public Config and Finance Snapshot Contracts

**Files:**
- Create: `packages/contracts/src/cloud.ts`
- Create: `packages/contracts/src/finance-snapshot.ts`
- Create: `packages/contracts/test/cloud.test.ts`
- Create: `packages/contracts/test/finance-snapshot.test.ts`
- Create: `packages/contracts/vitest.config.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/package.json`
- Modify: `packages/contracts/tsconfig.json`
- Modify: `apps/web/src/lib/local-finance-api.ts`

**Interfaces:**
- Produces: `publicAppConfigSchema`, `PublicAppConfig`, `financeSnapshotSchema`, `FinanceSnapshot`, and the nested snapshot read-model types.
- Consumes: existing `Workspace`, `Account`, `Category`, transaction, and installment contract enums from `@systems-credit/contracts`.

- [ ] **Step 1: Write failing contract tests**

Create tests that prove public config rejects elevated keys and that a complete empty snapshot parses:

```ts
import { describe, expect, it } from "vitest";
import {
  financeSnapshotSchema,
  publicAppConfigSchema
} from "../src";

describe("publicAppConfigSchema", () => {
  it("accepts only the browser-safe publishable key format", () => {
    expect(
      publicAppConfigSchema.parse({
        supabaseUrl: "https://project.supabase.co",
        supabasePublishableKey: "sb_publishable_public"
      })
    ).toEqual({
      supabaseUrl: "https://project.supabase.co",
      supabasePublishableKey: "sb_publishable_public"
    });
    expect(() =>
      publicAppConfigSchema.parse({
        supabaseUrl: "https://project.supabase.co",
        supabasePublishableKey: "sb_secret_private"
      })
    ).toThrow();
    expect(() =>
      publicAppConfigSchema.parse({
        supabaseUrl: "https://project.supabase.co",
        supabasePublishableKey: "arbitrary-key"
      })
    ).toThrow();
  });
});

describe("financeSnapshotSchema", () => {
  it("parses the deterministic empty cloud snapshot", () => {
    expect(
      financeSnapshotSchema.parse({
        version: 1,
        workspace: null,
        categories: [],
        accounts: [],
        accountBalances: {},
        openingTransactions: [],
        transactions: [],
        installmentContracts: [],
        installmentSchedules: {},
        installmentPayments: [],
        installmentPayoffs: []
      })
    ).toMatchObject({ version: 1, workspace: null });
  });
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```powershell
npx vitest run --config packages/contracts/vitest.config.ts
```

Expected: FAIL because the new contract modules and Vitest project do not exist.

- [ ] **Step 3: Implement exact shared schemas and types**

`cloud.ts` exports:

```ts
export const publicAppConfigSchema = z.object({
  supabaseUrl: z.string().url().refine((value) =>
    value.endsWith(".supabase.co")
  ),
  supabasePublishableKey: z.string().startsWith("sb_publishable_")
}).strict();

export type PublicAppConfig = z.infer<typeof publicAppConfigSchema>;
```

`finance-snapshot.ts` moves the exact cloud-neutral equivalents of
`LocalOpeningTransaction`, `LocalTransaction`, `LocalInstallmentContract`,
`LocalInstallmentScheduleRow`, `LocalInstallmentPayment`,
`LocalInstallmentPayoff`, and `LocalFinanceSnapshot` out of
`local-finance-api.ts`. Define strict Zod schemas for every nested object.
Use the existing status enums, UUID validation, ISO date regex, ISO timestamp
validation, and decimal string validation. Export:

```ts
export const financeSnapshotSchema: z.ZodType<FinanceSnapshot>;
export type FinanceSnapshot = Readonly<{
  version: 1;
  workspace: Workspace | null;
  categories: Category[];
  accounts: Account[];
  accountBalances: Record<string, AccountBalance>;
  openingTransactions: OpeningTransaction[];
  transactions: FinanceTransaction[];
  installmentContracts: FinanceInstallmentContract[];
  installmentSchedules: Record<string, FinanceInstallmentScheduleRow[]>;
  installmentPayments: FinanceInstallmentPayment[];
  installmentPayoffs: FinanceInstallmentPayoff[];
}>;
```

Keep the field names and optional fields identical to the approved design and
the existing local snapshot. Make `LocalFinanceSnapshot` a deprecated type
alias of `FinanceSnapshot` so existing UI tests remain green during the
cutover.

- [ ] **Step 4: Register the contracts test project**

Add `test` to `packages/contracts/package.json`, include `src` and `test` in
its TypeScript project, and use this Vitest config:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"]
  }
});
```

- [ ] **Step 5: Run contract and regression tests**

Run:

```powershell
npx vitest run --config packages/contracts/vitest.config.ts
npm test -- --run
npm run typecheck
```

Expected: contract tests pass, existing 100 tests pass, and typecheck passes.

- [ ] **Step 6: Commit**

```powershell
git add packages/contracts apps/web/src/lib/local-finance-api.ts
git commit -m "feat: share cloud finance snapshot contracts"
```

### Task 2: RLS-Protected Finance Snapshot RPC

**Files:**
- Create: `supabase/migrations/202607270010_finance_snapshot.sql`
- Create: `supabase/tests/database/finance_snapshot.test.sql`
- Create: `workers/api/test/finance-snapshot-database.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: all existing public finance tables, `public.format_money`, `auth.uid()`, and RLS helper functions.
- Produces: `public.get_finance_snapshot() returns jsonb`.

- [ ] **Step 1: Write the failing pgTAP contract test**

```sql
begin;
select plan(3);
select has_function('public', 'get_finance_snapshot', array[]::text[]);
select function_returns(
  'public',
  'get_finance_snapshot',
  array[]::text[],
  'jsonb'
);
select function_privs_are(
  'public',
  'get_finance_snapshot',
  array[]::text[],
  'authenticated',
  array['EXECUTE']
);
select * from finish();
rollback;
```

- [ ] **Step 2: Write the failing PGlite behavior test**

Load all migrations through `202607270010_finance_snapshot.sql`, create an
owner and stranger, create the owner's workspace/account/transaction and
installment contract using the existing RPCs, and assert:

```ts
const ownerSnapshot = await database.query<{ snapshot: unknown }>(
  "select public.get_finance_snapshot() as snapshot"
);
expect(ownerSnapshot.rows[0]?.snapshot).toMatchObject({
  version: 1,
  workspace: { role: "owner" }
});

await database.exec(
  `select set_config('request.jwt.claim.sub', '${strangerId}', false)`
);
const strangerSnapshot = await database.query<{ snapshot: unknown }>(
  "select public.get_finance_snapshot() as snapshot"
);
expect(strangerSnapshot.rows[0]?.snapshot).toMatchObject({
  version: 1,
  workspace: null,
  accounts: [],
  transactions: []
});
```

- [ ] **Step 3: Run the database test and verify RED**

Run:

```powershell
npx vitest run workers/api/test/finance-snapshot-database.test.ts
```

Expected: FAIL because `public.get_finance_snapshot()` does not exist.

- [ ] **Step 4: Implement the security-invoker RPC**

Create a stable SQL function with no `security definer` clause:

```sql
create function public.get_finance_snapshot()
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with selected_workspace as (
    select
      workspace.id,
      workspace.name,
      workspace.kind,
      workspace.base_currency,
      workspace.timezone,
      workspace.version,
      member.role
    from public.workspaces workspace
    join public.workspace_members member
      on member.workspace_id = workspace.id
     and member.user_id = auth.uid()
    where workspace.archived_at is null
    order by (workspace.kind = 'private') desc, workspace.created_at asc
    limit 1
  )
  select jsonb_build_object(
    'version', 1,
    'workspace', case when workspace.id is null then null else
      jsonb_build_object(
        'id', workspace.id,
        'name', workspace.name,
        'kind', workspace.kind,
        'baseCurrency', workspace.base_currency,
        'timeZone', workspace.timezone,
        'role', workspace.role,
        'version', workspace.version
      )
    end,
    'categories', public.snapshot_categories(workspace.id),
    'accounts', public.snapshot_accounts(workspace.id),
    'accountBalances', public.snapshot_account_balances(workspace.id),
    'openingTransactions', public.snapshot_opening_transactions(workspace.id),
    'transactions', public.snapshot_transactions(workspace.id),
    'installmentContracts',
      public.snapshot_installment_contracts(workspace.id),
    'installmentSchedules',
      public.snapshot_installment_schedules(workspace.id),
    'installmentPayments',
      public.snapshot_installment_payments(workspace.id),
    'installmentPayoffs',
      public.snapshot_installment_payoffs(workspace.id)
  )
  from (select 1) singleton
  left join selected_workspace workspace on true
$$;
```

In the same migration, implement the eight `snapshot_*` SQL helper functions
as stable, security-invoker functions. Each helper must return `[]` or `{}` for
a null workspace, filter on the supplied workspace ID, format every money
column with `public.format_money`, map snake_case to the exact camelCase
contract, and use these deterministic orders:

- Categories: `kind, name, id`.
- Accounts: `created_at, id`.
- Balances: account ID keys.
- Opening transactions: `financial_date, created_at, id`.
- Transactions: `financial_date desc, created_at desc, id`.
- Contracts: `created_at, id`.
- Schedule rows: contract ID then sequence.
- Payments/payoffs: `financial_date desc, created_at desc, id`.

Join `transaction_splits`, `transaction_tags`, and
`installment_transaction_links` so transactions include `splits`, `tagIds`,
`source`, and `sourceId`. Use balance-adjustment rows for
`openingTransactions` and exclude them from the normal transaction list.
Use `response_json` and the transaction-link table to expose installment
expense transaction IDs.

Revoke public execution and grant only authenticated execution:

```sql
revoke all on function public.get_finance_snapshot() from public;
grant execute on function public.get_finance_snapshot() to authenticated;
```

Apply the same revoke/grant policy to all helper functions.

- [ ] **Step 5: Run database tests and verify GREEN**

Run:

```powershell
npx vitest run workers/api/test/finance-snapshot-database.test.ts
npm run test:db
```

Expected: owner snapshot validates, stranger sees an empty snapshot, and all
existing database tests pass.

- [ ] **Step 6: Commit**

```powershell
git add supabase/migrations/202607270010_finance_snapshot.sql supabase/tests/database/finance_snapshot.test.sql workers/api/test/finance-snapshot-database.test.ts package.json
git commit -m "feat: add RLS finance snapshot read model"
```

### Task 3: Safe Public Worker Configuration Endpoint

**Files:**
- Create: `workers/api/test/config.test.ts`
- Modify: `workers/api/src/app.ts`
- Modify: `workers/api/src/index.ts`
- Modify: `workers/api/src/types.ts`
- Modify: `wrangler.jsonc`

**Interfaces:**
- Consumes: runtime `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
- Produces: unauthenticated `GET /config -> PublicAppConfig`.

- [ ] **Step 1: Write failing route tests**

```ts
it("returns only public Supabase browser configuration", async () => {
  const app = createApp({
    publicConfig: {
      supabaseUrl: "https://project.supabase.co",
      supabasePublishableKey: "sb_publishable_public"
    }
  });
  const response = await app.request("/config");
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    supabaseUrl: "https://project.supabase.co",
    supabasePublishableKey: "sb_publishable_public"
  });
});

it("does not expose an elevated key", async () => {
  const app = createApp({
    publicConfig: {
      supabaseUrl: "https://project.supabase.co",
      supabasePublishableKey: "sb_secret_private"
    }
  });
  expect((await app.request("/config")).status).toBe(500);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
npx vitest run workers/api/test/config.test.ts
```

Expected: FAIL because `publicConfig` and `/config` do not exist.

- [ ] **Step 3: Implement the route and runtime wiring**

Extend `AppDependencies` with `publicConfig?: PublicAppConfig`. The route
parses the dependency through `publicAppConfigSchema`; invalid configuration
throws a safe `INTERNAL_ERROR` without logging the key. In `index.ts`, pass:

```ts
publicConfig: {
  supabaseUrl: env.SUPABASE_URL,
  supabasePublishableKey: env.SUPABASE_ANON_KEY
}
```

Update Worker static routing:

```json
"run_worker_first": [
  "/config",
  "/health",
  "/v1/*"
]
```

Because production calls are same-origin, remove `ALLOWED_ORIGIN` from
`secrets.required` and make the binding optional. Keep CORS headers only when
an explicit local/cross-origin allow value matches.

- [ ] **Step 4: Verify GREEN**

Run:

```powershell
npx vitest run workers/api/test/config.test.ts workers/api/test/health.test.ts
npm run build
```

Expected: both routes pass and Wrangler includes `/config` in Worker-first
routing.

- [ ] **Step 5: Commit**

```powershell
git add workers/api wrangler.jsonc
git commit -m "feat: expose safe browser cloud config"
```

### Task 4: Worker Snapshot Repository and Route

**Files:**
- Create: `workers/api/src/routes/snapshot.ts`
- Create: `workers/api/test/snapshot.test.ts`
- Modify: `workers/api/src/app.ts`
- Modify: `workers/api/src/services/finance-repository.ts`
- Modify: `workers/api/src/services/supabase-finance-repository.ts`
- Modify: `workers/api/test/supabase-adapters.test.ts`

**Interfaces:**
- Consumes: `FinanceSnapshot`, `financeSnapshotSchema`, and
  `public.get_finance_snapshot()`.
- Produces: `FinanceRepository.getSnapshot(actor)` and authenticated
  `GET /v1/snapshot`.

- [ ] **Step 1: Write failing route and adapter tests**

The route test creates a workspace/account using the memory repository and
asserts the snapshot:

```ts
const response = await app.request("/v1/snapshot", {
  headers: { authorization: "Bearer owner-token" }
});
expect(response.status).toBe(200);
expect(financeSnapshotSchema.parse(await response.json())).toMatchObject({
  workspace: { role: "owner" },
  accounts: [{ name: "เงินสด" }]
});
```

The adapter test asserts one RPC request:

```ts
await repository.getSnapshot(actor);
expect(requestFetch).toHaveBeenCalledWith(
  "https://project.supabase.co/rest/v1/rpc/get_finance_snapshot",
  expect.objectContaining({
    method: "POST",
    body: "{}"
  })
);
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```powershell
npx vitest run workers/api/test/snapshot.test.ts workers/api/test/supabase-adapters.test.ts
```

Expected: FAIL because the repository method and route do not exist.

- [ ] **Step 3: Implement repository reads**

Add this interface method:

```ts
getSnapshot(actor: AuthSession): Promise<FinanceSnapshot>;
```

The memory repository builds the same deterministic snapshot from its maps,
including only workspaces where the actor is a member. Enrich stored
transactions and installment mutation records with all fields required by the
shared snapshot when they are created.

The Supabase repository implementation is:

```ts
async getSnapshot(actor) {
  const body = await client.rpc<unknown>(
    actor,
    "get_finance_snapshot",
    {}
  );
  return financeSnapshotSchema.parse(body);
}
```

- [ ] **Step 4: Implement and register the route**

```ts
export function snapshotRoutes(repository: FinanceRepository) {
  const routes = new Hono<AppEnv>();
  routes.get("/", async (context) =>
    context.json(
      await repository.getSnapshot(context.get("auth"))
    )
  );
  return routes;
}
```

Register it after `app.use("/v1/*", requireAuth(authVerifier))`.

- [ ] **Step 5: Verify GREEN and regressions**

Run:

```powershell
npx vitest run workers/api/test/snapshot.test.ts workers/api/test/supabase-adapters.test.ts
npm test -- --run
npm run typecheck
```

Expected: snapshot tests and all existing tests pass.

- [ ] **Step 6: Commit**

```powershell
git add workers/api
git commit -m "feat: add authenticated finance snapshot endpoint"
```

### Task 5: Browser Cloud Config and Supabase Auth Adapter

**Files:**
- Create: `apps/web/src/lib/cloud-config.ts`
- Create: `apps/web/src/lib/cloud-config.test.ts`
- Create: `apps/web/src/lib/cloud-auth.ts`
- Create: `apps/web/src/lib/cloud-auth.test.ts`
- Modify: `apps/web/package.json`
- Modify: `apps/web/vite.config.ts`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: `loadPublicAppConfig`, `CloudSession`, `CloudAuth`, and
  `createSupabaseCloudAuth`.
- Consumes: `/config` and Supabase JS Auth APIs.

- [ ] **Step 1: Install the browser Auth SDK**

Run:

```powershell
npm install -w @systems-credit/web @supabase/supabase-js
```

- [ ] **Step 2: Write failing config and auth-adapter tests**

Test `/config` parsing and the narrow adapter contract:

```ts
await expect(
  loadPublicAppConfig(fetchStub)
).resolves.toEqual({
  supabaseUrl: "https://project.supabase.co",
  supabasePublishableKey: "sb_publishable_public"
});

await auth.signUp({
  displayName: "มิน",
  email: "min@example.test",
  password: "correct-horse-battery",
  redirectTo: "https://app.example.test/"
});
expect(supabase.auth.signUp).toHaveBeenCalledWith({
  email: "min@example.test",
  password: "correct-horse-battery",
  options: {
    data: { display_name: "มิน" },
    emailRedirectTo: "https://app.example.test/"
  }
});
```

Also test `signInWithPassword`, `resetPasswordForEmail`, `updateUser`,
`refreshSession`, `signOut`, current-session mapping, and auth-state
subscription cleanup.

- [ ] **Step 3: Run the tests and verify RED**

Run:

```powershell
npx vitest run --project @systems-credit/web apps/web/src/lib/cloud-config.test.ts apps/web/src/lib/cloud-auth.test.ts
```

Expected: FAIL because the modules do not exist.

- [ ] **Step 4: Implement the narrow browser interfaces**

```ts
export type CloudSession = Readonly<{
  userId: string;
  email: string;
  displayName: string;
  accessToken: string;
}>;

export interface CloudAuth {
  getSession(): Promise<CloudSession | null>;
  refreshSession(): Promise<CloudSession | null>;
  subscribe(listener: (session: CloudSession | null) => void): () => void;
  signIn(input: { email: string; password: string }): Promise<CloudSession>;
  signUp(input: {
    displayName: string;
    email: string;
    password: string;
    redirectTo: string;
  }): Promise<"confirmation_required" | CloudSession>;
  requestPasswordReset(email: string, redirectTo: string): Promise<void>;
  updatePassword(password: string): Promise<void>;
  signOut(): Promise<void>;
}
```

Map `user.user_metadata.display_name` to `displayName`, falling back to the
email prefix. Keep Supabase SDK types inside this adapter.

- [ ] **Step 5: Proxy same-origin API paths during local Vite development**

Update `apps/web/vite.config.ts` so the browser can keep using relative,
same-origin URLs while Vite forwards API traffic to the local Worker:

```ts
server: {
  proxy: {
    "/config": "http://127.0.0.1:8787",
    "/health": "http://127.0.0.1:8787",
    "/v1": "http://127.0.0.1:8787"
  }
}
```

- [ ] **Step 6: Verify GREEN**

Run:

```powershell
npx vitest run --project @systems-credit/web apps/web/src/lib/cloud-config.test.ts apps/web/src/lib/cloud-auth.test.ts
npm run typecheck
```

- [ ] **Step 7: Commit**

```powershell
git add apps/web/package.json apps/web/vite.config.ts apps/web/src/lib/cloud-config.ts apps/web/src/lib/cloud-config.test.ts apps/web/src/lib/cloud-auth.ts apps/web/src/lib/cloud-auth.test.ts package-lock.json
git commit -m "feat: add Supabase browser auth adapter"
```

### Task 6: Authenticated Remote Finance API

**Files:**
- Create: `apps/web/src/lib/remote-finance-api.ts`
- Create: `apps/web/src/lib/remote-finance-api.test.ts`
- Modify: `apps/web/src/lib/finance-api.ts`

**Interfaces:**
- Consumes: `CloudAuth`, shared response schemas, and existing Worker routes.
- Produces: `RemoteFinanceApi` and `createRemoteFinanceApi`.

- [ ] **Step 1: Write failing token, retry, snapshot, and mutation tests**

```ts
const api = createRemoteFinanceApi({
  auth,
  fetch: requestFetch
});

await expect(api.getSnapshot()).resolves.toEqual(emptySnapshot);
expect(
  new Headers(requestFetch.mock.calls[0]![1]?.headers)
    .get("authorization")
).toBe("Bearer access-token");
```

Add a `401` test where the first call fails, `auth.refreshSession()` returns a
new token, and the second call succeeds. Add a second `401` test that invokes
`onUnauthenticated`. Add one test per mutation route and verify exact methods,
paths, JSON bodies, and response unwrapping for categories.

- [ ] **Step 2: Run the tests and verify RED**

Run:

```powershell
npx vitest run --project @systems-credit/web apps/web/src/lib/remote-finance-api.test.ts
```

Expected: FAIL because the remote API does not exist.

- [ ] **Step 3: Implement the remote client**

```ts
export type RemoteFinanceApi = FinanceApi & Readonly<{
  getSnapshot(): Promise<FinanceSnapshot>;
}>;

export function createRemoteFinanceApi(options: {
  auth: CloudAuth;
  fetch?: typeof fetch;
  onUnauthenticated(): void;
}): RemoteFinanceApi;
```

Implement one internal `request` function that obtains the session immediately
before the call, sends same-origin JSON, retries exactly once after a `401`,
parses structured `ApiErrorResponse`, and validates successful bodies. Map:

- `GET /v1/snapshot`
- `POST /v1/workspaces/private`
- `POST /v1/accounts`
- `POST /v1/categories`
- `POST /v1/transactions`
- `POST /v1/installments`
- `POST /v1/installments/:contractId/payments`
- `POST /v1/installments/:contractId/payoff`

Add an optional second `clientMutationId` argument to
`FinanceApi.createInstallmentContract` so the remote client sends it beside
the strict contract input while the local adapter ignores it.

- [ ] **Step 4: Verify GREEN**

Run:

```powershell
npx vitest run --project @systems-credit/web apps/web/src/lib/remote-finance-api.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit**

```powershell
git add apps/web/src/lib/finance-api.ts apps/web/src/lib/remote-finance-api.ts apps/web/src/lib/remote-finance-api.test.ts
git commit -m "feat: add authenticated remote finance client"
```

### Task 7: Cloud Application State and Router Cutover

**Files:**
- Create: `apps/web/src/app/cloud-state.ts`
- Create: `apps/web/src/app/cloud-state.test.ts`
- Modify: `apps/web/src/app/router.tsx`
- Modify: `apps/web/src/app/router.test.tsx`
- Modify: `apps/web/src/app/layout.tsx`
- Modify: `apps/web/src/features/auth/session-guard.tsx`
- Modify: `apps/web/src/features/dashboard/overview-page.tsx`
- Modify: `apps/web/src/features/accounts/accounts-page.tsx`
- Modify: `apps/web/src/features/transactions/transactions-page.tsx`
- Modify: `apps/web/src/features/installments/installments-page.tsx`

**Interfaces:**
- Consumes: `CloudAuth`, `RemoteFinanceApi`, `CloudSession`, and
  `FinanceSnapshot`.
- Produces: deterministic cloud boot state and protected route rendering.

- [ ] **Step 1: Write failing state-machine tests**

```ts
expect(initialCloudState).toEqual({ status: "loading-config" });
expect(
  cloudReducer(initialCloudState, { type: "SIGNED_OUT" })
).toEqual({ status: "signed-out" });
expect(
  cloudReducer(
    { status: "loading-finance", session },
    { type: "SNAPSHOT_LOADED", session, snapshot: emptySnapshot }
  )
).toMatchObject({ status: "ready", session, snapshot: emptySnapshot });
```

Cover all approved states and ensure a recoverable error retains the last
successful snapshot.

- [ ] **Step 2: Update the router integration test to expect cloud boot**

Inject fake config/auth/remote API dependencies. Prove:

- No session routes to `/sign-in`.
- Session plus empty snapshot routes to `/onboarding`.
- Session plus workspace routes to `/overview`.
- A valid session removes only the two legacy keys.
- Sign out routes back to `/sign-in`.

- [ ] **Step 3: Run tests and verify RED**

Run:

```powershell
npx vitest run --project @systems-credit/web apps/web/src/app/cloud-state.test.ts apps/web/src/app/router.test.tsx
```

- [ ] **Step 4: Implement cloud bootstrap and dependency injection**

`AppRouter` loads `/config`, creates Supabase Auth, restores/subscribes to the
session, constructs `RemoteFinanceApi`, deletes the two named legacy keys after
valid auth, and loads the snapshot. Keep configuration/auth construction
injectable in tests.

Remove `createLocalFinanceApi`, `readLocalSession`, `writeLocalSession`, and
`clearLocalSession` from production router imports. Keep local modules only for
their existing unit tests until the final cleanup task.

Change page props from `LocalFinanceApi`/`LocalFinanceSnapshot` to
`FinanceApi`/`FinanceSnapshot`. Change layout and overview session props to
`CloudSession`. Replace the sidebar Local badge with a Cloud-connected badge
and replace Local sign-out copy.

- [ ] **Step 5: Implement loading and retry states**

Render accessible Thai status cards for config/session/snapshot loading and a
retry button for `recoverable-error`. Do not redirect protected routes until
boot completes.

- [ ] **Step 6: Verify GREEN and existing feature tests**

Run:

```powershell
npx vitest run --project @systems-credit/web apps/web/src/app/cloud-state.test.ts apps/web/src/app/router.test.tsx
npm test -- --run
npm run typecheck
```

- [ ] **Step 7: Commit**

```powershell
git add apps/web/src/app apps/web/src/features
git commit -m "feat: cut application router over to cloud state"
```

### Task 8: Email Auth, Confirmation, and Password Reset UI

**Files:**
- Modify: `apps/web/src/features/auth/sign-in-page.tsx`
- Modify: `apps/web/src/features/auth/sign-in-page.test.tsx`
- Create: `apps/web/src/features/auth/reset-password-page.tsx`
- Create: `apps/web/src/features/auth/reset-password-page.test.tsx`
- Modify: `apps/web/src/app/router.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: `CloudAuth` actions supplied by the router.
- Produces: sign-in, sign-up, confirmation-pending, reset-request, and
  password-update experiences.

- [ ] **Step 1: Write failing sign-in and sign-up tests**

Test async email/password sign-in, display-name/email/password sign-up,
confirmation messaging, disabled pending buttons, and Thai error rendering.
Assert that password fields use `type="password"` and appropriate autocomplete
values.

- [ ] **Step 2: Write failing reset tests**

Test a reset-email request and `/reset-password` password confirmation. Assert
that mismatched passwords never call `updatePassword`.

- [ ] **Step 3: Run tests and verify RED**

Run:

```powershell
npx vitest run --project @systems-credit/web apps/web/src/features/auth/sign-in-page.test.tsx apps/web/src/features/auth/reset-password-page.test.tsx
```

- [ ] **Step 4: Implement the Auth UI**

Replace Local-only copy with Cloud account copy. Use a visible mode switch for
sign in and sign up, a text action for password reset, and explicit
confirmation-email feedback. Add `/reset-password` as a public route that
calls `CloudAuth.updatePassword`.

Use `window.location.origin + "/"` for signup confirmation and
`window.location.origin + "/reset-password"` for reset requests.

- [ ] **Step 5: Verify GREEN and accessibility**

Run:

```powershell
npx vitest run --project @systems-credit/web apps/web/src/features/auth/sign-in-page.test.tsx apps/web/src/features/auth/reset-password-page.test.tsx
npm run typecheck
```

- [ ] **Step 6: Commit**

```powershell
git add apps/web/src/features/auth apps/web/src/app/router.tsx apps/web/src/styles.css
git commit -m "feat: add Supabase email account flows"
```

### Task 9: Stable Idempotency Across User Retries

**Files:**
- Modify: `apps/web/src/features/transactions/transaction-form.tsx`
- Modify: `apps/web/src/features/transactions/transaction-form.test.tsx`
- Modify: `apps/web/src/features/installments/installment-form.tsx`
- Modify: `apps/web/src/features/installments/installment-form.test.tsx`
- Modify: `apps/web/src/features/installments/installment-payment-form.tsx`
- Modify: `apps/web/src/features/installments/installment-payment-form.test.tsx`
- Modify: `apps/web/src/features/installments/payoff-simulator.tsx`
- Modify: `apps/web/src/features/installments/payoff-simulator.test.tsx`

**Interfaces:**
- Consumes: mutation methods from `FinanceApi`.
- Produces: one stable `clientMutationId` per draft until confirmed success.

- [ ] **Step 1: Add failing retry tests**

For each mutation form, reject the first submission with a network error,
submit again, and assert both attempts use the same `clientMutationId`. After a
successful response, start a new draft and assert it receives a new ID.

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
npx vitest run --project @systems-credit/web apps/web/src/features/transactions/transaction-form.test.tsx apps/web/src/features/installments/installment-form.test.tsx apps/web/src/features/installments/installment-payment-form.test.tsx apps/web/src/features/installments/payoff-simulator.test.tsx
```

- [ ] **Step 3: Implement stable draft IDs**

Use one `useRef(crypto.randomUUID())` in each form. Read that value for every
retry and replace it only after a confirmed successful mutation or explicit
form reset. Pass the ID as the second argument for installment-contract
creation.

- [ ] **Step 4: Verify GREEN**

Run the four tests from Step 2 and then:

```powershell
npm test -- --run
```

- [ ] **Step 5: Commit**

```powershell
git add apps/web/src/features/transactions apps/web/src/features/installments
git commit -m "fix: preserve mutation ids across retries"
```

### Task 10: Remove Production Local Mode and Update Operations Docs

**Files:**
- Delete: `apps/web/src/lib/local-session.ts`
- Delete: `apps/web/src/lib/local-finance-api.ts`
- Delete: `apps/web/src/lib/local-finance-api.test.ts`
- Modify: `README.md`
- Modify: `docs/runbooks/deploy-cloudflare-supabase.md`
- Modify: `.dev.vars.example`
- Modify: `apps/web/.env.example`
- Modify: `package.json`

**Interfaces:**
- Consumes: completed cloud runtime.
- Produces: cloud-only source tree and an exact deployment runbook.

- [ ] **Step 1: Prove no production import uses Local mode**

Run:

```powershell
rg -n "createLocalFinanceApi|LocalFinanceSnapshot|LocalSession|local-session|local-finance-api" apps/web/src
```

Expected before deletion: matches only the legacy module and its legacy test.
If production imports remain, remove them through the shared cloud types before
continuing.

- [ ] **Step 2: Delete the legacy modules**

Use `apply_patch` to delete only the three files listed above. Do not remove
browser Local Storage globally; Supabase Auth still uses browser storage.

- [ ] **Step 3: Update docs and examples**

Document:

- `npm run dev:api` plus the Worker-served SPA for cloud testing.
- `/config`, `/health`, and `/v1/snapshot`.
- Supabase Auth Site URL and exact production/local redirect URLs.
- Default Supabase mailer limit of two emails per hour and the recommendation
  to configure custom SMTP before public launch.
- Migration order: tests, link, `db push`, deploy.
- No `VITE_SUPABASE_*` values are required because `/config` is runtime
  configuration.
- `ALLOWED_ORIGIN` is optional and only needed for cross-origin local clients.

Update `test:db` to include the new snapshot database test.

- [ ] **Step 4: Verify cloud-only source and docs**

Run:

```powershell
rg -n "LOCAL-FIRST|Local mode|createLocalFinanceApi|LocalFinanceSnapshot|LocalSession" apps/web/src README.md docs/runbooks
npm test -- --run
npm run typecheck
npm run build
```

Expected: no production Local-mode copy/import remains; tests and build pass.

- [ ] **Step 5: Commit**

```powershell
git add -A apps/web/src/lib README.md docs/runbooks .dev.vars.example apps/web/.env.example package.json
git commit -m "docs: complete cloud-only cutover"
```

### Task 11: Database Push, Production Deploy, and Acceptance

**Files:**
- Verify: all tracked files.
- External state: Supabase project `yzwlapcfnxbcjtpkvauz`.
- External state: Cloudflare Worker `baan-ngern-dee`.

**Interfaces:**
- Consumes: all completed tasks.
- Produces: migrated Supabase schema and deployed cloud-only application.

- [ ] **Step 1: Run the complete local verification**

Run:

```powershell
npm test -- --run
npm run test:db
npm run typecheck
npm run build
git diff --check
git status --short
```

Expected: all tests pass, typecheck/build exit zero, no whitespace errors, and
only intended tracked changes remain.

- [ ] **Step 2: Link and inspect the remote database migration plan**

Run:

```powershell
npx supabase login
npx supabase link --project-ref yzwlapcfnxbcjtpkvauz
npx supabase migration list
npx supabase db push --dry-run
```

Expected: the dry run lists only migrations not yet present remotely,
including `202607270010_finance_snapshot.sql`. Stop if it proposes destructive
or unexpected changes.

- [ ] **Step 3: Push the forward migration**

Run:

```powershell
npx supabase db push
```

Expected: remote migration completes without dropping user data.

- [ ] **Step 4: Configure Supabase Auth URLs**

In Supabase Dashboard → Authentication → URL Configuration, set:

```text
Site URL:
https://baan-ngern-dee.newforico-9ea.workers.dev

Redirect URLs:
https://baan-ngern-dee.newforico-9ea.workers.dev/
https://baan-ngern-dee.newforico-9ea.workers.dev/reset-password
http://127.0.0.1:8787/
http://127.0.0.1:8787/reset-password
http://127.0.0.1:5173/
http://127.0.0.1:5173/reset-password
```

Keep Confirm Email enabled. Do not enable Google or Phone in this cutover.

- [ ] **Step 5: Commit any final verified documentation and push**

```powershell
git status --short
git push origin HEAD:main
```

Expected: GitHub accepts a fast-forward push and Cloudflare Builds starts.

- [ ] **Step 6: Verify production infrastructure**

Run:

```powershell
curl.exe -i https://baan-ngern-dee.newforico-9ea.workers.dev/config
curl.exe -i https://baan-ngern-dee.newforico-9ea.workers.dev/health
curl.exe -i https://baan-ngern-dee.newforico-9ea.workers.dev/v1/snapshot
```

Expected:

- `/config` returns 200 and only public URL/publishable-key fields.
- `/health` returns 200.
- `/v1/snapshot` without a token returns 401.

- [ ] **Step 7: Complete browser acceptance**

Use a new test email account and verify:

1. Signup requests a confirmation email.
2. Confirmation returns to the Worker origin.
3. First login opens onboarding.
4. Workspace, account, transaction, installment, payment, and payoff data
   persist after a hard refresh.
5. Sign out blocks protected routes.
6. Password reset returns to `/reset-password` and accepts a new password.
7. A second account cannot see the first account's snapshot.

- [ ] **Step 8: Record delivery evidence**

Record the deployed commit, migration list, test counts, and verified URLs in
the final handoff. Mention that Supabase's default mail service is for testing
and custom SMTP is required before broader public use.

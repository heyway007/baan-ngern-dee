# Financial Core PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the deployable Phase 1 personal-finance PWA: authentication, private workspace, accounts, exact-money transactions, transfers, receipt attachments, dashboard basics, offline drafts/outbox, export/restore, and Cloudflare/Supabase deployment.

**Architecture:** Use an npm-workspaces monorepo with a React TypeScript PWA, a Hono Cloudflare Worker, a framework-independent financial-domain package, and Supabase migrations. The browser may call RLS-protected Supabase reads directly, while atomic or idempotent financial mutations go through Worker endpoints and PostgreSQL functions.

**Tech Stack:** Node.js 24.14.0, npm 11.9.0, TypeScript, React, Vite, React Router, TanStack Query, Zod, decimal.js, Dexie, Workbox, Hono, Cloudflare Workers/Wrangler, Supabase Auth/PostgreSQL/Storage/RLS, Vitest, Testing Library, pgTAP, and Playwright.

## Global Constraints

- User-facing language is Thai; code, schema names, and stable error codes are English.
- Default reporting currency is THB and default workspace timezone is Asia/Bangkok.
- Database money uses `numeric(20,4)`; exchange rates use `numeric(20,10)`; JavaScript binary floating point is forbidden for money calculations.
- Round to the currency minor unit with round-half-away-from-zero; place split/transfer residuals on the final component.
- Store UTC timestamps and interpret financial dates in the workspace timezone.
- Private data is private by default; RLS is the authorization boundary.
- A transfer is never income or expense.
- A credit-card purchase is an expense plus liability; paying the card reduces cash and liability without creating a second expense.
- Offline and synchronization states must be visible; never use silent last-write-wins for financial records.
- Infrastructure must target Cloudflare and Supabase free tiers and use no paid API.
- All material mutations require idempotency keys, optimistic record versions, audit events, and atomic rollback.

## Scope decomposition

The approved product is split into four independently testable plans:

1. This plan: Financial Core PWA.
2. Installments and Debt.
3. Planning, Recurrence, OCR, and Notifications.
4. Family, Multi-Currency Reporting, Assets, Backup, and Full Reports.

Phase 2 starts only after this plan's account, transaction, transfer, RLS, offline, and restore acceptance tests pass.

## Planned file structure

```text
.
├── apps/
│   └── web/
│       ├── src/app/                 # Router, providers, app shell
│       ├── src/features/auth/       # Sign-in and session handling
│       ├── src/features/onboarding/ # Private-workspace setup
│       ├── src/features/accounts/   # Account screens and queries
│       ├── src/features/transactions/
│       ├── src/features/dashboard/
│       ├── src/features/receipts/
│       ├── src/features/export/
│       ├── src/offline/             # IndexedDB outbox and sync engine
│       └── src/test/                # Web test setup and fixtures
├── workers/
│   └── api/
│       ├── src/index.ts             # Hono entry point
│       ├── src/middleware/           # Auth, request ID, error mapping
│       ├── src/routes/               # Mutation, receipt, export routes
│       ├── src/services/             # Supabase and mutation orchestration
│       └── test/                     # Worker integration tests
├── packages/
│   ├── domain/src/                  # Money, currency, account, transaction rules
│   └── contracts/src/               # Zod request/response schemas and error codes
├── supabase/
│   ├── migrations/                  # Schema, functions, RLS, storage policies
│   ├── seed.sql
│   └── tests/database/              # pgTAP tests
├── tests/e2e/                        # Playwright user journeys
├── docs/runbooks/                    # Local setup, deployment, restore
├── package.json
├── tsconfig.base.json
├── vitest.workspace.ts
├── playwright.config.ts
└── wrangler.toml
```

---

### Task 1: Monorepo scaffold and typed HTTP contracts

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `vitest.workspace.ts`
- Create: `apps/web/package.json`
- Create: `apps/web/index.html`
- Create: `apps/web/src/main.tsx`
- Create: `workers/api/package.json`
- Create: `workers/api/src/index.ts`
- Create: `workers/api/src/middleware/request-id.ts`
- Create: `workers/api/src/middleware/error-handler.ts`
- Create: `workers/api/test/health.test.ts`
- Create: `workers/api/test/error-handler.test.ts`
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/src/index.ts`
- Create: `packages/contracts/src/errors.ts`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `ApiErrorCode`, `ApiErrorResponse`, `HealthResponse`, Hono `GET /health`, `requestId()` middleware, and stable JSON error mapping.
- Consumes: none.

- [ ] **Step 1: Add the failing Worker health test**

```ts
// workers/api/test/health.test.ts
import { describe, expect, it } from "vitest";
import app from "../src/index";

describe("GET /health", () => {
  it("returns the stable health contract", async () => {
    const response = await app.request("/health");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      service: "systems-credit-api",
    });
  });
});
```

- [ ] **Step 2: Run the test and verify the scaffold is absent**

Run: `npm test -- --run workers/api/test/health.test.ts`  
Expected: FAIL because the workspace and Worker entry point do not exist.

- [ ] **Step 3: Create the npm workspace and base configuration**

Use these root scripts:

```json
{
  "private": true,
  "workspaces": ["apps/*", "workers/*", "packages/*"],
  "scripts": {
    "dev:web": "npm run dev -w @systems-credit/web",
    "dev:api": "npm run dev -w @systems-credit/api",
    "typecheck": "npm run typecheck --workspaces --if-present",
    "test": "vitest",
    "test:db": "supabase test db",
    "test:e2e": "playwright test",
    "build": "npm run build --workspaces --if-present"
  }
}
```

Install workspace dependencies with:

```bash
npm install -D typescript vitest @playwright/test
npm install -w @systems-credit/api hono zod
npm install -D -w @systems-credit/api wrangler @cloudflare/vitest-pool-workers
```

- [ ] **Step 4: Implement contracts and the health route**

```ts
// packages/contracts/src/errors.ts
export const apiErrorCodes = [
  "UNAUTHENTICATED",
  "FORBIDDEN_WORKSPACE",
  "VALIDATION_FAILED",
  "STALE_VERSION",
  "DUPLICATE_MUTATION",
  "INSUFFICIENT_BALANCE",
  "INTERNAL_ERROR",
] as const;
export type ApiErrorCode = (typeof apiErrorCodes)[number];
export type ApiErrorResponse = {
  error: { code: ApiErrorCode; message: string; requestId: string };
};
```

```ts
// workers/api/src/index.ts
import { Hono } from "hono";
const app = new Hono();
app.get("/health", (c) =>
  c.json({ ok: true as const, service: "systems-credit-api" as const }),
);
export default app;
```

Request middleware accepts a valid inbound `x-request-id` or creates a UUID. Error middleware returns `ApiErrorResponse`, includes the request ID, and logs only code, route template, HTTP status, and request ID. It must never log authorization headers, request bodies, financial amounts, notes, or receipt content.

- [ ] **Step 5: Verify scaffold quality**

Run: `npm test -- --run workers/api/test/health.test.ts workers/api/test/error-handler.test.ts && npm run typecheck && npm run build`  
Expected: all commands PASS and create no tracked build output.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.base.json vitest.workspace.ts apps workers packages .gitignore
git commit -m "build: scaffold financial PWA workspace"
```

---

### Task 2: Exact money, currency, and financial-date domain

**Files:**
- Create: `packages/domain/package.json`
- Create: `packages/domain/src/money.ts`
- Create: `packages/domain/src/currency.ts`
- Create: `packages/domain/src/financial-date.ts`
- Create: `packages/domain/src/index.ts`
- Test: `packages/domain/test/money.test.ts`
- Test: `packages/domain/test/financial-date.test.ts`

**Interfaces:**
- Produces:
  - `Money = { amount: string; currency: CurrencyCode }`
  - `parseMoney(input: Money): Decimal`
  - `roundMoney(amount: Decimal.Value, currency: CurrencyCode): string`
  - `sumMoney(items: readonly Money[]): Money`
  - `allocateMoney(total: Money, weights: readonly string[]): Money[]`
  - `toFinancialDate(utcInstant: string, timeZone: string): string`
- Consumes: none.

- [ ] **Step 1: Write failing exact-money tests**

```ts
import { describe, expect, it } from "vitest";
import { allocateMoney, roundMoney, sumMoney } from "../src";

it("sums decimal strings without binary-float drift", () => {
  expect(sumMoney([
    { amount: "0.10", currency: "THB" },
    { amount: "0.20", currency: "THB" },
  ])).toEqual({ amount: "0.30", currency: "THB" });
});

it("places allocation rounding residual on the final item", () => {
  expect(allocateMoney({ amount: "100.00", currency: "THB" }, ["1", "1", "1"]))
    .toEqual([
      { amount: "33.33", currency: "THB" },
      { amount: "33.33", currency: "THB" },
      { amount: "33.34", currency: "THB" },
    ]);
});

it("rounds half away from zero", () => {
  expect(roundMoney("1.005", "THB")).toBe("1.01");
  expect(roundMoney("-1.005", "THB")).toBe("-1.01");
});
```

- [ ] **Step 2: Verify the tests fail**

Run: `npm test -- --run packages/domain/test`  
Expected: FAIL because the domain package and functions do not exist.

- [ ] **Step 3: Implement the money boundary with decimal.js**

Install: `npm install -w @systems-credit/domain decimal.js zod`

```ts
export type CurrencyCode = "THB" | "USD" | "EUR" | "JPY" | string;
export type Money = Readonly<{ amount: string; currency: CurrencyCode }>;

export function roundMoney(value: Decimal.Value, currency: CurrencyCode): string {
  const digits = currency === "JPY" ? 0 : 2;
  return new Decimal(value).toDecimalPlaces(digits, Decimal.ROUND_HALF_UP).toFixed(digits);
}
```

Implement `sumMoney` with a same-currency guard and `allocateMoney` by rounding every allocation except the last, then assigning the exact residual to the last item.

- [ ] **Step 4: Implement timezone-safe financial dates**

Use `Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })` and normalize the parts into `YYYY-MM-DD`. Reject invalid IANA timezones with `VALIDATION_FAILED`.

- [ ] **Step 5: Run all domain checks**

Run: `npm test -- --run packages/domain/test && npm run typecheck`  
Expected: PASS, including negative rounding, mixed-currency rejection, and Asia/Bangkok date-boundary tests.

- [ ] **Step 6: Commit**

```bash
git add packages/domain package.json package-lock.json
git commit -m "feat: add exact financial domain primitives"
```

---

### Task 3: Supabase identity, private workspace, audit, and RLS foundation

**Files:**
- Create: `supabase/config.toml`
- Create: `supabase/migrations/202607260001_identity_workspaces.sql`
- Create: `supabase/migrations/202607260002_catalog_audit_rls.sql`
- Create: `supabase/tests/database/identity_rls.test.sql`
- Create: `supabase/seed.sql`
- Create: `packages/contracts/src/workspaces.ts`
- Create: `packages/contracts/src/catalog.ts`
- Create: `workers/api/src/routes/workspaces.ts`
- Create: `workers/api/src/routes/catalog.ts`
- Create: `workers/api/src/middleware/auth.ts`
- Create: `workers/api/test/workspaces.test.ts`
- Create: `workers/api/test/catalog.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `workers/api/src/index.ts`

**Interfaces:**
- Produces: tables `profiles`, `workspaces`, `workspace_members`, `categories`, `tags`, `merchants`, `audit_events`; function `create_private_workspace(p_name text, p_base_currency text, p_timezone text)`; RLS helper `is_workspace_member(uuid)`; `POST /v1/workspaces/private`; `POST /v1/categories`.
- Consumes: Supabase `auth.users`.

- [ ] **Step 1: Write the failing pgTAP authorization test**

```sql
begin;
select plan(4);
select has_table('public', 'workspaces');
select has_function(
  'public', 'create_private_workspace',
  array['text', 'text', 'text']
);
select policies_are(
  'public', 'workspaces',
  array['workspace_select_member', 'workspace_update_owner']
);
select throws_ok(
  $$ select * from public.workspaces $$,
  '42501',
  null,
  'anonymous users cannot read workspaces'
);
select * from finish();
rollback;
```

- [ ] **Step 2: Start local Supabase and verify failure**

Run: `npx supabase start && npx supabase db reset && npx supabase test db`  
Expected: FAIL because workspace tables and policies are absent.

- [ ] **Step 3: Create identity and workspace migrations**

Define enum `workspace_kind ('private','family')`, membership role enum, UUID primary keys, UTC audit timestamps, version columns, `base_currency`, `timezone`, and `numeric`-free identity tables. `create_private_workspace` must:

1. Require `auth.uid()`.
2. Reject a second active private workspace for the same user.
3. Validate `p_base_currency` and the IANA timezone, then insert the workspace.
4. Insert owner membership.
5. Insert the exact default categories below, using the stable slug as the import/export identity:
   - Income: `salary/เงินเดือน`, `bonus/โบนัส`, `freelance/งานเสริม`, `interest-income/ดอกเบี้ยรับ`, `gift-income/ของขวัญ`, `other-income/รายรับอื่น`
   - Expense: `food/อาหาร`, `groceries/ของใช้ในบ้าน`, `housing/ที่อยู่อาศัย`, `utilities/สาธารณูปโภค`, `transport/เดินทาง`, `health/สุขภาพ`, `education/การศึกษา`, `shopping/ช้อปปิ้ง`, `entertainment/บันเทิง`, `debt-interest/ดอกเบี้ยหนี้`, `financial-fees/ค่าธรรมเนียม`, `other-expense/รายจ่ายอื่น`
6. Insert an audit event.
7. Return the workspace row.

- [ ] **Step 4: Add RLS policies and security-definer safeguards**

All security-definer functions must set `search_path = public, pg_temp`, verify `auth.uid()`, and revoke public execution before granting to `authenticated`.

- [ ] **Step 5: Implement and test the authenticated workspace route**

Validate this exact body:

```ts
export const createPrivateWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(80),
  baseCurrency: z.string().regex(/^[A-Z]{3}$/).default("THB"),
  timeZone: z.string().default("Asia/Bangkok"),
});
```

`auth` middleware verifies the Supabase JWT and attaches `{ userId, accessToken }` without logging the token. Forward the caller JWT to Supabase and call `create_private_workspace`. Test success, duplicate private workspace, default categories, invalid timezone, missing authentication, expired token, and absence of the service-role key from responses. `POST /v1/categories` accepts `{ workspaceId, name, kind, parentId? }`, rejects cross-workspace parents, and enforces a unique active sibling name.

- [ ] **Step 6: Verify identity and cross-user isolation**

Run: `npm test -- --run workers/api/test/workspaces.test.ts workers/api/test/catalog.test.ts && npx supabase db reset && npx supabase test db`  
Expected: PASS for owner access, category isolation, non-member denial, anonymous denial, and audit creation.

- [ ] **Step 7: Generate and typecheck database types**

Run: `npx supabase gen types typescript --local > packages/contracts/src/database.generated.ts`  
Then run: `npm run typecheck`.

- [ ] **Step 8: Commit**

```bash
git add supabase packages/contracts workers/api
git commit -m "feat: add private workspaces and RLS foundation"
```

---

### Task 4: Account definitions and zero-balance creation

**Files:**
- Create: `supabase/migrations/202607260003_accounts.sql`
- Create: `supabase/tests/database/accounts_rls.test.sql`
- Create: `packages/contracts/src/accounts.ts`
- Create: `packages/domain/src/accounts.ts`
- Test: `packages/domain/test/accounts.test.ts`
- Create: `workers/api/src/routes/accounts.ts`
- Create: `workers/api/test/accounts.test.ts`
- Modify: `workers/api/src/index.ts`

**Interfaces:**
- Produces:
  - `AccountType = "cash" | "bank" | "ewallet" | "credit_card" | "loan" | "asset"`
  - `CreateAccountInput`
  - `POST /v1/accounts`
  - PostgreSQL function `create_account(...)`
  - `normalizeAccountKind(type: AccountType): { normalBalance: "debit" | "credit"; liquid: boolean; liability: boolean }`
- Consumes: workspace membership and audit events.

- [ ] **Step 1: Write failing account-domain and API tests**

```ts
it("requires liability behavior for credit-card accounts", () => {
  expect(normalizeAccountKind("credit_card")).toEqual({
    normalBalance: "credit",
    liquid: false,
    liability: true,
  });
});
```

```ts
it("rejects creating an account in another user's workspace", async () => {
  const response = await authenticatedAppRequest("POST", "/v1/accounts", outsiderToken, {
    workspaceId: ownerWorkspaceId,
    name: "Hidden account",
    type: "bank",
    currency: "THB",
  });
  expect(response.status).toBe(403);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- --run packages/domain/test/accounts.test.ts workers/api/test/accounts.test.ts`  
Expected: FAIL because account contracts and route are absent.

- [ ] **Step 3: Add account schema and zero-balance creation function**

Create `accounts` with workspace, owner, type, currency, archived state, and record version. `create_account` creates account metadata only and therefore starts at zero. Do not add an opening-balance column; Task 5 adds the transactional opening-balance mutation after transaction tables exist.

- [ ] **Step 4: Implement the authenticated account route**

Validate the body with Zod, forward the caller JWT to Supabase, call `create_account`, and map PostgreSQL permission errors to `FORBIDDEN_WORKSPACE`. The Task 4 request does not accept `openingBalance`.

- [ ] **Step 5: Run domain, API, database, and type tests**

Run: `npm test -- --run packages/domain/test/accounts.test.ts workers/api/test/accounts.test.ts && npx supabase test db && npm run typecheck`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase packages workers
git commit -m "feat: add account definitions"
```

---

### Task 5: Posted transactions, splits, revisions, and account balances

**Files:**
- Create: `supabase/migrations/202607260004_transactions.sql`
- Create: `supabase/tests/database/transactions.test.sql`
- Create: `packages/contracts/src/transactions.ts`
- Create: `packages/domain/src/transactions.ts`
- Test: `packages/domain/test/transactions.test.ts`
- Create: `workers/api/src/routes/transactions.ts`
- Create: `workers/api/src/services/mutations.ts`
- Create: `workers/api/test/transactions.test.ts`
- Modify: `packages/contracts/src/accounts.ts`
- Modify: `workers/api/src/routes/accounts.ts`
- Modify: `workers/api/test/accounts.test.ts`
- Modify: `workers/api/src/index.ts`

**Interfaces:**
- Produces:
  - `TransactionType`, `TransactionState`, `TransactionSplitInput`
  - `CreateTransactionInput`
  - `CreateAccountWithOpeningBalanceInput = CreateAccountInput & { openingBalance: string }`
  - `POST /v1/transactions`
  - `POST /v1/transactions/:id/void`
  - PostgreSQL functions `post_transaction(jsonb)`, `void_transaction(uuid, integer, text)`, and `create_account_with_opening_balance(jsonb)`
  - view `account_balances`
  - `validateSplits(total: Money, splits: readonly { amount: string }[]): void`
  - `postingEffect(type: TransactionType, accountType: AccountType, amount: Money): PostingEffect`
- Consumes: `Money`, accounts, membership, audit events, mutation key.

- [ ] **Step 1: Write failing split and double-counting tests**

```ts
it("requires split totals to equal the transaction total", () => {
  expect(() => validateSplits(
    { amount: "100.00", currency: "THB" },
    [{ amount: "60.00" }, { amount: "39.99" }],
  )).toThrow("SPLIT_TOTAL_MISMATCH");
});

it("classifies a credit-card purchase as expense plus liability", () => {
  expect(postingEffect(
    "expense",
    "credit_card",
    { amount: "100.00", currency: "THB" },
  )).toEqual({
    expense: "100.00",
    cashFlow: "0.00",
    liabilityIncrease: "100.00",
  });
});
```

- [ ] **Step 2: Verify tests fail**

Run: `npm test -- --run packages/domain/test/transactions.test.ts workers/api/test/transactions.test.ts`  
Expected: FAIL because the transaction model does not exist.

- [ ] **Step 3: Add transaction schema**

Create transaction, split, and transaction-tag tables with exact numeric columns, source/base currency fields, financial date, UTC timestamps, state, version, creator, void metadata, and indexes by workspace/date/account/state. `post_transaction` must validate account ownership, category kind, tag/merchant workspace, split reconciliation, currency, mutation uniqueness, and state before atomically writing records and audit history. It may create a normalized merchant or tag from user-entered text only inside the caller's workspace.

- [ ] **Step 4: Add explicit opening balances now that transactions exist**

Extend `POST /v1/accounts` to accept `openingBalance` as a decimal string. `create_account_with_opening_balance` creates the account and, when the amount is non-zero, a posted `balance_adjustment` transaction in the same database transaction. A failure in either write rolls back both.

- [ ] **Step 5: Implement route and stable response**

```ts
export type PostedTransactionResponse = {
  transactionId: string;
  version: number;
  state: "posted";
  accountBalances: Array<{ accountId: string; amount: string; currency: string }>;
};
```

Return the authoritative calculated balances; do not trust client totals.

- [ ] **Step 6: Test income, cash expense, card expense, opening balance, split, stale version, and void**

Run: `npm test -- --run packages/domain/test/transactions.test.ts workers/api/test/transactions.test.ts && npx supabase test db`  
Expected: PASS and every failed mutation leaves zero partial rows.

- [ ] **Step 7: Commit**

```bash
git add supabase packages workers
git commit -m "feat: add posted transactions and splits"
```

---

### Task 6: Atomic same- and cross-currency transfers

**Files:**
- Create: `supabase/migrations/202607260005_transfers.sql`
- Create: `supabase/tests/database/transfers.test.sql`
- Create: `packages/contracts/src/transfers.ts`
- Create: `packages/domain/src/transfers.ts`
- Test: `packages/domain/test/transfers.test.ts`
- Create: `workers/api/src/routes/transfers.ts`
- Create: `workers/api/test/transfers.test.ts`
- Modify: `workers/api/src/index.ts`

**Interfaces:**
- Produces: `CreateTransferInput`, `POST /v1/transfers`, function `post_transfer(jsonb)`, `transfer_links`, and `transferReportEffect(input: TransferEffectInput): { income: string; expense: string; cashFlow: string }`.
- Consumes: accounts, exact money, posted transactions, idempotency key.

- [ ] **Step 1: Write failing transfer tests**

```ts
it("excludes both transfer legs from income and expense", () => {
  expect(transferReportEffect({
    source: { amount: "1000.00", currency: "THB" },
    destination: { amount: "1000.00", currency: "THB" },
    fee: { amount: "0.00", currency: "THB" },
  })).toEqual({ income: "0.00", expense: "0.00", cashFlow: "0.00" });
});
```

Add database tests proving both legs roll back when the destination account is forbidden.

- [ ] **Step 2: Verify failure**

Run: `npm test -- --run packages/domain/test/transfers.test.ts workers/api/test/transfers.test.ts && npx supabase test db`  
Expected: FAIL for missing transfer implementation.

- [ ] **Step 3: Implement atomic transfer posting**

For same currency, require equal source and destination amounts. For cross-currency, require both amounts and a positive stored exchange rate. Record a separate expense split for a fee; the two principal legs remain excluded from income/expense.

- [ ] **Step 4: Verify balances and reports**

Run: `npm test -- --run packages/domain/test/transfers.test.ts workers/api/test/transfers.test.ts && npx supabase test db`  
Expected: PASS for same currency, cross currency, fee, duplicate mutation, and rollback.

- [ ] **Step 5: Commit**

```bash
git add supabase packages workers
git commit -m "feat: add atomic account transfers"
```

---

### Task 7: Web authentication, onboarding, account management, and app shell

**Files:**
- Create: `apps/web/src/app/router.tsx`
- Create: `apps/web/src/app/providers.tsx`
- Create: `apps/web/src/app/layout.tsx`
- Create: `apps/web/src/lib/supabase.ts`
- Create: `apps/web/src/features/auth/sign-in-page.tsx`
- Create: `apps/web/src/features/auth/session-guard.tsx`
- Create: `apps/web/src/features/onboarding/onboarding-page.tsx`
- Create: `apps/web/src/features/accounts/accounts-page.tsx`
- Create: `apps/web/src/features/accounts/account-form.tsx`
- Create: `apps/web/src/test/render.tsx`
- Test: `apps/web/src/features/onboarding/onboarding-page.test.tsx`
- Test: `apps/web/src/features/accounts/account-form.test.tsx`

**Interfaces:**
- Produces: routes `/sign-in`, `/onboarding`, `/overview`, `/accounts`; `SessionGuard`; `AccountForm`.
- Consumes: Supabase Auth, workspace and account contracts, `POST /v1/accounts`.

- [ ] **Step 1: Write failing onboarding test**

```tsx
it("creates a THB private workspace before showing account setup", async () => {
  renderApp(<OnboardingPage />);
  await user.type(screen.getByLabelText("ชื่อพื้นที่ส่วนตัว"), "การเงินของฉัน");
  await user.click(screen.getByRole("button", { name: "สร้างพื้นที่" }));
  expect(api.createPrivateWorkspace).toHaveBeenCalledWith({
    name: "การเงินของฉัน",
    baseCurrency: "THB",
    timeZone: "Asia/Bangkok",
  });
});
```

- [ ] **Step 2: Verify component tests fail**

Run: `npm test -- --run apps/web/src/features/onboarding apps/web/src/features/accounts`  
Expected: FAIL because pages and providers are absent.

- [ ] **Step 3: Create the React/Vite app and providers**

Install React, React Router, TanStack Query, Supabase JS, Zod, Testing Library, and user-event. Configure the router so unauthenticated users reach only `/sign-in`; authenticated users without a private workspace reach `/onboarding`.

- [ ] **Step 4: Implement accessible Thai forms**

Account form fields: name, type, currency, opening balance, and optional institution. Use labels, inline validation, submit busy state, and API error summary. Never convert amount strings through `Number`.

- [ ] **Step 5: Run component, accessibility, and type tests**

Run: `npm test -- --run apps/web/src/features/onboarding apps/web/src/features/accounts && npm run typecheck`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web package.json package-lock.json
git commit -m "feat: add authentication and account onboarding UI"
```

---

### Task 8: Transaction entry, history, and dashboard basics

**Files:**
- Create: `apps/web/src/features/transactions/transaction-form.tsx`
- Create: `apps/web/src/features/transactions/transaction-list.tsx`
- Create: `apps/web/src/features/transactions/transactions-page.tsx`
- Create: `apps/web/src/features/transactions/split-editor.tsx`
- Create: `apps/web/src/features/transactions/category-manager.tsx`
- Create: `apps/web/src/features/dashboard/overview-page.tsx`
- Create: `apps/web/src/features/dashboard/summary-cards.tsx`
- Create: `apps/web/src/features/dashboard/upcoming-review.tsx`
- Create: `apps/web/src/features/transactions/transaction-form.test.tsx`
- Create: `apps/web/src/features/transactions/category-manager.test.tsx`
- Create: `apps/web/src/features/dashboard/overview-page.test.tsx`
- Create: `supabase/migrations/202607260006_core_reports.sql`
- Create: `supabase/tests/database/core_reports.test.sql`

**Interfaces:**
- Produces: routes `/transactions`, `/transactions/new`, `/overview`; views/functions `monthly_cash_summary` and `category_expense_summary`.
- Consumes: transaction/account contracts, exact money display, Worker transaction route.

- [ ] **Step 1: Write failing quick-entry test**

```tsx
it("submits the original decimal string and never a JavaScript float", async () => {
  renderApp(<TransactionForm type="expense" />);
  await user.type(screen.getByLabelText("จำนวนเงิน"), "1250.50");
  await user.selectOptions(screen.getByLabelText("กระเป๋า"), cashAccountId);
  await user.click(screen.getByRole("button", { name: "บันทึกรายจ่าย" }));
  expect(api.postTransaction).toHaveBeenCalledWith(expect.objectContaining({
    amount: "1250.50",
    currency: "THB",
  }));
});
```

- [ ] **Step 2: Verify UI and report tests fail**

Run: `npm test -- --run apps/web/src/features/transactions apps/web/src/features/dashboard && npx supabase test db`  
Expected: FAIL because pages and report functions are absent.

- [ ] **Step 3: Implement transaction entry and split editor**

Support income, expense, and transfer shortcuts; amount, date, account, category, merchant, note, tags, visibility, and splits. Keep transfer submission on the transfer endpoint. Category manager lists defaults, creates custom categories through `POST /v1/categories`, and archives custom categories without removing them from historical transactions.

- [ ] **Step 4: Implement bounded dashboard queries**

Dashboard defaults to the current month and selected liquid accounts. Available money excludes liabilities, credit limits, archived accounts, and restricted assets. Query posted records only.

- [ ] **Step 5: Verify UI, report totals, and loading/error states**

Run: `npm test -- --run apps/web/src/features/transactions apps/web/src/features/dashboard && npx supabase test db && npm run typecheck`  
Expected: PASS for empty, loading, posted data, failed query, and excluded transfer cases.

- [ ] **Step 6: Commit**

```bash
git add apps/web supabase
git commit -m "feat: add transaction entry and dashboard basics"
```

---

### Task 9: Offline drafts, idempotent outbox, and conflict review

**Files:**
- Create: `apps/web/src/offline/database.ts`
- Create: `apps/web/src/offline/outbox.ts`
- Create: `apps/web/src/offline/sync-engine.ts`
- Create: `apps/web/src/offline/sync-status.tsx`
- Create: `apps/web/src/offline/conflict-dialog.tsx`
- Test: `apps/web/src/offline/sync-engine.test.ts`
- Create: `supabase/migrations/202607260007_sync_mutations.sql`
- Create: `supabase/tests/database/sync_mutations.test.sql`
- Create: `workers/api/src/routes/mutations.ts`
- Create: `workers/api/test/mutations.test.ts`
- Modify: `workers/api/src/index.ts`

**Interfaces:**
- Produces:
  - Dexie tables `drafts`, `outbox`, `receiptQueue`, `cachedRecords`
  - `enqueueMutation(input): Promise<string>`
  - `flushOutbox(): Promise<SyncSummary>`
  - `POST /v1/mutations`
  - database table `sync_mutations`
- Consumes: transaction endpoints, client mutation ID, record version.

- [ ] **Step 1: Write failing uncertain-retry and conflict tests**

```ts
it("retries an uncertain request with the same mutation id", async () => {
  server.failAfterCommitOnce();
  await enqueueMutation(exampleExpense);
  await flushOutbox();
  await flushOutbox();
  expect(server.postedTransactionCount()).toBe(1);
});

it("marks a stale record as conflict instead of overwriting", async () => {
  server.respondWith({ error: { code: "STALE_VERSION" } }, 409);
  const result = await flushOutbox();
  expect(result.conflicts).toHaveLength(1);
});
```

- [ ] **Step 2: Verify failure**

Run: `npm test -- --run apps/web/src/offline workers/api/test/mutations.test.ts`  
Expected: FAIL because the outbox and mutation endpoint are absent.

- [ ] **Step 3: Implement Dexie outbox and server idempotency**

Persist the full mutation body, UUID mutation key, base record version, attempt count, and safe last error. The server inserts the mutation key before returning and returns the stored result for an identical retry.

- [ ] **Step 4: Implement visible status and conflict resolution**

Statuses are `saved`, `queued`, `syncing`, `failed`, and `conflict`. Conflict UI shows local and server values and creates a new mutation only after the user chooses local, server, or merged values.

- [ ] **Step 5: Verify duplicate, offline restart, logout purge, and conflict tests**

Run: `npm test -- --run apps/web/src/offline workers/api/test/mutations.test.ts && npx supabase test db`  
Expected: PASS and no test uses silent last-write-wins.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/offline workers/api supabase
git commit -m "feat: add idempotent offline synchronization"
```

---

### Task 10: Private receipt attachments without OCR

**Files:**
- Create: `supabase/migrations/202607260008_receipt_storage.sql`
- Create: `supabase/tests/database/receipt_storage.test.sql`
- Create: `packages/contracts/src/receipts.ts`
- Create: `apps/web/src/features/receipts/image-preprocessor.ts`
- Create: `apps/web/src/features/receipts/receipt-attachment.tsx`
- Test: `apps/web/src/features/receipts/image-preprocessor.test.ts`
- Create: `workers/api/src/routes/receipts.ts`
- Create: `workers/api/test/receipts.test.ts`
- Modify: `workers/api/src/index.ts`

**Interfaces:**
- Produces: private `receipts` bucket, `attachments` table, `POST /v1/receipts/upload-request`, `GET /v1/receipts/:id/view-url`.
- Consumes: authenticated workspace access and transaction ownership.

- [ ] **Step 1: Write failing image and authorization tests**

```ts
it("rejects files larger than the pre-compression limit", async () => {
  await expect(preprocessReceipt(makeImageFile(21 * 1024 * 1024)))
    .rejects.toThrow("RECEIPT_TOO_LARGE");
});
```

Add Worker tests proving a non-owner cannot obtain a signed URL and that returned view URLs have short expiry.

- [ ] **Step 2: Verify failure**

Run: `npm test -- --run apps/web/src/features/receipts workers/api/test/receipts.test.ts`  
Expected: FAIL because preprocessing and routes are absent.

- [ ] **Step 3: Implement client preprocessing and private upload**

Accept JPEG, PNG, and HEIC only when browser decoding is available. Correct orientation, constrain the longest edge to 2000 px, encode JPEG/WebP under 2 MB where possible, and preserve the original only in the temporary offline queue.

- [ ] **Step 4: Implement storage policies and signed access**

Object keys use `workspace_id/user_id/attachment_id.ext`. Database membership and transaction ownership are checked before generating a signed URL. The bucket is never public.

- [ ] **Step 5: Verify upload, expiry, offline queue, and denial**

Run: `npm test -- --run apps/web/src/features/receipts workers/api/test/receipts.test.ts && npx supabase test db`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/receipts workers/api supabase packages/contracts
git commit -m "feat: add private receipt attachments"
```

---

### Task 11: Portable CSV/JSON export and validated empty-workspace restore

**Files:**
- Create: `packages/contracts/src/export.ts`
- Create: `workers/api/src/routes/export.ts`
- Create: `workers/api/src/services/export-service.ts`
- Create: `workers/api/src/services/restore-service.ts`
- Create: `workers/api/test/export-restore.test.ts`
- Create: `apps/web/src/features/export/export-page.tsx`
- Create: `apps/web/src/features/export/restore-preview.tsx`
- Test: `apps/web/src/features/export/restore-preview.test.tsx`
- Create: `supabase/migrations/202607260009_restore.sql`
- Create: `supabase/tests/database/restore.test.sql`
- Create: `docs/runbooks/export-restore.md`

**Interfaces:**
- Produces: `GET /v1/export.json`, `GET /v1/transactions.csv`, `POST /v1/restore/preview`, `POST /v1/restore/commit`.
- Consumes: all Phase 1 logical tables, RLS, mutation keys.

- [ ] **Step 1: Write failing round-trip test**

```ts
it("restores an exported workspace with identical balances", async () => {
  const archive = await exportWorkspace(sourceWorkspaceId);
  const preview = await previewRestore(emptyWorkspaceId, archive);
  expect(preview.errors).toEqual([]);
  await commitRestore(emptyWorkspaceId, archive, preview.restoreToken);
  expect(await balances(emptyWorkspaceId)).toEqual(await balances(sourceWorkspaceId));
});
```

- [ ] **Step 2: Verify failure**

Run: `npm test -- --run workers/api/test/export-restore.test.ts apps/web/src/features/export && npx supabase test db`  
Expected: FAIL because export and restore do not exist.

- [ ] **Step 3: Implement versioned export**

Use manifest version `1`, stable entity ordering, original UUIDs inside the archive, ISO dates, decimal strings, and a SHA-256 content digest. CSV uses UTF-8 with a header row and original/base amounts.

- [ ] **Step 4: Implement preview and atomic restore**

Restore only into an empty private workspace. Preview validates schema version, digest, references, currencies, split totals, and ownership. Commit maps imported IDs to new IDs inside one transaction and records an audit event.

- [ ] **Step 5: Verify round trip, corrupt digest, duplicate request, and rollback**

Run: `npm test -- --run workers/api/test/export-restore.test.ts apps/web/src/features/export && npx supabase test db`  
Expected: PASS and a failed restore leaves the destination empty.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts workers/api apps/web/src/features/export supabase docs/runbooks/export-restore.md
git commit -m "feat: add portable export and restore"
```

---

### Task 12: Installable PWA, end-to-end acceptance, deployment, and operations

**Files:**
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/public/manifest.webmanifest`
- Create: `apps/web/src/app/update-prompt.tsx`
- Create: `playwright.config.ts`
- Create: `tests/e2e/onboarding-transactions.spec.ts`
- Create: `tests/e2e/offline-sync.spec.ts`
- Create: `tests/e2e/private-data.spec.ts`
- Create: `tests/e2e/export-restore.spec.ts`
- Create: `tests/e2e/helpers.ts`
- Create: `wrangler.toml`
- Create: `docs/runbooks/local-development.md`
- Create: `docs/runbooks/deployment.md`
- Create: `docs/runbooks/free-tier-monitoring.md`
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: installable PWA, production Worker/Pages configuration, repeatable CI, and Phase 1 acceptance evidence.
- Consumes: every Phase 1 interface.

- [ ] **Step 1: Write failing Playwright acceptance journey**

```ts
test("user onboards, records money, transfers, and exports", async ({ page }) => {
  await signUpAndCreatePrivateWorkspace(page);
  await createAccount(page, { name: "เงินสด", type: "cash", opening: "5000.00" });
  await createExpense(page, { amount: "125.50", category: "อาหาร" });
  await expect(page.getByText("4,874.50")).toBeVisible();
  await page.getByRole("link", { name: "ส่งออกข้อมูล" }).click();
  const download = await page.waitForEvent("download");
  await page.getByRole("button", { name: "ดาวน์โหลด JSON" }).click();
  expect(await download.suggestedFilename()).toMatch(/finance-export.*\.json/);
});
```

Define these helpers in `tests/e2e/helpers.ts` with typed input objects: `signUpAndCreatePrivateWorkspace(page)`, `createAccount(page, input)`, and `createExpense(page, input)`. Each helper waits for the authoritative success state rather than an arbitrary timeout.

- [ ] **Step 2: Verify acceptance tests fail**

Run: `npm run test:e2e -- onboarding-transactions.spec.ts`  
Expected: FAIL because PWA/deployment test configuration is absent.

- [ ] **Step 3: Add PWA manifest, service worker, and update flow**

Use Workbox to precache the app shell only. Financial API responses are not blindly cached by the service worker; bounded recent data lives in IndexedDB. Show an explicit “มีเวอร์ชันใหม่” update prompt.

- [ ] **Step 4: Add full acceptance and privacy journeys**

Cover:

- Install and reload offline.
- Queue an expense, restart, reconnect, and post once.
- Same retry after uncertain response posts once.
- User B cannot access User A workspace or receipt.
- Transfer does not change income or expense totals.
- Credit-card payment does not duplicate expense.
- Export and empty-workspace restore reconcile balances.

- [ ] **Step 5: Configure CI**

CI jobs:

1. Install from `package-lock.json`.
2. Typecheck.
3. Unit/component/Worker tests.
4. Start local Supabase and run pgTAP.
5. Build web and Worker.
6. Run Playwright against local services.
7. Upload test reports on failure without environment secrets.

- [ ] **Step 6: Configure Cloudflare and Supabase deployment**

Document environment variables by name only:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `APP_ORIGIN`

Set Worker secrets through Wrangler, never committed files. Document Pages build command `npm run build -w @systems-credit/web` and output directory `apps/web/dist`.

- [ ] **Step 7: Run the Phase 1 release gate**

Run:

```bash
npm ci
npm run typecheck
npm test -- --run
npx supabase db reset
npx supabase test db
npm run build
npm run test:e2e
git status --short
```

Expected: every command PASS, `git status --short` shows only intentional plan/execution changes, Playwright verifies the manifest and active service worker, and `rg "SUPABASE_SERVICE_ROLE_KEY|service_role" apps/web/dist` returns no match.

- [ ] **Step 8: Commit**

```bash
git add apps/web tests playwright.config.ts wrangler.toml docs/runbooks .github/workflows/ci.yml
git commit -m "feat: complete deployable financial core PWA"
```

## Phase 1 completion checklist

- [ ] Authentication and private-workspace RLS pass cross-user tests.
- [ ] Opening balances are explicit posted adjustments.
- [ ] Income, expense, card purchase, split, void, and transfer reconcile.
- [ ] Transfers are excluded from income and expenses.
- [ ] Money never passes through JavaScript binary floating point.
- [ ] Offline retry is idempotent and conflicts require user review.
- [ ] Receipt attachments remain private.
- [ ] Export and empty-workspace restore round-trip successfully.
- [ ] PWA installs, opens offline, and visibly synchronizes.
- [ ] Cloudflare/Supabase deployment and monitoring runbooks are complete.

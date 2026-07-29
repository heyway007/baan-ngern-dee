# Monthly Budget and Savings Goals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one financial-planning page with category budgets, explicit positive and negative monthly rollover, unbudgeted-spending visibility, and savings goals whose progress follows real account balances.

**Architecture:** Add planning contracts and pure domain calculations, then place persistence behind a focused `PlanningRepository` rather than enlarging the existing finance repository. Supabase RPCs calculate historical rollover from posted base-currency expense data, while the Worker provides authenticated planning routes and the React page consumes one calculated month response.

**Tech Stack:** TypeScript 5.8, Zod, decimal.js through the existing money helpers, Hono, React 19, React Router, Vitest, Testing Library, PostgreSQL/Supabase RLS and RPC, PGlite, Cloudflare Workers.

## Global Constraints

- Transactions and account balances remain the financial source of truth.
- Both positive surplus and negative overspending roll into the following month.
- The interface must label carry as `ยอดยกมาจากเดือนก่อน` and explain that it is accumulated from prior months.
- Voided transactions, income, balance adjustments, opening balances, and transfers do not count as budget spending.
- Transfer-fee expense transactions count normally.
- Savings progress reads the actual linked-account balance and can decrease after money leaves the account.
- One account can have only one active savings goal.
- Eligible goal accounts are `cash`, `bank`, `ewallet`, and `asset`, in workspace base currency.
- Owners and editors can mutate plans; viewers are read-only.
- No live exchange-rate, notification, investment-projection, or shared-contribution work is included.
- Do not expose a Supabase service-role credential to the browser.

---

## File Structure

### New files

- `packages/contracts/src/planning.ts` — all planning inputs, stored models, calculated response schemas, and inferred public types.
- `packages/contracts/test/planning.test.ts` — contract validation and cross-field invariants.
- `packages/domain/src/planning.ts` — pure category rollover and savings-progress calculations used by the memory adapter and unit tests.
- `packages/domain/test/planning.test.ts` — deterministic positive/negative carry, split spending, and goal progress tests.
- `supabase/migrations/202607290019_financial_planning.sql` — planning tables, constraints, RLS, RPCs, audit writes, calculated plan function, and snapshot extension.
- `workers/api/src/services/planning-repository.ts` — focused repository interface and in-memory implementation.
- `workers/api/src/services/supabase-planning-repository.ts` — Supabase RPC adapter and response parsing.
- `workers/api/src/routes/planning.ts` — authenticated planning HTTP routes.
- `workers/api/test/planning.test.ts` — route validation, authorization behavior delegated to the repository, and response status tests.
- `workers/api/test/planning-database.test.ts` — PGlite persistence, RLS, rollover, spending, and goal-balance integration tests.
- `apps/web/src/features/planning/planning-page.tsx` — month loading, refresh orchestration, error/empty state, and combined page layout.
- `apps/web/src/features/planning/planning-page.test.tsx` — integrated page behavior, role mode, retry, and mutation refresh tests.
- `apps/web/src/features/planning/budget-panel.tsx` — budget summary, category rows, unbudgeted group, and allocation editor.
- `apps/web/src/features/planning/budget-panel.test.tsx` — visible provenance, warning states, and edit/remove behavior.
- `apps/web/src/features/planning/savings-goals-panel.tsx` — goal cards, eligible-account form, edit, and archive behavior.
- `apps/web/src/features/planning/savings-goals-panel.test.tsx` — account filtering, progress, completed state, and archived-account warning.

### Existing files to modify

- `packages/contracts/src/index.ts` — export planning contracts.
- `packages/contracts/src/finance-snapshot.ts` — append raw budget allocations and savings goals to snapshot version 1.
- `packages/contracts/test/finance-snapshot.test.ts` — cover the two new snapshot arrays.
- `packages/domain/src/index.ts` — export planning calculations.
- `workers/api/src/app.ts` — accept/mount the planning repository and routes.
- `workers/api/src/index.ts` — construct the Supabase planning repository.
- `workers/api/src/services/finance-repository.ts` — return empty planning arrays from the memory finance snapshot.
- `workers/api/src/services/supabase-finance-repository.ts` — parse the extended finance snapshot through the updated contract.
- `workers/api/test/finance-snapshot-database.test.ts` — verify planning rows appear in the snapshot.
- `workers/api/test/supabase-adapters.test.ts` — verify planning RPC names and argument mapping.
- `package.json` — include the planning database test in `test:db`.
- `apps/web/src/lib/finance-api.ts` — add planning operations to `FinanceApi`.
- `apps/web/src/lib/remote-finance-api.ts` — call planning routes and parse every response.
- `apps/web/src/lib/remote-finance-api.test.ts` — cover planning URLs, bodies, and schemas.
- `apps/web/src/app/router.tsx` — mount `/planning`.
- `apps/web/src/app/router.test.tsx` — prove authenticated routing reaches the planning page.
- `apps/web/src/app/layout.tsx` — add `แผนการเงิน` navigation.
- `apps/web/src/app/layout.test.tsx` — cover desktop and mobile navigation.
- `apps/web/src/styles.css` — responsive planning summary, table/card, dialog, goal, warning, and progress styles.
- `apps/web/src/styles.test.ts` — assert critical planning layout and 44px action targets.
- Finance snapshot fixtures in existing web/Worker tests — add `budgetAllocations: []` and `savingsGoals: []` where a strict `FinanceSnapshot` literal is constructed.

---

### Task 1: Define Planning Contracts and Extend the Snapshot

**Files:**
- Create: `packages/contracts/src/planning.ts`
- Create: `packages/contracts/test/planning.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/finance-snapshot.ts`
- Modify: `packages/contracts/test/finance-snapshot.test.ts`
- Modify snapshot fixtures returned by `rg -l "recurringOccurrences:" apps packages workers --glob "*.ts" --glob "*.tsx"`

**Interfaces:**
- Consumes: existing UUID, currency, calendar-month, money-string, and optimistic-version conventions.
- Produces:
  - `MonthlyBudgetAllocation`
  - `SavingsGoal`
  - `FinancialPlan`
  - `InitializeBudgetMonthInput`
  - `SetMonthlyBudgetInput`
  - `RemoveMonthlyBudgetInput`
  - `CreateSavingsGoalInput`
  - `UpdateSavingsGoalInput`
  - `ArchiveSavingsGoalInput`
  - the corresponding exported Zod schemas.

- [ ] **Step 1: Write failing contract tests**

```ts
it("accepts a calculated plan with negative carry", () => {
  expect(financialPlanSchema.parse({
    workspaceId,
    month: "2026-08",
    currency: "THB",
    totals: {
      baseBudget: "10000.00",
      priorCarry: "-1000.00",
      available: "9000.00",
      spent: "2500.00",
      remaining: "6500.00"
    },
    categories: [{
      categoryId,
      categoryName: "อาหาร",
      allocationId,
      allocationVersion: 2,
      isBudgeted: true,
      baseBudget: "10000.00",
      priorCarry: "-1000.00",
      available: "9000.00",
      spent: "2500.00",
      remaining: "6500.00"
    }],
    goals: []
  })).toMatchObject({
    totals: { priorCarry: "-1000.00" }
  });
});

it("rejects a goal linked to a debt account type", () => {
  expect(() => savingsGoalSchema.parse({
    id: goalId,
    workspaceId,
    name: "เงินฉุกเฉิน",
    targetAmount: "50000.00",
    currency: "THB",
    accountId,
    accountType: "loan",
    status: "active",
    version: 1
  })).toThrow();
});
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `npm test -- --run packages/contracts/test/planning.test.ts packages/contracts/test/finance-snapshot.test.ts`

Expected: FAIL because `planning.ts`, `financialPlanSchema`, and the snapshot fields do not exist.

- [ ] **Step 3: Implement strict planning schemas**

Define the public shapes with these exact fields:

```ts
export const monthlyBudgetAllocationSchema = z.object({
  id: uuidSchema,
  workspaceId: uuidSchema,
  categoryId: uuidSchema,
  month: monthSchema,
  amount: unsignedMoneySchema,
  removedAt: timestampSchema.optional(),
  version: versionSchema
}).strict();

export const savingsGoalSchema = z.object({
  id: uuidSchema,
  workspaceId: uuidSchema,
  name: z.string().trim().min(1).max(100),
  targetAmount: positiveMoneySchema,
  currency: currencySchema,
  targetDate: dateSchema.optional(),
  accountId: uuidSchema,
  accountType: z.enum(["cash", "bank", "ewallet", "asset"]),
  status: z.enum(["active", "archived"]),
  version: versionSchema
}).strict();

export const budgetCategoryPlanSchema = z.object({
  categoryId: uuidSchema,
  categoryName: z.string().min(1),
  allocationId: uuidSchema.optional(),
  allocationVersion: versionSchema.optional(),
  isBudgeted: z.boolean(),
  baseBudget: signedMoneySchema,
  priorCarry: signedMoneySchema,
  available: signedMoneySchema,
  spent: signedMoneySchema,
  remaining: signedMoneySchema
}).strict();

export const savingsGoalProgressSchema = z.object({
  id: uuidSchema,
  name: z.string().min(1),
  accountId: uuidSchema,
  accountName: z.string().min(1),
  currentAmount: unsignedMoneySchema,
  targetAmount: positiveMoneySchema,
  currency: currencySchema,
  targetDate: dateSchema.optional(),
  percent: z.number().min(0).max(100),
  reached: z.boolean(),
  accountArchived: z.boolean(),
  status: z.enum(["active", "archived"]),
  version: versionSchema
}).strict();

const budgetTotalsSchema = z.object({
  baseBudget: signedMoneySchema,
  priorCarry: signedMoneySchema,
  available: signedMoneySchema,
  spent: signedMoneySchema,
  remaining: signedMoneySchema
}).strict();

export const financialPlanSchema = z.object({
  workspaceId: uuidSchema,
  month: monthSchema,
  currency: currencySchema,
  totals: budgetTotalsSchema,
  categories: z.array(budgetCategoryPlanSchema),
  goals: z.array(savingsGoalProgressSchema)
}).strict();
```

Define mutation schemas with these exact shapes:

```ts
export const initializeBudgetMonthSchema = z.object({
  workspaceId: uuidSchema,
  month: monthSchema
}).strict();

export const initializeBudgetMonthResultSchema = z.object({
  createdCount: z.number().int().nonnegative()
}).strict();

export const setMonthlyBudgetSchema = z.object({
  workspaceId: uuidSchema,
  categoryId: uuidSchema,
  month: monthSchema,
  amount: positiveMoneySchema,
  version: versionSchema.optional()
}).strict();

export const removeMonthlyBudgetSchema = z.object({
  version: versionSchema
}).strict();

export const createSavingsGoalSchema = z.object({
  workspaceId: uuidSchema,
  name: z.string().trim().min(1).max(100),
  targetAmount: positiveMoneySchema,
  currency: currencySchema,
  targetDate: dateSchema.optional(),
  accountId: uuidSchema
}).strict();

export const updateSavingsGoalSchema = z.object({
  name: z.string().trim().min(1).max(100),
  targetAmount: positiveMoneySchema,
  currency: currencySchema,
  targetDate: dateSchema.optional(),
  accountId: uuidSchema,
  version: versionSchema
}).strict();

export const archiveSavingsGoalSchema = z.object({
  version: versionSchema
}).strict();
```

The missing budget version means create or reactivate a never-edited row,
while a supplied version means update with optimistic locking. Require
strictly positive amounts for set/create/update inputs. Remove/archive always
requires a positive version.

Append these strict arrays to `financeSnapshotSchema`:

```ts
budgetAllocations: z.array(monthlyBudgetAllocationSchema),
savingsGoals: z.array(savingsGoalSchema)
```

Add `budgetAllocations: []` and `savingsGoals: []` to every existing strict
snapshot fixture, then export all planning schemas and types from
`packages/contracts/src/index.ts`.

- [ ] **Step 4: Run contract tests and typecheck**

Run: `npm test -- --run packages/contracts/test/planning.test.ts packages/contracts/test/finance-snapshot.test.ts`

Expected: PASS.

Run: `npm run typecheck -w @systems-credit/contracts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- packages/contracts/src/planning.ts packages/contracts/src/index.ts packages/contracts/src/finance-snapshot.ts packages/contracts/test/planning.test.ts packages/contracts/test/finance-snapshot.test.ts apps/web/src/app/router.test.tsx apps/web/src/app/cloud-state.test.ts apps/web/src/lib/remote-finance-api.test.ts apps/web/src/features/dashboard/overview-page.test.tsx apps/web/src/features/transactions/transactions-page.test.tsx apps/web/src/features/installments/installments-page.test.tsx apps/web/src/features/recurring/recurring-page.test.tsx workers/api/src/services/finance-repository.ts workers/api/test/finance-snapshot-database.test.ts workers/api/test/recurring.test.ts workers/api/test/supabase-adapters.test.ts
git commit -m "feat: define financial planning contracts"
```

---

### Task 2: Implement Pure Budget and Savings Calculations

**Files:**
- Create: `packages/domain/src/planning.ts`
- Create: `packages/domain/test/planning.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Consumes:
  - `PlanningAllocationFact`
  - `PlanningExpenseFact`
  - `PlanningGoalFact`
  - existing `parseMoney()` and `roundMoney()`.
- Produces:
  - `calculateBudgetPlan(input: BudgetPlanInput): BudgetCalculation`
  - `calculateSavingsProgress(input: SavingsProgressInput): SavingsProgress`
  - `allocateSplitBaseAmount(input: SplitBaseAllocationInput): CategoryExpense[]`.

- [ ] **Step 1: Write failing domain tests**

```ts
it("rolls surplus and overspending through later months", () => {
  const result = calculateBudgetPlan({
    selectedMonth: "2026-03",
    currency: "THB",
    categories: [{ id: foodId, name: "อาหาร" }],
    allocations: [
      { categoryId: foodId, month: "2026-01", amount: "1000.00" },
      { categoryId: foodId, month: "2026-02", amount: "1000.00" },
      { categoryId: foodId, month: "2026-03", amount: "1000.00" }
    ],
    expenses: [
      { categoryId: foodId, month: "2026-01", baseAmount: "700.00" },
      { categoryId: foodId, month: "2026-02", baseAmount: "1500.00" },
      { categoryId: foodId, month: "2026-03", baseAmount: "200.00" }
    ]
  });

  expect(result.categories[0]).toMatchObject({
    priorCarry: "-200.00",
    available: "800.00",
    spent: "200.00",
    remaining: "600.00"
  });
});

it("keeps unbudgeted spending visible", () => {
  const result = calculateBudgetPlan({
    selectedMonth: "2026-03",
    currency: "THB",
    categories: [{ id: healthId, name: "สุขภาพ" }],
    allocations: [],
    expenses: [
      { categoryId: healthId, month: "2026-03", baseAmount: "350.00" }
    ]
  });

  expect(result.categories[0]).toMatchObject({
    isBudgeted: false,
    baseBudget: "0.00",
    remaining: "-350.00"
  });
});

it("caps display percent but preserves an over-target amount", () => {
  expect(calculateSavingsProgress({
    balance: "12000.00",
    targetAmount: "10000.00",
    currency: "THB"
  })).toEqual({
    currentAmount: "12000.00",
    percent: 100,
    reached: true
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- --run packages/domain/test/planning.test.ts`

Expected: FAIL because the planning calculation module does not exist.

- [ ] **Step 3: Implement exact-money calculations**

Use decimal money helpers, never `Number` for money:

```ts
import Decimal from "decimal.js";

export function calculateSavingsProgress(
  input: SavingsProgressInput
): SavingsProgress {
  const balance = parseMoney({
    amount: input.balance,
    currency: input.currency
  });
  const target = parseMoney({
    amount: input.targetAmount,
    currency: input.currency
  });
  const current = Decimal.max(balance, 0);

  return {
    currentAmount: roundMoney(current, input.currency),
    percent: Math.min(100, current.div(target).mul(100).toDecimalPlaces(2).toNumber()),
    reached: current.greaterThanOrEqualTo(target)
  };
}
```

For each category, begin at its earliest allocation month. Sum
`allocation - spending` for every earlier month to obtain `priorCarry`.
For the selected month compute `available` and `remaining`. Also append
categories that have selected-month spending but no allocation history.
Return rows sorted with budgeted rows first, then Thai category name.

For splits, distribute `baseAmount * splitAmount / transactionAmount`; assign
the final split the rounded remainder so category totals exactly equal the
transaction base amount.

- [ ] **Step 4: Run domain tests and package typecheck**

Run: `npm test -- --run packages/domain/test/planning.test.ts`

Expected: PASS for positive carry, negative carry, missing months, unbudgeted
spending, split rounding, exclusions supplied by the caller, and goal progress.

Run: `npm run typecheck -w @systems-credit/domain`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add packages/domain
git commit -m "feat: calculate budget rollover and savings progress"
```

---

### Task 3: Add Supabase Planning Persistence, RLS, RPCs, and Snapshot Data

**Files:**
- Create: `supabase/migrations/202607290019_financial_planning.sql`
- Create: `workers/api/test/planning-database.test.ts`
- Modify: `workers/api/test/finance-snapshot-database.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `public.is_workspace_member`, `public.workspace_role_for`,
  `public.account_balances`, `public.transactions`,
  `public.transaction_splits`, and `public.audit_events`.
- Produces database functions:
  - `initialize_budget_month(jsonb) -> jsonb`
  - `set_monthly_budget(jsonb) -> jsonb`
  - `remove_monthly_budget(uuid, integer) -> jsonb`
  - `get_financial_plan(uuid, text) -> jsonb`
  - `create_savings_goal(jsonb) -> jsonb`
  - `update_savings_goal(uuid, jsonb) -> jsonb`
  - `archive_savings_goal(uuid, integer) -> jsonb`.

- [ ] **Step 1: Write a failing PGlite integration test**

Load migrations through `202607290019_financial_planning.sql`, create one
workspace, a bank account, expense categories, allocations for January through
March, posted and voided expenses, a transfer, and one savings goal. Assert:

```ts
expect(marchPlan.totals).toMatchObject({
  baseBudget: "1000.00",
  priorCarry: "-200.00",
  available: "800.00"
});
expect(marchPlan.goals[0]).toMatchObject({
  currentAmount: "12000.00",
  percent: 24,
  reached: false
});
await expect(createSecondActiveGoalForSameAccount()).rejects.toThrow(
  /active savings goal|already linked/i
);
```

Switch `auth.uid()` to a stranger and assert direct table reads return no rows
and every planning mutation/read RPC raises access denied.

- [ ] **Step 2: Run the database test and verify failure**

Run: `npm test -- --run workers/api/test/planning-database.test.ts`

Expected: FAIL because migration `202607290019_financial_planning.sql` is
missing.

- [ ] **Step 3: Create planning tables and constraints**

Create `monthly_budget_allocations` with a unique
`(workspace_id, category_id, month)` index, numeric amount `>= 0`,
`removed_at`, timestamps, creator, and version. Store month as the first-day
`date` and check `month = date_trunc('month', month)::date`.

Create `savings_goals` with target amount `> 0`, currency, optional target
date, account, `active|archived` status, timestamps, creator, and version.
Enforce one active goal per account:

```sql
create unique index one_active_savings_goal_per_account
  on public.savings_goals (workspace_id, account_id)
  where status = 'active';
```

Enable RLS with member-only select policies. Do not grant authenticated users
direct insert, update, or delete access because that would bypass optimistic
locking and audit writes. Implement all seven mutations as `security definer`
functions with a fixed `search_path`, revoke their default public access, and
grant authenticated users only table select plus execute on those RPCs.

- [ ] **Step 4: Implement atomic mutation RPCs**

Every mutation must:

1. require `auth.uid()`;
2. require owner/editor role;
3. validate that referenced category/account belongs to the workspace;
4. apply optimistic locking when a version is supplied;
5. write an audit event;
6. return lower-camel JSON matching Task 1.

The remove operation retains the row:

```sql
update public.monthly_budget_allocations
set amount = 0,
    removed_at = now(),
    updated_at = now(),
    version = version + 1
where id = p_id
  and version = p_expected_version
returning * into v_row;
```

`initialize_budget_month` copies only active positive previous-month rows and
uses `on conflict (workspace_id, category_id, month) do nothing`, making the
operation safe to retry.

Goal create/update rejects archived accounts, `credit_card`, `loan`, and
accounts whose currency differs from the workspace base currency. Archive
changes only `status`, timestamps, and version.

- [ ] **Step 5: Implement calculated plan SQL**

Use posted base-currency expenses only. Produce category spending with this
shape before aggregating:

```sql
select
  tx.workspace_id,
  coalesce(tx.category_id, split.category_id) as category_id,
  date_trunc('month', tx.financial_date)::date as month,
  case
    when tx.category_id is not null then tx.base_amount
    else tx.base_amount * split.amount / nullif(tx.amount, 0)
  end as base_amount
from public.transactions tx
left join public.transaction_splits split
  on split.transaction_id = tx.id
where tx.workspace_id = p_workspace_id
  and tx.type = 'expense'
  and tx.state = 'posted';
```

For each category, generate months from its first allocation row through the
selected month. Calculate carry with a window:

```sql
coalesce(sum(base_budget - spent) over (
  partition by category_id
  order by month
  rows between unbounded preceding and 1 preceding
), 0) as prior_carry
```

Add selected-month expenses for categories with no allocation history as
unbudgeted rows. Build totals by summing the selected category rows.

Join active and archived goals to `account_balances`; clamp negative balances
to zero for progress, cap percent at 100, preserve the actual over-target
amount, and include `accountArchived`.

- [ ] **Step 6: Extend the finance snapshot**

Add `snapshot_budget_allocations(workspace_id)` and
`snapshot_savings_goals(workspace_id)` JSON functions, then replace
`get_finance_snapshot()` so it appends:

```sql
'budgetAllocations', public.snapshot_budget_allocations(workspace.id),
'savingsGoals', public.snapshot_savings_goals(workspace.id)
```

Keep snapshot `version: 1`; these are additive fields inside the strict version
1 contract.

- [ ] **Step 7: Run database and snapshot tests**

Run: `npm test -- --run workers/api/test/planning-database.test.ts workers/api/test/finance-snapshot-database.test.ts`

Expected: PASS.

Add `workers/api/test/planning-database.test.ts` to the root `test:db` script,
then run: `npm run test:db`

Expected: PASS when the local database-test prerequisites are available.

- [ ] **Step 8: Commit**

```powershell
git add supabase/migrations/202607290019_financial_planning.sql workers/api/test/planning-database.test.ts workers/api/test/finance-snapshot-database.test.ts package.json
git commit -m "feat: persist financial plans in supabase"
```

---

### Task 4: Add the Planning Repository and Authenticated Worker Routes

**Files:**
- Create: `workers/api/src/services/planning-repository.ts`
- Create: `workers/api/src/services/supabase-planning-repository.ts`
- Create: `workers/api/src/routes/planning.ts`
- Create: `workers/api/test/planning.test.ts`
- Modify: `workers/api/src/app.ts`
- Modify: `workers/api/src/index.ts`
- Modify: `workers/api/test/supabase-adapters.test.ts`

**Interfaces:**
- Consumes: Task 1 planning types/schemas, Task 2 calculations, and Task 3 RPCs.
- Produces:

```ts
export interface PlanningRepository {
  getPlan(actor: AuthSession, workspaceId: string, month: string): Promise<FinancialPlan>;
  initializeMonth(actor: AuthSession, input: InitializeBudgetMonthInput): Promise<InitializeBudgetMonthResult>;
  setBudget(actor: AuthSession, input: SetMonthlyBudgetInput): Promise<MonthlyBudgetAllocation>;
  removeBudget(actor: AuthSession, allocationId: string, input: RemoveMonthlyBudgetInput): Promise<MonthlyBudgetAllocation>;
  createGoal(actor: AuthSession, input: CreateSavingsGoalInput): Promise<SavingsGoal>;
  updateGoal(actor: AuthSession, goalId: string, input: UpdateSavingsGoalInput): Promise<SavingsGoal>;
  archiveGoal(actor: AuthSession, goalId: string, input: ArchiveSavingsGoalInput): Promise<SavingsGoal>;
}
```

- [ ] **Step 1: Write failing route tests**

Cover:

```ts
await request("/v1/planning/2026-08?workspaceId=...", { token })
  .expect(200);
await request("/v1/planning/2026-13?workspaceId=...", { token })
  .expect(400);
await post("/v1/planning/budgets", { amount: "0.00" }, token)
  .expect(400);
await post("/v1/planning/goals", validGoal, token)
  .expect(201);
await post(`/v1/planning/goals/${goalId}/archive`, { version: 1 }, token)
  .expect(200);
```

Also assert a request without a bearer token returns 401 through the existing
auth middleware.

- [ ] **Step 2: Run route tests and verify failure**

Run: `npm test -- --run workers/api/test/planning.test.ts`

Expected: FAIL because planning routes are not mounted.

- [ ] **Step 3: Implement focused repositories**

The in-memory factory accepts deterministic seed facts:

```ts
createMemoryPlanningRepository({
  memberships,
  categories,
  accounts,
  balances,
  expenses,
  allocations,
  goals
});
```

It uses Task 2 functions and enforces owner/editor mutations, unique
category/month, optimistic versions, eligible accounts, and one active goal per
account. Reads allow viewers.

The Supabase adapter maps methods directly to Task 3 RPCs and parses every
response with Task 1 schemas:

```ts
getPlan(actor, workspaceId, month) {
  return client
    .rpc(actor, "get_financial_plan", {
      p_workspace_id: workspaceId,
      p_month: month
    })
    .then((value) => financialPlanSchema.parse(value));
}
```

- [ ] **Step 4: Implement and mount routes**

Mount these exact endpoints:

```text
GET   /v1/planning/:month?workspaceId=11111111-1111-4111-8111-111111111111
POST  /v1/planning/budgets/initialize
POST  /v1/planning/budgets
POST  /v1/planning/budgets/:id/remove
POST  /v1/planning/goals
PATCH /v1/planning/goals/:id
POST  /v1/planning/goals/:id/archive
```

Use Task 1 `safeParse()` schemas before repository calls. Budget set is an
upsert and always returns 200 because its repository result intentionally has
no separate creation flag. New goals return 201; goal updates, initialization,
budget removal, and goal archive return 200.
The application dependency is:

```ts
planningRepository: PlanningRepository;
```

Default tests use `createMemoryPlanningRepository()`. Production constructs
`createSupabasePlanningRepository(config)` in `workers/api/src/index.ts`.

- [ ] **Step 5: Run Worker tests and typecheck**

Run: `npm test -- --run workers/api/test/planning.test.ts workers/api/test/supabase-adapters.test.ts`

Expected: PASS and adapter tests show the exact RPC names/arguments.

Run: `npm run typecheck -w @systems-credit/api`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add workers/api/src workers/api/test/planning.test.ts workers/api/test/supabase-adapters.test.ts
git commit -m "feat: expose financial planning api"
```

---

### Task 5: Add Planning Operations to the Browser API Client

**Files:**
- Modify: `apps/web/src/lib/finance-api.ts`
- Modify: `apps/web/src/lib/remote-finance-api.ts`
- Modify: `apps/web/src/lib/remote-finance-api.test.ts`

**Interfaces:**
- Consumes: Task 1 request/response types and Task 4 HTTP endpoints.
- Produces these `FinanceApi` methods:

```ts
getFinancialPlan(workspaceId: string, month: string): Promise<FinancialPlan>;
initializeBudgetMonth(input: InitializeBudgetMonthInput): Promise<InitializeBudgetMonthResult>;
setMonthlyBudget(input: SetMonthlyBudgetInput): Promise<MonthlyBudgetAllocation>;
removeMonthlyBudget(allocationId: string, input: RemoveMonthlyBudgetInput): Promise<MonthlyBudgetAllocation>;
createSavingsGoal(input: CreateSavingsGoalInput): Promise<SavingsGoal>;
updateSavingsGoal(goalId: string, input: UpdateSavingsGoalInput): Promise<SavingsGoal>;
archiveSavingsGoal(goalId: string, input: ArchiveSavingsGoalInput): Promise<SavingsGoal>;
```

- [ ] **Step 1: Write failing client tests**

```ts
await api.getFinancialPlan(workspaceId, "2026-08");
expect(fetch).toHaveBeenCalledWith(
  `/v1/planning/2026-08?workspaceId=${workspaceId}`,
  expect.objectContaining({ method: "GET" })
);

await api.setMonthlyBudget({
  workspaceId,
  categoryId,
  month: "2026-08",
  amount: "5000.00"
});
expect(requestBody(fetch)).toEqual({
  workspaceId,
  categoryId,
  month: "2026-08",
  amount: "5000.00"
});
```

Add equivalent URL/body/schema assertions for initialize, remove, create goal,
update goal, and archive goal.

- [ ] **Step 2: Run client tests and verify failure**

Run: `npm test -- --run apps/web/src/lib/remote-finance-api.test.ts`

Expected: FAIL because `FinanceApi` has no planning methods.

- [ ] **Step 3: Implement client operations**

Import Task 1 schemas. URL-encode every ID/month/query value. Use the existing
`request`, `post`, and `patch` helpers. Parse outgoing input before sending and
parse all responses:

```ts
getFinancialPlan(workspaceId, month) {
  return request(
    `/v1/planning/${encodeURIComponent(month)}?workspaceId=${encodeURIComponent(workspaceId)}`,
    { method: "GET" },
    financialPlanSchema
  );
}
```

- [ ] **Step 4: Run client tests and web typecheck**

Run: `npm test -- --run apps/web/src/lib/remote-finance-api.test.ts`

Expected: PASS.

Run: `npm run typecheck -w @systems-credit/web`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/src/lib
git commit -m "feat: connect web client to planning api"
```

---

### Task 6: Build Monthly Budget Summary and Category Controls

**Files:**
- Create: `apps/web/src/features/planning/planning-page.tsx`
- Create: `apps/web/src/features/planning/planning-page.test.tsx`
- Create: `apps/web/src/features/planning/budget-panel.tsx`
- Create: `apps/web/src/features/planning/budget-panel.test.tsx`

**Interfaces:**
- Consumes: Task 5 planning API methods, `FinanceSnapshot.workspace`,
  `FinanceSnapshot.categories`, and calculated `FinancialPlan`.
- Produces: `PlanningPage` for the router and `BudgetPanel` for the integrated
  page.

- [ ] **Step 1: Write failing budget UI tests**

```tsx
expect(await screen.findByText("ยอดยกมาจากเดือนก่อน")).toBeVisible();
expect(screen.getByText("-฿1,000.00")).toHaveClass("negative");
expect(screen.getByText("เงินเหลือหรือใช้เกินสะสมจากเดือนก่อน ๆ")).toBeVisible();
expect(screen.getByRole("heading", { name: "ไม่ได้ตั้งงบ" })).toBeVisible();
```

For an editor, change the category amount and assert
`api.setMonthlyBudget()` receives workspace, category, selected month, exact
decimal amount, and allocation version. Remove a budget and assert the explicit
remove confirmation calls `api.removeMonthlyBudget()`.

For a viewer, assert edit and remove controls are absent.

- [ ] **Step 2: Run UI tests and verify failure**

Run: `npm test -- --run apps/web/src/features/planning/planning-page.test.tsx apps/web/src/features/planning/budget-panel.test.tsx`

Expected: FAIL because both components are missing.

- [ ] **Step 3: Implement page loading and month behavior**

`PlanningPage` owns:

```ts
const [selectedMonth, setSelectedMonth] = useState(currentWorkspaceMonth);
const [plan, setPlan] = useState<FinancialPlan | null>(null);
const [loadState, setLoadState] =
  useState<"loading" | "ready" | "error">("loading");
```

On month change, owners/editors call `initializeBudgetMonth` before loading
only when `selectedMonth >= currentWorkspaceMonth`; the RPC is idempotent.
Historical months and all viewer reads call only `getFinancialPlan`, so opening
history never mutates it. On error, retain the selected month and show a
`ลองอีกครั้ง` button that reruns the same load.

After a mutation, load the selected plan again and call `onChanged()` so the
global snapshot remains current.

- [ ] **Step 4: Implement budget summary and table/card rows**

Render five named values:

```text
งบเดือนนี้
ยอดยกมาจากเดือนก่อน
ใช้ได้ทั้งหมด
ใช้ไป
เหลือใช้จริง
```

Keep `งบเดือนนี้` visually separate from carry. Place the explanation
`เงินเหลือหรือใช้เกินสะสมจากเดือนก่อน ๆ` next to carry. Render negative
carry/remaining with warning semantics and `aria-label` including the signed
amount.

Budgeted rows show base, carry, available, spent, remaining, and progress.
Rows with `isBudgeted: false` and spending belong to a visible
`ไม่ได้ตั้งงบ` group. Never hide their spending from totals.

The allocation form uses an expense-category select and amount input. Disable
categories already actively budgeted for the selected month. Owners/editors
see add/edit/remove; viewers receive the same calculated data without mutation
controls.

- [ ] **Step 5: Run focused UI tests**

Run: `npm test -- --run apps/web/src/features/planning/planning-page.test.tsx apps/web/src/features/planning/budget-panel.test.tsx`

Expected: PASS for provenance, signs, unbudgeted rows, role mode, mutation
refresh, loading, and retry.

- [ ] **Step 6: Commit**

```powershell
git add apps/web/src/features/planning/planning-page.tsx apps/web/src/features/planning/planning-page.test.tsx apps/web/src/features/planning/budget-panel.tsx apps/web/src/features/planning/budget-panel.test.tsx
git commit -m "feat: add monthly budget planning ui"
```

---

### Task 7: Add Savings Goals, Navigation, Routing, and Responsive Styling

**Files:**
- Create: `apps/web/src/features/planning/savings-goals-panel.tsx`
- Create: `apps/web/src/features/planning/savings-goals-panel.test.tsx`
- Modify: `apps/web/src/features/planning/planning-page.tsx`
- Modify: `apps/web/src/app/router.tsx`
- Modify: `apps/web/src/app/router.test.tsx`
- Modify: `apps/web/src/app/layout.tsx`
- Modify: `apps/web/src/app/layout.test.tsx`
- Modify: `apps/web/src/styles.css`
- Modify: `apps/web/src/styles.test.ts`

**Interfaces:**
- Consumes: Task 5 goal mutations, Task 6 `PlanningPage`, calculated
  `FinancialPlan.goals`, accounts from the finance snapshot, and workspace
  role/currency.
- Produces: the complete `/planning` feature and `แผนการเงิน` navigation.

- [ ] **Step 1: Write failing goal and navigation tests**

```tsx
expect(screen.getByText("฿12,000.00 จาก ฿50,000.00")).toBeVisible();
expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "24");
expect(screen.getByText("ถึงเป้าแล้ว")).toBeVisible();
expect(screen.getByText("บัญชีนี้ถูกเก็บถาวรแล้ว")).toBeVisible();
expect(screen.queryByRole("option", { name: /บัตรเครดิต/ })).toBeNull();
expect(screen.queryByRole("option", { name: /เงินกู้/ })).toBeNull();
expect(screen.getByRole("link", { name: "แผนการเงิน" })).toHaveAttribute(
  "href",
  "/planning"
);
```

Assert that an account used by another active goal is disabled with an
explanation. Assert archive requires confirmation and sends the current
version.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- --run apps/web/src/features/planning/savings-goals-panel.test.tsx apps/web/src/app/layout.test.tsx apps/web/src/app/router.test.tsx`

Expected: FAIL because goal UI and the route/navigation do not exist.

- [ ] **Step 3: Implement savings-goal cards and form**

Each goal displays:

- goal name;
- account name;
- actual current amount and target;
- target date when present;
- progress bar and percentage;
- `ถึงเป้าแล้ว` when `reached`;
- archived-account warning when `accountArchived`.

Eligible form accounts satisfy:

```ts
const eligible = accounts.filter((account) =>
  ["cash", "bank", "ewallet", "asset"].includes(account.type) &&
  account.currency === workspace.baseCurrency &&
  !activeGoalAccountIds.has(account.id)
);
```

Allow the currently linked account during edit. Owners/editors can
create/edit/archive. Viewers see cards only. Goal completion is derived and
never auto-archives.

- [ ] **Step 4: Mount route and navigation**

Add a `Target` or `PiggyBank` Lucide icon and this navigation item:

```ts
{
  to: "/planning",
  label: "แผนการเงิน",
  mobileLabel: "แผน",
  icon: Target
}
```

Mount:

```tsx
<Route
  path="/planning"
  element={
    <PlanningPage
      api={api}
      snapshot={snapshot}
      onChanged={refreshSnapshot}
    />
  }
/>
```

- [ ] **Step 5: Add responsive Kanit-aligned styles**

Add focused selectors under `.planning-page`, `.budget-summary-grid`,
`.budget-category-table`, `.budget-category-card`,
`.savings-goal-grid`, `.goal-progress`, and `.planning-dialog`.

At desktop widths, use a readable table and multi-column summary/goal grid.
At `max-width: 760px`, convert each category row to a card while preserving
base budget and prior carry labels. All buttons/inputs/selects have
`min-height: 44px`. Negative values use the existing warning palette; positive
carry does not rely on color alone.

- [ ] **Step 6: Run web tests, style tests, and typecheck**

Run: `npm test -- --run apps/web/src/features/planning apps/web/src/app/layout.test.tsx apps/web/src/app/router.test.tsx apps/web/src/styles.test.ts`

Expected: PASS.

Run: `npm run typecheck -w @systems-credit/web`

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add apps/web/src/features/planning apps/web/src/app apps/web/src/styles.css apps/web/src/styles.test.ts
git commit -m "feat: complete financial planning page"
```

---

### Task 8: Verify the Integrated Feature and Deployment Build

**Files:**
- Modify only files required by failures directly caused by Tasks 1–7.

**Interfaces:**
- Consumes: all earlier tasks.
- Produces: a deployable build with the planning schema, API, and UI verified
  together.

- [ ] **Step 1: Run focused planning tests**

Run:

```powershell
npm test -- --run packages/contracts/test/planning.test.ts packages/domain/test/planning.test.ts workers/api/test/planning.test.ts workers/api/test/planning-database.test.ts apps/web/src/features/planning
```

Expected: PASS.

- [ ] **Step 2: Run the complete test suite**

Run: `npm test -- --run`

Expected: every test passes with no unhandled rejection.

- [ ] **Step 3: Run static verification**

Run: `npm run typecheck`

Expected: PASS for every workspace.

Run: `npm run build`

Expected: production web and Worker builds complete successfully.

- [ ] **Step 4: Run database verification**

Run: `npm run test:db`

Expected: PASS when the local PGlite/Supabase database test prerequisites are
available.

Run: `npm run test:db:supabase`

Expected: PASS when the Supabase CLI local stack is running. If the stack is
not running, record the exact environmental error separately; do not report
the database test as passed.

- [ ] **Step 5: Inspect the final diff**

Run:

```powershell
git status --short
git diff --check
git log --oneline -10
```

Expected: no whitespace errors, no accidental generated files, and only
financial-planning changes.

- [ ] **Step 6: Commit verification-only fixes if any**

When verification required a directly related correction:

```powershell
git add -- packages/contracts/src/planning.ts packages/contracts/src/finance-snapshot.ts packages/domain/src/planning.ts supabase/migrations/202607290019_financial_planning.sql workers/api/src/services/planning-repository.ts workers/api/src/services/supabase-planning-repository.ts workers/api/src/routes/planning.ts apps/web/src/lib/finance-api.ts apps/web/src/lib/remote-finance-api.ts apps/web/src/features/planning apps/web/src/app/router.tsx apps/web/src/app/layout.tsx apps/web/src/styles.css package.json
git commit -m "fix: finalize financial planning integration"
```

When no correction was required, do not create an empty commit.

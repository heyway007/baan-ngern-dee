# Monthly Recurring Items Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เพิ่มโมดูลรายรับและรายจ่ายประจำรายเดือนที่สร้างรายการรอยืนยันเมื่อเปิดระบบ ปรับยอดบัญชีเฉพาะเมื่อผู้ใช้ยืนยัน และรองรับแก้ยอด ข้าม พัก เปิดใหม่ และยกเลิกโดยไม่ทำรายการซ้ำ

**Architecture:** เพิ่ม recurring template และ occurrence เป็น bounded units ใน contracts/domain จากนั้นให้ Worker repository และ Supabase RPC ใช้ interfaces เดียวกัน การ materialize ทำแบบ lazy และ idempotent หลังโหลด snapshot แรก ส่วนการ post occurrence เรียก transaction posting ภายใน database transaction เดียว หน้าเว็บใช้ current-month read model จาก snapshot และโหลดประวัติเดือนเก่าผ่าน endpoint แยก

**Tech Stack:** TypeScript, Zod, React 19, React Router, Vitest, Testing Library, Hono, PostgreSQL/Supabase RLS, PGlite, Cloudflare Workers, Vite

## Global Constraints

- รองรับเฉพาะความถี่รายเดือนในรอบนี้
- occurrence ต้องเริ่มเป็น `pending` และห้ามเปลี่ยนยอดบัญชีก่อนผู้ใช้ยืนยัน
- materialize ได้เฉพาะเดือนปัจจุบันตาม timezone ของ workspace และต้องไม่สร้าง `(template_id, period_month)` ซ้ำ
- วันที่ 29–31 ในเดือนสั้นต้องใช้วันสุดท้ายของเดือน
- จำนวนเงินผ่าน API ต้องเป็น decimal string และห้ามแปลงผ่าน JavaScript `number`
- แต่ละ template เลือกบัญชีและหมวดหมู่ของตัวเอง โดยสกุลเงินต้องตรงกับบัญชี
- สรุปต้องแยกตามสกุลเงินและห้ามแปลงอัตราแลกเปลี่ยน
- `skipped` ไม่รวมในประมาณการ และเดือนถัดไปต้องกลับมาสร้างได้
- `paused` เปิดใหม่ได้ แต่ `cancelled` เป็นการยกเลิกถาวร
- occurrence ปัจจุบันที่มีอยู่แล้วต้องไม่ถูกลบเมื่อพักหรือยกเลิก template
- การแก้ template ต้องทับค่าของ occurrence เดือนปัจจุบันที่ยัง `pending` หลังผู้ใช้ยืนยันคำเตือน แต่ห้ามเปลี่ยนประวัติ `posted`/`skipped`
- post occurrence ต้อง atomic, optimistic-concurrency safe และ idempotent ด้วย `clientMutationId`
- RLS ต้องแยกข้อมูลตาม workspace membership
- ห้ามเพิ่ม Cloudflare Cron, notification, ความถี่อื่น หรือการหักเงินจริงจากธนาคาร

---

### Task 1: Recurring contracts and snapshot schema

**Files:**
- Create: `packages/contracts/src/recurring.ts`
- Create: `packages/contracts/test/recurring.test.ts`
- Modify: `packages/contracts/src/transactions.ts`
- Modify: `packages/contracts/src/finance-snapshot.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/test/finance-snapshot.test.ts`
- Modify snapshot fixtures in:
  - `apps/web/src/app/cloud-state.test.ts`
  - `apps/web/src/app/router.test.tsx`
  - `apps/web/src/features/installments/installments-page.test.tsx`
  - `apps/web/src/lib/remote-finance-api.test.ts`
  - `workers/api/test/finance-snapshot-database.test.ts`
  - `workers/api/test/supabase-adapters.test.ts`
  - `workers/api/src/services/finance-repository.ts`

**Interfaces:**
- Produces: `RecurringTemplate`, `RecurringOccurrence`, all recurring command inputs, response schemas, and snapshot fields `recurringTemplates` / `recurringOccurrences`
- Consumes: existing `categoryKindSchema`, UUID/date/currency/decimal conventions

- [ ] **Step 1: Write failing contract tests**

Create `packages/contracts/test/recurring.test.ts` with literal valid and invalid inputs:

```ts
import { describe, expect, it } from "vitest";
import {
  createRecurringTemplateSchema,
  materializeRecurringPeriodSchema,
  postedTransactionResponseSchema,
  updateRecurringOccurrenceSchema
} from "../src";

const ids = {
  workspaceId: "11111111-1111-4111-8111-111111111111",
  accountId: "22222222-2222-4222-8222-222222222222",
  categoryId: "33333333-3333-4333-8333-333333333333"
};

describe("recurring contracts", () => {
  it("accepts an exact monthly salary template", () => {
    expect(
      createRecurringTemplateSchema.parse({
        ...ids,
        name: "เงินเดือน",
        kind: "income",
        amount: "35000.50",
        currency: "THB",
        dayOfMonth: 25,
        startMonth: "2026-07"
      })
    ).toMatchObject({ amount: "35000.50", dayOfMonth: 25 });
  });

  it("rejects zero money, invalid days, and reversed month ranges", () => {
    const base = {
      ...ids,
      name: "ค่าเช่า",
      kind: "expense",
      amount: "0",
      currency: "THB",
      dayOfMonth: 32,
      startMonth: "2026-08",
      endMonth: "2026-07"
    };
    expect(createRecurringTemplateSchema.safeParse(base).success).toBe(false);
  });

  it("requires YYYY-MM materialization and real calendar dates", () => {
    expect(
      materializeRecurringPeriodSchema.safeParse({
        workspaceId: ids.workspaceId,
        period: "2026-7"
      }).success
    ).toBe(false);
    expect(
      updateRecurringOccurrenceSchema.safeParse({
        amount: "1200.00",
        scheduledDate: "2026-02-30",
        version: 1
      }).success
    ).toBe(false);
  });

  it("parses the shared posted transaction response", () => {
    expect(
      postedTransactionResponseSchema.parse({
        transactionId: "44444444-4444-4444-8444-444444444444",
        version: 1,
        state: "posted",
        accountBalances: [{
          accountId: ids.accountId,
          amount: "35000.50",
          currency: "THB"
        }]
      }).state
    ).toBe("posted");
  });
});
```

Update the finance snapshot test fixture to include `recurringTemplates: []` and `recurringOccurrences: []`, then add a valid template and occurrence assertion.

- [ ] **Step 2: Run the contract tests and verify RED**

Run:

```powershell
npm test -- --run packages/contracts/test/recurring.test.ts packages/contracts/test/finance-snapshot.test.ts
```

Expected: FAIL because recurring exports and snapshot fields do not exist.

- [ ] **Step 3: Implement recurring Zod schemas and types**

Create `packages/contracts/src/recurring.ts` with these public names:

```ts
import { z } from "zod";
import { categoryKindSchema } from "./catalog";

const uuid = z.string().uuid();
const currency = z.string().regex(/^[A-Z]{3}$/);
const month = z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const positiveMoney = z
  .string()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/)
  .refine((value) => /[1-9]/.test(value));
const version = z.number().int().positive();

export const recurringTemplateStatusSchema = z.enum([
  "active",
  "paused",
  "cancelled"
]);
export const recurringOccurrenceStatusSchema = z.enum([
  "pending",
  "posted",
  "skipped"
]);

const templateFields = {
  name: z.string().trim().min(1).max(100),
  kind: categoryKindSchema,
  amount: positiveMoney,
  currency,
  accountId: uuid,
  categoryId: uuid,
  dayOfMonth: z.number().int().min(1).max(31),
  startMonth: month,
  endMonth: month.optional()
};

export const createRecurringTemplateSchema = z
  .object({ workspaceId: uuid, ...templateFields })
  .strict()
  .refine(
    (value) => !value.endMonth || value.endMonth >= value.startMonth,
    { path: ["endMonth"], message: "End month must not precede start month" }
  );

export const updateRecurringTemplateSchema = z
  .object({ ...templateFields, version })
  .strict()
  .refine(
    (value) => !value.endMonth || value.endMonth >= value.startMonth,
    { path: ["endMonth"], message: "End month must not precede start month" }
  );

export const recurringVersionActionSchema = z
  .object({ version })
  .strict();

export const materializeRecurringPeriodSchema = z
  .object({ workspaceId: uuid, period: month })
  .strict();

export const updateRecurringOccurrenceSchema = z
  .object({
    amount: positiveMoney,
    scheduledDate: date,
    version
  })
  .strict();

export const postRecurringOccurrenceSchema = z
  .object({ version, clientMutationId: uuid })
  .strict();
```

Refine `date` with a UTC parse-and-round-trip check so invalid calendar
dates such as `2026-02-30` fail at the contract boundary.

Define and export strict response schemas/types:

- `recurringTemplateSchema`
- `recurringOccurrenceSchema` including derived `name`
- `materializeRecurringPeriodResultSchema` with `createdCount` and `existingCount`
- `recurringPeriodSchema` with `period` and `occurrences`
- `postRecurringOccurrenceResultSchema` with `occurrence` and the existing posted transaction response shape
- inferred input and output types for every schema

Promote the existing posted-transaction response shape from
`apps/web/src/lib/remote-finance-api.ts` into
`postedTransactionResponseSchema` in `packages/contracts/src/transactions.ts`.
Keep `PostedTransactionResponse` inferred from that schema, export both from
`packages/contracts/src/index.ts`, and compose
`postRecurringOccurrenceResultSchema` from the shared schema.

- [ ] **Step 4: Extend the finance snapshot contract**

Import the two read-model schemas in `finance-snapshot.ts` and add:

```ts
recurringTemplates: z.array(recurringTemplateSchema),
recurringOccurrences: z.array(recurringOccurrenceSchema),
```

Export every recurring type/schema from `packages/contracts/src/index.ts`. Add empty recurring arrays to every typed fixture listed in this task.

- [ ] **Step 5: Verify contracts and type consistency**

Run:

```powershell
npm test -- --run packages/contracts/test/recurring.test.ts packages/contracts/test/finance-snapshot.test.ts
npm run typecheck
```

Expected: contract tests pass and no `FinanceSnapshot` fixture is missing recurring fields.

- [ ] **Step 6: Commit contracts**

```powershell
git add -- packages/contracts apps/web/src/app/cloud-state.test.ts apps/web/src/app/router.test.tsx apps/web/src/features/installments/installments-page.test.tsx apps/web/src/lib/remote-finance-api.test.ts workers/api/test/finance-snapshot-database.test.ts workers/api/test/supabase-adapters.test.ts workers/api/src/services/finance-repository.ts
git commit -m "feat: define recurring item contracts"
```

---

### Task 2: Exact monthly date and summary domain logic

**Files:**
- Create: `packages/domain/src/recurring.ts`
- Create: `packages/domain/test/recurring.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Consumes: `RecurringOccurrence`, decimal money helpers
- Produces:
  - `resolveRecurringDate(period: string, dayOfMonth: number): string`
  - `summarizeRecurringOccurrences(occurrences: RecurringOccurrence[]): RecurringCurrencySummary[]`

- [ ] **Step 1: Write failing domain tests**

```ts
import { describe, expect, it } from "vitest";
import {
  resolveRecurringDate,
  summarizeRecurringOccurrences
} from "../src";

describe("recurring date resolution", () => {
  it("clamps day 31 to leap and non-leap February", () => {
    expect(resolveRecurringDate("2028-02", 31)).toBe("2028-02-29");
    expect(resolveRecurringDate("2027-02", 31)).toBe("2027-02-28");
  });
});

describe("recurring summaries", () => {
  it("keeps currencies separate and excludes skipped occurrences", () => {
    const summaries = summarizeRecurringOccurrences([
      {
        id: crypto.randomUUID(),
        workspaceId: crypto.randomUUID(),
        templateId: crypto.randomUUID(),
        name: "เงินเดือน",
        kind: "income",
        period: "2026-07",
        scheduledDate: "2026-07-25",
        amount: "35000.50",
        currency: "THB",
        accountId: crypto.randomUUID(),
        categoryId: crypto.randomUUID(),
        status: "pending",
        version: 1
      },
      {
        id: crypto.randomUUID(),
        workspaceId: crypto.randomUUID(),
        templateId: crypto.randomUUID(),
        name: "ค่าเช่า",
        kind: "expense",
        period: "2026-07",
        scheduledDate: "2026-07-01",
        amount: "8000.25",
        currency: "THB",
        accountId: crypto.randomUUID(),
        categoryId: crypto.randomUUID(),
        status: "posted",
        transactionId: crypto.randomUUID(),
        version: 2
      },
      {
        id: crypto.randomUUID(),
        workspaceId: crypto.randomUUID(),
        templateId: crypto.randomUUID(),
        name: "ข้าม",
        kind: "expense",
        period: "2026-07",
        scheduledDate: "2026-07-10",
        amount: "900.00",
        currency: "THB",
        accountId: crypto.randomUUID(),
        categoryId: crypto.randomUUID(),
        status: "skipped",
        version: 2
      }
    ]);

    expect(summaries).toEqual([
      {
        currency: "THB",
        income: "35000.50",
        expense: "8000.25",
        remaining: "27000.25",
        pendingIncome: "35000.50",
        pendingExpense: "0.00",
        postedIncome: "0.00",
        postedExpense: "8000.25",
        pendingCount: 1
      }
    ]);
  });
});
```

- [ ] **Step 2: Run the domain test and verify RED**

```powershell
npm test -- --run packages/domain/test/recurring.test.ts
```

Expected: FAIL because both domain functions are missing.

- [ ] **Step 3: Implement exact date and currency-grouped summaries**

In `packages/domain/src/recurring.ts`, validate the period/day, create the last day with `new Date(Date.UTC(year, month, 0))`, clamp the requested day, and format without locale APIs.

For summaries, group by `currency`, ignore `skipped`, and use `parseMoney`, `sumMoney`, and `roundMoney`; never coerce amounts with `Number`, `parseFloat`, unary `+`, or arithmetic operators. Sort results by currency for deterministic rendering.

Export the functions and `RecurringCurrencySummary` from `packages/domain/src/index.ts`.

- [ ] **Step 4: Run domain tests**

```powershell
npm test -- --run packages/domain/test/recurring.test.ts packages/domain/test/money.test.ts
```

Expected: leap-day, skipped, decimal, and currency grouping tests pass.

- [ ] **Step 5: Commit domain logic**

```powershell
git add -- packages/domain/src/recurring.ts packages/domain/src/index.ts packages/domain/test/recurring.test.ts
git commit -m "feat: calculate monthly recurring schedules"
```

---

### Task 3: Worker repository interface, memory behavior, and routes

**Files:**
- Create: `workers/api/src/routes/recurring.ts`
- Create: `workers/api/test/recurring.test.ts`
- Modify: `workers/api/src/app.ts`
- Modify: `workers/api/src/services/finance-repository.ts`

**Interfaces:**
- Extends `FinanceRepository` with create/update/status/materialize/read/update/skip/post recurring methods
- Produces authenticated `/v1/recurring-*` routes used by both memory tests and Supabase adapter

- [ ] **Step 1: Write failing route tests against the memory repository**

Create a helper in `workers/api/test/recurring.test.ts` that creates a workspace, bank account, and resolves salary/housing category IDs through the API. Test:

```ts
it("materializes once, skips one month, and posts another occurrence once", async () => {
  const salaryTemplate = await postJson("/v1/recurring-templates", {
    workspaceId,
    name: "เงินเดือน",
    kind: "income",
    amount: "35000.00",
    currency: "THB",
    accountId,
    categoryId: salaryCategoryId,
    dayOfMonth: 25,
    startMonth: currentPeriod
  });
  const rentTemplate = await postJson("/v1/recurring-templates", {
    workspaceId,
    name: "ค่าเช่า",
    kind: "expense",
    amount: "8000.00",
    currency: "THB",
    accountId,
    categoryId: housingCategoryId,
    dayOfMonth: 1,
    startMonth: currentPeriod
  });

  expect((await materialize()).createdCount).toBe(2);
  expect((await materialize()).createdCount).toBe(0);

  const period = await getPeriod();
  const salary = period.occurrences.find(
    (item: { templateId: string }) => item.templateId === salaryTemplate.id
  );
  const rent = period.occurrences.find(
    (item: { templateId: string }) => item.templateId === rentTemplate.id
  );

  expect((await postOccurrence(salary.id, salary.version)).occurrence.status)
    .toBe("posted");
  expect((await postOccurrence(salary.id, salary.version)).occurrence.status)
    .toBe("posted");
  expect((await skipOccurrence(rent.id, rent.version)).status).toBe("skipped");
});
```

Add tests for:

- update occurrence with stale version returns `409 STALE_VERSION`
- update occurrence with a date outside its stored period returns `400`
- editing a template overwrites its current `pending` occurrence and increments the occurrence version
- editing a template never rewrites a `posted` or `skipped` occurrence
- pause before materialization creates nothing, while resume allows current-month materialization
- pause/cancel after materialization leaves the existing pending occurrence actionable
- cancel is permanent
- stranger token receives `403`
- invalid account/category/currency receives `400`

- [ ] **Step 2: Run route tests and verify RED**

```powershell
npm test -- --run workers/api/test/recurring.test.ts
```

Expected: FAIL because routes and repository methods are absent.

- [ ] **Step 3: Extend the repository interface and memory stores**

Add exact methods:

```ts
createRecurringTemplate(actor, input): Promise<RecurringTemplate>;
updateRecurringTemplate(actor, templateId, input): Promise<RecurringTemplate>;
setRecurringTemplateStatus(
  actor,
  templateId,
  status: "active" | "paused" | "cancelled",
  version: number
): Promise<RecurringTemplate>;
materializeRecurringPeriod(
  actor,
  input
): Promise<MaterializeRecurringPeriodResult>;
getRecurringPeriod(actor, workspaceId, period): Promise<RecurringPeriod>;
updateRecurringOccurrence(actor, occurrenceId, input): Promise<RecurringOccurrence>;
skipRecurringOccurrence(actor, occurrenceId, version): Promise<RecurringOccurrence>;
postRecurringOccurrence(
  actor,
  occurrenceId,
  input
): Promise<{ response: PostRecurringOccurrenceResult; replayed: boolean }>;
```

Add maps keyed by IDs plus a `${templateId}:${period}` index. Reuse `postTransaction` behavior when confirming, but set occurrence `posted` only after transaction succeeds. Cache the post result by actor + `clientMutationId` so a retry returns the same transaction and does not change the account twice.

When a template is edited, atomically copy its new kind, amount, account,
category, currency, and clamped date into the current workspace-month
occurrence only when that occurrence is still `pending`, then increment both
versions. This deliberately overwrites a current-month custom edit after the
warning tested in Task 7. Never rewrite `posted` or `skipped` history.

- [ ] **Step 4: Implement Hono routes with contract validation**

Mount three route groups from one file:

```ts
app.route("/v1/recurring-templates", recurringTemplateRoutes(repository));
app.route("/v1/recurring-periods", recurringPeriodRoutes(repository));
app.route("/v1/recurring-occurrences", recurringOccurrenceRoutes(repository));
```

Use the contract schemas directly. Route behavior:

- create returns `201`
- update/status/skip returns `200`
- first post returns `201`, replay returns `200`
- invalid UUID/body throws `VALIDATION_FAILED`
- period GET validates `workspaceId` query and `YYYY-MM` path param

Use these exact endpoints:

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/v1/recurring-templates` | create template |
| `PATCH` | `/v1/recurring-templates/:templateId` | update template |
| `POST` | `/v1/recurring-templates/:templateId/pause` | pause active template |
| `POST` | `/v1/recurring-templates/:templateId/resume` | resume paused template |
| `POST` | `/v1/recurring-templates/:templateId/cancel` | permanently cancel template |
| `POST` | `/v1/recurring-periods/materialize` | lazily create current occurrences |
| `GET` | `/v1/recurring-periods/:period?workspaceId=:workspaceId` | read one month |
| `PATCH` | `/v1/recurring-occurrences/:occurrenceId` | edit pending amount/date |
| `POST` | `/v1/recurring-occurrences/:occurrenceId/skip` | skip this month |
| `POST` | `/v1/recurring-occurrences/:occurrenceId/post` | post once to transactions |

Hard-code the lifecycle target status in each lifecycle route. Enforce
`active → paused`, `paused → active`, and `active|paused → cancelled`;
reject every transition out of `cancelled`.

- [ ] **Step 5: Verify memory route behavior**

```powershell
npm test -- --run workers/api/test/recurring.test.ts workers/api/test/transactions.test.ts
npm run typecheck
```

Expected: recurring and existing transaction route tests pass.

- [ ] **Step 6: Commit Worker routes**

```powershell
git add -- workers/api/src/app.ts workers/api/src/routes/recurring.ts workers/api/src/services/finance-repository.ts workers/api/test/recurring.test.ts
git commit -m "feat: add recurring item API routes"
```

---

### Task 4: Supabase schema, RLS, atomic RPCs, and database tests

**Files:**
- Create: `supabase/migrations/202607270011_recurring_items.sql`
- Create: `workers/api/test/recurring-database.test.ts`
- Create: `supabase/tests/database/recurring_items.test.sql`
- Modify: `package.json`

**Interfaces:**
- Produces PostgreSQL enums, tables, RLS, JSON helpers, materialize/history/template/occurrence RPCs
- Consumes existing `post_transaction(jsonb)`, workspace role helpers, audit events, accounts, categories, and `format_money`

- [ ] **Step 1: Write the failing PGlite integration test**

Load migrations `001` through `011`, create owner/stranger, workspace, account, and categories, then assert:

```ts
const created = await database.query<{ result: { id: string } }>(
  "select public.create_recurring_template($1::jsonb) as result",
  [JSON.stringify(templateInput)]
);
const first = await database.query<{
  result: { createdCount: number; existingCount: number };
}>(
  "select public.materialize_recurring_period($1::jsonb) as result",
  [JSON.stringify({ workspaceId, period: currentPeriod })]
);
const replay = await database.query<{
  result: { createdCount: number; existingCount: number };
}>(
  "select public.materialize_recurring_period($1::jsonb) as result",
  [JSON.stringify({ workspaceId, period: currentPeriod })]
);

expect(first.rows[0]!.result.createdCount).toBe(1);
expect(replay.rows[0]!.result).toEqual({
  createdCount: 0,
  existingCount: 1
});
```

Post the occurrence twice with one `clientMutationId`, verify one transaction, one account balance change, `posted` status, and identical response. Add a second template to verify skip. Verify a template edit overwrites and increments only its current `pending` occurrence. Verify materialization excludes templates before `startMonth`, after `endMonth`, while paused, and after cancellation; resume permits a current-month occurrence again. Verify pausing or cancelling after materialization keeps the existing occurrence available for post or skip. Switch to stranger and verify RLS returns no rows and mutation RPC raises authorization error. Disable the selected account/category in isolated tests and verify post fails with no transaction, balance, or occurrence changes.

- [ ] **Step 2: Run the database test and verify RED**

```powershell
npm test -- --run workers/api/test/recurring-database.test.ts
```

Expected: FAIL because migration `202607270011_recurring_items.sql` does not exist.

- [ ] **Step 3: Create enums, tables, indexes, constraints, and RLS**

Use this DDL boundary:

```sql
create type public.recurring_template_status as enum (
  'active', 'paused', 'cancelled'
);
create type public.recurring_occurrence_status as enum (
  'pending', 'posted', 'skipped'
);

create table public.recurring_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  kind public.category_kind not null,
  amount numeric(20,4) not null check (amount > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  account_id uuid not null references public.accounts(id),
  category_id uuid not null references public.categories(id),
  day_of_month integer not null check (day_of_month between 1 and 31),
  start_month date not null check (date_trunc('month', start_month)::date = start_month),
  end_month date check (
    end_month is null or (
      date_trunc('month', end_month)::date = end_month
      and end_month >= start_month
    )
  ),
  status public.recurring_template_status not null default 'active',
  version integer not null default 1 check (version > 0),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.recurring_occurrences (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  template_id uuid not null references public.recurring_templates(id),
  kind public.category_kind not null,
  period_month date not null check (
    date_trunc('month', period_month)::date = period_month
  ),
  scheduled_date date not null,
  amount numeric(20,4) not null check (amount > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  account_id uuid not null references public.accounts(id),
  category_id uuid not null references public.categories(id),
  status public.recurring_occurrence_status not null default 'pending',
  transaction_id uuid unique references public.transactions(id),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (template_id, period_month),
  check (date_trunc('month', scheduled_date)::date = period_month),
  check (
    (status = 'posted' and transaction_id is not null)
    or (status in ('pending', 'skipped') and transaction_id is null)
  )
);
```

Enable RLS and add select policies using `public.is_workspace_member(workspace_id)`. Writes occur only through `security definer` RPCs after checking `workspace_role_for` is owner/editor. Grant table select and RPC execute only to `authenticated`.

- [ ] **Step 4: Implement exact SQL helpers and mutation RPCs**

Implement:

```sql
public.recurring_date(p_period date, p_day integer) returns date
public.recurring_template_json(p_id uuid) returns jsonb
public.recurring_occurrence_json(p_id uuid) returns jsonb
public.create_recurring_template(p_input jsonb) returns jsonb
public.update_recurring_template(p_id uuid, p_input jsonb) returns jsonb
public.set_recurring_template_status(
  p_id uuid,
  p_expected_version integer,
  p_status public.recurring_template_status
) returns jsonb
public.materialize_recurring_period(p_input jsonb) returns jsonb
public.get_recurring_period(p_workspace_id uuid, p_period text) returns jsonb
public.update_recurring_occurrence(p_id uuid, p_input jsonb) returns jsonb
public.skip_recurring_occurrence(
  p_id uuid,
  p_expected_version integer
) returns jsonb
public.post_recurring_occurrence(p_id uuid, p_input jsonb) returns jsonb
```

`recurring_date` must use:

```sql
make_date(
  extract(year from p_period)::integer,
  extract(month from p_period)::integer,
  least(
    p_day,
    extract(
      day from (
        date_trunc('month', p_period)
        + interval '1 month - 1 day'
      )
    )::integer
  )
)
```

`materialize_recurring_period` must compare the requested first-of-month date to:

```sql
date_trunc('month', now() at time zone workspace.timezone)::date
```

Use `insert ... on conflict (template_id, period_month) do nothing`, return exact counts, and audit created templates/status changes/skips/posts.

Lifecycle RPCs must enforce the same transition matrix as the memory
repository: `active → paused`, `paused → active`, and
`active|paused → cancelled`, with `cancelled` terminal. Updating a template
must lock the template and its current workspace-month occurrence in one
transaction, copy the new kind and other template values into that occurrence only when it
is `pending`, and increment its version. Existing `posted` and `skipped`
occurrences remain immutable.

`post_recurring_occurrence` must lock the occurrence, check expected version, call `public.post_transaction` with occurrence values plus supplied `clientMutationId`, update the occurrence from `pending` to `posted`, and return:

```json
{
  "occurrence": {},
  "transaction": {}
}
```

If the occurrence is already posted and its linked transaction has the same actor and mutation ID, return the stored response without another update. Any other non-pending state raises SQLSTATE `40001`.

- [ ] **Step 5: Add pgTAP shape/RLS coverage and test script**

In `supabase/tests/database/recurring_items.test.sql`, assert both tables, RLS enabled, both select policies, unique indexes, and authenticated grants. Add `workers/api/test/recurring-database.test.ts` to `test:db` in root `package.json`.

- [ ] **Step 6: Run database verification**

```powershell
npm test -- --run workers/api/test/recurring-database.test.ts
npm run test:db
```

Expected: atomic post, retry, skip, status, and RLS tests pass.

- [ ] **Step 7: Commit migration**

```powershell
git add -- supabase/migrations/202607270011_recurring_items.sql supabase/tests/database/recurring_items.test.sql workers/api/test/recurring-database.test.ts package.json
git commit -m "feat: persist recurring items in Supabase"
```

---

### Task 5: Snapshot integration and Supabase repository adapter

**Files:**
- Create: `supabase/migrations/202607270012_recurring_snapshot.sql`
- Modify: `supabase/migrations/202607270010_finance_snapshot.sql` only if a reusable helper must be factored; prefer the new migration
- Modify: `workers/api/src/services/supabase-finance-repository.ts`
- Modify: `workers/api/test/supabase-adapters.test.ts`
- Modify: `workers/api/test/finance-snapshot-database.test.ts`
- Modify: `packages/contracts/test/finance-snapshot.test.ts`

**Interfaces:**
- Produces current-month `recurringTemplates` and `recurringOccurrences` in `FinanceSnapshot`
- Maps every `FinanceRepository` recurring method to one Supabase RPC

- [ ] **Step 1: Write failing adapter and snapshot tests**

Add adapter assertions:

```ts
await repository.materializeRecurringPeriod(actor, {
  workspaceId,
  period: "2026-07"
});
expect(requestFetch).toHaveBeenCalledWith(
  "https://project.supabase.co/rest/v1/rpc/materialize_recurring_period",
  expect.objectContaining({
    method: "POST",
    body: JSON.stringify({
      p_input: { workspaceId, period: "2026-07" }
    })
  })
);
```

Cover all RPC names and parameter keys. Extend the database snapshot test by creating/materializing one template, then assert one template and one current occurrence parse through `financeSnapshotSchema`; stranger still receives empty recurring arrays.

- [ ] **Step 2: Run focused tests and verify RED**

```powershell
npm test -- --run workers/api/test/supabase-adapters.test.ts workers/api/test/finance-snapshot-database.test.ts
```

Expected: FAIL because adapter methods and snapshot JSON keys are missing.

- [ ] **Step 3: Add bounded snapshot helpers**

In migration `012`, create:

```sql
public.snapshot_recurring_templates(p_workspace_id uuid) returns jsonb
public.snapshot_recurring_occurrences(
  p_workspace_id uuid,
  p_period date
) returns jsonb
```

Replace `public.get_finance_snapshot()` while preserving every existing key and add:

```sql
'recurringTemplates',
  public.snapshot_recurring_templates(workspace.id),
'recurringOccurrences',
  public.snapshot_recurring_occurrences(
    workspace.id,
    date_trunc(
      'month',
      now() at time zone workspace.timezone
    )::date
  )
```

Templates include all statuses so current occurrences retain a resolvable name after a template is cancelled. Occurrences include derived template `name` and only the current workspace month.

- [ ] **Step 4: Implement Supabase repository RPC mappings**

Add methods that call:

```ts
client.rpc(actor, "create_recurring_template", { p_input: input });
client.rpc(actor, "update_recurring_template", {
  p_id: templateId,
  p_input: input
});
client.rpc(actor, "set_recurring_template_status", {
  p_id: templateId,
  p_expected_version: version,
  p_status: status
});
client.rpc(actor, "materialize_recurring_period", { p_input: input });
client.rpc(actor, "get_recurring_period", {
  p_workspace_id: workspaceId,
  p_period: period
});
client.rpc(actor, "update_recurring_occurrence", {
  p_id: occurrenceId,
  p_input: input
});
client.rpc(actor, "skip_recurring_occurrence", {
  p_id: occurrenceId,
  p_expected_version: version
});
client.rpc(actor, "post_recurring_occurrence", {
  p_id: occurrenceId,
  p_input: input
});
```

Parse snapshot with the existing `financeSnapshotSchema` and parse recurring RPC responses with schemas from contracts.

- [ ] **Step 5: Verify snapshot and adapter**

```powershell
npm test -- --run packages/contracts/test/finance-snapshot.test.ts workers/api/test/supabase-adapters.test.ts workers/api/test/finance-snapshot-database.test.ts
npm run typecheck
```

Expected: current occurrence is present, history is not unbounded, and all adapter calls use exact RPC payloads.

- [ ] **Step 6: Commit snapshot adapter**

```powershell
git add -- supabase/migrations/202607270012_recurring_snapshot.sql workers/api/src/services/supabase-finance-repository.ts workers/api/test/supabase-adapters.test.ts workers/api/test/finance-snapshot-database.test.ts packages/contracts/test/finance-snapshot.test.ts
git commit -m "feat: expose recurring items in finance snapshots"
```

---

### Task 6: Remote client and lazy cloud-boot materialization

**Files:**
- Modify: `apps/web/src/lib/finance-api.ts`
- Modify: `apps/web/src/lib/remote-finance-api.ts`
- Modify: `apps/web/src/lib/remote-finance-api.test.ts`
- Modify: `apps/web/src/app/router.tsx`
- Modify: `apps/web/src/app/router.test.tsx`

**Interfaces:**
- Extends `FinanceApi` / `RemoteFinanceApi` with recurring operations
- Cloud boot sequence: first snapshot → materialize current period → refresh snapshot only when `createdCount > 0`

- [ ] **Step 1: Write failing remote-client tests**

Use a fake fetch queue and assert:

```ts
await api.createRecurringTemplate(templateInput);
expect(fetchMock).toHaveBeenCalledWith(
  "/v1/recurring-templates",
  expect.objectContaining({
    method: "POST",
    body: JSON.stringify(templateInput)
  })
);

await api.getRecurringPeriod(workspaceId, "2026-07");
expect(fetchMock).toHaveBeenCalledWith(
  `/v1/recurring-periods/2026-07?workspaceId=${workspaceId}`,
  expect.objectContaining({ method: "GET" })
);
```

Cover update, pause, resume, cancel, materialize, occurrence update, skip, and post response parsing.
Assert materialization uses
`POST /v1/recurring-periods/materialize`, and replace the web-local
`postedTransactionSchema` with the exported contract schema.

- [ ] **Step 2: Write failing boot test**

In `router.test.tsx`, mock `getSnapshot` to return a workspace snapshot first and a snapshot containing occurrences second; mock materialize to return `{ createdCount: 2, existingCount: 0 }`.

Assert order and call counts:

```ts
expect(api.getSnapshot).toHaveBeenCalledTimes(2);
expect(api.materializeRecurringPeriod).toHaveBeenCalledWith({
  workspaceId: workspaceSnapshot.workspace!.id,
  period: currentPeriod
});
```

Add a zero-created test that asserts only one snapshot call, and an empty-workspace test that asserts materialize is not called.

- [ ] **Step 3: Run client/boot tests and verify RED**

```powershell
npm test -- --run apps/web/src/lib/remote-finance-api.test.ts apps/web/src/app/router.test.tsx
```

Expected: FAIL because recurring client methods and boot behavior are missing.

- [ ] **Step 4: Implement client methods with contract schemas**

Add every method to `FinanceApi`, reuse the generic request/post functions, add a `patch` helper, URL-encode query values, and use contract response schemas rather than duplicating recurring Zod structures in the web app.

- [ ] **Step 5: Implement lazy materialization in `loadSnapshot`**

Use:

```ts
const initial = await api.getSnapshot();
let snapshot = initial;
if (initial.workspace) {
  const period = toFinancialDate(
    new Date().toISOString(),
    initial.workspace.timeZone
  ).slice(0, 7);
  const materialized = await api.materializeRecurringPeriod({
    workspaceId: initial.workspace.id,
    period
  });
  if (materialized.createdCount > 0) {
    snapshot = await api.getSnapshot();
  }
}
dispatch({ type: "SNAPSHOT_LOADED", session, snapshot });
```

Do not materialize before a workspace exists and do not loop after the second snapshot.

- [ ] **Step 6: Verify client and boot**

```powershell
npm test -- --run apps/web/src/lib/remote-finance-api.test.ts apps/web/src/app/router.test.tsx apps/web/src/app/cloud-state.test.ts
npm run typecheck
```

Expected: boot is idempotent and recurring methods parse exact responses.

- [ ] **Step 7: Commit cloud client**

```powershell
git add -- apps/web/src/lib/finance-api.ts apps/web/src/lib/remote-finance-api.ts apps/web/src/lib/remote-finance-api.test.ts apps/web/src/app/router.tsx apps/web/src/app/router.test.tsx
git commit -m "feat: materialize recurring items on cloud boot"
```

---

### Task 7: Recurring template form and lifecycle manager

**Files:**
- Create: `apps/web/src/features/recurring/recurring-template-form.tsx`
- Create: `apps/web/src/features/recurring/recurring-template-form.test.tsx`
- Create: `apps/web/src/features/recurring/recurring-template-manager.tsx`
- Create: `apps/web/src/features/recurring/recurring-template-manager.test.tsx`

**Interfaces:**
- `RecurringTemplateForm` consumes accounts/categories and creates or fully updates one template
- `RecurringTemplateManager` pauses, resumes, and confirms permanent cancellation

- [ ] **Step 1: Write failing form tests**

Test create with exact money:

```ts
expect(createRecurringTemplate).toHaveBeenCalledWith({
  workspaceId,
  name: "เงินเดือน",
  kind: "income",
  amount: "35000.50",
  currency: "THB",
  accountId,
  categoryId: salaryCategoryId,
  dayOfMonth: 25,
  startMonth: "2026-07"
});
```

Test changing the account updates currency, changing kind filters category options, malformed/zero money blocks the API, and update includes the template version. When editing a template with a current pending occurrence, assert the overwrite warning appears and the update API is not called until the user confirms.

- [ ] **Step 2: Write failing lifecycle tests**

Render active and paused templates. Assert pause/resume calls include current version. Click cancel, assert a `role="dialog"` confirmation appears, then confirm and assert `cancelRecurringTemplate(id, { version })`. Verify cancel is absent for an already cancelled template.

- [ ] **Step 3: Run component tests and verify RED**

```powershell
npm test -- --run apps/web/src/features/recurring/recurring-template-form.test.tsx apps/web/src/features/recurring/recurring-template-manager.test.tsx
```

Expected: FAIL because components do not exist.

- [ ] **Step 4: Implement accessible forms and lifecycle controls**

Use controlled string state for amount and month inputs. Derive currency from selected account. Filter categories by kind. Disable submit while pending. Show Thai validation/API messages with `role="alert"`.

Implement cancellation as an in-page dialog state, not `window.confirm`, with buttons “กลับ” and “ยกเลิกรายการถาวร”.

Expose one `onChanged` callback after successful create/update/lifecycle
operations. `RecurringPage` owns that callback: it materializes the current
period and then refreshes the global snapshot. This makes a new or resumed
current-month template appear immediately while the unique occurrence index
prevents duplicates. Before an edit whose current occurrence is `pending`,
show an explicit confirmation that saving the template replaces that
month's custom type, amount, account, category, currency, and date.

- [ ] **Step 5: Verify template UI**

```powershell
npm test -- --run apps/web/src/features/recurring/recurring-template-form.test.tsx apps/web/src/features/recurring/recurring-template-manager.test.tsx
```

Expected: create/update/status/error paths pass.

- [ ] **Step 6: Commit template UI**

```powershell
git add -- apps/web/src/features/recurring/recurring-template-form.tsx apps/web/src/features/recurring/recurring-template-form.test.tsx apps/web/src/features/recurring/recurring-template-manager.tsx apps/web/src/features/recurring/recurring-template-manager.test.tsx
git commit -m "feat: manage recurring templates"
```

---

### Task 8: Recurring monthly page, occurrence actions, and history

**Files:**
- Create: `apps/web/src/features/recurring/recurring-summary.tsx`
- Create: `apps/web/src/features/recurring/recurring-summary.test.tsx`
- Create: `apps/web/src/features/recurring/recurring-occurrence-list.tsx`
- Create: `apps/web/src/features/recurring/recurring-occurrence-list.test.tsx`
- Create: `apps/web/src/features/recurring/recurring-page.tsx`
- Create: `apps/web/src/features/recurring/recurring-page.test.tsx`

**Interfaces:**
- `RecurringSummary` renders one summary group per currency
- `RecurringOccurrenceList` edits/posts/skips current pending occurrences
- `RecurringPage` uses snapshot for current month and `getRecurringPeriod` for past read-only months

- [ ] **Step 1: Write failing summary and occurrence tests**

Assert THB and USD render separately. For a pending expense:

```ts
await user.clear(screen.getByLabelText("ยอดของ ค่าเช่า"));
await user.type(screen.getByLabelText("ยอดของ ค่าเช่า"), "8250.75");
await user.click(screen.getByRole("button", { name: "บันทึกการแก้ไข ค่าเช่า" }));
expect(updateRecurringOccurrence).toHaveBeenCalledWith(occurrence.id, {
  amount: "8250.75",
  scheduledDate: occurrence.scheduledDate,
  version: occurrence.version
});
```

Assert post uses one stable `clientMutationId` during retry, disables the action while pending, calls `onChanged` once, and renders a Thai error on failure. Assert skip calls the current version and removes the item from projected totals after refresh.

- [ ] **Step 2: Write failing page/history tests**

Current period must use `snapshot.recurringOccurrences` without a history request. Selecting a past month calls `getRecurringPeriod(workspaceId, period)`, renders read-only entries, and hides edit/post/skip controls. A future month input must be disallowed with `max={currentPeriod}`.

- [ ] **Step 3: Run recurring page tests and verify RED**

```powershell
npm test -- --run apps/web/src/features/recurring
```

Expected: FAIL because page components do not exist.

- [ ] **Step 4: Implement summary, lists, and page composition**

Use `summarizeRecurringOccurrences`, sort pending income/expense by `scheduledDate` then name, and show posted/skipped history below. The page must expose:

- “เพิ่มรายการประจำ”
- “รอรับ”
- “รอจ่าย”
- “ดำเนินการแล้ว”
- month selector
- template manager

Current occurrence actions call `onChanged` to refresh the global snapshot.
Template changes first call `materializeRecurringPeriod` for the current
month and then refresh the snapshot. Past history uses local
loading/error state and never calls materialize.

- [ ] **Step 5: Verify recurring page behavior**

```powershell
npm test -- --run apps/web/src/features/recurring
npm run typecheck
```

Expected: summary, exact edits, post, skip, history, loading, and error states pass.

- [ ] **Step 6: Commit monthly page**

```powershell
git add -- apps/web/src/features/recurring
git commit -m "feat: add monthly recurring item workspace"
```

---

### Task 9: Navigation, Overview card, responsive styles, and final verification

**Files:**
- Create: `apps/web/src/features/dashboard/recurring-overview-card.tsx`
- Create: `apps/web/src/features/dashboard/recurring-overview-card.test.tsx`
- Modify: `apps/web/src/features/dashboard/overview-page.tsx`
- Modify: `apps/web/src/app/layout.tsx`
- Modify: `apps/web/src/app/router.tsx`
- Modify: `apps/web/src/app/router.test.tsx`
- Modify: `apps/web/src/styles.css`
- Modify: `apps/web/src/styles.test.ts`
- Modify: `docs/runbooks/deploy-cloudflare-supabase.md`

**Interfaces:**
- Adds authenticated route `/recurring`
- Adds desktop/mobile navigation item and bounded Overview projection card
- Documents migration order `011` then `012`

- [ ] **Step 1: Write failing Overview and router tests**

The Overview card test must assert pending expense, per-currency remaining, and link `/recurring`. Router test opens `/recurring` with a workspace snapshot and asserts heading “รายการประจำ”. Layout test or router snapshot asserts the navigation link name exists.

- [ ] **Step 2: Run integration UI tests and verify RED**

```powershell
npm test -- --run apps/web/src/features/dashboard/recurring-overview-card.test.tsx apps/web/src/app/router.test.tsx
```

Expected: FAIL because card, route, and navigation are missing.

- [ ] **Step 3: Wire route, navigation, and Overview**

Add a `Repeat2` navigation item:

```ts
{ to: "/recurring", label: "รายการประจำ", icon: Repeat2 }
```

Render `RecurringPage` with `api`, `snapshot`, and `onChanged={refreshSnapshot}`. Render the Overview card using only current snapshot occurrences. For mobile bottom navigation show five compact labels, using “ประจำ” for this route.

- [ ] **Step 4: Add responsive Kanit-preserving styles**

Add focused class groups for:

- `.recurring-page`
- `.recurring-summary-grid`
- `.recurring-occurrence-list`
- `.recurring-template-grid`
- `.recurring-action-row`
- `.recurring-history`
- `.recurring-confirm-dialog`
- `.recurring-overview-card`

At the existing mobile breakpoint, collapse summary/templates to one column and keep action buttons at least 44px high. Do not add another font-family; all new UI inherits Kanit. Extend `styles.test.ts` fixtures only if a new explicit typography role is introduced.

- [ ] **Step 5: Update deployment runbook**

Document that production Supabase must apply:

```text
202607270011_recurring_items.sql
202607270012_recurring_snapshot.sql
```

before deploying the Worker bundle. Document that no Cron trigger or new Worker secret is required.

- [ ] **Step 6: Run fresh complete verification**

```powershell
npm test -- --run
npm run typecheck
npm run build
git diff --check
```

Expected: all tests pass, TypeScript is clean, Vite builds, Wrangler dry-run succeeds, and no whitespace errors exist.

- [ ] **Step 7: Perform local browser QA**

At desktop `1440 × 900` and mobile `390 × 844`, verify:

- `/overview` recurring card
- `/recurring` summary, template form, pending lists, history
- exact Kanit computed font on headings, inputs, buttons, and amounts
- no horizontal overflow or overlapping controls
- cancellation confirmation and disabled pending actions

Use an authenticated local session supplied by the user if protected routes redirect to sign-in. Do not inspect browser storage or credentials.

- [ ] **Step 8: Commit integration**

```powershell
git add -- apps/web/src/features/dashboard/recurring-overview-card.tsx apps/web/src/features/dashboard/recurring-overview-card.test.tsx apps/web/src/features/dashboard/overview-page.tsx apps/web/src/app/layout.tsx apps/web/src/app/router.tsx apps/web/src/app/router.test.tsx apps/web/src/styles.css apps/web/src/styles.test.ts docs/runbooks/deploy-cloudflare-supabase.md
git commit -m "feat: integrate monthly recurring items"
```

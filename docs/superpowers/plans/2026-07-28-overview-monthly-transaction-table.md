# Overview Monthly Transaction Table Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a month-selectable transaction table to the Overview page and keep its income, expense, and net totals synchronized with the selected month.

**Architecture:** Keep month selection in `OverviewPage`, put deterministic filtering, sorting, totals, labels, and cumulative-net calculations in a pure model module, and render those results through a focused table component. Use the existing snapshot only; no new Worker route, Supabase RPC, or migration is required.

**Tech Stack:** React 19, TypeScript, React Router, Vitest, Testing Library, Lucide React, existing exact-money helpers, existing Kanit dashboard CSS.

## Global Constraints

- Use the approved full-width table layout below the monthly summary cards.
- Filter only posted THB income and expense transactions for the selected month.
- Initialize the selected month from the workspace time zone.
- Use exact decimal-string arithmetic; never convert money to JavaScript `number`.
- Show 10 rows per page and reset to page one after a month change.
- Render the columns วันที่, รายการ, หมวดหมู่, บัญชี, รายรับ, รายจ่าย, and สุทธิสะสม.
- `สุทธิสะสม` is cumulative selected-month cash flow starting at zero, not historical account balance.
- Keep the existing warm ivory, forest-green, Kanit visual system.
- On narrow screens render each transaction row as a stacked card without horizontal page overflow.
- Do not add charts, transaction editing/deletion, backend endpoints, or database migrations.

---

## File structure

- Create `apps/web/src/features/dashboard/monthly-transaction-model.ts`: pure month, filtering, sorting, label, totals, and cumulative-net logic.
- Create `apps/web/src/features/dashboard/monthly-transaction-model.test.ts`: exact arithmetic and deterministic model tests.
- Create `apps/web/src/features/dashboard/monthly-transaction-table.tsx`: accessible month controls, table, totals footer, pagination, and empty state.
- Create `apps/web/src/features/dashboard/monthly-transaction-table.test.tsx`: component behavior and interaction tests.
- Modify `apps/web/src/features/dashboard/overview-page.tsx`: own selected month state and render the table below `SummaryCards`.
- Create `apps/web/src/features/dashboard/overview-page.test.tsx`: integration test proving cards and rows change together.
- Modify `apps/web/src/styles.css`: desktop table, controls, pagination, and mobile stacked-row styling.

### Task 1: Monthly transaction view model

**Files:**
- Create: `apps/web/src/features/dashboard/monthly-transaction-model.ts`
- Create: `apps/web/src/features/dashboard/monthly-transaction-model.test.ts`

**Interfaces:**
- Consumes: `FinanceTransaction[]`, `Account[]`, `Category[]`, selected month as `YYYY-MM`.
- Produces:

```ts
export type MonthlyTransactionRow = Readonly<{
  id: string;
  financialDate: string;
  itemLabel: string;
  categoryLabel: string;
  accountLabel: string;
  income: string | null;
  expense: string | null;
  cumulativeNet: string;
  currency: "THB";
}>;

export type MonthlyTransactionModel = Readonly<{
  rows: readonly MonthlyTransactionRow[];
  income: string;
  expense: string;
  net: string;
}>;

export function buildMonthlyTransactionModel(input: {
  month: string;
  transactions: readonly FinanceTransaction[];
  accounts: readonly Account[];
  categories: readonly Category[];
}): MonthlyTransactionModel;

export function shiftFinancialMonth(
  month: string,
  offset: -1 | 1
): string;
```

- [ ] **Step 1: Write the failing model tests**

Create fixtures with literal UUIDs and exact expected money strings. Cover:

```ts
it("filters posted THB rows, sorts newest first, and calculates exact totals");
it("resolves note, category, split-category, account, and fallback labels");
it("calculates cumulative monthly net chronologically before presenting newest first");
it.each([
  ["2026-01", -1, "2025-12"],
  ["2026-12", 1, "2027-01"]
])("shifts %s by %s month to %s");
```

The cumulative fixture must hand-check this sequence:

```ts
[
  { date: "2026-07-01", type: "income", amount: "1000.10" },
  { date: "2026-07-03", type: "expense", amount: "250.05" },
  { date: "2026-07-05", type: "income", amount: "0.20" }
]
```

Expected newest-first cumulative values are `["750.25", "750.05", "1000.10"]`.

- [ ] **Step 2: Run the model test and verify RED**

Run:

```powershell
npx vitest run apps/web/src/features/dashboard/monthly-transaction-model.test.ts
```

Expected: FAIL because `monthly-transaction-model.ts` does not exist.

- [ ] **Step 3: Implement exact month filtering and totals**

Use `addExactMoney` from `apps/web/src/lib/money-display.ts`. Negate expense strings by prefixing `-` before passing them to `addExactMoney`.

Filter with this complete predicate:

```ts
transaction.state === "posted" &&
transaction.currency === "THB" &&
transaction.financialDate.startsWith(`${input.month}-`)
```

Sort a chronological copy by `financialDate`, then `createdAt`, then `id`. Walk that copy once to calculate cumulative net. Return a newest-first copy by reversing the completed chronological rows.

- [ ] **Step 4: Implement deterministic labels**

Build account and category maps once. Resolve item labels in this order:

```ts
transaction.note?.trim() ||
singleCategoryName ||
(transaction.type === "income" ? "รายรับ" : "รายจ่าย")
```

Use `แบ่งหลายหมวดหมู่` when a transaction has splits. Use `ไม่พบหมวดหมู่` and `ไม่พบบัญชี` only when referenced IDs are absent from the snapshot.

- [ ] **Step 5: Implement safe month shifting**

Parse `YYYY-MM` into numeric year/month values, apply the offset through `Date.UTC`, and return a zero-padded `YYYY-MM` string. Do not use local time.

- [ ] **Step 6: Run the model test and verify GREEN**

Run:

```powershell
npx vitest run apps/web/src/features/dashboard/monthly-transaction-model.test.ts
```

Expected: all model tests PASS.

- [ ] **Step 7: Commit the model**

```powershell
git add apps/web/src/features/dashboard/monthly-transaction-model.ts apps/web/src/features/dashboard/monthly-transaction-model.test.ts
git commit -m "feat: add overview monthly transaction model"
```

### Task 2: Monthly transaction table component

**Files:**
- Create: `apps/web/src/features/dashboard/monthly-transaction-table.tsx`
- Create: `apps/web/src/features/dashboard/monthly-transaction-table.test.tsx`

**Interfaces:**
- Consumes `buildMonthlyTransactionModel` and `shiftFinancialMonth` from Task 1.
- Produces:

```ts
export function MonthlyTransactionTable(props: Readonly<{
  month: string;
  transactions: readonly FinanceTransaction[];
  accounts: readonly Account[];
  categories: readonly Category[];
  onMonthChange(month: string): void;
}>): JSX.Element;
```

- [ ] **Step 1: Write failing month-control and table tests**

The component tests must assert:

```ts
expect(screen.getByRole("heading", {
  name: "รายการประจำเดือน"
})).toBeInTheDocument();

expect(screen.getByRole("button", {
  name: "เดือนก่อนหน้า"
})).toBeInTheDocument();

expect(screen.getByLabelText("เลือกเดือน")).toHaveValue("2026-07");
expect(screen.getByRole("button", {
  name: "เดือนถัดไป"
})).toBeInTheDocument();
```

Use `userEvent` to click previous and next buttons and change the month input. Assert the literal calls `"2026-06"`, `"2026-08"`, and the directly selected value.

- [ ] **Step 2: Write failing row, footer, pagination, and empty-state tests**

Render 12 posted transactions and assert:

- page one contains the 10 newest rows;
- page two contains the remaining two rows;
- the footer shows exact income, expense, and net totals for all 12 rows, not only the visible page;
- changing `month` in a harness resets pagination to page one;
- zero matching rows show `ยังไม่มีรายการในเดือนนี้` while month controls remain available;
- each body cell has the matching `data-label` used by the mobile stacked layout;
- the Transactions link has `href="/transactions"`.

- [ ] **Step 3: Run the component test and verify RED**

Run:

```powershell
npx vitest run apps/web/src/features/dashboard/monthly-transaction-table.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 4: Implement accessible month controls**

Use `ChevronLeft`, `ChevronRight`, and `CalendarDays` from Lucide. Render a native:

```tsx
<input
  aria-label="เลือกเดือน"
  type="month"
  value={month}
  onChange={(event) => onMonthChange(event.target.value)}
/>
```

Ignore an empty month value. The previous and next buttons call `shiftFinancialMonth(month, -1)` and `shiftFinancialMonth(month, 1)`.

- [ ] **Step 5: Implement table rows and totals footer**

Render semantic `<table>`, `<thead>`, `<tbody>`, and `<tfoot>`. Format dates with a Thai `Intl.DateTimeFormat` using numeric day and short month. Format all money through `formatMoney`.

Add a visually hidden `<caption>รายการเงินประจำเดือนที่เลือก</caption>` so
assistive technology receives the table purpose independently from the visible
card heading.

Use:

```tsx
<td data-label="รายรับ">
  {row.income ? formatMoney(row.income, "THB") : "—"}
</td>
```

Repeat the equivalent contract for expense and cumulative net. Add income/expense classes without relying on color as the only label.

- [ ] **Step 6: Implement 10-row pagination**

Keep `page` in local state, derive `pageCount = Math.max(1, Math.ceil(rows.length / 10))`, and reset page to zero in an effect keyed by `month`. Disable unavailable directions and render `หน้า X / Y`.

- [ ] **Step 7: Run the component test and verify GREEN**

Run:

```powershell
npx vitest run apps/web/src/features/dashboard/monthly-transaction-table.test.tsx
```

Expected: all component tests PASS.

- [ ] **Step 8: Commit the component**

```powershell
git add apps/web/src/features/dashboard/monthly-transaction-table.tsx apps/web/src/features/dashboard/monthly-transaction-table.test.tsx
git commit -m "feat: add overview monthly transaction table"
```

### Task 3: Integrate selected month into Overview

**Files:**
- Modify: `apps/web/src/features/dashboard/overview-page.tsx`
- Create: `apps/web/src/features/dashboard/overview-page.test.tsx`

**Interfaces:**
- Consumes `MonthlyTransactionTable` from Task 2.
- Keeps the existing `SummaryCards` interface unchanged.

- [ ] **Step 1: Write the failing integration test**

Use `vi.setSystemTime("2026-07-28T12:00:00.000Z")`. Build a
`FinanceSnapshot` with one June income, one July income, and one July expense.
Render `OverviewPage` with workspace time zone `Asia/Bangkok`, assert the month
input starts at `2026-07`, and assert July values first. Restore real timers
after the test.

Change the month input to June and assert:

```ts
expect(within(screen.getByTestId("monthly-income"))
  .getByText("฿1,500.00")).toBeInTheDocument();
expect(screen.getByText("โบนัสเดือนมิถุนายน")).toBeInTheDocument();
expect(screen.queryByText("เงินเดือนกรกฎาคม")).not.toBeInTheDocument();
```

This proves the cards and table share one state.

- [ ] **Step 2: Run the integration test and verify RED**

Run:

```powershell
npx vitest run apps/web/src/features/dashboard/overview-page.test.tsx
```

Expected: FAIL because Overview does not render the table or own selectable month state.

- [ ] **Step 3: Add selected month state**

Import `useState` and initialize:

```ts
const initialMonth = toFinancialDate(
  new Date().toISOString(),
  snapshot.workspace?.timeZone ?? "Asia/Bangkok"
).slice(0, 7);
const [selectedMonth, setSelectedMonth] = useState(initialMonth);
```

Pass `selectedMonth` to `SummaryCards`.

- [ ] **Step 4: Render the table below summary cards**

Add:

```tsx
<MonthlyTransactionTable
  month={selectedMonth}
  transactions={snapshot.transactions}
  accounts={snapshot.accounts}
  categories={snapshot.categories}
  onMonthChange={setSelectedMonth}
/>
```

Keep `RecurringOverviewCard` below the new table.

- [ ] **Step 5: Run dashboard tests and verify GREEN**

Run:

```powershell
npx vitest run apps/web/src/features/dashboard/overview-page.test.tsx apps/web/src/features/dashboard/summary-cards.test.tsx apps/web/src/features/dashboard/recurring-overview-card.test.tsx
```

Expected: all dashboard tests PASS.

- [ ] **Step 6: Commit the integration**

```powershell
git add apps/web/src/features/dashboard/overview-page.tsx apps/web/src/features/dashboard/overview-page.test.tsx
git commit -m "feat: connect overview month selection"
```

### Task 4: Responsive styling and final verification

**Files:**
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Styles only the `monthly-transactions-*` class names introduced in Task 2.
- Does not change existing account, recurring, transaction, or admin table selectors.

- [ ] **Step 1: Add desktop table styling**

Add a full-width card with:

- `margin-top: 1.2rem`;
- equal-height month controls;
- sticky-looking totals footer using the existing ivory surface;
- right-aligned money columns;
- subtle row separators and category pills;
- income green and expense terracotta variables already used by the dashboard.

- [ ] **Step 2: Add mobile stacked rows**

Inside the existing `@media (max-width: 820px)` block:

```css
.monthly-transactions-table thead {
  display: none;
}

.monthly-transactions-table,
.monthly-transactions-table tbody,
.monthly-transactions-table tr,
.monthly-transactions-table td {
  display: block;
}

.monthly-transactions-table td::before {
  content: attr(data-label);
}
```

Keep `<tfoot>` visually distinct, wrap the month controls, and prevent horizontal page overflow.

- [ ] **Step 3: Run complete verification**

Run:

```powershell
npx vitest run
npm run typecheck
npm run build
git diff --check
```

Expected:

- 0 failed tests;
- TypeScript exits 0;
- Vite and Wrangler dry-run builds exit 0;
- `git diff --check` prints no errors.

- [ ] **Step 4: Verify the local UI**

Run:

```powershell
npm run dev:web
```

Open `/overview` and verify:

- month controls all have equal height;
- switching month updates cards and table together;
- 10-row pagination works;
- empty month keeps controls visible;
- viewport widths 1440px, 820px, and 390px have no horizontal page overflow.

- [ ] **Step 5: Commit the responsive implementation**

```powershell
git add apps/web/src/styles.css
git commit -m "style: polish overview monthly transaction table"
```

- [ ] **Step 6: Push and deploy after the production diff is reviewed**

```powershell
git push origin main
npm run deploy:worker
```

Expected: Wrangler reports a successful deployment URL and version ID.

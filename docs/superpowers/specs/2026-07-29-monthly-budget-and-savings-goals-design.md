# Monthly Budget and Savings Goals Design

## Goal

Add one integrated financial planning area that answers two questions:

1. How much can the user still spend this month after accounting for
   prior-month surplus or overspending?
2. How close is the user to each savings goal based on money that actually
   exists in a linked account?

Transactions and account balances remain the financial source of truth.
The planning module never creates duplicate spending or savings entries.

## Scope

The first release includes:

- monthly expense budgets by category;
- automatic positive and negative rollover;
- an explicit explanation that rollover came from earlier months;
- actual spending derived from posted expense transactions;
- savings goals linked to real account balances;
- one active savings goal per account;
- one integrated `แผนการเงิน` page.

The first release does not include investment projections, interest
forecasting, shared contributions, live exchange rates, or notifications.

## Architecture

The feature follows the existing project boundaries:

- `packages/domain` owns budget, rollover, and savings-progress calculations;
- `packages/contracts` defines request, response, and snapshot schemas;
- the Worker exposes authenticated planning routes and delegates persistence
  to the finance repository;
- Supabase stores budget allocations and savings goals under a workspace,
  protected by the existing membership and role rules;
- the web app presents the combined planning page and consumes the contracts.

The finance snapshot will include planning data so local, remote, and refreshed
views use the same representation.

## Data Model

### Monthly budget allocations

Each allocation stores:

- workspace;
- expense category;
- month in `YYYY-MM`;
- base budget amount in workspace base currency;
- creator and timestamps;
- optimistic-lock version.

There is at most one allocation for a category and month. When the user first
opens a new month, the system copies the previous month's base allocations.
The copy is idempotent and does not copy the previous month's rollover into
the base amount.

The user can change or remove an allocation for the selected month without
changing older months. A removed allocation has a base amount of zero for that
month; its accumulated positive or negative carry still remains visible.

### Savings goals

Each goal stores:

- workspace;
- name;
- target amount;
- optional target date;
- linked account;
- status: `active` or `archived`;
- creator and timestamps;
- optimistic-lock version.

Only positive-balance account types are eligible: `cash`, `bank`, `ewallet`,
and `asset`. Credit-card and loan accounts are excluded. The account currency
must match the workspace base currency because the application has no live
exchange-rate source.

An account can have only one active goal. An archived goal preserves history
and releases the account for a new goal.

## Budget Calculations

Calculations use calendar months in the workspace timezone and use base
currency values.

For each expense category and month:

```text
available = base budget + carry from prior month
remaining = available - actual spending
next month's carry = remaining
```

The carry may be positive or negative:

- positive means money left from previous months;
- negative means earlier overspending that reduces the current month's
  available amount.

Carry is derived from the first budgeted month through the selected month. It
is not stored as a manually editable balance. Editing or voiding an older
transaction, or changing an older allocation, therefore recalculates all later
carry amounts deterministically.

The interface must label the amount as `ยอดยกมาจากเดือนก่อน` and distinguish
it from `งบเดือนนี้`. A detail affordance shows that the number is the
accumulated result of prior months, not new income.

The page also sums all category results:

- `งบเดือนนี้` — sum of current base allocations;
- `ยอดยกมาจากเดือนก่อน` — sum of category carry;
- `ใช้ได้ทั้งหมด` — base allocations plus carry;
- `ใช้ไป` — actual spending;
- `เหลือใช้จริง` — available minus spending.

## Actual Spending Rules

Actual spending includes only transactions that:

- belong to the workspace;
- have type `expense`;
- have state `posted`;
- have a financial date in the month being calculated.

Voided transactions, income, balance adjustments, account opening balances,
and transfers are excluded. Transfer fees remain expenses through their
expense transaction and are included normally.

For an unsplit transaction, spending is assigned to its category. For a split
transaction, the transaction's base amount is distributed proportionally by
split amount and assigned to each split category. This preserves correct base
currency totals without adding a second source of truth.

Expense categories without an allocation may still appear under an
`ไม่ได้ตั้งงบ` group so unplanned spending cannot disappear from the monthly
total.

## Savings Progress Rules

A goal reads the current balance of its linked account:

```text
progress amount = maximum(account balance, 0)
progress percent = progress amount / target amount
```

The displayed percentage is capped at 100%, while the actual amount remains
visible when the balance exceeds the target. A goal is shown as `ถึงเป้าแล้ว`
whenever the balance is at least the target, but it is not automatically
archived. If money later leaves the account, the displayed progress decreases
to match reality.

Transfers into or out of the linked account update progress through the
existing account balance. They do not create budget spending.

If a linked account is later archived, the goal remains readable and shows a
warning. The user must archive the old goal or choose another active eligible
account before further editing.

## User Interface

Add `แผนการเงิน` to the main navigation.

The page contains:

1. a month picker;
2. summary cards for base budget, prior carry, total available, actual
   spending, and real remaining amount;
3. a category table showing base budget, carry, available, spent, remaining,
   and a progress indicator;
4. a visible `ไม่ได้ตั้งงบ` row when relevant;
5. budget add/edit/remove actions for the selected month;
6. a savings-goal section showing linked account, current balance, target,
   target date, progress, and archive/edit actions.

Positive carry uses a supportive neutral/green treatment. Negative carry and
overspent categories use a warning treatment, never a misleading positive
remaining value. On small screens, table rows become readable cards without
hiding base budget or carry provenance.

Owners and editors can mutate plans. Viewers can inspect the page but do not
see active edit controls.

## API and Persistence

Planning endpoints provide:

- the selected month's calculated budget summary;
- create/update/remove monthly category allocation;
- idempotent initialization from the previous month;
- list/create/update/archive savings goals.

All mutations validate workspace access, role, category/account ownership,
currency, amount bounds, and optimistic-lock version. Supabase constraints
enforce category/month uniqueness and one active goal per account. Mutations
write audit events using the project's existing convention.

No service-role credential is exposed to the browser. The Worker and database
RLS remain the authorization boundary.

## Error Handling

- Reject zero or negative budget and target amounts at the contract boundary.
  Removing a budget uses the explicit remove action instead of saving zero.
- Reject income or archived categories for new allocations.
- Reject archived, credit-card, loan, foreign-currency, or already-linked
  accounts for a new active goal.
- Concurrent creation of the same monthly allocation or duplicate active goal
  returns a conflict that the UI explains and resolves by refreshing.
- A missing earlier month does not break calculation; it contributes zero base
  budget while prior carry continues through it.
- Loading failures preserve the selected month and provide a retry action.
- Empty states explain how to create the first budget or goal.

## Testing

Domain tests cover:

- positive carry across multiple months;
- negative carry after overspending;
- mixed positive and negative category carry;
- months with no allocation;
- unsplit and split expense allocation;
- exclusion of voided transactions, transfers, income, and adjustments;
- savings progress below, at, and above target;
- progress changes when the linked account balance changes.

Contract and Worker tests cover validation, role enforcement, idempotent month
initialization, conflicts, audit events, persistence, and snapshot output.

Web tests cover summary labels, the explicit prior-month provenance, negative
states, unbudgeted spending, allocation editing, linked-account eligibility,
goal progress, archived-account warnings, viewer mode, responsive content, and
failure/retry states.

Before deployment, run focused tests, the full test suite, TypeScript checks,
the production build, and database tests available in the project.

## Success Criteria

- The user can see exactly how the current spendable amount was formed.
- Both surplus and overspending affect the following month automatically.
- Past financial corrections update future carry without manual adjustments.
- Unbudgeted spending remains visible.
- Savings progress always matches the actual linked account balance.
- The same account balance cannot be counted toward two active goals.

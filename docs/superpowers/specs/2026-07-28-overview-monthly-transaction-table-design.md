# Overview Monthly Transaction Table Design

Date: 2026-07-28
Status: Approved visual direction; awaiting written-spec review

## Goal

Add a monthly transaction table to the Overview page so a user can understand
the month's cash flow without leaving the dashboard. The user can move between
months and see the summary cards and table update together.

## Approved visual direction

Use the full-width table layout shown in the approved mockup:

- Keep the existing warm ivory, forest-green, rounded-card visual system.
- Place the table below the monthly summary cards.
- Make the table the primary detailed section of the Overview page.
- Put previous month, month selector, and next month controls in the table
  header at equal heights.
- Keep income green and expenses terracotta.

## Page behavior

### Selected month

- Initialize the selected month from the workspace time zone.
- The previous and next buttons change exactly one calendar month.
- The month picker allows direct selection of any month.
- Changing the selected month resets table pagination to the first page.
- The existing income, expense, and net summary cards use the same selected
  month as the table.

### Transaction rows

Include posted THB income and expense transactions whose financial date belongs
to the selected month. This matches the existing THB monthly summary cards and
prevents totals from combining currencies. Sort by financial date descending,
then use the transaction ID as a stable tie-breaker.

Display these columns:

1. วันที่
2. รายการ
3. หมวดหมู่
4. บัญชี
5. รายรับ
6. รายจ่าย
7. สุทธิสะสม

The item label uses the transaction note when present. Otherwise it falls back
to the category name, then to a localized income or expense label.

Income appears only in the income column and expense appears only in the
expense column. Empty money cells display an em dash. Money follows the
existing project formatter and currency rules.

`สุทธิสะสม` means cumulative cash flow within the selected month, starting at
zero. It is not the historical balance of an individual account. This wording
prevents the table from implying a historical account balance that the current
snapshot API does not provide.

### Monthly totals

Add a footer row labeled with the selected month. It displays:

- total income;
- total expense;
- net amount for the selected month.

These values must match the three summary cards.

### Row volume

- Show 10 rows per page on the Overview page.
- Provide previous and next page controls only when needed.
- “ดูรายการทั้งหมด” links to the existing Transactions page.

### Empty and error states

- If the month has no posted transactions, show a calm empty state inside the
  table card without hiding the month controls.
- The table is derived from the already-loaded finance snapshot, so it does not
  introduce a separate API error state.
- Existing page-level snapshot loading and connection errors remain unchanged.

## Component boundaries

### OverviewPage

Owns the selected month and table page state. It passes the selected month to
both the summary cards and the new table.

### SummaryCards

Keeps its current calculation responsibility but receives the user-selected
month instead of always receiving the current month.

### MonthlyTransactionTable

A focused new component responsible for:

- filtering posted transactions by selected month;
- resolving account and category labels;
- sorting and paginating rows;
- calculating monthly totals and cumulative monthly net;
- rendering desktop and mobile layouts.

Pure calculation helpers should remain separate from rendering so date
filtering, totals, stable ordering, and cumulative values can be tested without
the DOM.

## Responsive design

- Desktop and tablet use the full table.
- On narrow screens each row becomes a stacked transaction card with the date,
  item, category, account, and amount labels preserved.
- Month controls wrap as one group and retain equal heights.
- No horizontal page overflow is allowed.

## Accessibility

- Give the section a descriptive heading and the table a caption available to
  assistive technology.
- Month navigation buttons have explicit Thai accessible names.
- Income and expense must be distinguishable by labels and columns, not color
  alone.
- Pagination reports the current page and disables unavailable directions.

## Testing

Add tests that prove:

- the initial month follows the workspace time zone;
- previous, next, and direct month selection update both cards and rows;
- only posted transactions from the selected month are included;
- rows have stable descending order;
- account, category, and fallback item labels render correctly;
- income, expense, monthly net, and cumulative monthly net are exact;
- pagination resets when the month changes;
- the empty state keeps month controls usable;
- the mobile layout exposes the same information as the desktop table.

## Out of scope

- Historical per-account balances;
- transaction editing or deletion from the Overview page;
- new charts;
- new backend endpoints or database migrations;
- category analytics beyond the category label in each row.

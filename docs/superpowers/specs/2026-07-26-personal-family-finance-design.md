# Personal & Family Finance PWA — Design Specification

**Date:** 2026-07-26  
**Status:** Approved design, awaiting written-spec review  
**Primary language:** Thai  
**Base currency:** THB  
**Target operating cost:** 0 THB within provider free-tier limits

## 1. Executive summary

This product is an installable Progressive Web App (PWA) for personal and family financial planning. A person can begin with a private workspace and later create or join a family workspace without exposing private accounts to other members.

The system covers income, expenses, transfers, wallets, bank accounts, e-wallets, credit cards, installment purchases, debts, budgets, recurring bills, savings goals, assets, liabilities, net worth, multi-currency transactions, receipt OCR, notifications, offline drafts, export, and reporting.

The approved architecture uses Cloudflare Pages and Workers for the web application and server-side orchestration, with Supabase Free for authentication, PostgreSQL, private receipt storage, and Row Level Security (RLS). Receipt OCR runs on the user device for Thai and English whenever practical.

The most important product-specific feature is the installment and debt module. It supports 0% installments, flat-rate interest, reducing-balance interest, and a manually defined repayment schedule. Expense recognition, cash flow, principal, interest, and fees are separated so reports do not double-count money.

## 2. Confirmed product decisions

- Product type: personal and family finance, not business accounting.
- Main purpose: complete financial planning across cash flow, budget, savings, debt, and goals.
- Usage model: private by default; a user may invite family members later.
- Client: responsive installable PWA for phone and desktop.
- Hosting: Cloudflare Pages.
- Server-side API and scheduled work: Cloudflare Workers and Cron Triggers.
- Authentication, database, storage, and RLS: Supabase Free.
- Receipt OCR: Thai and English, primarily on-device.
- Currencies: multiple currencies, with THB as the reporting currency.
- Exchange rates: manually entered in the initial release; historical transactions retain the rate used when posted.
- Default locale and reporting timezone: Thai locale and Asia/Bangkok; timestamps are stored in UTC and financial dates are interpreted in the workspace timezone.
- Design approach: a modular system with a small primary navigation and advanced modules revealed when enabled.

## 3. Goals

1. Let a user record a normal transaction in roughly ten seconds.
2. Show an accurate answer to three questions: how much money is available now, where money went this month, and what obligations are approaching.
3. Track installment purchases and debts without double-counting the purchase, repayment, principal, or interest.
4. Support private and shared family finances with enforceable database-level permissions.
5. Continue to accept drafts while offline and synchronize safely when the connection returns.
6. Keep infrastructure usage within free-tier allowances for normal personal or family use.
7. Keep the user's data portable through CSV and JSON export and a verified restore path.

## 4. Explicit non-goals for the initial release

- Automatic bank-account synchronization.
- Real-time stock, fund, cryptocurrency, or foreign-exchange market feeds.
- Tax filing, payroll, invoicing, or business double-entry accounting.
- Native Android or iOS applications.
- Paid cloud OCR or paid generative-AI categorization.
- A public social network, lender marketplace, or credit-scoring product.

Assets and investments may be recorded manually for net-worth purposes. Automated price refresh is outside the initial release.

## 5. Product principles

### 5.1 Private by default

A private workspace and private account remain visible only to their owner. Creating a family workspace does not grant its owner access to another member's private accounts.

### 5.2 Money must reconcile

Account balances, transaction history, debt schedules, budget totals, and reports derive from the same posted financial records. A report must not maintain an independent editable copy of a balance.

### 5.3 Separate economic activity from cash movement

An installment purchase is an expense at purchase time and creates a liability. Later payments are cash movements that reduce principal and recognize interest or fees. This separation prevents duplicate expense reporting while preserving accurate cash-flow reporting.

### 5.4 Offline behavior is visible

The interface always identifies whether a record is saved, pending synchronization, conflicted, or failed. The system never pretends an unsynchronized change is safely stored on the server.

### 5.5 Advanced features stay out of the way

The default interface focuses on the dashboard, transactions, quick add, plans, and more. Multi-currency, assets, family sharing, and advanced reports appear when enabled or relevant.

## 6. Information architecture

The mobile primary navigation has five destinations. Desktop uses the same hierarchy in a sidebar.

### 6.1 Overview

- Available money across selected accounts.
- Income and expenses for the selected period.
- Budget status and projected overspend.
- Upcoming bills and installment payments.
- Savings-goal progress.
- Net worth and debt summary.
- Offline or review-required items.

### 6.2 Transactions

- Search, filters, and date/account/category/member views.
- List and calendar presentation.
- Draft, OCR-review, pending-sync, posted, and voided states.
- Receipt, note, tags, merchant, and split-category details.
- Private/family visibility indicator.

### 6.3 Quick add

- Income.
- Expense.
- Transfer.
- Installment purchase or new debt.
- Receipt scan.

### 6.4 Plans

- Category budgets.
- Recurring transactions and bills.
- Installments, credit cards, and debts.
- Savings goals.
- Forward cash-flow projection.

### 6.5 More

- Accounts and wallets.
- Assets, liabilities, and net worth.
- Reports.
- Family, members, and permissions.
- Categories, currencies, notifications, import/export, and settings.

## 7. Functional requirements

### 7.1 Authentication and onboarding

- Support email/password and email OTP through Supabase Auth.
- The first login creates a private workspace and guides the user through base currency, locale, initial accounts, and opening balances.
- An opening balance is represented explicitly as a balance-adjustment transaction, not hidden account metadata.
- A user can create or join a family workspace later.
- Sensitive destructive actions require recent authentication.

### 7.2 Accounts and wallets

Supported account types:

- Cash.
- Bank current or savings account.
- E-wallet.
- Credit card.
- Loan or installment liability.
- Manual asset account.

Each account has an owner, workspace, visibility, currency, opening date, opening balance record, optional institution, display order, and archived state. Archiving hides an account from normal entry but retains history.

### 7.3 Transactions

Supported transaction types:

- Income.
- Expense.
- Transfer.
- Balance adjustment.
- Debt disbursement.
- Installment purchase.
- Debt payment.
- Refund.

A transaction contains:

- Effective date and optional time.
- Posted state.
- Source amount and currency.
- Base-currency amount and exchange rate.
- Account or linked accounts.
- Category, optional subcategory, tags, merchant, and note.
- Private or family visibility.
- Creator and revision metadata.
- Optional receipt and OCR result.

A transaction may contain multiple splits. The sum of split amounts must equal the transaction amount after applying the defined rounding rule.

Credit-card purchases create an expense and increase the card liability. Paying the card reduces cash and the liability; it is not a second expense. A debt disbursement increases cash and a liability; it is not income.

### 7.4 Transfers

A transfer creates two linked account movements inside one database transaction. It is excluded from income and expense reports. Cross-currency transfers record the source amount, destination amount, both currencies, the applied rate, and any fee. A transfer cannot be posted if only one side is valid.

### 7.5 Receipt OCR

Receipt processing flow:

1. Capture or choose an image.
2. Correct orientation, crop, increase contrast, and resize locally.
3. Run Thai and English OCR on the device.
4. Extract candidate merchant, date, total, tax, currency, and line items.
5. Display confidence and require user confirmation.
6. Suggest a category using deterministic merchant history where possible.
7. Save the financial record only after confirmation.
8. Upload the compressed receipt image to a private bucket after permission is granted.

OCR never posts a transaction automatically. Failed OCR leaves the image and a manual-entry path available.

### 7.6 Budgets

- Monthly category budgets are the initial model.
- A budget may apply to a person, private workspace, or family workspace.
- The UI shows planned, posted actual, committed recurring, remaining, and projected month-end values.
- Transfers and principal repayments do not consume an expense budget.
- Purchase expense, interest, and fees may consume separate categories.
- Threshold notifications are configurable, with sensible defaults at 80%, 100%, and projected overspend.

### 7.7 Recurring transactions and bills

- Support daily, weekly, monthly, yearly, and custom interval recurrence.
- Support end date, occurrence count, and paused state.
- A recurring rule creates a draft or posted transaction based on user preference.
- Bills remain pending until marked paid or matched to a transaction.
- Cron processing is idempotent; running the same occurrence twice cannot create duplicates.

### 7.8 Savings goals

- A goal has a target amount, target date, currency, workspace, contributors, and optional linked account.
- Contributions may be explicit transfers or progress-only entries.
- The system calculates required monthly contribution and expected completion date.
- Goal progress does not alter account balances unless backed by a real transaction.

### 7.9 Assets, liabilities, and net worth

- Assets and liabilities are manually created and valued.
- A valuation snapshot records value, currency, base value, date, and source note.
- Net worth equals selected assets and positive account balances minus liabilities and credit balances.
- The report exposes included and excluded accounts so the calculation is auditable.
- Automated investment pricing is not included.

### 7.10 Multi-currency

Every posted foreign-currency record stores:

- Source amount.
- Source currency.
- Base currency.
- Exchange rate.
- Base amount.
- Rate date and manual source label.

Changing the default rate later does not rewrite a posted transaction. A user may explicitly edit the transaction, which creates a revision. Reports aggregate using stored base amounts and retain access to original amounts.

Money is stored as `numeric(20,4)` and exchange rates as `numeric(20,10)`. User-facing totals round to the currency's minor unit using round-half-away-from-zero. Any split or installment residual caused by rounding is assigned to the final component so the stored components reconcile exactly to the transaction or contract total.

### 7.11 Family workspaces

- A user can own or join a family workspace.
- Shared accounts and transactions belong to the family workspace.
- Private accounts remain in the user's private workspace.
- A family expense identifies payer, beneficiary workspace, and optional contribution shares.
- Family reports can show total shared spending and contribution by member.
- Leaving a family preserves audit history and removes future access according to role and ownership rules.

### 7.12 Notifications

Notification types:

- Upcoming installment or debt payment.
- Upcoming recurring bill.
- Overdue obligation.
- Budget threshold or projected overspend.
- Goal contribution reminder.
- Failed synchronization or required conflict review.
- Receipt OCR awaiting confirmation.

Web Push is optional and permission-based. In-app notifications remain available when push is denied.

### 7.13 Import, export, and backup

- CSV import supports an explicit column-mapping and preview step.
- CSV export supports transactions and reports.
- JSON export includes the complete portable logical dataset and metadata version.
- Receipt binaries may be exported separately with a manifest.
- Restore runs validation and preview before writing.
- Import and restore use idempotency identifiers and never silently overwrite existing records.

## 8. Installment and debt module

### 8.1 Contract data

An installment or debt contract stores:

- Product or debt name.
- Creditor and optional merchant.
- Purchase cash price or original principal.
- Down payment.
- Financed principal.
- Contract currency and base-currency values.
- Interest method.
- Rate value and whether it is annual or per-period.
- Number of periods and frequency.
- First due date.
- Fees and late-fee rule.
- Funding account or credit card.
- Expense category and interest category.
- Private or family workspace.
- Contract status: draft, active, paid off, cancelled, or defaulted.

### 8.2 Supported interest methods

#### Zero interest

The scheduled principal is divided across the periods. Any rounding residual is applied to the final period.

#### Flat rate

For an annual rate and monthly term:

`total_interest = financed_principal × annual_rate × term_months / 12`

`scheduled_total = financed_principal + total_interest + financed_fees`

The initial release distributes principal and interest evenly unless the creditor's real schedule is entered manually. Rounding residuals are assigned to the final installment.

#### Reducing balance

The initial reducing-balance calculator supports equal monthly payments. Other payment frequencies use the manual schedule in the initial release.

For equal monthly payments:

`periodic_rate = annual_rate / 12`

`payment = principal × periodic_rate × (1 + periodic_rate)^n / ((1 + periodic_rate)^n - 1)`

When the periodic rate is zero, payment equals principal divided by the number of periods. Each period calculates interest from the opening principal; the remainder of the payment reduces principal. The final payment is adjusted to make the remaining principal exactly zero.

#### Manual schedule

The user enters each due date and principal, interest, and fee allocation. Validation requires the scheduled principal allocations to equal the financed principal before posting.

### 8.3 Schedule and payments

Each installment contains:

- Sequence number.
- Due date.
- Opening principal.
- Scheduled principal.
- Scheduled interest.
- Scheduled fees.
- Scheduled total.
- Paid principal, interest, fees, and penalty.
- Paid date and linked payment transaction.
- Status: upcoming, due, partially paid, paid, overdue, waived, or cancelled.

A payment is allocated in an explicit order shown to the user. The default is penalty, fee, interest, then principal, but the stored allocation may be corrected to match the creditor statement.

### 8.4 Extra payment and early payoff

- A reducing-balance contract recalculates future interest from the new remaining principal.
- The user chooses whether an extra payment lowers future payments or shortens the term.
- A flat-rate contract does not assume an interest rebate. A verified rebate from the creditor is recorded as an adjustment.
- Early payoff displays the outstanding principal, accrued interest, fees, proposed adjustment, and resulting cash transaction before confirmation.

### 8.5 Reporting treatment

- The cash purchase price is recognized once as the purchase expense.
- The financed portion creates a liability.
- Down payment is immediate cash outflow.
- Later principal payments reduce cash and liability but are not a second purchase expense.
- Interest and fees are expenses only when a payment or explicit posted charge records them. Unpaid scheduled interest remains a forecast and is not included in actual expense totals.
- Cash-flow reports show actual cash movements by date.
- Debt reports show outstanding principal, remaining interest, next payment, payoff date, and payment-to-income ratio.

## 9. Dashboard and reports

### 9.1 Dashboard

The dashboard shows:

- Available money.
- Current-period income and expenses.
- Net cash flow.
- Net worth.
- Budget remaining and at-risk categories.
- Upcoming bills and installments.
- Total debt, remaining interest, next payment, and payment-to-income ratio.
- Savings-goal progress.
- Six-month income and expense trend.
- Items requiring review or synchronization.

All cards support a private/family scope filter, account filter, and period selector.

Available money includes selected liquid asset accounts and excludes credit limits, liabilities, archived accounts, and restricted goal accounts unless explicitly included. Payment-to-income ratio equals scheduled debt payments for the current month divided by average posted monthly income from the three preceding complete months; the UI discloses the formula and shows “insufficient history” when the denominator is unavailable.

### 9.2 Reports

- Income and expenses by period, category, merchant, member, tag, and account.
- Budget versus actual and projected month-end.
- Cash-flow history and forecast.
- Debt amortization, principal, interest, fees, and early-payoff simulation.
- Net-worth history and asset/liability composition.
- Savings-goal progress and required contribution.
- Family shared expenses and contribution shares.
- Recurring obligations and monthly fixed-cost ratio.
- Multi-currency original and THB-equivalent amounts.

Reports disclose filters, base currency, and whether pending records are included.

## 10. Roles and authorization

### Owner

- Full family-workspace administration.
- Invite, remove, and change roles.
- Manage shared accounts and settings.
- Delete the family workspace after re-authentication.
- No automatic access to another member's private workspace.

### Administrator

- Manage shared accounts, budgets, debts, goals, and ordinary members.
- Cannot delete the family workspace.
- Cannot access private workspaces.

### Member

- Manage their private workspace.
- Read and add records to permitted shared accounts.
- Edit shared records according to explicit policy.

### Viewer

- Read permitted shared dashboards and reports.
- Cannot create or edit financial records.

RLS policies enforce membership, role, workspace, owner, and record visibility. UI authorization is supplementary and not the security boundary.

## 11. System architecture

### 11.1 Client

- Responsive TypeScript PWA.
- Application shell served from Cloudflare Pages.
- Service Worker for shell caching and controlled background synchronization.
- IndexedDB for offline drafts, queued mutations, and temporary receipt images.
- On-device Thai/English OCR.

The exact UI framework and supporting libraries will be fixed in the implementation plan, while the interfaces in this specification remain framework-independent.

### 11.2 Cloudflare Workers

- Validate requests and authentication context.
- Execute business operations that require privileged orchestration.
- Generate signed receipt access requests through approved server-side paths.
- Run idempotent scheduled work for recurrence and notifications.
- Keep secrets outside the client.

Ordinary user-scoped reads and mutations may call Supabase using the user's session when RLS is sufficient. Privileged or multi-record financial operations go through Worker endpoints or PostgreSQL functions with explicit authorization.

### 11.3 Supabase

- Supabase Auth for identity.
- PostgreSQL for financial and configuration data.
- Private Storage bucket for receipts.
- RLS on every user- or workspace-owned table.
- Transactional PostgreSQL functions for transfer, installment payment, payoff, restore, and other atomic operations.

### 11.4 Data flow

1. The client validates input and creates a client mutation identifier.
2. If offline, it stores the draft or mutation in IndexedDB.
3. If online, it sends the mutation with the Supabase session.
4. Worker/PostgreSQL revalidates authorization and financial constraints.
5. The database commits all related records atomically.
6. The response returns the authoritative record version and calculated totals.
7. The client replaces optimistic values and updates the offline cache.

## 12. Data model

Core logical tables:

- `profiles`
- `workspaces`
- `workspace_members`
- `accounts`
- `categories`
- `tags`
- `merchants`
- `transactions`
- `transaction_splits`
- `transfer_links`
- `attachments`
- `ocr_results`
- `exchange_rates_used`
- `recurring_rules`
- `recurring_occurrences`
- `budgets`
- `budget_lines`
- `installment_contracts`
- `installment_schedules`
- `debt_payments`
- `payment_allocations`
- `savings_goals`
- `goal_contributions`
- `assets`
- `valuation_snapshots`
- `notifications`
- `push_subscriptions`
- `audit_events`
- `import_jobs`
- `sync_mutations`

Every workspace-owned table includes a workspace identifier. User-specific records include an owner identifier where needed. Financial tables include created/updated timestamps, creator/updater, record version, and soft-delete or void metadata.

Money uses an exact database numeric representation, never binary floating point. The implementation plan will standardize the application money type and rounding helpers. Currency codes use ISO 4217 values where applicable.

## 13. Record state and integrity rules

- Transaction states: draft, review required, posted, voided.
- Reports include posted records by default.
- Posted financial records may be corrected through an auditable revision or void-and-replace operation.
- Deletion of material financial history is soft and recoverable until workspace deletion.
- A transfer, installment payment, and early payoff are atomic multi-record operations.
- Database constraints reject impossible currency, amount, date, ownership, and allocation combinations.
- Client mutation identifiers and occurrence keys prevent duplicate synchronization and Cron output.
- Aggregate balances are calculated from canonical posted records or transactionally maintained projections that can be rebuilt.

## 14. Offline synchronization and conflicts

- Offline mode supports app-shell access, cached recent data, and new or edited drafts.
- Posted changes may be queued with a base record version.
- Each mutation has a globally unique client identifier.
- The server stores processed identifiers and returns the original result on safe retry.
- If the server version changed after the offline base version, the mutation becomes a conflict.
- Conflicts display local and server values. The user chooses local, server, or a merged edit.
- Receipt binaries remain queued until upload succeeds; the transaction can remain in review-required state.
- Logging out removes sensitive cached data and temporary images.
- No silent last-write-wins behavior is used for financial records.

## 15. Security and privacy

- RLS is mandatory on all user and workspace data.
- Supabase service credentials never enter client bundles.
- Cloudflare secrets store server credentials.
- Receipt storage is private and accessed through short-lived signed URLs.
- Uploads are restricted by type and size and are resized before storage.
- Audit events record actor, time, action, entity, and safe before/after fields.
- Passwords, session tokens, full OCR text, and receipt image content are excluded from technical logs.
- Workspace deletion, ownership transfer, and destructive restore require recent authentication and confirmation.
- Export is available to preserve user control and provider portability.

## 16. Error handling and observability

- Client errors identify the affected action and whether retry is safe.
- Validation errors name the field and rule that failed.
- Business errors use stable codes such as insufficient balance, duplicate occurrence, schedule mismatch, already-paid installment, stale version, and forbidden workspace.
- Multi-record failures roll back completely.
- Failed OCR always offers manual entry.
- Failed background work records an occurrence error and retries with bounded backoff.
- Technical logs contain correlation identifiers but not sensitive financial content.
- A user-visible diagnostics page shows synchronization state, pending items, last successful sync, and provider-quota warnings.

## 17. Free-tier operating strategy

- Serve immutable application assets from Cloudflare Pages.
- Cache static assets aggressively and avoid unnecessary Worker calls.
- Use direct RLS-protected Supabase access for safe user-scoped operations.
- Batch Cron work and notification preparation.
- Compress receipt images before upload and apply user-visible retention controls.
- Avoid storing redundant OCR artifacts after confirmation.
- Paginate transaction history and load reports for bounded periods.
- Display storage, database, and request usage warnings before limits are reached.

The system targets current free tiers but does not assume provider limits are permanent. Provider-specific limits remain configuration and operational concerns, not embedded business rules.

## 18. Testing strategy

### Unit tests

- Exact money arithmetic and rounding.
- Currency conversion using stored rates.
- Split validation.
- Budget calculations.
- Zero-interest, flat-rate, reducing-balance, and manual schedules.
- Partial payment, extra payment, late payment, and payoff.
- Recurrence and due-date edge cases.

### Database and authorization tests

- Constraints and atomic rollback.
- RLS matrix for every role and private/shared combination.
- Cross-workspace access denial.
- Idempotency and duplicate occurrence prevention.
- Audit record creation.

### Integration tests

- PWA to Worker to Supabase.
- Authentication refresh and expiry.
- Private receipt upload and signed access.
- Cron recurrence and notifications.
- Export and restore.

### Offline tests

- Create and edit while offline.
- Network loss during mutation.
- Retry after uncertain response.
- Duplicate synchronization.
- Conflict between two devices.
- Receipt upload failure and recovery.

### End-to-end tests

- Onboarding and opening balances.
- Income, expense, split, transfer, and refund.
- Receipt scan and confirmation.
- Create installment contract and pay multiple installments.
- Extra payment and early payoff.
- Budget alert and recurring bill.
- Family invite and private-data isolation.
- Multi-currency transaction and report.

### Compatibility and security tests

- Current Chrome, Edge, and mobile Safari behavior.
- Responsive phone and desktop layouts.
- PWA installation and update.
- Signed URL expiration and unauthorized access.
- Secret absence from client output and logs.

## 19. Delivery sequence

### Phase 1 — Financial core

Authentication, private workspace, accounts, categories, transactions, transfers, receipts, dashboard basics, export, PWA shell, and offline drafts.

### Phase 2 — Installments and debt

All interest methods, schedule generation, payments, extra payments, payoff, reminders, and debt reports.

### Phase 3 — Planning and automation

Budgets, recurring bills, savings goals, cash-flow forecast, on-device OCR, and Web Push.

### Phase 4 — Family and full financial picture

Family roles, shared accounts, multi-currency, manual assets and valuations, net worth, complete reports, audit history, import, backup, and restore.

Each phase must preserve data compatibility with later phases. A phase is not complete until its financial calculation, RLS, offline, and restore tests pass.

## 20. Acceptance criteria

The release is ready for personal/family use when:

1. A normal transaction can be recorded quickly on phone and desktop.
2. Account balances, reports, and installment schedules reconcile.
3. Retried or duplicate synchronization never creates duplicate financial activity.
4. Family roles cannot access other members' private records.
5. Offline drafts survive application restart and synchronize without loss.
6. Installments correctly separate purchase expense, cash outflow, principal, interest, and fees.
7. Early payoff and extra payment show a confirmation preview and produce a zero-reconciling schedule.
8. Multi-currency reports use the stored transaction rate and disclose original amounts.
9. Complete logical data can be exported and restored into an empty workspace.
10. Provider usage can be monitored and normal use remains within configured free-tier budgets.

## 21. Design completion statement

This specification resolves the product scope, core behavior, architecture, security boundary, financial calculation model, offline model, error handling, testing approach, and delivery sequence. There are no unresolved placeholders in the approved design. Implementation planning may select specific frontend libraries and repository structure, but may not change the financial or permission semantics defined here without a design revision.

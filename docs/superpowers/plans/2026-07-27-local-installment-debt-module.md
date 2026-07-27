# Local Installment and Debt Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved local-first installment and debt module with zero-interest, flat-rate, reducing-balance, and manual schedules; exact principal/interest/fee separation; payment tracking; and payoff simulation.

**Architecture:** Pure domain calculators generate immutable exact-money schedules from typed contracts. The web local data layer persists contracts, schedules, and payments beside the existing accounts and transactions, while React pages consume only typed local API methods. Supabase tables, RLS, and Worker routes are a later adapter over the same contracts after local behavior is accepted.

**Tech Stack:** TypeScript, Decimal.js through `@systems-credit/domain`, Zod contracts, React 19, Vitest, Testing Library, browser `localStorage`, Supabase/PostgreSQL in the later cloud-adapter task.

## Global Constraints

- Never convert money or interest-rate strings through JavaScript `Number`.
- Store and calculate money as exact decimal strings; round currency amounts with `roundMoney` and assign residuals to the final schedule row.
- Default timezone is `Asia/Bangkok`, default currency is `THB`, and financial dates are `YYYY-MM-DD`.
- A purchase expense is recognized once at contract creation; later payments separate principal, interest, fees, and cash flow so reports do not double-count principal.
- Local mode must remain explicitly labelled non-production authentication and device-only persistence.
- Supported calculated schedules are monthly. Other frequencies use the manual schedule.

---

### Task 1: Exact installment schedule domain

**Files:**
- Create: `packages/contracts/src/installments.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `packages/domain/src/installments.ts`
- Modify: `packages/domain/src/index.ts`
- Test: `packages/domain/test/installments.test.ts`

**Interfaces:**
- Consumes: `roundMoney`, `parseMoney`, and `CurrencyCode` from `@systems-credit/domain`.
- Produces: `InstallmentInterestMethod`, `CreateInstallmentContractInput`, `InstallmentScheduleRow`, `generateInstallmentSchedule(input)`, and `validateManualSchedule(input)`.

- [ ] **Step 1: Write failing zero-interest and flat-rate tests**

```ts
it("allocates a zero-interest principal residual to the final installment", () => {
  const rows = generateInstallmentSchedule({
    principal: "1000.00",
    financedFees: "0.00",
    currency: "THB",
    interestMethod: "zero",
    annualRate: "0",
    periods: 3,
    firstDueDate: "2026-08-31"
  });
  expect(rows.map((row) => row.principal)).toEqual([
    "333.33",
    "333.33",
    "333.34"
  ]);
  expect(rows.map((row) => row.dueDate)).toEqual([
    "2026-08-31",
    "2026-09-30",
    "2026-10-31"
  ]);
});

it("calculates flat annual interest without counting principal as interest", () => {
  const rows = generateInstallmentSchedule({
    principal: "12000.00",
    financedFees: "0.00",
    currency: "THB",
    interestMethod: "flat",
    annualRate: "12",
    periods: 12,
    firstDueDate: "2026-08-01"
  });
  expect(sumRows(rows, "principal")).toBe("12000.00");
  expect(sumRows(rows, "interest")).toBe("1440.00");
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npm exec -w @systems-credit/domain vitest run test/installments.test.ts`  
Expected: FAIL because `generateInstallmentSchedule` does not exist.

- [ ] **Step 3: Implement zero-interest and flat-rate schedules**

Use Decimal.js values returned by `parseMoney`. Divide principal, total flat interest (`principal × annualRate ÷ 100 × periods ÷ 12`), and financed fees evenly. Round each non-final row, then set the final row to total minus all prior rows. Calculate opening and closing principal for every row. Add calendar months using UTC date parts and clamp the day to the final day of the target month.

- [ ] **Step 4: Write failing reducing-balance and manual validation tests**

```ts
it("ends a reducing-balance schedule at exactly zero principal", () => {
  const rows = generateInstallmentSchedule({
    principal: "100000.00",
    financedFees: "0.00",
    currency: "THB",
    interestMethod: "reducing",
    annualRate: "8",
    periods: 12,
    firstDueDate: "2026-08-15"
  });
  expect(rows.at(-1)?.closingPrincipal).toBe("0.00");
  expect(rows[0].interest).toBe("666.67");
});

it("rejects a manual schedule whose principal does not reconcile", () => {
  expect(() => validateManualSchedule({
    principal: "1000.00",
    currency: "THB",
    rows: [
      { dueDate: "2026-08-01", principal: "400.00", interest: "0.00", fees: "0.00" },
      { dueDate: "2026-09-01", principal: "400.00", interest: "0.00", fees: "0.00" }
    ]
  })).toThrow("INSTALLMENT_PRINCIPAL_MISMATCH");
});
```

- [ ] **Step 5: Implement reducing balance and manual validation**

For reducing balance, use monthly rate `annualRate ÷ 100 ÷ 12` and payment formula `P × r × (1+r)^n ÷ ((1+r)^n-1)`. Each row interest is opening principal times monthly rate, principal is payment minus interest, and the final principal is the exact remaining balance. Manual rows must have ascending unique due dates, non-negative components, positive principal allocation, and a total principal exactly equal to the contract principal.

- [ ] **Step 6: Verify and commit**

Run: `npm exec -w @systems-credit/domain vitest run test/installments.test.ts && npm run typecheck`  
Expected: PASS.

```bash
git add packages/contracts packages/domain
git commit -m "feat: add exact installment schedule domain"
```

---

### Task 2: Local contract persistence and lifecycle

**Files:**
- Modify: `apps/web/src/lib/finance-api.ts`
- Modify: `apps/web/src/lib/local-finance-api.ts`
- Test: `apps/web/src/lib/local-finance-api.test.ts`

**Interfaces:**
- Consumes: `generateInstallmentSchedule` and `CreateInstallmentContractInput`.
- Produces: `createInstallmentContract(input)`, `getSnapshot().installmentContracts`, and `getSnapshot().installmentSchedules`.

- [ ] **Step 1: Write a failing persistence test**

Create a THB loan with principal `12000.00`, flat rate `12`, 12 periods, reload the API from the same `Storage`, and assert that the contract remains active, scheduled principal totals `12000.00`, and scheduled interest totals `1440.00`.

- [ ] **Step 2: Run test and verify RED**

Run: `npm exec -w @systems-credit/web vitest run src/lib/local-finance-api.test.ts`  
Expected: FAIL because `createInstallmentContract` is absent.

- [ ] **Step 3: Implement local lifecycle**

Persist contract status `draft | active | paid_off | cancelled | defaulted`, exact original principal, down payment, financed principal, fees, interest method/rate, periods, first due date, linked funding account, categories, and generated schedule rows. Reject workspace/account mismatches and duplicate contract names only when both active.

- [ ] **Step 4: Verify and commit**

Run: `npm exec -w @systems-credit/web vitest run src/lib/local-finance-api.test.ts && npm run -w @systems-credit/web typecheck`  
Expected: PASS.

```bash
git add apps/web/src/lib
git commit -m "feat: persist local installment contracts"
```

---

### Task 3: Installment creation wizard and schedule preview

**Files:**
- Create: `apps/web/src/features/installments/installment-form.tsx`
- Create: `apps/web/src/features/installments/schedule-preview.tsx`
- Create: `apps/web/src/features/installments/installments-page.tsx`
- Test: `apps/web/src/features/installments/installment-form.test.tsx`
- Modify: `apps/web/src/app/router.tsx`
- Modify: `apps/web/src/app/layout.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: local contract API, accounts, expense categories, and schedule generator.
- Produces: routes `/installments` and `/installments/new`, creation form, contract cards, and exact schedule preview.

- [ ] **Step 1: Write a failing form test**

Fill product name, original principal `12000.00`, down payment `2000.00`, flat annual rate `12`, 10 periods, first due date, and assert the API receives original strings plus financed principal `10000.00`.

- [ ] **Step 2: Run test and verify RED**

Run: `npm exec -w @systems-credit/web vitest run src/features/installments/installment-form.test.tsx`  
Expected: FAIL because the form is absent.

- [ ] **Step 3: Implement accessible Thai wizard**

Provide installment/debt type, name, creditor, principal, down payment, financed fees, zero/flat/reducing/manual method, annual rate, periods, first due date, optional funding account, expense category, and interest category. Show a live schedule with due date, opening principal, principal, interest, fees, total, and closing principal. Never parse inputs through `Number`.

- [ ] **Step 4: Verify and commit**

Run: `npm exec -w @systems-credit/web vitest run src/features/installments && npm run -w @systems-credit/web typecheck`  
Expected: PASS.

```bash
git add apps/web
git commit -m "feat: add local installment contract UI"
```

---

### Task 4: Payment allocation and account posting

**Files:**
- Modify: `packages/contracts/src/installments.ts`
- Modify: `packages/domain/src/installments.ts`
- Test: `packages/domain/test/installment-payments.test.ts`
- Modify: `apps/web/src/lib/finance-api.ts`
- Modify: `apps/web/src/lib/local-finance-api.ts`
- Create: `apps/web/src/features/installments/installment-payment-form.tsx`
- Test: `apps/web/src/features/installments/installment-payment-form.test.tsx`

**Interfaces:**
- Consumes: active contract, due schedule rows, and payment account balance.
- Produces: `allocateInstallmentPayment`, `postInstallmentPayment`, payment transaction links, and updated schedule status.

- [ ] **Step 1: Write failing allocation tests**

Assert a payment allocates penalty, fees, interest, then principal; a partial payment marks the row `partially_paid`; and paying the full scheduled amount marks it `paid` without reporting principal as a new expense.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm exec -w @systems-credit/domain vitest run test/installment-payments.test.ts`  
Expected: FAIL because payment allocation is absent.

- [ ] **Step 3: Implement exact allocation and atomic local posting**

Allocate against remaining row components in the configured order. Decrease a liquid payment account by total cash paid, reduce the liability by paid principal, add only interest/fees/penalty to expense reporting, persist one linked payment record, and reject replayed payment identifiers.

- [ ] **Step 4: Implement payment form and verify**

The form selects contract row and payment account, displays allocation before posting, and requires explicit confirmation. Run `npm test -- --run apps/web/src/features/installments packages/domain/test/installment-payments.test.ts && npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add packages apps/web
git commit -m "feat: add installment payment allocation"
```

---

### Task 5: Extra payment and payoff simulation

**Files:**
- Modify: `packages/domain/src/installments.ts`
- Test: `packages/domain/test/installment-payoff.test.ts`
- Modify: `apps/web/src/lib/local-finance-api.ts`
- Create: `apps/web/src/features/installments/payoff-simulator.tsx`
- Test: `apps/web/src/features/installments/payoff-simulator.test.tsx`

**Interfaces:**
- Consumes: current remaining principal, unpaid rows, payment date, quoted fees, and reducing annual rate.
- Produces: `simulateInstallmentPayoff` and `postInstallmentPayoff`.

- [ ] **Step 1: Write failing payoff tests**

Assert extra principal on reducing balance recalculates future interest, the final row remains exactly zero, and zero/flat contracts do not invent an interest rebate without a manual quoted adjustment.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm exec -w @systems-credit/domain vitest run test/installment-payoff.test.ts`  
Expected: FAIL because payoff simulation is absent.

- [ ] **Step 3: Implement simulation and confirmation UI**

Show current principal, accrued/quoted interest, fees, total cash required, interest saved when applicable, and regenerated future rows. Posting requires a fresh client mutation ID and stores the accepted quote inputs.

- [ ] **Step 4: Verify and commit**

Run: `npm test -- --run packages/domain/test/installment-payoff.test.ts apps/web/src/features/installments && npm run typecheck`  
Expected: PASS.

```bash
git add packages apps/web
git commit -m "feat: add installment payoff simulation"
```

---

### Task 6: Supabase and Worker adapter after local acceptance

**Files:**
- Create: `supabase/migrations/202607270009_installment_contracts.sql`
- Create: `supabase/tests/database/installment_contracts.test.sql`
- Create: `workers/api/src/routes/installments.ts`
- Create: `workers/api/test/installments.test.ts`
- Modify: `workers/api/src/app.ts`

**Interfaces:**
- Consumes: approved contracts and domain functions from Tasks 1–5.
- Produces: RLS-protected installment tables and `POST /v1/installments`, `POST /v1/installments/:id/payments`, and `POST /v1/installments/:id/payoff`.

- [ ] **Step 1: Write failing RLS and route tests**

Prove non-members cannot read or mutate contracts, schedule/payment posting is idempotent, stale versions are rejected, and principal/interest/fee/account-balance updates are atomic.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- --run workers/api/test/installments.test.ts && npm run test:db`  
Expected: FAIL because migrations and routes are absent.

- [ ] **Step 3: Implement cloud adapter**

Use PostgreSQL `numeric(20,4)` money, `numeric(20,10)` rates, explicit workspace membership checks, version columns, audit events, and transactional SQL functions for payment/payoff posting. Do not make cloud auth or persistence active in the web app until environment configuration is supplied.

- [ ] **Step 4: Verify and commit**

Run: `npm test -- --run && npm run test:db && npm run typecheck && npm run build`  
Expected: PASS.

```bash
git add supabase workers
git commit -m "feat: add installment cloud adapter"
```

---

## Self-Review

- Spec coverage: zero, flat, reducing, manual schedules, exact residual handling, component-level payment allocation, extra payment, payoff, statuses, Local persistence, UI, and later Supabase/RLS are mapped to Tasks 1–6.
- Deliberate initial limitation: calculated schedules are monthly; non-monthly frequencies require manual rows, matching the approved initial-release rule.
- Placeholder scan: no TODO/TBD placeholders or undefined “handle appropriately” steps remain.
- Type consistency: contract → domain → local API → UI → cloud adapter uses the same contract and schedule names throughout.

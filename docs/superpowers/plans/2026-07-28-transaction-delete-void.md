# Transaction Delete as Auditable Void Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ให้ผู้ใช้ลบรายรับหรือรายจ่ายทั่วไปที่บันทึกผิดได้ โดยย้อนยอดบัญชี เก็บ audit และดูรายการที่ลบแล้วได้จากตัวกรอง

**Architecture:** ใช้ `POST /v1/transactions/:id/void` และ PostgreSQL `void_transaction` เดิมเป็น mutation เดียวเพื่อย้อนยอดและเขียน audit เพิ่ม migration แบบ additive เพื่อให้ finance snapshot ส่งทั้งรายการ `posted` และ `void` พร้อม source/void metadata เว็บกรองสถานะในหน่วยความจำและอนุญาต action เฉพาะรายการที่ไม่มี source จากโมดูลอื่น

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Testing Library, Hono, Zod, PostgreSQL/Supabase, PGlite

## Global Constraints

- ใช้สถานะ `void`; ห้าม hard-delete แถวใน `transactions`, `transaction_splits`, `transaction_tags` หรือ `audit_events`
- ปุ่มลบครอบคลุมเฉพาะ `income`/`expense` ที่ `source` ไม่มีค่า
- ห้ามลบผ่านหน้านี้เมื่อ source เป็น `transfer_fee`, `installment_payment`, `installment_payoff` หรือ `recurring_occurrence`
- มุมมองเริ่มต้นแสดงเฉพาะ `posted`; ประวัติแสดงเฉพาะ `void`
- เหตุผลเริ่มต้นคือ `บันทึกรายการผิด` และค่าที่ส่งต้องยาว 1–200 ตัวอักษรหลัง trim
- mutation ต้องส่ง version จาก snapshot และพึ่ง `void_transaction` ป้องกัน stale/double reversal
- ยอดบัญชีและรายงานยังคำนวณเฉพาะรายการ `posted`
- ใช้ Kanit และรูปแบบ dialog ในหน้า ห้ามใช้ `window.confirm`
- ไม่เพิ่ม dependency ใหม่
- ทุก production change ต้องเริ่มด้วย failing test และต้องเห็น RED ก่อน GREEN

---

## File Structure

- `packages/contracts/src/finance-snapshot.ts`: read model ของรายการปัจจุบันและรายการที่ void
- `packages/contracts/test/finance-snapshot.test.ts`: contract regression สำหรับ state, version, void metadata และ source
- `supabase/migrations/202607280015_transaction_void_history.sql`: projection ของ transaction history ใน snapshot
- `workers/api/test/finance-snapshot-database.test.ts`: ทดสอบ projection, source และยอดหลัง void กับ PostgreSQL จริงใน PGlite
- `apps/web/src/lib/finance-api.ts`: เพิ่ม interface `voidTransaction`
- `apps/web/src/lib/remote-finance-api.ts`: mapping จาก web client ไป endpoint เดิม
- `apps/web/src/lib/remote-finance-api.test.ts`: ตรวจ path, payload, response และ auth boundary
- `apps/web/src/features/transactions/transaction-list.tsx`: ตัวกรอง รายการ void และปุ่ม request delete
- `apps/web/src/features/transactions/transaction-list.test.tsx`: presentational behavior ของรายการและ source guard
- `apps/web/src/features/transactions/transaction-void-dialog.tsx`: dialog ยืนยันและ validation เหตุผล
- `apps/web/src/features/transactions/transaction-void-dialog.test.tsx`: dialog success, validation, pending และ error
- `apps/web/src/features/transactions/transactions-page.tsx`: เชื่อมรายการ dialog API และ snapshot refresh
- `apps/web/src/features/transactions/transactions-page.test.tsx`: integration ของ page state กับ API
- `apps/web/src/styles.css`: responsive actions, filter, void state และ dialog

---

### Task 1: Expand the Finance Transaction Read Contract

**Files:**
- Modify: `packages/contracts/test/finance-snapshot.test.ts`
- Modify: `packages/contracts/src/finance-snapshot.ts`

**Interfaces:**
- Consumes: `transactionStateSchema` จาก `packages/contracts/src/transactions.ts`
- Produces: `FinanceTransaction` ที่มี `state: "posted" | "void"`, `version: number`, optional `voidedAt`, optional `voidReason`, และ optional `source`

- [ ] **Step 1: Write the failing contract test**

เพิ่ม test ที่ใช้ literal fixture และตรวจ production break: schema แบบเดิมต้องปฏิเสธ `void`, version 2 และ source ใหม่

```ts
it("parses void transaction history and module sources", () => {
  const transaction = {
    id: "10000000-0000-4000-8000-000000000001",
    workspaceId: "20000000-0000-4000-8000-000000000002",
    accountId: "30000000-0000-4000-8000-000000000003",
    type: "expense",
    amount: "125.50",
    currency: "THB",
    financialDate: "2026-07-28",
    categoryId: "40000000-0000-4000-8000-000000000004",
    tagIds: [],
    state: "void",
    version: 2,
    createdAt: "2026-07-28T04:00:00.000Z",
    voidedAt: "2026-07-28T05:00:00.000Z",
    voidReason: "บันทึกรายการผิด",
    source: "recurring_occurrence",
    sourceId: "50000000-0000-4000-8000-000000000005"
  } as const;

  expect(
    financeSnapshotSchema.parse({
      ...emptySnapshot,
      transactions: [transaction]
    }).transactions[0]
  ).toEqual(transaction);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npx vitest --run packages/contracts/test/finance-snapshot.test.ts
```

Expected: FAIL เพราะ `state` รับเฉพาะ `posted`, `version` รับเฉพาะ `1` หรือ `source` ไม่รู้จัก `recurring_occurrence`

- [ ] **Step 3: Implement the minimal contract**

แก้ `financeTransactionSchema`:

```ts
state: z.enum(["posted", "void"]),
version: versionSchema,
createdAt: timestampSchema,
voidedAt: timestampSchema.optional(),
voidReason: z.string().min(1).max(200).optional(),
source: z
  .enum([
    "transfer_fee",
    "installment_payment",
    "installment_payoff",
    "recurring_occurrence"
  ])
  .optional(),
sourceId: uuidSchema.optional()
```

ห้ามเปลี่ยน `openingTransactionSchema`; ยอดยกมายังคงเป็น `posted` version 1 ใน snapshot

- [ ] **Step 4: Run the focused contract tests and verify GREEN**

Run:

```powershell
npx vitest --run packages/contracts/test/finance-snapshot.test.ts
```

Expected: 6 tests PASS

- [ ] **Step 5: Commit the contract**

```powershell
git add packages/contracts/src/finance-snapshot.ts packages/contracts/test/finance-snapshot.test.ts
git commit -m "feat: expose void transaction history contract"
```

---

### Task 2: Project Voided Transactions and Module Sources from PostgreSQL

**Files:**
- Create: `supabase/migrations/202607280015_transaction_void_history.sql`
- Modify: `workers/api/test/finance-snapshot-database.test.ts`

**Interfaces:**
- Consumes: `public.snapshot_transactions(uuid)`, `public.void_transaction(uuid, integer, text)`, transfer/installment/recurring link tables
- Produces: snapshot JSON matching the expanded `FinanceTransaction`

- [ ] **Step 1: Extend the database test with a voided manual transaction**

เปลี่ยนผลของ `post_transaction` ให้จับ `transactionId`, void ด้วย version 1 และตรวจ literal state/version/reason กับยอดที่ย้อน:

```ts
const posted = await database.query<{
  result: { transactionId: string };
}>("select public.post_transaction($1::jsonb) as result", [
  JSON.stringify({
    workspaceId,
    accountId,
    type: "income",
    amount: "250.00",
    currency: "THB",
    financialDate: "2026-07-27",
    categoryId,
    tagIds: [],
    clientMutationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
  })
]);

await database.query(
  "select public.void_transaction($1, $2, $3)",
  [
    posted.rows[0]!.result.transactionId,
    1,
    "บันทึกรายการผิด"
  ]
);
```

เพิ่ม assertions หลัง parse snapshot:

```ts
expect(ownerSnapshot.accountBalances[accountId]?.amount).toBe("1000.00");
expect(ownerSnapshot.transactions).toEqual(
  expect.arrayContaining([
    expect.objectContaining({
      id: posted.rows[0]!.result.transactionId,
      state: "void",
      version: 2,
      voidReason: "บันทึกรายการผิด"
    })
  ])
);
expect(ownerSnapshot.transactions[0]?.voidedAt).toMatch(
  /^\d{4}-\d{2}-\d{2}T/
);
```

- [ ] **Step 2: Add real source fixtures and assertions**

ใน test เดิม:

1. สร้างบัญชีปลายทางด้วย `create_account_with_opening_balance`
2. เรียก `post_transfer` ด้วย `feeAmount: "10.00"` แล้วจับ `feeTransactionId` จาก `transfer_links`
3. materialize และ post recurring occurrence ด้วย `post_recurring_occurrence`
4. ใช้ installment payment fixture เดิมหรือสร้าง payment หนึ่งครั้ง แล้วจับ linked transaction

ตรวจ source ด้วยค่า literal:

```ts
expect(ownerSnapshot.transactions).toEqual(
  expect.arrayContaining([
    expect.objectContaining({
      id: feeTransactionId,
      source: "transfer_fee",
      sourceId: transferId
    }),
    expect.objectContaining({
      id: recurringTransactionId,
      source: "recurring_occurrence",
      sourceId: recurringOccurrenceId
    })
  ])
);
```

assert ทุก source-linked transaction ยังคง `state: "posted"` และยอด snapshot ตรงกับยอดหลัง mutation จริง

- [ ] **Step 3: Register migration 015 in the PGlite test and verify RED**

เพิ่มชื่อท้าย migration array:

```ts
"202607280015_transaction_void_history.sql"
```

สร้างไฟล์ migration ว่างชั่วคราวที่มีเพียง comment เพื่อให้ test โหลดไฟล์ได้ แล้วรัน:

```powershell
npx vitest --run workers/api/test/finance-snapshot-database.test.ts
```

Expected: FAIL เพราะ snapshot เดิมตัด `void` ออกและยังไม่ระบุ `transfer_fee`/`recurring_occurrence`

- [ ] **Step 4: Replace `snapshot_transactions` in migration 015**

ใช้ `create or replace function public.snapshot_transactions(p_workspace_id uuid)` signature และ security attributes เดิม เปลี่ยน projection ดังนี้:

```sql
'state', tx.state,
'version', tx.version,
'createdAt', tx.created_at,
'voidedAt', tx.voided_at,
'voidReason', tx.void_reason,
'source', case
  when transfer_link.transfer_id is not null then 'transfer_fee'
  when installment.payment_id is not null then 'installment_payment'
  when installment.payoff_id is not null then 'installment_payoff'
  when recurring.id is not null then 'recurring_occurrence'
  else null
end,
'sourceId', coalesce(
  transfer_link.transfer_id,
  installment.payment_id,
  installment.payoff_id,
  recurring.id
)
```

เพิ่ม joins ที่ให้หนึ่งแถวต่อ transaction:

```sql
left join public.transfer_links transfer_link
  on transfer_link.fee_transaction_id = tx.id
left join public.installment_transaction_links installment
  on installment.transaction_id = tx.id
left join public.recurring_occurrences recurring
  on recurring.transaction_id = tx.id
```

คง split/tag subqueries และ sort เดิม เปลี่ยนเงื่อนไขท้ายจาก:

```sql
and tx.state = 'posted'
```

เป็น:

```sql
and tx.state in ('posted', 'void')
```

ห้ามแก้ `snapshot_account_balances`, account views หรือ summary functions เพราะทั้งหมดต้องนับเฉพาะ `posted`

- [ ] **Step 5: Run database tests and verify GREEN**

Run:

```powershell
npx vitest --run workers/api/test/finance-snapshot-database.test.ts
npm run test:db
```

Expected: focused finance snapshot test PASS; database suite 9 files / 17+ tests PASS

- [ ] **Step 6: Commit the database projection**

```powershell
git add supabase/migrations/202607280015_transaction_void_history.sql workers/api/test/finance-snapshot-database.test.ts
git commit -m "feat: project void transaction history"
```

---

### Task 3: Add the Web API Void Mutation

**Files:**
- Modify: `apps/web/src/lib/finance-api.ts`
- Modify: `apps/web/src/lib/remote-finance-api.ts`
- Modify: `apps/web/src/lib/remote-finance-api.test.ts`

**Interfaces:**
- Consumes: `VoidTransactionInput`, `PostedTransactionResponse`
- Produces: `FinanceApi.voidTransaction(transactionId, input)`

- [ ] **Step 1: Write the failing API client test**

เพิ่ม test แยก ไม่รวมกับ mutation mapping เดิม:

```ts
it("voids a transaction with its current version and reason", async () => {
  const response = {
    transactionId: mutationId,
    version: 2,
    state: "void",
    accountBalances: [
      { accountId, amount: "1000.00", currency: "THB" }
    ]
  } as const;
  const requestFetch = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json(response));
  const api = createRemoteFinanceApi({
    auth: createAuth(),
    fetch: requestFetch,
    onUnauthenticated: vi.fn()
  });

  await expect(
    api.voidTransaction(mutationId, {
      version: 1,
      reason: "บันทึกรายการผิด"
    })
  ).resolves.toEqual(response);

  expect(requestFetch).toHaveBeenCalledOnce();
  const [url, init] = requestFetch.mock.calls[0]!;
  expect(url).toBe(`/v1/transactions/${mutationId}/void`);
  expect(init?.method).toBe("POST");
  expect(JSON.parse(String(init?.body))).toEqual({
    version: 1,
    reason: "บันทึกรายการผิด"
  });
});
```

- [ ] **Step 2: Run the client test and verify RED**

Run:

```powershell
npx vitest --run apps/web/src/lib/remote-finance-api.test.ts
```

Expected: FAIL เพราะ `voidTransaction` ไม่มีใน returned API

- [ ] **Step 3: Add the interface and client mapping**

ใน `finance-api.ts` import types และเพิ่ม:

```ts
voidTransaction(
  transactionId: string,
  input: VoidTransactionInput
): Promise<PostedTransactionResponse>;
```

ใน `createRemoteFinanceApi` return object เพิ่ม:

```ts
voidTransaction(transactionId, input) {
  return post(
    `/v1/transactions/${encodeURIComponent(transactionId)}/void`,
    input,
    postedTransactionResponseSchema
  );
},
```

- [ ] **Step 4: Run API client tests and typecheck**

Run:

```powershell
npx vitest --run apps/web/src/lib/remote-finance-api.test.ts
npm run typecheck
```

Expected: remote client tests PASS; all workspace typechecks PASS

- [ ] **Step 5: Commit the client boundary**

```powershell
git add apps/web/src/lib/finance-api.ts apps/web/src/lib/remote-finance-api.ts apps/web/src/lib/remote-finance-api.test.ts
git commit -m "feat: add transaction void web client"
```

---

### Task 4: Add Transaction Filters and Source Guards

**Files:**
- Create: `apps/web/src/features/transactions/transaction-list.test.tsx`
- Modify: `apps/web/src/features/transactions/transaction-list.tsx`

**Interfaces:**
- Consumes: `FinanceTransaction[]`, accounts, categories
- Produces: filter UI and `onDeleteRequested(transaction)` callback only for eligible posted manual entries

- [ ] **Step 1: Write failing list tests**

สร้าง fixtures ครบทุก field ของ `FinanceTransaction`:

```ts
const postedManual: FinanceTransaction = {
  id: "10000000-0000-4000-8000-000000000001",
  workspaceId,
  accountId,
  type: "expense",
  amount: "125.50",
  currency: "THB",
  financialDate: "2026-07-28",
  categoryId,
  note: "อาหาร",
  tagIds: [],
  state: "posted",
  version: 1,
  createdAt: "2026-07-28T04:00:00.000Z"
};

const voidedManual: FinanceTransaction = {
  ...postedManual,
  id: "20000000-0000-4000-8000-000000000002",
  note: "รายการผิด",
  state: "void",
  version: 2,
  voidedAt: "2026-07-28T05:00:00.000Z",
  voidReason: "บันทึกรายการผิด"
};
```

Test 1 ต้องจับ bug ที่ default แสดง void:

```ts
expect(screen.getByText("อาหาร")).toBeInTheDocument();
expect(screen.queryByText("รายการผิด")).not.toBeInTheDocument();
```

Test 2 คลิก “รายการที่ลบแล้ว” แล้วตรวจ:

```ts
expect(screen.getByText("รายการผิด")).toBeInTheDocument();
expect(screen.getByText("ลบแล้ว")).toBeInTheDocument();
expect(screen.getByText("บันทึกรายการผิด")).toBeInTheDocument();
expect(
  screen.queryByRole("button", { name: /ลบรายการ รายการผิด/ })
).not.toBeInTheDocument();
```

Test 3 สร้าง source fixtures ทั้งสี่ค่าแล้วตรวจว่า manual มีปุ่มเดียว:

```ts
expect(
  screen.getAllByRole("button", { name: /ลบรายการ/ })
).toHaveLength(1);
expect(screen.getAllByText("จัดการจากโมดูลต้นทาง")).toHaveLength(4);
```

- [ ] **Step 2: Run list tests and verify RED**

Run:

```powershell
npx vitest --run apps/web/src/features/transactions/transaction-list.test.tsx
```

Expected: FAIL เพราะไม่มี filter, delete callback, void badge หรือ source guard

- [ ] **Step 3: Implement filter state and eligible action**

เพิ่ม props:

```ts
type TransactionListProps = Readonly<{
  transactions: FinanceTransaction[];
  accounts: Account[];
  categories: Category[];
  filter: "current" | "deleted";
  onFilterChange(filter: "current" | "deleted"): void;
  onDeleteRequested(transaction: FinanceTransaction): void;
}>;
```

filter ก่อน sort:

```ts
const visibleTransactions = transactions.filter((transaction) =>
  filter === "current"
    ? transaction.state === "posted"
    : transaction.state === "void"
);
```

รายการลบได้เมื่อ:

```ts
const canDelete =
  transaction.state === "posted" && transaction.source === undefined;
```

ปุ่มต้องมี accessible name:

```tsx
aria-label={`ลบรายการ ${displayName}`}
```

history row แสดง `ลบแล้ว`, `transaction.voidReason` และ `<time dateTime={transaction.voidedAt}>`

- [ ] **Step 4: Run list tests and verify GREEN**

Run:

```powershell
npx vitest --run apps/web/src/features/transactions/transaction-list.test.tsx
```

Expected: all list tests PASS

- [ ] **Step 5: Commit the list behavior**

```powershell
git add apps/web/src/features/transactions/transaction-list.tsx apps/web/src/features/transactions/transaction-list.test.tsx
git commit -m "feat: filter deletable transaction history"
```

---

### Task 5: Build the Accessible Void Confirmation Dialog

**Files:**
- Create: `apps/web/src/features/transactions/transaction-void-dialog.tsx`
- Create: `apps/web/src/features/transactions/transaction-void-dialog.test.tsx`

**Interfaces:**
- Consumes: one manual `FinanceTransaction`, account/category display strings, async `onConfirm(reason)`
- Produces: validated accessible dialog with retry-preserving state

- [ ] **Step 1: Write failing dialog tests**

Render the real dialog and test:

1. heading “ลบรายการ”
2. amount/account/date details
3. default reason
4. empty/201-character reason never calls `onConfirm`
5. successful promise calls exact trimmed reason
6. rejected promise keeps dialog open and shows `role="alert"`
7. deferred promise disables cancel/confirm to prevent duplicate calls

Critical assertion:

```ts
await user.clear(screen.getByLabelText("เหตุผลที่ลบ"));
await user.type(screen.getByLabelText("เหตุผลที่ลบ"), "  ใส่ยอดผิด  ");
await user.click(
  screen.getByRole("button", { name: "ลบและย้อนยอด" })
);
expect(onConfirm).toHaveBeenCalledWith("ใส่ยอดผิด");
```

- [ ] **Step 2: Run dialog tests and verify RED**

Run:

```powershell
npx vitest --run apps/web/src/features/transactions/transaction-void-dialog.test.tsx
```

Expected: FAIL เพราะ component ยังไม่มี

- [ ] **Step 3: Implement the minimal dialog**

Public props:

```ts
type TransactionVoidDialogProps = Readonly<{
  transaction: FinanceTransaction;
  accountName: string;
  categoryName: string;
  onCancel(): void;
  onConfirm(reason: string): Promise<void>;
}>;
```

State:

```ts
const [reason, setReason] = useState("บันทึกรายการผิด");
const [isPending, setIsPending] = useState(false);
const [error, setError] = useState<string | null>(null);
```

validation:

```ts
const normalizedReason = reason.trim();
if (
  normalizedReason.length < 1 ||
  normalizedReason.length > 200
) {
  setError("กรุณาระบุเหตุผล 1–200 ตัวอักษร");
  return;
}
```

ใช้ `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, `<form>` และปุ่ม type ที่ถูกต้อง ห้ามปิด dialog เมื่อ `onConfirm` reject

- [ ] **Step 4: Run dialog tests and verify GREEN**

Run:

```powershell
npx vitest --run apps/web/src/features/transactions/transaction-void-dialog.test.tsx
```

Expected: all dialog tests PASS

- [ ] **Step 5: Commit the dialog**

```powershell
git add apps/web/src/features/transactions/transaction-void-dialog.tsx apps/web/src/features/transactions/transaction-void-dialog.test.tsx
git commit -m "feat: add transaction void confirmation"
```

---

### Task 6: Integrate Void Flow into the Transactions Page

**Files:**
- Create: `apps/web/src/features/transactions/transactions-page.test.tsx`
- Modify: `apps/web/src/features/transactions/transactions-page.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: `FinanceApi.voidTransaction`, `TransactionList`, `TransactionVoidDialog`
- Produces: complete delete/refresh UX

- [ ] **Step 1: Write the failing page integration tests**

สร้าง snapshot จริงที่มี workspace, account, category และ manual posted transaction Test success:

```ts
await user.click(
  screen.getByRole("button", { name: "ลบรายการ อาหาร" })
);
expect(screen.getByRole("dialog")).toHaveTextContent("125.50");
await user.click(
  screen.getByRole("button", { name: "ลบและย้อนยอด" })
);
expect(voidTransaction).toHaveBeenCalledWith(transaction.id, {
  version: 1,
  reason: "บันทึกรายการผิด"
});
expect(onChanged).toHaveBeenCalledOnce();
expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
```

Test stale/network:

```ts
voidTransaction.mockRejectedValueOnce(new Error("STALE_VERSION"));
await user.click(screen.getByRole("button", { name: "ลบและย้อนยอด" }));
expect(await screen.findByRole("alert")).toBeInTheDocument();
expect(screen.getByRole("dialog")).toBeInTheDocument();
expect(onChanged).not.toHaveBeenCalled();
```

- [ ] **Step 2: Run page tests and verify RED**

Run:

```powershell
npx vitest --run apps/web/src/features/transactions/transactions-page.test.tsx
```

Expected: FAIL เพราะ page ยังไม่ส่ง callbacks และไม่มี dialog

- [ ] **Step 3: Integrate page state**

เพิ่ม:

```ts
const [transactionFilter, setTransactionFilter] =
  useState<"current" | "deleted">("current");
const [transactionToVoid, setTransactionToVoid] =
  useState<FinanceTransaction | null>(null);
```

ส่ง props ให้ `TransactionList` และ render dialog เมื่อมี target:

```tsx
<TransactionVoidDialog
  transaction={transactionToVoid}
  accountName={
    snapshot.accounts.find(
      (account) => account.id === transactionToVoid.accountId
    )?.name ?? "ไม่พบบัญชี"
  }
  categoryName={resolvedCategoryName}
  onCancel={() => setTransactionToVoid(null)}
  onConfirm={async (reason) => {
    await api.voidTransaction(transactionToVoid.id, {
      version: transactionToVoid.version,
      reason
    });
    setTransactionToVoid(null);
    onChanged();
  }}
/>
```

ให้ dialog แปลง server/network error เป็นข้อความ “ยังลบรายการไม่ได้ กรุณาลองอีกครั้ง” และเก็บ input ไว้

- [ ] **Step 4: Add responsive styles**

เพิ่ม class แบบ scoped:

- `.transaction-list-toolbar`
- `.transaction-filter`
- `.transaction-delete-button`
- `.transaction-row.void`
- `.transaction-void-badge`
- `.transaction-source-note`
- `.transaction-void-dialog`
- `.transaction-void-dialog .dialog-card`
- `.transaction-void-details`

ใช้ variables เดิม (`--forest`, `--coral`, `--muted`, `--line`, `--paper`, `--shadow`) และ Kanit จาก global typography ปรับ grid desktop ให้มี action column และ breakpoint เดิมให้ row วาง action ด้านล่างโดยไม่ล้น

- [ ] **Step 5: Run focused web tests and verify GREEN**

Run:

```powershell
npx vitest --run apps/web/src/features/transactions/transaction-list.test.tsx apps/web/src/features/transactions/transaction-void-dialog.test.tsx apps/web/src/features/transactions/transactions-page.test.tsx
npm run typecheck
```

Expected: all focused tests PASS; typecheck PASS

- [ ] **Step 6: Commit the page integration**

```powershell
git add apps/web/src/features/transactions/transactions-page.tsx apps/web/src/features/transactions/transactions-page.test.tsx apps/web/src/styles.css
git commit -m "feat: let users void mistaken transactions"
```

---

### Task 7: Full Verification and Local Browser Smoke

**Files:**
- Verify only; no production file changes expected

**Interfaces:**
- Consumes: complete implementation from Tasks 1–6
- Produces: evidence that tests, database, types, build and signed-out browser behavior remain valid

- [ ] **Step 1: Run the full automated suite**

```powershell
npm test -- --run
npm run test:db
npm run typecheck
npm run build
```

Expected:

- all Vitest files PASS
- all PGlite database tests PASS
- all TypeScript projects PASS
- Vite production build and Wrangler dry-run exit 0

- [ ] **Step 2: Inspect migration status locally without mutating production**

```powershell
npx supabase status
```

If Docker Desktop is unavailable, record that Supabase CLI/pgTAP was not run; do not claim it passed and do not run `db push`.

- [ ] **Step 3: Run a read-only browser smoke**

Start local Worker with test-only `.dev.vars`, open `/transactions` through the in-app browser, and verify:

- signed-out access redirects to `/sign-in`
- no console errors are emitted on the redirect

Authenticated mutation smoke requires a local Supabase session. Do not create, void or change a production record for this check.

- [ ] **Step 4: Verify repository state**

```powershell
git diff --check
git status --short
git log -8 --oneline
```

Expected: no unstaged implementation changes, no `.dev.vars`, and commit history contains each task commit

- [ ] **Step 5: Stop before production**

Do not push migration 015 to Supabase, deploy Cloudflare, or void a real transaction without a new explicit production authorization from the user.

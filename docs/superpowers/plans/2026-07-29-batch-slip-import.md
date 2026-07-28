# Batch Slip Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an authenticated user analyze up to ten slip images in a bounded queue, review them together, and post every included transaction atomically.

**Architecture:** Keep the existing single-image analyze endpoint and orchestrate at most two concurrent calls from a browser queue. Add strict batch confirmation contracts, a Worker service boundary that verifies every signed claim, and one idempotent Supabase RPC that posts all included rows or rolls back all of them. A new migration removes the hourly application quota while preserving a 30-attempt workspace UTC-day limit.

**Tech Stack:** TypeScript 5.8, React 19, Vitest 3, Zod, Hono, Cloudflare Workers AI, Supabase PostgreSQL, PGlite, decimal.js

## Global Constraints

- Select at most 10 images per batch.
- Accept only JPG, PNG, and WebP, with a 5 MB original-file limit per image.
- Keep the camera input single-image.
- Run at most two analyze requests concurrently.
- Call Workers AI at most once for each non-duplicate analysis.
- Remove the per-user hourly application quota.
- Allow at most 30 AI attempts per workspace per UTC day.
- Check persisted duplicates before consuming quota.
- Post every included batch item or none.
- Never persist images, raw AI answers, or raw analysis tokens.
- Never log image bytes, raw AI answers, names, references, account numbers, amounts, dates, or tokens.
- Keep exact decimal strings; do not use JavaScript binary floating point for money.
- Keep account-owner matching out of scope; uncertain transaction types require review.
- Keep existing manual entry and single-image camera behavior usable.

---

## File Structure

### Contracts and token lifetime

- Modify `packages/contracts/src/slip-imports.ts`
  - Adds analysis expiry, quota, batch input, batch result, and issue schemas.
- Modify `packages/contracts/src/index.ts`
  - Re-exports all new schemas and inferred types.
- Modify `packages/contracts/test/slip-imports.test.ts`
  - Proves strict bounds, uniqueness, and result shapes.
- Modify `workers/api/src/services/slip-analysis-token.ts`
  - Issues a signed token together with its 30-minute expiry.
- Modify `workers/api/test/slip-primitives.test.ts`
  - Proves exact expiry and existing verification behavior.

### Quota

- Create `supabase/migrations/202607290018_batch_slip_imports.sql`
  - Replaces quota functions and later owns batch persistence/RPC.
- Modify `workers/api/test/slip-imports-database.test.ts`
  - Proves no hourly limit, the 30-attempt daily limit, and read-only quota status.
- Modify `workers/api/src/services/slip-import-repository.ts`
  - Adds quota state and read method.
- Modify `workers/api/src/services/supabase-slip-import-repository.ts`
  - Parses the new RPC results.
- Modify `workers/api/src/services/slip-import-service.ts`
  - Returns analysis expiry and exposes quota status.
- Modify `workers/api/src/routes/slip-imports.ts`
  - Adds authenticated quota status route.
- Modify `workers/api/test/slip-import-service.test.ts`
- Modify `workers/api/test/slip-imports.test.ts`

### Atomic batch persistence

- Extend `supabase/migrations/202607290018_batch_slip_imports.sql`
  - Adds private batch metadata and the atomic idempotent RPC.
- Create `workers/api/test/slip-batch-database.test.ts`
  - Proves commit, rollback, replay, conflict, and isolation.
- Modify `supabase/tests/database/slip_imports.test.sql`
  - Adds native Supabase privilege and quota assertions.
- Modify `package.json`
  - Adds the new PGlite test to `test:db`.
- Modify `workers/api/src/services/slip-import-repository.ts`
  - Adds canonical batch repository command/result types.
- Modify `workers/api/src/services/supabase-slip-import-repository.ts`
  - Calls and validates the batch RPC.
- Create `workers/api/test/supabase-slip-import-repository.test.ts`
  - Proves RPC names, inputs, and strict result parsing.

### Worker batch confirmation

- Modify `workers/api/src/services/slip-import-service.ts`
  - Verifies all tokens, computes the canonical request fingerprint, and maps results.
- Modify `workers/api/test/slip-import-service.test.ts`
  - Proves verification-before-write and per-item blocking.
- Modify `workers/api/src/routes/slip-imports.ts`
  - Adds `POST /confirm-batch`.
- Modify `workers/api/test/slip-imports.test.ts`
  - Proves auth, strict input, and public response behavior.

### Browser queue and review

- Create `apps/web/src/features/transactions/slip-batch-queue.ts`
  - Owns row types, reducer transitions, bounded concurrency, readiness, and exact totals.
- Create `apps/web/src/features/transactions/slip-batch-queue.test.ts`
- Modify `apps/web/src/features/transactions/transaction-form.tsx`
  - Adds a review-only mode that returns a validated transaction without posting.
- Modify `apps/web/src/features/transactions/transaction-form.test.tsx`
- Create `apps/web/src/features/transactions/slip-batch-table.tsx`
  - Renders desktop rows and mobile cards.
- Create `apps/web/src/features/transactions/slip-batch-table.test.tsx`
- Modify `apps/web/src/features/transactions/slip-import-dialog.tsx`
  - Becomes the batch queue controller while preserving the single camera input.
- Modify `apps/web/src/features/transactions/slip-import-dialog.test.tsx`
- Modify `apps/web/src/lib/finance-api.ts`
  - Adds quota and batch confirmation methods.
- Modify `apps/web/src/lib/remote-finance-api.ts`
- Modify `apps/web/src/lib/remote-finance-api.test.ts`
- Modify `apps/web/src/styles.css`

---

### Task 1: Strict Contracts and 30-Minute Analysis Claims

**Files:**
- Modify: `packages/contracts/src/slip-imports.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/test/slip-imports.test.ts`
- Modify: `workers/api/src/services/slip-analysis-token.ts`
- Modify: `workers/api/test/slip-primitives.test.ts`
- Modify: `workers/api/src/services/slip-import-service.ts`
- Modify: `workers/api/test/slip-import-service.test.ts`

**Interfaces:**

- Produces:

```ts
export const slipQuotaStateSchema: z.ZodType<{
  used: number;
  limit: 30;
}>;

export const confirmSlipBatchInputSchema: z.ZodType<{
  workspaceId: string;
  batchMutationId: string;
  items: Array<{
    itemId: string;
    analysisToken: string;
    transaction: CreateTransactionInput;
  }>;
}>;

export type ConfirmSlipBatchResult =
  | {
      status: "posted";
      items: Array<{
        itemId: string;
        transaction: PostedTransactionResponse;
      }>;
    }
  | {
      status: "blocked";
      issues: Array<{
        itemId: string;
        code:
          | "duplicate"
          | "invalid_account"
          | "invalid_category"
          | "currency_mismatch"
          | "expired_analysis"
          | "invalid_analysis"
          | "mutation_conflict";
      }>;
    };

export type IssuedSlipAnalysisToken = Readonly<{
  token: string;
  expiresAt: string;
}>;
```

- Extends the `status: "success"` member of `SlipAnalysisResponse` with
  `analysisExpiresAt: string`.

- [ ] **Step 1: Write failing contract tests**

Add literal tests that:

```ts
const workspaceId = "11111111-1111-4111-8111-111111111111";
const itemId = "22222222-2222-4222-8222-222222222222";
const batchMutationId = "33333333-3333-4333-8333-333333333333";

expect(analyzeSlipResponseSchema.parse({
  status: "success",
  analysisToken: "a".repeat(40),
  analysisExpiresAt: "2026-07-29T03:30:00.000Z",
  documentKind: "bank_transfer",
  draft: {
    type: "expense",
    amount: "60.00",
    currency: "THB",
    financialDate: "2026-07-27",
    fieldsNeedingReview: []
  }
})).toMatchObject({ status: "success" });

expect(confirmSlipBatchInputSchema.parse({
  workspaceId,
  batchMutationId,
  items: [{
    itemId,
    analysisToken: "b".repeat(40),
    transaction: {
      workspaceId,
      accountId: "44444444-4444-4444-8444-444444444444",
      categoryId: "55555555-5555-4555-8555-555555555555",
      type: "expense",
      amount: "60.00",
      currency: "THB",
      financialDate: "2026-07-27",
      tagIds: [],
      clientMutationId: "66666666-6666-4666-8666-666666666666"
    }
  }]
})).toHaveProperty("items", expect.any(Array));
```

Also assert:

- zero and eleven items fail;
- duplicate `itemId` fails;
- duplicate transaction `clientMutationId` fails;
- an item transaction with another `workspaceId` fails;
- unknown keys fail;
- posted and blocked results parse;
- a blocked issue with any unlisted code fails.

- [ ] **Step 2: Run contract tests and verify RED**

Run:

```powershell
npx vitest run packages/contracts/test/slip-imports.test.ts
```

Expected: FAIL because the batch and quota schemas do not exist and a success
analysis has no expiry.

- [ ] **Step 3: Implement strict contracts**

Use `.strict()` on every object, `.min(1).max(10)` on `items`, UUID schemas for
all IDs, and `.superRefine` for uniqueness and workspace equality:

```ts
const batchItemSchema = z.object({
  itemId: z.string().uuid(),
  analysisToken: z.string().min(40).max(4096),
  transaction: createTransactionSchema
}).strict();

export const confirmSlipBatchInputSchema = z.object({
  workspaceId: z.string().uuid(),
  batchMutationId: z.string().uuid(),
  items: z.array(batchItemSchema).min(1).max(10)
}).strict().superRefine((input, context) => {
  const itemIds = new Set<string>();
  const mutationIds = new Set<string>();
  input.items.forEach((item, index) => {
    if (item.transaction.workspaceId !== input.workspaceId) {
      context.addIssue({
        code: "custom",
        path: ["items", index, "transaction", "workspaceId"],
        message: "BATCH_WORKSPACE_MISMATCH"
      });
    }
    if (itemIds.has(item.itemId)) {
      context.addIssue({
        code: "custom",
        path: ["items", index, "itemId"],
        message: "BATCH_ITEM_DUPLICATE"
      });
    }
    if (mutationIds.has(item.transaction.clientMutationId)) {
      context.addIssue({
        code: "custom",
        path: ["items", index, "transaction", "clientMutationId"],
        message: "BATCH_MUTATION_DUPLICATE"
      });
    }
    itemIds.add(item.itemId);
    mutationIds.add(item.transaction.clientMutationId);
  });
});
```

Export all schemas and inferred types from `packages/contracts/src/index.ts`.

- [ ] **Step 4: Run contract tests and verify GREEN**

Run the same focused test. Expected: PASS.

- [ ] **Step 5: Write a failing 30-minute token test**

In `slip-primitives.test.ts`, inject `now = () => 1_800_000_000`, issue one
claim, and assert:

```ts
const issued = await codec.issue(claims);
expect(issued.expiresAt).toBe("2027-01-15T08:30:00.000Z");
expect(issued.token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
```

Decode only the unsigned payload in the test and assert `exp` equals
`1_800_001_800`. Keep the existing signature, scope, and expiry verification
tests.

- [ ] **Step 6: Run the token test and verify RED**

Run:

```powershell
npx vitest run workers/api/test/slip-primitives.test.ts
```

Expected: FAIL because `issue` returns a string and uses 900 seconds.

- [ ] **Step 7: Return an issued token object**

Change the codec interface and implementation:

```ts
issue(claims: NewClaims): Promise<IssuedSlipAnalysisToken>;
```

Compute one `expiresAtSeconds = now() + 1800`, sign the payload containing that
exact `exp`, and return:

```ts
{
  token: `${payload}.${signature}`,
  expiresAt: new Date(expiresAtSeconds * 1000).toISOString()
}
```

Do not change signature verification or scope checks.

- [ ] **Step 8: Adapt analysis service tests and implementation**

Make the service mock return:

```ts
{
  token: "a".repeat(40),
  expiresAt: "2026-07-29T03:30:00.000Z"
}
```

Assert the success response exposes `analysisToken` and `analysisExpiresAt`.
Update `SlipImportService.analyze` to destructure the issued object.

- [ ] **Step 9: Run focused tests and typecheck**

Run:

```powershell
npx vitest run packages/contracts/test/slip-imports.test.ts workers/api/test/slip-primitives.test.ts workers/api/test/slip-import-service.test.ts
npx tsc -p workers/api/tsconfig.json --noEmit
```

Expected: PASS.

- [ ] **Step 10: Commit**

```powershell
git add -- packages/contracts/src/slip-imports.ts packages/contracts/src/index.ts packages/contracts/test/slip-imports.test.ts workers/api/src/services/slip-analysis-token.ts workers/api/test/slip-primitives.test.ts workers/api/src/services/slip-import-service.ts workers/api/test/slip-import-service.test.ts
git commit -m "feat: define batch slip contracts"
```

---

### Task 2: Workspace Daily Quota Without an Hourly Limit

**Files:**
- Create: `supabase/migrations/202607290018_batch_slip_imports.sql`
- Modify: `workers/api/test/slip-imports-database.test.ts`
- Modify: `supabase/tests/database/slip_imports.test.sql`
- Modify: `workers/api/src/services/slip-import-repository.ts`
- Modify: `workers/api/src/services/supabase-slip-import-repository.ts`
- Modify: `workers/api/src/services/slip-import-service.ts`
- Modify: `workers/api/src/routes/slip-imports.ts`
- Modify: `workers/api/test/slip-import-service.test.ts`
- Modify: `workers/api/test/slip-imports.test.ts`

**Interfaces:**

```ts
export type SlipQuotaState = Readonly<{ used: number; limit: 30 }>;

getQuota(
  actor: AuthSession,
  workspaceId: string
): Promise<SlipQuotaState>;

consumeQuota(
  actor: AuthSession,
  workspaceId: string
): Promise<
  | { allowed: true; used: number; limit: 30 }
  | {
      allowed: false;
      reason: "workspace_day";
      used: 30;
      limit: 30;
    }
>;
```

- [ ] **Step 1: Replace the old quota expectation with failing daily tests**

Update the PGlite test to:

1. call `consume_slip_analysis_quota` 30 times for one user and expect allowed;
2. assert calls 11–30 are still allowed, proving the hourly limit is gone;
3. call it once as another workspace member and expect:

```json
{"allowed":false,"reason":"workspace_day","used":30,"limit":30}
```

4. call `get_slip_analysis_quota` before and after consumption and prove it does
   not insert another attempt.

Use literal expected objects and assert the table count stays 30.

- [ ] **Step 2: Run the database test and verify RED**

Run:

```powershell
npx vitest run workers/api/test/slip-imports-database.test.ts
```

Expected: FAIL at attempt 11 and because the read RPC does not exist.

- [ ] **Step 3: Create the replacement migration**

Start `202607290018_batch_slip_imports.sql` with:

```sql
create or replace function public.get_slip_analysis_quota(
  p_workspace_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_used integer;
begin
  if auth.uid() is null
    or not public.is_workspace_member(p_workspace_id)
  then
    raise exception using errcode = '42501',
      message = 'workspace access denied';
  end if;

  select count(*) into v_used
  from public.slip_analysis_attempts
  where workspace_id = p_workspace_id
    and attempted_at >= (
      date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'
    );

  return jsonb_build_object('used', v_used, 'limit', 30);
end;
$$;
```

Replace `consume_slip_analysis_quota` so it:

- locks only `hashtext(p_workspace_id::text)`;
- deletes attempts older than 24 hours;
- counts current UTC-day workspace attempts;
- returns denied at 30;
- otherwise inserts once and returns the post-insert `used` count.

Revoke from `public`, `anon`, and `authenticated`, then grant execute only to
`authenticated`, matching the existing security pattern.

- [ ] **Step 4: Add native SQL privilege assertions**

Extend `supabase/tests/database/slip_imports.test.sql` to prove:

- authenticated members can execute both quota functions;
- anon cannot execute them;
- the attempts table remains unreadable directly;
- another workspace is isolated.

- [ ] **Step 5: Run database tests and verify GREEN**

Run:

```powershell
npx vitest run workers/api/test/slip-imports-database.test.ts
```

Expected: PASS with exactly 30 stored attempts.

- [ ] **Step 6: Write failing repository and route tests**

Add service tests asserting:

```ts
await expect(service.getQuota(actor, workspaceId)).resolves.toEqual({
  used: 7,
  limit: 30
});
```

Add route tests for:

```text
GET /v1/slip-imports/quota?workspaceId=<uuid>
```

Assert authentication is required, unknown query keys fail, and success returns
`{"used":7,"limit":30}`.

- [ ] **Step 7: Run Worker tests and verify RED**

Run:

```powershell
npx vitest run workers/api/test/slip-import-service.test.ts workers/api/test/slip-imports.test.ts
```

Expected: FAIL because `getQuota` is absent.

- [ ] **Step 8: Implement quota interfaces, adapter, service, and route**

Parse RPC results with strict Zod schemas. The route query schema is:

```ts
z.object({ workspaceId: z.string().uuid() }).strict()
```

Do not read `slip_analysis_attempts` directly from the Worker. Use only the two
Security Definer RPCs.

- [ ] **Step 9: Run focused tests and typecheck**

```powershell
npx vitest run workers/api/test/slip-import-service.test.ts workers/api/test/slip-imports.test.ts workers/api/test/slip-imports-database.test.ts
npx tsc -p workers/api/tsconfig.json --noEmit
```

Expected: PASS.

- [ ] **Step 10: Commit**

```powershell
git add -- supabase/migrations/202607290018_batch_slip_imports.sql supabase/tests/database/slip_imports.test.sql workers/api/test/slip-imports-database.test.ts workers/api/src/services/slip-import-repository.ts workers/api/src/services/supabase-slip-import-repository.ts workers/api/src/services/slip-import-service.ts workers/api/src/routes/slip-imports.ts workers/api/test/slip-import-service.test.ts workers/api/test/slip-imports.test.ts
git commit -m "feat: enforce daily slip quota"
```

---

### Task 3: Atomic and Idempotent Batch Persistence

**Files:**
- Modify: `supabase/migrations/202607290018_batch_slip_imports.sql`
- Create: `workers/api/test/slip-batch-database.test.ts`
- Modify: `supabase/tests/database/slip_imports.test.sql`
- Modify: `package.json`
- Modify: `workers/api/src/services/slip-import-repository.ts`
- Modify: `workers/api/src/services/supabase-slip-import-repository.ts`
- Create: `workers/api/test/supabase-slip-import-repository.test.ts`

**Interfaces:**

```ts
export type ConfirmSlipBatchCommand = Readonly<{
  workspaceId: string;
  batchMutationId: string;
  requestSha256: string;
  items: Array<Readonly<{
    itemId: string;
    imageSha256: string;
    documentIdentitySha256: string | null;
    documentKind: SlipDocumentKind;
    transaction: CreateTransactionInput;
  }>>;
}>;

confirmBatch(
  actor: AuthSession,
  command: ConfirmSlipBatchCommand
): Promise<ConfirmSlipBatchResult>;
```

- [ ] **Step 1: Write the failing atomic database test**

Create a PGlite fixture that loads migrations through `202607290018`, creates
one authenticated owner, private workspace, THB account, and expense category.

Build two canonical items using synthetic hashes:

```ts
const first = {
  itemId: "10000000-0000-4000-8000-000000000001",
  imageSha256: "1".repeat(64),
  documentIdentitySha256: "a".repeat(64),
  documentKind: "bank_transfer",
  transaction: {
    workspaceId,
    accountId,
    categoryId,
    type: "expense",
    amount: "60.00",
    currency: "THB",
    financialDate: "2026-07-27",
    tagIds: [],
    clientMutationId: "20000000-0000-4000-8000-000000000001"
  }
};
```

The second uses distinct IDs/hashes and amount `"1191.67"`.

Assert:

- one RPC call returns `status: "posted"` with two transaction IDs;
- two transactions and two import rows exist;
- replaying the identical batch mutation ID and request hash returns the same
  transaction IDs and row counts remain two;
- reusing the batch mutation ID with another request hash returns
  `mutation_conflict` and changes nothing;
- a batch containing a duplicate document returns `blocked` and posts none;
- a batch with one invalid category returns `blocked` and posts none;
- a viewer and a non-member cannot post.

- [ ] **Step 2: Run the atomic database test and verify RED**

```powershell
npx vitest run workers/api/test/slip-batch-database.test.ts
```

Expected: FAIL because the tables and RPC do not exist.

- [ ] **Step 3: Add private batch metadata**

Extend the migration with:

```sql
create table public.financial_document_import_batches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  batch_mutation_id uuid not null,
  request_sha256 text not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
  item_count smallint not null check (item_count between 1 and 10),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (created_by, batch_mutation_id)
);

alter table public.financial_document_imports
  add column batch_id uuid
    references public.financial_document_import_batches(id),
  add column batch_item_id uuid;

create unique index financial_document_import_batch_item
  on public.financial_document_imports(batch_id, batch_item_id)
  where batch_id is not null;
```

Revoke all direct access to the batch table.

- [ ] **Step 4: Implement one atomic RPC**

Create:

```sql
public.confirm_financial_document_import_batch(p_input jsonb) returns jsonb
```

The function must:

1. require owner/editor role;
2. enforce 1–10 items;
3. take an advisory transaction lock on creator plus batch mutation ID;
4. find an existing batch mutation;
5. return `mutation_conflict` if its request hash differs;
6. return the original ordered posted response when the hash matches;
7. insert the batch metadata;
8. loop through items in one exception-protected block;
9. call `public.post_transaction` for each item;
10. insert its financial document row with batch and item IDs;
11. convert known validation/duplicate failures to one `blocked` response;
12. ensure the exception block rolls back the batch row, transactions, splits,
    and import rows before returning blocked issues.

Unexpected exceptions must be re-raised rather than returned with database
details.

- [ ] **Step 5: Add privilege assertions and package script**

Grant execute only to `authenticated`. Add
`workers/api/test/slip-batch-database.test.ts` to `test:db`.

- [ ] **Step 6: Run database tests and verify GREEN**

```powershell
npx vitest run workers/api/test/slip-batch-database.test.ts workers/api/test/slip-imports-database.test.ts
```

Expected: PASS with exact row counts after every rollback/replay branch.

- [ ] **Step 7: Write failing Supabase adapter tests**

Use a controlled fetch to assert `confirmBatch` calls:

```text
/rest/v1/rpc/confirm_financial_document_import_batch
```

with:

```json
{"p_input":{"workspaceId":"...","batchMutationId":"...","requestSha256":"...","items":[]}}
```

Assert posted and blocked results parse, while an unknown issue code or extra
response key rejects.

- [ ] **Step 8: Implement repository types and adapter**

Add `confirmBatch` to `SlipImportRepository`, call the RPC, and parse with the
shared strict result schema. Do not pass analysis tokens.

- [ ] **Step 9: Run adapter tests and typecheck**

```powershell
npx vitest run workers/api/test/supabase-slip-import-repository.test.ts
npx tsc -p workers/api/tsconfig.json --noEmit
```

Expected: PASS.

- [ ] **Step 10: Commit**

```powershell
git add -- supabase/migrations/202607290018_batch_slip_imports.sql supabase/tests/database/slip_imports.test.sql workers/api/test/slip-batch-database.test.ts package.json workers/api/src/services/slip-import-repository.ts workers/api/src/services/supabase-slip-import-repository.ts workers/api/test/supabase-slip-import-repository.test.ts
git commit -m "feat: post slip batches atomically"
```

---

### Task 4: Worker Batch Verification and Routes

**Files:**
- Modify: `workers/api/src/services/slip-import-service.ts`
- Modify: `workers/api/test/slip-import-service.test.ts`
- Modify: `workers/api/src/routes/slip-imports.ts`
- Modify: `workers/api/test/slip-imports.test.ts`

**Interfaces:**

```ts
confirmBatch(
  actor: AuthSession,
  input: ConfirmSlipBatchInput
): Promise<ConfirmSlipBatchResult>;
```

- [ ] **Step 1: Write failing service tests**

Add tests that:

- verify all item tokens before `repository.confirmBatch` is called;
- return `expired_analysis` for `TOKEN_EXPIRED`;
- return `invalid_analysis` for invalid signature/scope;
- block repeated image hashes and repeated non-null document identities;
- call the repository once with no raw token fields;
- produce a deterministic 64-character lowercase request SHA-256;
- preserve item order in posted and blocked results.

Use two synthetic claims:

```ts
{
  userId,
  workspaceId,
  imageSha256: "1".repeat(64),
  documentIdentitySha256: "a".repeat(64),
  documentKind: "bank_transfer",
  exp: 1_800_001_800
}
```

and a second object with distinct hashes.

- [ ] **Step 2: Run service tests and verify RED**

```powershell
npx vitest run workers/api/test/slip-import-service.test.ts
```

Expected: FAIL because `confirmBatch` is absent.

- [ ] **Step 3: Implement verification and canonical fingerprinting**

For every item:

1. call `tokenCodec.verify(token, { userId, workspaceId })`;
2. map only typed token errors to bounded item issues;
3. do not call the repository if any token issue exists;
4. check duplicate image/document identities;
5. build declared canonical objects in input order;
6. compute SHA-256 over `JSON.stringify(canonicalItems)` using `TextEncoder`;
7. call `repository.confirmBatch` once.

Never include token text in an error, log, repository command, or fingerprint.

- [ ] **Step 4: Write failing route tests**

Add route tests for authenticated:

```text
POST /v1/slip-imports/confirm-batch
```

Assert:

- valid input reaches `service.confirmBatch`;
- posted and blocked results return JSON;
- unknown keys, 0 items, 11 items, duplicate item IDs, and workspace mismatch
  return `VALIDATION_FAILED`;
- unauthenticated requests return 401;
- the response never contains analysis tokens.

- [ ] **Step 5: Run route tests and verify RED**

```powershell
npx vitest run workers/api/test/slip-imports.test.ts
```

Expected: FAIL because the route does not exist.

- [ ] **Step 6: Implement the strict route**

Parse with `confirmSlipBatchInputSchema`, call the service with the auth session,
and validate output with `confirmSlipBatchResultSchema`. Return 201 for posted
and 200 for blocked.

- [ ] **Step 7: Run Worker regressions and typecheck**

```powershell
npx vitest run workers/api/test/slip-import-service.test.ts workers/api/test/slip-imports.test.ts workers/api/test/error-handler.test.ts
npx tsc -p workers/api/tsconfig.json --noEmit
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add -- workers/api/src/services/slip-import-service.ts workers/api/test/slip-import-service.test.ts workers/api/src/routes/slip-imports.ts workers/api/test/slip-imports.test.ts
git commit -m "feat: verify batch slip confirmations"
```

---

### Task 5: Pure Browser Queue, Bounded Concurrency, and Exact Totals

**Files:**
- Create: `apps/web/src/features/transactions/slip-batch-queue.ts`
- Create: `apps/web/src/features/transactions/slip-batch-queue.test.ts`

**Interfaces:**

```ts
export type SlipBatchStatus =
  | "preparing"
  | "queued"
  | "analyzing"
  | "ready"
  | "needs_review"
  | "duplicate"
  | "unsupported"
  | "failed"
  | "quota_blocked";

export type SlipBatchRow = Readonly<{
  itemId: string;
  fileName: string;
  revision: number;
  status: SlipBatchStatus;
  image?: PreparedSlipImage;
  analysisToken?: string;
  analysisExpiresAt?: string;
  draft?: SlipTransactionDraft;
  transaction?: CreateTransactionInput;
  duplicate?: DuplicateTransaction;
  error?: string;
}>;

export async function runBounded<T>(
  inputs: readonly T[],
  concurrency: 2,
  worker: (input: T) => Promise<void>
): Promise<void>;

export function batchTotals(
  rows: readonly SlipBatchRow[]
): Readonly<{
  income: Record<string, string>;
  expense: Record<string, string>;
}>;

export function canConfirmBatch(rows: readonly SlipBatchRow[]): boolean;
```

- [ ] **Step 1: Write failing reducer tests**

Use literal actions and assert:

- source order remains stable;
- an out-of-order result updates only its matching `itemId` and `revision`;
- a result with an old revision is ignored after replacement;
- a local duplicate hash becomes duplicate before analyze;
- removal calls `dispose` exactly once;
- closing disposes every retained prepared image;
- one failure leaves other rows unchanged;
- quota denial changes queued rows to `quota_blocked` but keeps completed rows.

- [ ] **Step 2: Write a failing concurrency test**

Create six deferred promises, increment an `active` counter inside the worker,
and assert `maximumActive` equals 2 and all six items complete.

- [ ] **Step 3: Write failing readiness and money tests**

Assert confirmation is false for processing, review, failed, or an empty batch;
true for at least one ready included row plus excluded duplicate rows.

Use:

```ts
[
  { type: "expense", amount: "1191.67", currency: "THB" },
  { type: "expense", amount: "60.00", currency: "THB" },
  { type: "income", amount: "0.10", currency: "THB" },
  { type: "income", amount: "1.25", currency: "USD" }
]
```

and expect exact totals `"1251.67"`, `"0.10"`, and `"1.25"`. Use
`sumMoney` from `@systems-credit/domain`; never `Number` or `parseFloat`.

- [ ] **Step 4: Run queue tests and verify RED**

```powershell
npx vitest run apps/web/src/features/transactions/slip-batch-queue.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 5: Implement the pure queue**

Use an immutable reducer. Require every async completion action to include
`itemId` and `revision`. `runBounded` uses a shared next-index counter and
exactly `Math.min(2, inputs.length)` runners; it must not use an unbounded
`Promise.all(inputs.map(...))`.

Group totals by transaction type and currency, then call `sumMoney` for each
non-empty group.

- [ ] **Step 6: Run queue tests and typecheck**

```powershell
npx vitest run apps/web/src/features/transactions/slip-batch-queue.test.ts
npx tsc -p apps/web/tsconfig.json --noEmit
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add -- apps/web/src/features/transactions/slip-batch-queue.ts apps/web/src/features/transactions/slip-batch-queue.test.ts
git commit -m "feat: add slip batch queue model"
```

---

### Task 6: Review Table, Multiple File Selection, and Remote API

**Files:**
- Modify: `apps/web/src/lib/finance-api.ts`
- Modify: `apps/web/src/lib/remote-finance-api.ts`
- Modify: `apps/web/src/lib/remote-finance-api.test.ts`
- Modify: `apps/web/src/features/transactions/transaction-form.tsx`
- Modify: `apps/web/src/features/transactions/transaction-form.test.tsx`
- Create: `apps/web/src/features/transactions/slip-batch-table.tsx`
- Create: `apps/web/src/features/transactions/slip-batch-table.test.tsx`
- Modify: `apps/web/src/features/transactions/slip-import-dialog.tsx`
- Modify: `apps/web/src/features/transactions/slip-import-dialog.test.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**

```ts
getSlipQuota(workspaceId: string): Promise<SlipQuotaState>;
confirmSlipBatch(
  input: ConfirmSlipBatchInput
): Promise<ConfirmSlipBatchResult>;
```

Add a discriminated `TransactionForm` review mode:

```ts
type ReviewModeProps = Readonly<{
  mode: "review";
  workspaceId: string;
  accounts: Account[];
  categories: Category[];
  initialDraft: SlipTransactionDraft;
  clientMutationId: string;
  onReviewed(transaction: CreateTransactionInput): void;
  onCancel(): void;
}>;
```

The existing post/confirm mode remains source compatible.

- [ ] **Step 1: Write failing remote API tests**

Assert:

```ts
await api.getSlipQuota(workspaceId);
```

sends an authenticated GET with an encoded workspace query, and:

```ts
await api.confirmSlipBatch(input);
```

sends the strict JSON to `/v1/slip-imports/confirm-batch` and parses both
posted and blocked results. Malformed quota/result payloads must reject.

- [ ] **Step 2: Run remote API tests and verify RED**

```powershell
npx vitest run apps/web/src/lib/remote-finance-api.test.ts
```

Expected: FAIL because the methods do not exist.

- [ ] **Step 3: Implement Finance API methods**

Use shared contract schemas. Do not add raw response casts. Keep the existing
401 refresh-and-retry path.

- [ ] **Step 4: Write a failing review-only TransactionForm test**

Render review mode with a draft that needs type and account review. Change
fields, submit, and assert:

- `onReviewed` receives one strict `CreateTransactionInput`;
- its `clientMutationId` is the supplied row mutation ID;
- no Finance API method is called;
- the label reads `บันทึกการแก้ไข`;
- invalid money does not call `onReviewed`.

- [ ] **Step 5: Run the form test and verify RED**

```powershell
npx vitest run apps/web/src/features/transactions/transaction-form.test.tsx
```

Expected: FAIL because review mode does not exist.

- [ ] **Step 6: Implement review mode without duplicating validation**

Use the existing amount, account, category, split, and date validation in the
same `handleSubmit`. At the final side-effect branch:

```ts
if (mode === "review") {
  onReviewed(transaction);
  return;
}
```

Keep existing manual post and single-slip confirm paths unchanged.

- [ ] **Step 7: Write failing batch table component tests**

Render ready, needs-review, duplicate, and failed rows. Assert:

- each status has visible Thai text;
- edit is offered only where applicable;
- retry/replace/remove actions target the correct `itemId`;
- separate exact income/expense totals render;
- the batch button names the ready count;
- the button is disabled until `canConfirmBatch` is true;
- blocked item issues return focus to the matching row.

- [ ] **Step 8: Implement `SlipBatchTable`**

Render semantic table markup on desktop and CSS-driven stacked row cards under
820 px. Do not duplicate rows in two DOM trees. Use `data-label` on cells for
mobile labels and preserve accessible button names.

- [ ] **Step 9: Write failing dialog queue tests**

Mock `prepareSlipImage` and Finance API calls. Test:

- gallery input has `multiple`;
- camera input has `capture="environment"` and no `multiple`;
- selecting 11 files creates a visible limit error and starts no analysis;
- ten files prepare and analyze in stable order;
- same-selection duplicate hash makes only one API call;
- no more than two analyze calls are active;
- one rejected analysis leaves other results visible;
- quota denial stops untouched queued rows;
- retry uses the retained image;
- replace/remove/close dispose resources;
- close with a non-empty queue requires confirmation;
- confirm sends only ready included rows;
- posted closes and refreshes once;
- blocked maps issues to rows and keeps edits.

- [ ] **Step 10: Run dialog tests and verify RED**

```powershell
npx vitest run apps/web/src/features/transactions/slip-import-dialog.test.tsx apps/web/src/features/transactions/slip-batch-table.test.tsx
```

Expected: FAIL because the batch controller and table do not exist.

- [ ] **Step 11: Implement the dialog controller**

Use `multiple` only on the gallery input. Prepare files, dispatch queue actions,
and call `runBounded(..., 2, analyzeOne)`.

When one response is:

- success: store token, expiry, draft, and review status;
- duplicate: exclude and show existing transaction;
- unsupported: exclude and allow replacement/removal;
- `RATE_LIMITED`: mark queued rows quota-blocked and stop dequeuing;
- other error: retain the image and allow retry/replace/remove.

On final confirm, create one stable `batchMutationId`, preserve each row
transaction mutation ID, and resend the same values after network uncertainty.

- [ ] **Step 12: Add responsive styles**

Extend the existing slip styles. Required checks:

- desktop dialog accommodates the table without page overflow;
- under 820 px, cells render as stacked labeled sections;
- at 390 px, actions use full-width controls;
- status color is paired with visible text;
- focus rings and disabled states remain visible;
- Kanit remains inherited from global typography.

- [ ] **Step 13: Run focused web regressions and typecheck**

```powershell
npx vitest run apps/web/src/features/transactions/slip-batch-queue.test.ts apps/web/src/features/transactions/slip-batch-table.test.tsx apps/web/src/features/transactions/slip-import-dialog.test.tsx apps/web/src/features/transactions/transaction-form.test.tsx apps/web/src/lib/remote-finance-api.test.ts
npx tsc -p apps/web/tsconfig.json --noEmit
```

Expected: PASS.

- [ ] **Step 14: Commit**

```powershell
git add -- apps/web/src/lib/finance-api.ts apps/web/src/lib/remote-finance-api.ts apps/web/src/lib/remote-finance-api.test.ts apps/web/src/features/transactions/transaction-form.tsx apps/web/src/features/transactions/transaction-form.test.tsx apps/web/src/features/transactions/slip-batch-table.tsx apps/web/src/features/transactions/slip-batch-table.test.tsx apps/web/src/features/transactions/slip-import-dialog.tsx apps/web/src/features/transactions/slip-import-dialog.test.tsx apps/web/src/styles.css
git commit -m "feat: review multiple slips in one batch"
```

---

### Task 7: Full Verification, Migration, and Production Release

**Files:**
- Verify: all files above
- Modify: `docs/runbooks/deploy-cloudflare-supabase.md` only if the new migration
  is not automatically covered by its existing ordered migration instructions.

- [ ] **Step 1: Run focused database and slip tests**

```powershell
npm run test:db
npx vitest run packages/contracts/test/slip-imports.test.ts workers/api/test/slip-primitives.test.ts workers/api/test/slip-import-service.test.ts workers/api/test/slip-imports.test.ts workers/api/test/supabase-slip-import-repository.test.ts apps/web/src/features/transactions/slip-batch-queue.test.ts apps/web/src/features/transactions/slip-batch-table.test.tsx apps/web/src/features/transactions/slip-import-dialog.test.tsx apps/web/src/features/transactions/transaction-form.test.tsx apps/web/src/lib/remote-finance-api.test.ts
```

Expected: all focused and database tests PASS.

- [ ] **Step 2: Run complete automated verification**

```powershell
npm test -- --run
npm run typecheck
npm run build
git diff --check
git status --short
```

Expected:

- zero failed tests;
- every workspace typecheck exits 0;
- Vite build and Wrangler dry-run exit 0;
- only intentional files are changed;
- no real slip image or secret is tracked.

- [ ] **Step 3: Verify the production migration target before writing**

Use the already-linked Supabase project and run:

```powershell
npx supabase migration list
npx supabase db push --dry-run
```

Confirm production currently has migration `202607280017_slip_imports.sql`,
the dry run lists only `202607290018_batch_slip_imports.sql`, and the deployed
schema does not already contain `financial_document_import_batches` or
`confirm_financial_document_import_batch`.

Stop if the observed schema differs materially from the repository migration
history.

- [ ] **Step 4: Apply migration 018**

Apply the reviewed forward migration through the linked project:

```powershell
npx supabase db push
npx supabase migration list
```

The applied file must be exactly:

```text
supabase/migrations/202607290018_batch_slip_imports.sql
```

Do not paste credentials into commands, commits, logs, or documentation.

- [ ] **Step 5: Verify production database behavior**

Run read-only checks that:

- `get_slip_analysis_quota` exists;
- `confirm_financial_document_import_batch` exists;
- direct authenticated table access remains revoked;
- the current quota response contains `used` and `limit: 30`.

Do not consume production quota merely to verify the read endpoint.

- [ ] **Step 6: Commit any runbook-only change**

If the runbook needed updating:

```powershell
git add -- docs/runbooks/deploy-cloudflare-supabase.md
git commit -m "docs: add batch slip rollout"
```

If no runbook change was required, do not create an empty commit.

- [ ] **Step 7: Push and monitor Cloudflare**

```powershell
git push origin main
npx wrangler deployments list -c wrangler.jsonc
curl.exe -sS -i https://baan-ngern-dee.newforico-9ea.workers.dev/health
```

Expected:

- `main` pushes successfully;
- the newest deployment reaches 100%;
- `/health` returns HTTP 200 and
  `{"ok":true,"service":"systems-credit-api"}`.

- [ ] **Step 8: Production smoke test without personal fixtures**

Use 1, 2, and 10 synthetic test images containing no real names, account
numbers, references, QR codes, or payment details.

Verify:

- selection and progress states;
- at most two active analyses;
- duplicate, unsupported, and failed row behavior;
- review editing at desktop, 820 px, and 390 px;
- one controlled two-item batch posts once;
- repeating the identical confirmation returns the same transaction IDs;
- balances and history update exactly once.

Void the controlled test transactions through the existing audited void flow
after verification; do not delete financial rows directly.

- [ ] **Step 9: Final privacy and repository audit**

```powershell
git status --short
git ls-files | rg -i "\.(jpg|jpeg|png|webp|heic|pdf)$"
git log -7 --oneline
```

Confirm no supplied real slip, generated test payment image, secret file, raw
token, or credential is tracked.

# Slip and Receipt Image Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an authenticated user upload a Thai bank slip or shop receipt, extract a reviewable transaction draft with Cloudflare Workers AI, and atomically block duplicate documents without persisting the image.

**Architecture:** The React client prepares and fingerprints one image, then sends it to authenticated Hono endpoints. A Worker service validates the bytes, checks Supabase for duplicates and quota, calls a replaceable Workers AI vision adapter, returns a signed 15-minute analysis token, and confirms the reviewed transaction through one atomic Supabase RPC. The existing transaction form and posting rules remain the financial source of truth.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Hono, Cloudflare Workers AI (`@cf/meta/llama-3.2-11b-vision-instruct`), Zod, Supabase PostgreSQL/RLS/RPC, Web Crypto.

## Global Constraints

- Support Thai bank transfer slips for incoming and outgoing money, plus shop receipts.
- Accept only one JPG, PNG, or WebP image and enforce a 5 MB server-side limit.
- Reduce the client image to a longest edge of at most 2,000 pixels when necessary.
- Never persist original or prepared image bytes in browser storage, Supabase Storage, logs, or observability data.
- Never post a transaction before explicit user confirmation.
- Block duplicates without an override by workspace-scoped image SHA-256 and canonical document identity SHA-256.
- Keep all monetary values as decimal strings and all financial dates as `YYYY-MM-DD`.
- Analysis tokens are HMAC signed, scoped to user and workspace, and expire after 15 minutes.
- Limit analysis to 10 attempts per authenticated user per rolling hour and 30 attempts per workspace per UTC day.
- Duplicate image checks return before quota consumption and before Workers AI inference.
- Manual transaction entry must remain usable when extraction fails or quota is unavailable.
- Keep Thai UI copy encoded as UTF-8 and continue using Kanit through the existing global styles.

---

## File Map

### Shared contracts

- Create `packages/contracts/src/slip-imports.ts`: schemas and public types for AI extraction, analysis outcomes, drafts, and confirmation.
- Create `packages/contracts/test/slip-imports.test.ts`: strict contract coverage.
- Modify `packages/contracts/src/errors.ts`: add slip-specific API error codes.
- Modify `packages/contracts/src/index.ts`: export slip contracts.

### Supabase

- Create `supabase/migrations/202607280017_slip_imports.sql`: document fingerprints, quota attempts, RLS, duplicate/quota functions, and atomic confirmation RPC.
- Create `supabase/tests/database/slip_imports.test.sql`: pgTAP/RLS/uniqueness tests.
- Create `workers/api/test/slip-imports-database.test.ts`: PGlite behavior and rollback/concurrency tests.

### Worker

- Create `workers/api/src/services/slip-image.ts`: magic-byte validation and SHA-256 helpers.
- Create `workers/api/src/services/slip-identity.ts`: canonical document identity.
- Create `workers/api/src/services/slip-analysis-token.ts`: signed short-lived token.
- Create `workers/api/src/services/slip-vision-extractor.ts`: extraction interface and Cloudflare adapter.
- Create `workers/api/src/services/slip-import-repository.ts`: persistence boundary.
- Create `workers/api/src/services/supabase-slip-import-repository.ts`: Supabase RPC adapter.
- Create `workers/api/src/services/slip-import-service.ts`: analyze/confirm orchestration.
- Create `workers/api/src/routes/slip-imports.ts`: authenticated multipart API.
- Create Worker unit tests matching each focused unit.
- Modify `workers/api/src/app.ts`, `workers/api/src/index.ts`, and `workers/api/src/types.ts`: dependency wiring and AI binding.

### Web

- Modify `apps/web/src/lib/finance-api.ts`: slip-import API methods.
- Modify `apps/web/src/lib/remote-finance-api.ts`: authenticated multipart analysis and JSON confirmation.
- Modify `apps/web/src/lib/remote-finance-api.test.ts`: request/response behavior.
- Create `apps/web/src/features/transactions/slip-image.ts`: browser validation, resize, preview cleanup, and fingerprint.
- Create `apps/web/src/features/transactions/slip-image.test.ts`: browser image preparation tests.
- Create `apps/web/src/features/transactions/slip-import-dialog.tsx`: select, analyze, duplicate, error, and review states.
- Create `apps/web/src/features/transactions/slip-import-dialog.test.tsx`: dialog behavior and accessibility.
- Modify `apps/web/src/features/transactions/transaction-form.tsx`: optional reviewed draft and slip confirmation submission.
- Modify `apps/web/src/features/transactions/transaction-form.test.tsx`: draft and confirmation tests.
- Modify `apps/web/src/features/transactions/transactions-page.tsx`: `อ่านสลิป` action and dialog integration.
- Modify `apps/web/src/features/transactions/transactions-page.test.tsx`: end-to-end component flow.
- Modify `apps/web/src/styles.css` and `apps/web/src/styles.test.ts`: responsive dialog and warning styles.

### Deployment

- Modify `wrangler.jsonc`: Workers AI binding and required token secret.
- Modify `.dev.vars.example`: document the local token secret.
- Modify `docs/runbooks/deploy-cloudflare-supabase.md`: migration, model license, secret, and smoke-test steps.

---

### Task 1: Define Strict Slip Import Contracts

**Files:**
- Create: `packages/contracts/src/slip-imports.ts`
- Create: `packages/contracts/test/slip-imports.test.ts`
- Modify: `packages/contracts/src/errors.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Produces: `slipAiExtractionSchema`, `analyzeSlipResponseSchema`, `confirmSlipInputSchema`, `SlipAnalysisResponse`, `SlipTransactionDraft`, and new API error codes.
- Consumes: `createTransactionSchema` and `postedTransactionResponseSchema` from `packages/contracts/src/transactions.ts`.

- [ ] **Step 1: Write failing strict-schema tests**

```ts
import { describe, expect, it } from "vitest";
import {
  analyzeSlipResponseSchema,
  confirmSlipInputSchema,
  slipAiExtractionSchema
} from "../src";

const analysisToken = "a".repeat(40);

describe("slip import contracts", () => {
  it("accepts a reviewable bank-transfer draft", () => {
    expect(analyzeSlipResponseSchema.parse({
      status: "success",
      analysisToken,
      documentKind: "bank_transfer",
      draft: {
        type: "expense",
        amount: "1250.50",
        currency: "THB",
        financialDate: "2026-07-28",
        accountId: "22222222-2222-4222-8222-222222222222",
        categoryId: "33333333-3333-4333-8333-333333333333",
        note: "โอนไป ร้านตัวอย่าง",
        reference: "ABC123",
        fieldsNeedingReview: []
      }
    }).status).toBe("success");
  });

  it("accepts duplicate and unsupported outcomes", () => {
    expect(analyzeSlipResponseSchema.parse({
      status: "duplicate",
      existingTransaction: {
        id: "44444444-4444-4444-8444-444444444444",
        amount: "1250.50",
        financialDate: "2026-07-28",
        note: "โอนไป ร้านตัวอย่าง"
      }
    }).status).toBe("duplicate");
    expect(analyzeSlipResponseSchema.parse({
      status: "unsupported"
    }).status).toBe("unsupported");
  });

  it("rejects invented or malformed extraction fields", () => {
    expect(() => slipAiExtractionSchema.parse({
      documentKind: "receipt",
      suggestedType: "expense",
      amount: "not-money",
      currency: "THB",
      financialDate: "28/07/2026",
      confidence: { amount: 2 }
    })).toThrow();
  });

  it("requires the final reviewed transaction on confirmation", () => {
    expect(() => confirmSlipInputSchema.parse({
      analysisToken,
      transaction: { amount: "1.00" }
    })).toThrow();
  });
});
```

- [ ] **Step 2: Run the contract test and verify it fails**

Run:

```powershell
npx vitest run packages/contracts/test/slip-imports.test.ts
```

Expected: FAIL because `slip-imports.ts` and exports do not exist.

- [ ] **Step 3: Implement the public schemas and types**

Create discriminated, strict schemas with these exact public shapes:

```ts
export const slipDocumentKindSchema = z.enum([
  "bank_transfer",
  "receipt"
]);

export const slipAiExtractionSchema = z.object({
  documentKind: z.enum(["bank_transfer", "receipt", "unsupported"]),
  suggestedType: z.enum(["income", "expense"]).nullable(),
  amount: positiveSlipMoneySchema.nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
  financialDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  reference: z.string().trim().max(200).nullable(),
  merchant: z.string().trim().max(200).nullable(),
  sender: z.string().trim().max(200).nullable(),
  recipient: z.string().trim().max(200).nullable(),
  institution: z.string().trim().max(200).nullable(),
  confidence: z.object({
    documentKind: confidenceSchema,
    suggestedType: confidenceSchema,
    amount: confidenceSchema,
    financialDate: confidenceSchema,
    reference: confidenceSchema
  }).strict()
}).strict();

export const slipTransactionDraftSchema = z.object({
  type: z.enum(["income", "expense"]),
  amount: positiveSlipMoneySchema.optional(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  financialDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  accountId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  note: z.string().trim().max(500).optional(),
  reference: z.string().trim().max(200).optional(),
  fieldsNeedingReview: z.array(z.enum([
    "type", "amount", "financialDate", "account", "category"
  ]))
}).strict();
```

Define `analyzeSlipResponseSchema` as a discriminated union of:

```ts
{ status: "success"; analysisToken: string; documentKind: SlipDocumentKind; draft: SlipTransactionDraft }
{ status: "duplicate"; existingTransaction: { id: string; amount: string; financialDate: string; note?: string } }
{ status: "unsupported" }
```

Define `confirmSlipInputSchema` as:

```ts
z.object({
  analysisToken: z.string().min(40).max(4096),
  transaction: createTransactionSchema
}).strict()
```

Add `DUPLICATE_DOCUMENT`, `AI_UNAVAILABLE`, `RATE_LIMITED`, and
`UNSUPPORTED_DOCUMENT` to `apiErrorCodes`, then export all new schemas and
types from `packages/contracts/src/index.ts`.

- [ ] **Step 4: Run contracts and type checking**

Run:

```powershell
npx vitest run packages/contracts/test/slip-imports.test.ts
npm run typecheck -w @systems-credit/contracts
```

Expected: PASS.

- [ ] **Step 5: Commit the contracts**

```powershell
git add packages/contracts
git commit -m "feat: add slip import contracts"
```

---

### Task 2: Add Duplicate, Quota, and Atomic Confirmation Database Support

**Files:**
- Create: `supabase/migrations/202607280017_slip_imports.sql`
- Create: `supabase/tests/database/slip_imports.test.sql`
- Create: `workers/api/test/slip-imports-database.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces RPCs:
  - `find_financial_document_duplicate(p_workspace_id uuid, p_image_sha256 text, p_document_identity_sha256 text default null)`
  - `consume_slip_analysis_quota(p_workspace_id uuid)`
  - `confirm_financial_document_import(p_input jsonb)`
- Consumes: existing `public.post_transaction(jsonb)` and workspace membership rules.

- [ ] **Step 1: Write failing PGlite tests for uniqueness, quota, and rollback**

Use the same migration loader and authenticated actor setup as
`workers/api/test/transactions-database.test.ts`. Add tests that execute:

```ts
const duplicate = await database.query(
  `select public.find_financial_document_duplicate(
    $1::uuid, $2::text, $3::text
  ) as result`,
  [workspaceId, imageHash, identityHash]
);
expect(duplicate.rows[0]?.result).toBeNull();
```

Confirm once, then assert:

```ts
expect(first.rows[0]?.result.transactionId).toMatch(UUID_PATTERN);
expect(
  await countRows(database, "financial_document_imports")
).toBe(1);
```

Confirm the same image and a differently fingerprinted image with the same
identity, and expect SQLSTATE `23505` to be translated by the RPC into:

```ts
{ status: "duplicate", existingTransaction: { id, amount, financialDate, note } }
```

Call quota 11 times for one user in one hour and assert attempts 1–10 return
`{ allowed: true }` while attempt 11 returns `{ allowed: false, reason:
"user_hour" }`. Create a second user and assert the workspace's attempt 31
returns `{ allowed: false, reason: "workspace_day" }`.

Force `post_transaction` validation to fail and assert neither
`transactions` nor `financial_document_imports` gains a row.

- [ ] **Step 2: Run the database test and verify it fails**

Run:

```powershell
npx vitest run workers/api/test/slip-imports-database.test.ts
```

Expected: FAIL because migration `202607280017_slip_imports.sql` does not exist.

- [ ] **Step 3: Implement tables, indexes, and RLS**

Create these exact tables and constraints:

```sql
create table public.financial_document_imports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  document_kind text not null check (document_kind in ('bank_transfer', 'receipt')),
  image_sha256 text not null check (image_sha256 ~ '^[0-9a-f]{64}$'),
  document_identity_sha256 text check (
    document_identity_sha256 is null
    or document_identity_sha256 ~ '^[0-9a-f]{64}$'
  ),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (workspace_id, image_sha256)
);

create unique index financial_document_imports_identity_unique
  on public.financial_document_imports
  (workspace_id, document_identity_sha256)
  where document_identity_sha256 is not null;

create table public.slip_analysis_attempts (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  attempted_at timestamptz not null default now()
);

create index slip_analysis_attempts_user_time
  on public.slip_analysis_attempts (user_id, attempted_at desc);
create index slip_analysis_attempts_workspace_time
  on public.slip_analysis_attempts (workspace_id, attempted_at desc);
```

Enable RLS with a workspace-membership select policy as defense in depth, but
revoke all direct table privileges so application access remains RPC-only. Do
not create insert, update, or delete policies. Grant authenticated execution
only on the three RPCs.

- [ ] **Step 4: Implement the three security-definer RPCs**

Each function must set `search_path = ''`, require `auth.uid()`, and verify
membership through `public.workspace_members`.

`consume_slip_analysis_quota` must:

```sql
delete from public.slip_analysis_attempts
where attempted_at < now() - interval '24 hours';

select count(*) into v_user_count
from public.slip_analysis_attempts
where user_id = auth.uid()
  and attempted_at >= now() - interval '1 hour';

select count(*) into v_workspace_count
from public.slip_analysis_attempts
where workspace_id = p_workspace_id
  and attempted_at >= date_trunc('day', now() at time zone 'UTC')
    at time zone 'UTC';
```

Return without inserting when `v_user_count >= 10` or
`v_workspace_count >= 30`; otherwise insert one attempt and return allowed.

`confirm_financial_document_import` must call
`public.post_transaction(p_input -> 'transaction')`, insert the document row,
and return:

```sql
jsonb_build_object(
  'status', 'posted',
  'transaction', v_transaction
)
```

Catch `unique_violation`, query the matching existing transaction, and return a
`status = duplicate` result. Do not catch other errors so PostgreSQL rolls the
whole statement back.

- [ ] **Step 5: Add Supabase pgTAP coverage**

Test:

- unauthenticated access is denied;
- non-members cannot query or confirm;
- hashes are unique only inside one workspace;
- the same hash is allowed in another workspace;
- raw reference text and image bytes have no database columns;
- direct inserts are denied;
- quota and confirmation RPC grants are correct.

Register `workers/api/test/slip-imports-database.test.ts` in the root
`test:db` script.

- [ ] **Step 6: Run database verification**

Run:

```powershell
npx vitest run workers/api/test/slip-imports-database.test.ts
npm run test:db
```

Expected: PASS when local Supabase/PGlite prerequisites are available.

- [ ] **Step 7: Commit database support**

```powershell
git add supabase package.json workers/api/test/slip-imports-database.test.ts
git commit -m "feat: persist slip duplicate protection"
```

---

### Task 3: Implement Image Validation, Canonical Identity, and Signed Tokens

**Files:**
- Create: `workers/api/src/services/slip-image.ts`
- Create: `workers/api/src/services/slip-identity.ts`
- Create: `workers/api/src/services/slip-analysis-token.ts`
- Create: `workers/api/test/slip-image.test.ts`
- Create: `workers/api/test/slip-identity.test.ts`
- Create: `workers/api/test/slip-analysis-token.test.ts`

**Interfaces:**
- Produces:
  - `validateSlipImage(bytes: Uint8Array, claimedMime: string): SlipImage`
  - `sha256Hex(bytes: Uint8Array | string): Promise<string>`
  - `buildDocumentIdentity(extraction: SlipAiExtraction): Promise<string | null>`
  - `createSlipAnalysisTokenCodec(secret: string): SlipAnalysisTokenCodec`
- Consumes: slip contract types from Task 1.

- [ ] **Step 1: Write failing primitive tests**

Cover these exact behaviors:

```ts
expect(validateSlipImage(jpegBytes, "image/jpeg").mime).toBe("image/jpeg");
expect(() => validateSlipImage(jpegBytes, "image/png")).toThrow("MIME_MISMATCH");
expect(() => validateSlipImage(new Uint8Array(5_000_001), "image/jpeg"))
  .toThrow("IMAGE_TOO_LARGE");
expect(await sha256Hex(new TextEncoder().encode("abc")))
  .toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
```

Assert canonical identities are equal across case, Thai-compatible Unicode
normalization, spaces, and reference separators, but differ for another
merchant or amount. Assert missing reference returns `null`.

Create a token at a fixed clock, verify it, then assert modified signatures,
wrong users, wrong workspaces, and clocks after 15 minutes fail.

- [ ] **Step 2: Run primitive tests and verify they fail**

Run:

```powershell
npx vitest run workers/api/test/slip-image.test.ts workers/api/test/slip-identity.test.ts workers/api/test/slip-analysis-token.test.ts
```

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement magic-byte and size validation**

Recognize:

```ts
const signatures = {
  "image/jpeg": [0xff, 0xd8, 0xff],
  "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  "image/webp": {
    riff: [0x52, 0x49, 0x46, 0x46],
    webpOffset8: [0x57, 0x45, 0x42, 0x50]
  }
} as const;
```

Reject empty, oversized, signature-mismatched, and unsupported data with typed
errors. Use `crypto.subtle.digest("SHA-256", ...)` and lowercase hexadecimal.

- [ ] **Step 4: Implement canonical identity**

Normalize text with:

```ts
value.normalize("NFKC").trim().toLocaleLowerCase("th-TH")
  .replace(/[\s\-_/.:]+/g, "");
```

Return `null` unless reference, financial date, amount, currency, and either
institution or merchant exist with confidence at least `0.7`. Hash this exact
pipe-delimited payload:

```ts
[
  extraction.documentKind,
  normalizedIssuer,
  normalizedReference,
  extraction.financialDate,
  extraction.currency,
  extraction.amount
].join("|")
```

- [ ] **Step 5: Implement HMAC token codec**

Use Web Crypto HMAC SHA-256 with base64url payload and signature:

```ts
type SlipAnalysisClaims = Readonly<{
  userId: string;
  workspaceId: string;
  imageSha256: string;
  documentIdentitySha256: string | null;
  documentKind: "bank_transfer" | "receipt";
  exp: number;
}>;
```

`issue` sets `exp` to `now + 15 * 60`. `verify` uses a constant-time signature
comparison and validates claims through Zod before checking subject, workspace,
and expiry.

- [ ] **Step 6: Run primitive tests and type checking**

Run:

```powershell
npx vitest run workers/api/test/slip-image.test.ts workers/api/test/slip-identity.test.ts workers/api/test/slip-analysis-token.test.ts
npm run typecheck -w @systems-credit/api
```

Expected: PASS.

- [ ] **Step 7: Commit Worker primitives**

```powershell
git add workers/api/src/services/slip-* workers/api/test/slip-*
git commit -m "feat: validate and sign slip analyses"
```

---

### Task 4: Add the Cloudflare Vision Extraction Adapter

**Files:**
- Create: `workers/api/src/services/slip-vision-extractor.ts`
- Create: `workers/api/test/slip-vision-extractor.test.ts`
- Modify: `workers/api/src/types.ts`

**Interfaces:**
- Produces:

```ts
export interface SlipVisionExtractor {
  extract(input: Readonly<{
    bytes: Uint8Array;
    mime: "image/jpeg" | "image/png" | "image/webp";
  }>): Promise<SlipAiExtraction>;
}

export function createCloudflareSlipVisionExtractor(
  ai: Ai
): SlipVisionExtractor;
```

- Consumes: `slipAiExtractionSchema` from Task 1.

- [ ] **Step 1: Write failing adapter tests with a fake AI binding**

Assert `AI.run` receives:

```ts
expect(run).toHaveBeenCalledWith(
  "@cf/meta/llama-3.2-11b-vision-instruct",
  expect.objectContaining({
    image: expect.stringMatching(/^data:image\/jpeg;base64,/),
    temperature: 0,
    max_tokens: 700,
    response_format: expect.objectContaining({
      type: "json_schema"
    })
  })
);
```

Test valid structured output, `documentKind: "unsupported"`, malformed JSON,
schema-invalid money/date, provider rejection, and provider timeout. Provider
failures must become `SlipVisionUnavailableError` without containing the raw
response or image.

- [ ] **Step 2: Run the adapter test and verify it fails**

Run:

```powershell
npx vitest run workers/api/test/slip-vision-extractor.test.ts
```

Expected: FAIL because the adapter does not exist.

- [ ] **Step 3: Implement the extraction prompt and JSON Schema**

The system prompt must state:

```text
Extract only text and values visible in this Thai bank transfer slip or shop
receipt. Do not infer missing values. Return null for missing fields. For bank
slips, choose income only when the document clearly indicates money received;
otherwise flag suggestedType with low confidence. Amount is the final transfer
or receipt total, not balance, tax subtotal, or change. Dates must be Gregorian
YYYY-MM-DD; convert Buddhist Era by subtracting 543 only when the printed year
is clearly Buddhist Era.
```

Use the Task 1 schema translated to JSON Schema, `temperature: 0`, no streaming,
and `max_tokens: 700`. Parse either a structured `response` object or a JSON
string response, then validate with `slipAiExtractionSchema`.

- [ ] **Step 4: Add the AI binding type**

Extend `AppEnv["Bindings"]`:

```ts
AI: Ai;
SLIP_ANALYSIS_TOKEN_SECRET: string;
```

Do not add an API token. The Worker calls Workers AI only through `env.AI`.

- [ ] **Step 5: Run the adapter and Worker tests**

Run:

```powershell
npx vitest run workers/api/test/slip-vision-extractor.test.ts
npm run typecheck -w @systems-credit/api
```

Expected: PASS.

- [ ] **Step 6: Commit the adapter**

```powershell
git add workers/api/src/types.ts workers/api/src/services/slip-vision-extractor.ts workers/api/test/slip-vision-extractor.test.ts
git commit -m "feat: extract slip data with workers ai"
```

---

### Task 5: Build Slip Import Repository, Service, and Authenticated Routes

**Files:**
- Create: `workers/api/src/services/slip-import-repository.ts`
- Create: `workers/api/src/services/supabase-slip-import-repository.ts`
- Create: `workers/api/src/services/slip-import-service.ts`
- Create: `workers/api/src/routes/slip-imports.ts`
- Create: `workers/api/test/supabase-slip-import-repository.test.ts`
- Create: `workers/api/test/slip-import-service.test.ts`
- Create: `workers/api/test/slip-imports.test.ts`
- Modify: `workers/api/src/app.ts`
- Modify: `workers/api/src/index.ts`

**Interfaces:**
- Produces:

```ts
interface SlipImportRepository {
  findDuplicate(actor, workspaceId, imageSha256, identitySha256):
    Promise<DuplicateTransaction | null>;
  consumeQuota(actor, workspaceId): Promise<
    { allowed: true } |
    { allowed: false; reason: "user_hour" | "workspace_day" }
  >;
  confirm(actor, command: ConfirmSlipCommand):
    Promise<
      { status: "posted"; transaction: PostedTransactionResponse } |
      { status: "duplicate"; existingTransaction: DuplicateTransaction }
    >;
}

interface SlipImportService {
  analyze(actor, command: AnalyzeSlipCommand): Promise<SlipAnalysisResponse>;
  confirm(actor, input: ConfirmSlipInput): Promise<PostedTransactionResponse>;
}
```

- Consumes: Task 2 RPCs, Task 3 helpers/token codec, Task 4 extractor, and the
  existing `FinanceRepository.getSnapshot(actor)` for authorized account and
  category suggestions.

- [ ] **Step 1: Write failing repository adapter tests**

Use the existing `SupabaseRestClient` fetch mocking pattern. Assert exact RPCs:

```ts
expect(fetch).toHaveBeenCalledWith(
  expect.stringContaining("/rest/v1/rpc/find_financial_document_duplicate"),
  expect.objectContaining({
    method: "POST",
    body: JSON.stringify({
      p_workspace_id: workspaceId,
      p_image_sha256: imageSha256,
      p_document_identity_sha256: null
    })
  })
);
```

Cover duplicate mapping, allowed/denied quota mapping, posted confirmation, and
duplicate confirmation.

- [ ] **Step 2: Write failing service tests**

Test this order:

1. Validate/recompute server hash.
2. Load the finance snapshot and reject when its workspace does not match the
   requested workspace.
3. Return a repository duplicate before quota or AI.
4. Consume quota.
5. Extract and schema-validate.
6. Return unsupported without token.
7. Build canonical identity and run the second duplicate check.
8. Suggest deterministic account/category fields from the authorized snapshot.
9. Issue the 15-minute token.

Assert confirmation verifies user/workspace/token, ignores client attempts to
replace document hashes, calls repository `confirm`, and maps a duplicate to
`ApiError("DUPLICATE_DOCUMENT", 409, ...)`.

- [ ] **Step 3: Write failing route tests**

Add authenticated route tests for:

- missing `image` multipart field → 400;
- multiple images → 400;
- invalid workspace UUID → 400;
- valid multipart → 200 success;
- duplicate → 200 duplicate outcome;
- unsupported → 200 unsupported outcome;
- rate limit → 429 `RATE_LIMITED`;
- provider failure → 503 `AI_UNAVAILABLE`;
- unauthenticated analysis/confirmation → 401;
- valid confirmation → 201 posted transaction.

Build test form data with:

```ts
const form = new FormData();
form.set("workspaceId", workspaceId);
form.set("clientMutationId", crypto.randomUUID());
form.set("imageSha256", imageSha256);
form.set("image", new File([jpegBytes], "slip.jpg", {
  type: "image/jpeg"
}));
```

- [ ] **Step 4: Run focused tests and verify they fail**

Run:

```powershell
npx vitest run workers/api/test/supabase-slip-import-repository.test.ts workers/api/test/slip-import-service.test.ts workers/api/test/slip-imports.test.ts
```

Expected: FAIL because the repository, service, and routes do not exist.

- [ ] **Step 5: Implement the repository adapter**

Map the three RPCs from Task 2 using `SupabaseRestClient.rpc`. Validate every
response with local strict Zod schemas before returning typed results.

- [ ] **Step 6: Implement analyze and confirm orchestration**

Use confidence threshold `0.7`. Build the note in this priority:

```ts
[
  extraction.merchant && `ร้านค้า: ${extraction.merchant}`,
  extraction.sender && `ผู้โอน: ${extraction.sender}`,
  extraction.recipient && `ผู้รับ: ${extraction.recipient}`,
  extraction.reference && `อ้างอิง: ${extraction.reference}`
].filter(Boolean).join(" · ").slice(0, 500);
```

Match accounts by normalized `institution` against account `institution` and
name. Match categories by normalized merchant text and category name; otherwise
use the first category of the suggested type and include `"category"` in
`fieldsNeedingReview`. Include `"type"` whenever type confidence is below
`0.7`, and similarly flag amount/date/account.

- [ ] **Step 7: Implement routes and dependency injection**

Mount:

```ts
app.route("/v1/slip-imports", slipImportRoutes(dependencies.slipImportService));
```

Only mount when `slipImportService` is provided, matching the existing optional
admin-service test pattern. In production `workers/api/src/index.ts`, create:

```ts
const slipImportRepository = createSupabaseSlipImportRepository(config);
const slipImportService = createSlipImportService({
  repository: slipImportRepository,
  financeRepository,
  extractor: createCloudflareSlipVisionExtractor(env.AI),
  tokenCodec: createSlipAnalysisTokenCodec(
    z.string().min(32).parse(env.SLIP_ANALYSIS_TOKEN_SECRET)
  )
});
```

Do not log `FormData`, image bytes, extraction names, references, or model
responses.

- [ ] **Step 8: Run Worker tests**

Run:

```powershell
npx vitest run workers/api/test/supabase-slip-import-repository.test.ts workers/api/test/slip-import-service.test.ts workers/api/test/slip-imports.test.ts
npm run typecheck -w @systems-credit/api
```

Expected: PASS.

- [ ] **Step 9: Commit the Worker flow**

```powershell
git add workers/api/src workers/api/test
git commit -m "feat: add authenticated slip import api"
```

---

### Task 6: Add Authenticated Multipart Methods to the Web API

**Files:**
- Modify: `apps/web/src/lib/finance-api.ts`
- Modify: `apps/web/src/lib/remote-finance-api.ts`
- Modify: `apps/web/src/lib/remote-finance-api.test.ts`

**Interfaces:**
- Produces:

```ts
analyzeSlip(input: Readonly<{
  workspaceId: string;
  clientMutationId: string;
  imageSha256: string;
  image: Blob;
}>): Promise<SlipAnalysisResponse>;

confirmSlip(input: ConfirmSlipInput): Promise<PostedTransactionResponse>;
```

- Consumes: Task 1 contracts and Task 5 endpoints.

- [ ] **Step 1: Write failing remote API tests**

Assert analysis sends `FormData`, does not set `content-type`, includes the
Bearer token, and retries once after a 401 using the refreshed session.

```ts
await api.analyzeSlip({
  workspaceId,
  clientMutationId,
  imageSha256,
  image: new Blob([jpegBytes], { type: "image/jpeg" })
});

const init = fetchMock.mock.calls[0]![1]!;
expect(init.body).toBeInstanceOf(FormData);
expect(new Headers(init.headers).has("content-type")).toBe(false);
```

Assert confirmation sends strict JSON to `/v1/slip-imports/confirm` and parses
`postedTransactionResponseSchema`.

- [ ] **Step 2: Run the remote API test and verify it fails**

Run:

```powershell
npx vitest run apps/web/src/lib/remote-finance-api.test.ts
```

Expected: FAIL because `analyzeSlip` and `confirmSlip` do not exist.

- [ ] **Step 3: Generalize the authenticated request helper**

Change the private request helper to set JSON content type only for string
bodies:

```ts
const hasJsonBody = typeof init.body === "string";
headers: {
  accept: "application/json",
  ...(hasJsonBody ? { "content-type": "application/json" } : {}),
  authorization: `Bearer ${accessToken}`,
  ...init.headers
}
```

Build analysis form fields with `FormData.set`. Use the shared response schemas.
Do not base64-encode the image in the browser API client.

- [ ] **Step 4: Run web API tests and type checking**

Run:

```powershell
npx vitest run apps/web/src/lib/remote-finance-api.test.ts
npm run typecheck -w @systems-credit/web
```

Expected: PASS.

- [ ] **Step 5: Commit web API support**

```powershell
git add apps/web/src/lib
git commit -m "feat: connect web client to slip import api"
```

---

### Task 7: Prepare and Fingerprint Images in the Browser

**Files:**
- Create: `apps/web/src/features/transactions/slip-image.ts`
- Create: `apps/web/src/features/transactions/slip-image.test.ts`

**Interfaces:**
- Produces:

```ts
export type PreparedSlipImage = Readonly<{
  blob: Blob;
  mime: "image/jpeg" | "image/png" | "image/webp";
  sha256: string;
  previewUrl: string;
  dispose(): void;
}>;

export async function prepareSlipImage(file: File): Promise<PreparedSlipImage>;
```

- Consumes: browser `createImageBitmap`, canvas, `URL.createObjectURL`, and Web Crypto.

- [ ] **Step 1: Write failing preparation tests**

Mock `createImageBitmap`, canvas `toBlob`, object URLs, and `crypto.subtle`.
Assert:

- unsupported MIME rejects with Thai copy;
- input over 5 MB rejects before decoding;
- a 4,000 × 2,000 image is rendered as 2,000 × 1,000;
- an 800 × 600 supported image is not enlarged;
- output SHA-256 is computed from the exact output Blob;
- `dispose()` revokes the preview URL exactly once;
- decode/canvas failure rejects and revokes any created URL.

- [ ] **Step 2: Run the preparation test and verify it fails**

Run:

```powershell
npx vitest run apps/web/src/features/transactions/slip-image.test.ts
```

Expected: FAIL because `slip-image.ts` does not exist.

- [ ] **Step 3: Implement client validation and resizing**

Use:

```ts
const supported = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 5_000_000;
const MAX_EDGE = 2_000;
const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
```

Preserve PNG/WebP when the canvas supports it; otherwise encode JPEG at quality
`0.9`. Reject output over 5 MB. Compute SHA-256 from
`new Uint8Array(await blob.arrayBuffer())`. Create the preview URL only after
successful preparation.

- [ ] **Step 4: Run preparation tests**

Run:

```powershell
npx vitest run apps/web/src/features/transactions/slip-image.test.ts
npm run typecheck -w @systems-credit/web
```

Expected: PASS.

- [ ] **Step 5: Commit image preparation**

```powershell
git add apps/web/src/features/transactions/slip-image*
git commit -m "feat: prepare slip images in browser"
```

---

### Task 8: Allow the Existing Transaction Form to Review a Slip Draft

**Files:**
- Modify: `apps/web/src/features/transactions/transaction-form.tsx`
- Modify: `apps/web/src/features/transactions/transaction-form.test.tsx`

**Interfaces:**
- Produces optional props:

```ts
initialDraft?: SlipTransactionDraft;
analysisToken?: string;
onDuplicate?(
  duplicate: Extract<SlipAnalysisResponse, { status: "duplicate" }>
): void;
```

- Consumes: `FinanceApi.confirmSlip` from Task 6 and existing manual
`FinanceApi.postTransaction`.

- [ ] **Step 1: Write failing draft population tests**

Render with a draft and assert type, amount, date, account, category, and note
are populated. Assert every field in `fieldsNeedingReview` receives visible
`โปรดตรวจสอบ` text linked by `aria-describedby`.

Submit a slip draft and assert:

```ts
expect(api.confirmSlip).toHaveBeenCalledWith({
  analysisToken,
  transaction: expect.objectContaining({
    workspaceId,
    accountId,
    categoryId,
    type: "expense",
    amount: "1250.50",
    financialDate: "2026-07-28"
  })
});
expect(api.postTransaction).not.toHaveBeenCalled();
```

Retain the existing manual-form test asserting `postTransaction` is called
when no analysis token exists.

- [ ] **Step 2: Run the form test and verify it fails**

Run:

```powershell
npx vitest run apps/web/src/features/transactions/transaction-form.test.tsx
```

Expected: FAIL because the form does not accept a slip draft.

- [ ] **Step 3: Initialize state from the optional draft**

Initialize only on mount/key change:

```ts
const [type, setType] = useState(initialDraft?.type ?? initialType);
const [amount, setAmount] = useState(initialDraft?.amount ?? "");
const [accountId, setAccountId] = useState(
  initialDraft?.accountId ?? accounts[0]?.id ?? ""
);
const [categoryId, setCategoryId] = useState(
  initialDraft?.categoryId ?? ""
);
const [financialDate, setFinancialDate] = useState(
  initialDraft?.financialDate ??
  toFinancialDate(new Date().toISOString(), "Asia/Bangkok")
);
const [note, setNote] = useState(initialDraft?.note ?? "");
```

Do not overwrite user edits in an effect. Require valid account/category and a
positive amount exactly as manual entry does.

- [ ] **Step 4: Submit through the correct API**

Build one `CreateTransactionInput`. If `analysisToken` exists, call
`confirmSlip`; otherwise call `postTransaction`. Map
`RemoteFinanceError.code === "DUPLICATE_DOCUMENT"` to the duplicate callback
and do not call `onPosted`.

- [ ] **Step 5: Run form regression tests**

Run:

```powershell
npx vitest run apps/web/src/features/transactions/transaction-form.test.tsx
```

Expected: PASS for both slip and manual paths.

- [ ] **Step 6: Commit form review support**

```powershell
git add apps/web/src/features/transactions/transaction-form*
git commit -m "feat: review slip drafts in transaction form"
```

---

### Task 9: Build the Slip Import Dialog and Transaction Page Integration

**Files:**
- Create: `apps/web/src/features/transactions/slip-import-dialog.tsx`
- Create: `apps/web/src/features/transactions/slip-import-dialog.test.tsx`
- Modify: `apps/web/src/features/transactions/transactions-page.tsx`
- Modify: `apps/web/src/features/transactions/transactions-page.test.tsx`
- Modify: `apps/web/src/styles.css`
- Modify: `apps/web/src/styles.test.ts`

**Interfaces:**
- Produces: complete `อ่านสลิป` interaction.
- Consumes: Tasks 6–8.

- [ ] **Step 1: Write failing dialog behavior tests**

Cover:

- disclosure text says Cloudflare AI processes the image and the application
  does not retain it;
- selecting a file shows a local preview;
- remove/close calls `dispose`;
- analyze shows `กำลังตรวจสลิปซ้ำ` then
  `กำลังอ่านยอดและรายละเอียด`;
- analyze button cannot be double-submitted;
- success renders the existing transaction form with draft values;
- duplicate renders amount, date, note, and a `/transactions` link with no
  override button;
- unsupported offers `กรอกเอง`;
- `RATE_LIMITED` and `AI_UNAVAILABLE` show retry-later/manual-entry actions;
- dialog restores focus to the opening button on close;
- Escape closes only when no confirmation request is active.

- [ ] **Step 2: Write failing page integration tests**

Assert `อ่านสลิป` is adjacent to `เพิ่มรายการ`, opens the dialog, closes the
manual form to avoid two forms at once, and refreshes the snapshot after
successful confirmation.

- [ ] **Step 3: Run UI tests and verify they fail**

Run:

```powershell
npx vitest run apps/web/src/features/transactions/slip-import-dialog.test.tsx apps/web/src/features/transactions/transactions-page.test.tsx
```

Expected: FAIL because the dialog and action do not exist.

- [ ] **Step 4: Implement the dialog state machine**

Use a discriminated state:

```ts
type SlipDialogState =
  | { status: "selecting" }
  | { status: "ready"; image: PreparedSlipImage }
  | { status: "checking"; image: PreparedSlipImage }
  | { status: "extracting"; image: PreparedSlipImage }
  | { status: "reviewing"; image: PreparedSlipImage; result: SlipAnalysisSuccess }
  | { status: "duplicate"; duplicate: DuplicateTransaction }
  | { status: "unsupported" }
  | { status: "error"; kind: "invalid" | "rate_limited" | "ai_unavailable"; message: string };
```

Create a new mutation UUID per analysis. Keep the selected image only in React
state. Always call `dispose` on replace, cancel, unmount, manual fallback, and
successful confirmation.

The server owns the actual duplicate/extraction ordering; the two progress
labels are UI phases. Switch from checking to extracting after the request is
accepted without claiming that the duplicate result has already completed.

- [ ] **Step 5: Integrate the page action**

Add a `ScanLine` icon button:

```tsx
<button
  ref={slipButtonRef}
  type="button"
  className="secondary-button compact"
  onClick={() => {
    setShowForm(false);
    setShowSlipImport(true);
  }}
>
  <ScanLine size={18} aria-hidden="true" />
  อ่านสลิป
</button>
```

Keep `เพิ่มรายการ` behavior unchanged. After slip confirmation call
`onChanged()`, close the dialog, and restore focus.

- [ ] **Step 6: Add responsive and accessible styling**

Add styles for:

- a fixed backdrop and centered dialog;
- maximum dialog width `760px`;
- preview constrained to `min(360px, 100%)`;
- 44px minimum controls;
- yellow low-confidence callouts;
- destructive duplicate warning without a confirm action;
- stacked dialog actions and full-width controls at `max-width: 820px`;
- no horizontal overflow at 390px.

Extend `styles.test.ts` to assert the responsive breakpoint, minimum control
height, dialog max width, and overflow-safe preview rule.

- [ ] **Step 7: Run all transaction UI tests**

Run:

```powershell
npx vitest run apps/web/src/features/transactions
npm run typecheck -w @systems-credit/web
```

Expected: PASS.

- [ ] **Step 8: Commit the UI**

```powershell
git add apps/web/src/features/transactions apps/web/src/styles.css apps/web/src/styles.test.ts
git commit -m "feat: add slip import review flow"
```

---

### Task 10: Configure Deployment, Document Operations, and Verify End to End

**Files:**
- Modify: `wrangler.jsonc`
- Modify: `.dev.vars.example`
- Modify: `docs/runbooks/deploy-cloudflare-supabase.md`

**Interfaces:**
- Produces: deployable Worker configuration and operator instructions.
- Consumes: all previous tasks.

- [ ] **Step 1: Add a failing configuration test**

Extend `workers/api/test/config.test.ts` to assert:

```ts
expect(config.ai).toEqual({ binding: "AI" });
expect(config.secrets.required).toContain(
  "SLIP_ANALYSIS_TOKEN_SECRET"
);
```

Also assert `.dev.vars.example` contains the secret name but no real secret.

- [ ] **Step 2: Run the config test and verify it fails**

Run:

```powershell
npx vitest run workers/api/test/config.test.ts
```

Expected: FAIL because the AI binding and secret are absent.

- [ ] **Step 3: Update Wrangler and local environment example**

Add:

```json
"ai": {
  "binding": "AI"
}
```

Add `SLIP_ANALYSIS_TOKEN_SECRET` to `secrets.required`. Add this non-secret
example:

```dotenv
SLIP_ANALYSIS_TOKEN_SECRET=replace-with-at-least-32-random-characters
```

- [ ] **Step 4: Update the deployment runbook**

Document this exact order:

1. Apply `202607280017_slip_imports.sql`.
2. Set `SLIP_ANALYSIS_TOKEN_SECRET` in Cloudflare Variables and Secrets.
3. Add/verify the `AI` binding.
4. Accept the Meta model license with the Cloudflare account before first use.
5. Deploy the Worker.
6. Upload one redacted Thai bank slip and one redacted receipt.
7. Confirm that no Storage object is created.
8. Re-upload each document and verify it is blocked as a duplicate.
9. Verify manual entry still posts when AI is unavailable.

Include a warning that local remote-binding AI tests consume the Cloudflare
Workers AI allocation.

- [ ] **Step 5: Run the complete automated suite**

Run:

```powershell
npx vitest run
npm run test:db
npm run typecheck
npm run build
git diff --check
```

Expected: all available tests pass, all packages typecheck, Vite builds, and
Wrangler dry-run succeeds.

- [ ] **Step 6: Run local browser smoke tests**

Start the existing local Worker/web flow. At desktop, 820px, and 390px widths,
verify:

- select/camera input;
- preview and disposal;
- successful review;
- low-confidence warnings;
- duplicate blocking;
- unsupported document fallback;
- rate/provider error fallback;
- manual entry regression;
- no horizontal overflow;
- no console errors.

Use only redacted test documents. Inspect Supabase and confirm it contains
hashes and metadata but no image bytes or raw document reference.

- [ ] **Step 7: Commit configuration and runbook**

```powershell
git add wrangler.jsonc .dev.vars.example docs/runbooks/deploy-cloudflare-supabase.md workers/api/test/config.test.ts
git commit -m "chore: configure slip analysis deployment"
```

- [ ] **Step 8: Review the final branch before push**

Run:

```powershell
git status --short
git log --oneline -12
git diff origin/main...HEAD --stat
```

Expected: only intentional feature commits, a clean worktree, and no secrets or
image fixtures containing personal information.

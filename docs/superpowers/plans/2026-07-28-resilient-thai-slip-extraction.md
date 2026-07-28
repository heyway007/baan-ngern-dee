# Resilient Thai Slip Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make both supplied K+ slips produce reviewable expense drafts while preserving strict contracts, privacy, duplicate detection, and explicit confirmation.

**Architecture:** Add a focused normalization unit between the raw Workers AI answer and `slipAiExtractionSchema`. The unit converts Thai dates, money, currencies, enum aliases, missing keys, and extra keys into one canonical `SlipAiExtraction`; the adapter remains responsible for provider calls and safe failure classification, while the existing import service remains responsible for draft review and posting.

**Tech Stack:** TypeScript 5.8, Vitest 3, Zod, Cloudflare Workers AI, Hono, React 19

## Global Constraints

- Call Workers AI exactly once per non-duplicate analysis.
- Do not add HEIC, PDF, statement, or multi-page support.
- Do not persist or log images, raw AI answers, names, references, account numbers, amounts, or dates.
- Do not add either supplied K+ image to Git; tests must use synthetic values.
- Keep monetary values as decimal strings and never convert them through JavaScript floating-point arithmetic.
- Keep `slipAiExtractionSchema` as the strict boundary consumed by the finance service.
- Keep duplicate checks, quota consumption, signed analysis tokens, and explicit user confirmation unchanged.
- A reviewable candidate must contain either amount plus one of date/reference/party, or reference plus date and party.
- Canonical present fields receive confidence `0.75`; missing or rejected fields receive `0`.

---

## File Structure

- Create `workers/api/src/services/slip-extraction-normalizer.ts`
  - Owns raw-object interpretation, Thai date parsing, exact money cleanup,
    enum aliasing, partial-field handling, confidence assignment, and final
    strict schema validation.
- Create `workers/api/test/slip-extraction-normalizer.test.ts`
  - Covers synthetic K+ output and individual normalization boundaries.
- Modify `workers/api/src/services/slip-vision-extractor.ts`
  - Keeps provider invocation and answer unwrapping; delegates all canonical
    normalization and classifies safe failure categories.
- Modify `workers/api/test/slip-vision-extractor.test.ts`
  - Covers wrapped/fenced answers, a single provider call, partial answers, and
    safe failure categories.
- Modify `workers/api/src/services/slip-import-service.ts`
  - Preserves the safe extraction failure category when creating `ApiError`.
- Modify `workers/api/test/slip-import-service.test.ts`
  - Proves partial normalized results reach a review draft and missing required
    fields are marked for review.
- Modify `workers/api/src/api-error.ts`
  - Adds optional bounded log context without changing the public error body.
- Modify `workers/api/src/middleware/error-handler.ts`
  - Includes only the bounded safe log context alongside the existing request
    ID.
- Modify `workers/api/test/error-handler.test.ts`
  - Proves safe categories are logged and never returned publicly.

---

### Task 1: Canonical Thai Slip Normalizer

**Files:**
- Create: `workers/api/src/services/slip-extraction-normalizer.ts`
- Create: `workers/api/test/slip-extraction-normalizer.test.ts`

**Interfaces:**
- Consumes: an `unknown` parsed JSON value from the vision adapter.
- Produces:

```ts
export class SlipExtractionNormalizationError extends Error {
  constructor(readonly category: "invalid_shape");
}

export function normalizeSlipExtraction(value: unknown): SlipAiExtraction;
```

- [ ] **Step 1: Write the failing K+ normalization test**

Create `workers/api/test/slip-extraction-normalizer.test.ts` with a synthetic
fixture that contains no real personal data:

```ts
import { describe, expect, it } from "vitest";

import { normalizeSlipExtraction } from
  "../src/services/slip-extraction-normalizer";

describe("normalizeSlipExtraction", () => {
  it("normalizes a K+ bill payment with a Thai short date", () => {
    expect(normalizeSlipExtraction({
      documentKind: "bill_payment",
      suggestedType: "payment",
      amount: "1,191.67 บาท",
      currency: "฿",
      financialDate: "27 ก.ค. 69",
      reference: "SYNTHETIC-001",
      merchant: null,
      sender: "ผู้ชำระตัวอย่าง",
      recipient: "บัตรตัวอย่าง",
      institution: "ธนาคารตัวอย่าง",
      ignoredProviderField: "discard me"
    })).toEqual({
      documentKind: "bank_transfer",
      suggestedType: "expense",
      amount: "1191.67",
      currency: "THB",
      financialDate: "2026-07-27",
      reference: "SYNTHETIC-001",
      merchant: null,
      sender: "ผู้ชำระตัวอย่าง",
      recipient: "บัตรตัวอย่าง",
      institution: "ธนาคารตัวอย่าง",
      confidence: {
        documentKind: 0.75,
        suggestedType: 0.75,
        amount: 0.75,
        financialDate: 0.75,
        reference: 0.75
      }
    });
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npx vitest run workers/api/test/slip-extraction-normalizer.test.ts
```

Expected: FAIL because `slip-extraction-normalizer.ts` does not exist.

- [ ] **Step 3: Add failing boundary tests**

Add table-driven literal expectations for:

```ts
it.each([
  ["2026-07-27", "2026-07-27"],
  ["27/07/2569", "2026-07-27"],
  ["27 กรกฎาคม 2569", "2026-07-27"],
  ["31 ก.พ. 69", null],
  ["not-a-date", null]
])("normalizes date %s", (financialDate, expected) => {
  const result = normalizeSlipExtraction({
    documentKind: "receipt",
    suggestedType: "expense",
    amount: "60.00",
    currency: "THB",
    financialDate,
    reference: "SYNTHETIC-DATE",
    merchant: "ร้านตัวอย่าง"
  });
  expect(result.financialDate).toBe(expected);
});

it("keeps usable fields when optional values are malformed", () => {
  const result = normalizeSlipExtraction({
    documentKind: "transfer",
    suggestedType: "outgoing",
    amount: "60.00 THB",
    currency: "บาท",
    financialDate: "bad date",
    reference: 42,
    recipient: "ผู้รับตัวอย่าง",
    institution: "ธนาคารตัวอย่าง"
  });
  expect(result).toMatchObject({
    documentKind: "bank_transfer",
    suggestedType: "expense",
    amount: "60.00",
    currency: "THB",
    financialDate: null,
    reference: null,
    recipient: "ผู้รับตัวอย่าง"
  });
  expect(result.confidence.financialDate).toBe(0);
  expect(result.confidence.reference).toBe(0);
});

it("returns unsupported for an object without enough financial evidence", () => {
  expect(normalizeSlipExtraction({
    documentKind: "screen",
    amount: "543.00"
  }).documentKind).toBe("unsupported");
});
```

Run the same focused test and confirm each new case fails because the
normalization behavior is missing.

- [ ] **Step 4: Implement exact string and alias normalization**

Create `slip-extraction-normalizer.ts`. Use `Record<string, unknown>` only
after excluding `null` and arrays. Implement these literal alias groups:

```ts
const expenseAliases = new Set([
  "expense", "payment", "outgoing", "paid",
  "รายจ่าย", "ชำระเงิน", "จ่ายเงิน", "จ่ายบิล"
]);
const incomeAliases = new Set([
  "income", "incoming", "received", "receive",
  "รายรับ", "รับเงิน", "เงินเข้า"
]);
const bankAliases = new Set([
  "bank_transfer", "transfer", "payment", "bill_payment",
  "ชำระเงิน", "จ่ายเงิน", "จ่ายบิล", "โอนเงิน"
]);
const receiptAliases = new Set([
  "receipt", "shop_receipt", "ใบเสร็จ", "ใบกำกับภาษี"
]);
```

Normalize alias keys with NFKC, locale lowercase, surrounding trim, and
collapsed spaces. Optional text values must:

```ts
function optionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").trim();
  return normalized ? normalized.slice(0, 200) : null;
}
```

Convert Thai digits `๐๑๒๓๔๕๖๗๘๙` to `0123456789` before parsing money or
dates.

- [ ] **Step 5: Implement exact money normalization**

Strip only known presentation tokens:

```ts
const cleaned = thaiDigits(value)
  .normalize("NFKC")
  .replace(/(?:THB|บาท|฿|,|\s)/gi, "");
```

Return the cleaned value only when it matches
`/^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/` and contains a non-zero digit. Otherwise
return `null`. Do not call `Number`, `parseFloat`, or `toFixed`.

- [ ] **Step 6: Implement Thai and Buddhist Era date normalization**

Use this explicit month map. Normalize month tokens by removing dots and
spaces:

```ts
const thaiMonths = new Map([
  ["มค", 1], ["มกราคม", 1],
  ["กพ", 2], ["กุมภาพันธ์", 2],
  ["มีค", 3], ["มีนาคม", 3],
  ["เมย", 4], ["เมษายน", 4],
  ["พค", 5], ["พฤษภาคม", 5],
  ["มิย", 6], ["มิถุนายน", 6],
  ["กค", 7], ["กรกฎาคม", 7],
  ["สค", 8], ["สิงหาคม", 8],
  ["กย", 9], ["กันยายน", 9],
  ["ตค", 10], ["ตุลาคม", 10],
  ["พย", 11], ["พฤศจิกายน", 11],
  ["ธค", 12], ["ธันวาคม", 12]
]);
```

Convert years as follows:

```ts
function gregorianYear(year: number, sourceDigits: number) {
  if (sourceDigits === 2) return 2500 + year - 543;
  return year >= 2400 ? year - 543 : year;
}
```

Support canonical `YYYY-MM-DD`, numeric `D/M/YYYY`, and Thai textual
`D <month> YY|YYYY`. Validate the reconstructed date with UTC component
round-tripping:

```ts
const date = new Date(Date.UTC(year, month - 1, day));
const valid =
  date.getUTCFullYear() === year &&
  date.getUTCMonth() === month - 1 &&
  date.getUTCDate() === day;
```

Return `null` when parsing is ambiguous or invalid.

- [ ] **Step 7: Implement evidence gating, confidence, and strict validation**

Derive canonical fields first. Define `partyPresent` from merchant, sender,
recipient, or institution. A candidate is reviewable only when:

```ts
const reviewable =
  Boolean(amount && (financialDate || reference || partyPresent)) ||
  Boolean(reference && financialDate && partyPresent);
```

When `reviewable` is false, return a strict extraction with
`documentKind: "unsupported"`, every optional value preserved only when it
passes its canonical parser, and all confidence values derived from canonical
presence.

Infer an unknown document kind as:

```ts
if (reference && (institution || sender || recipient)) "bank_transfer";
else if (amount && merchant) "receipt";
else "unsupported";
```

Build only the declared schema keys, assign `0.75` for present canonical fields
and `0` for missing fields, then call
`slipAiExtractionSchema.parse(canonical)`.

- [ ] **Step 8: Run focused tests and verify GREEN**

Run:

```powershell
npx vitest run workers/api/test/slip-extraction-normalizer.test.ts
```

Expected: all normalizer tests PASS.

- [ ] **Step 9: Commit the normalizer**

```powershell
git add -- workers/api/src/services/slip-extraction-normalizer.ts workers/api/test/slip-extraction-normalizer.test.ts
git commit -m "feat: normalize Thai slip extraction"
```

---

### Task 2: Integrate Normalization and Safe Failure Categories

**Files:**
- Modify: `workers/api/src/services/slip-vision-extractor.ts`
- Modify: `workers/api/test/slip-vision-extractor.test.ts`
- Modify: `workers/api/src/api-error.ts`
- Modify: `workers/api/src/middleware/error-handler.ts`
- Modify: `workers/api/test/error-handler.test.ts`
- Modify: `workers/api/src/services/slip-import-service.ts`

**Interfaces:**
- Consumes: `normalizeSlipExtraction(value: unknown): SlipAiExtraction` from
  Task 1.
- Produces:

```ts
export type SlipVisionFailureCategory =
  | "provider"
  | "empty_answer"
  | "invalid_json"
  | "invalid_shape";

export class SlipVisionUnavailableError extends Error {
  constructor(readonly category: SlipVisionFailureCategory);
}
```

`ApiError` gains this bounded internal-only context:

```ts
export type ApiErrorLogContext = Readonly<{
  slipVisionCategory?:
    | "provider"
    | "empty_answer"
    | "invalid_json"
    | "invalid_shape";
}>;

readonly logContext?: ApiErrorLogContext;
```

The public `ApiErrorResponse` remains unchanged.

- [ ] **Step 1: Write failing adapter tests for partial and malformed answers**

Replace the old adapter fixture's provider confidence with a raw partial
answer and assert normalized output:

```ts
it("normalizes a wrapped partial provider answer", async () => {
  const run = vi.fn().mockResolvedValue({
    result: {
      answer: JSON.stringify({
        documentKind: "bill_payment",
        suggestedType: "payment",
        amount: "60.00 บาท",
        financialDate: "27 ก.ค. 69",
        reference: "SYNTHETIC-060",
        recipient: "ร้านตัวอย่าง",
        institution: "ธนาคารตัวอย่าง"
      })
    }
  });
  const result = await createCloudflareSlipVisionExtractor({ run }).extract({
    bytes: new Uint8Array([0xff, 0xd8, 0xff]),
    mime: "image/jpeg"
  });
  expect(result).toMatchObject({
    documentKind: "bank_transfer",
    suggestedType: "expense",
    amount: "60.00",
    currency: null,
    financialDate: "2026-07-27"
  });
  expect(run).toHaveBeenCalledTimes(1);
});
```

Add literal category expectations:

```ts
it.each([
  [{}, "empty_answer"],
  [{ answer: "not-json" }, "invalid_json"],
  [{ answer: "[]" }, "invalid_shape"]
])("classifies unsafe provider output", async (providerResult, category) => {
  const extractor = createCloudflareSlipVisionExtractor({
    run: vi.fn().mockResolvedValue(providerResult)
  });
  await expect(extractor.extract({
    bytes: new Uint8Array([0xff, 0xd8, 0xff]),
    mime: "image/jpeg"
  })).rejects.toMatchObject({ category });
});

it("classifies a rejected provider call", async () => {
  const extractor = createCloudflareSlipVisionExtractor({
    run: vi.fn().mockRejectedValue(new Error("provider detail"))
  });
  await expect(extractor.extract({
    bytes: new Uint8Array([0xff, 0xd8, 0xff]),
    mime: "image/jpeg"
  })).rejects.toMatchObject({ category: "provider" });
});
```

- [ ] **Step 2: Run adapter tests and verify RED**

Run:

```powershell
npx vitest run workers/api/test/slip-vision-extractor.test.ts
```

Expected: FAIL because the adapter still uses its local strict normalizer and
does not expose bounded failure categories.

- [ ] **Step 3: Refactor the adapter around explicit boundaries**

Import `normalizeSlipExtraction`. Remove `addConservativeConfidence`. Keep
`parseAnswer` limited to fence removal and `JSON.parse`.

Use separate `try/catch` boundaries:

```ts
let providerResult: unknown;
try {
  providerResult = await ai.run(model, input);
} catch {
  throw new SlipVisionUnavailableError("provider");
}

const answer = unwrapAnswer(providerResult);
if (typeof answer !== "string" || !answer.trim()) {
  throw new SlipVisionUnavailableError("empty_answer");
}

let parsed: unknown;
try {
  parsed = parseAnswer(answer);
} catch {
  throw new SlipVisionUnavailableError("invalid_json");
}

try {
  return normalizeSlipExtraction(parsed);
} catch {
  throw new SlipVisionUnavailableError("invalid_shape");
}
```

Do not include the provider result or answer text in any thrown error.

- [ ] **Step 4: Update the extraction prompt**

Keep the current one-call Moondream request. Add explicit guidance that K+
labels may be returned through existing canonical fields:

```text
Thai labels such as "ชำระเงินสำเร็จ" or "จ่ายบิลสำเร็จ" mean an outgoing
bank payment and suggestedType expense. A two-digit Thai year is Buddhist Era.
Return null for a field you cannot read. Do not add fields.
```

The local normalizer remains authoritative even when the model ignores these
instructions.

- [ ] **Step 5: Run adapter tests and verify GREEN**

Run:

```powershell
npx vitest run workers/api/test/slip-vision-extractor.test.ts workers/api/test/slip-extraction-normalizer.test.ts
```

Expected: both test files PASS.

- [ ] **Step 6: Write a failing safe-log test**

In `workers/api/test/error-handler.test.ts`, add a test that sends:

```ts
new ApiError(
  "AI_UNAVAILABLE",
  503,
  "ยังอ่านรูปไม่ได้ กรุณาลองใหม่หรือกรอกข้อมูลเอง",
  { slipVisionCategory: "invalid_json" }
)
```

Assert the `console.error` object contains:

```ts
expect.objectContaining({
  code: "AI_UNAVAILABLE",
  requestId: expect.any(String),
  slipVisionCategory: "invalid_json",
  status: 503
})
```

Also assert the JSON response contains only `code`, `message`, and
`requestId`, with no `slipVisionCategory`.

- [ ] **Step 7: Run the safe-log test and verify RED**

Run:

```powershell
npx vitest run workers/api/test/error-handler.test.ts
```

Expected: FAIL because `ApiError` does not yet accept or log bounded context.

- [ ] **Step 8: Add bounded internal log context**

Extend the `ApiError` constructor with an optional fourth argument:

```ts
constructor(
  readonly code: ApiErrorCode,
  readonly status: 400 | 401 | 403 | 404 | 409 | 429 | 500 | 503,
  message: string,
  readonly logContext?: ApiErrorLogContext
)
```

In `errorHandler`, spread `apiError.logContext` only into the `console.error`
object:

```ts
...(apiError.logContext ?? {})
```

Do not add log context to the response body.

When `SlipImportService` catches `SlipVisionUnavailableError`, construct the
existing `AI_UNAVAILABLE` error with:

```ts
{ slipVisionCategory: error.category }
```

- [ ] **Step 9: Run focused logging and service tests**

Run:

```powershell
npx vitest run workers/api/test/error-handler.test.ts workers/api/test/slip-import-service.test.ts
```

Expected: all focused tests PASS, and no test logs raw extraction content.

- [ ] **Step 10: Commit adapter and safe diagnostics**

```powershell
git add -- workers/api/src/services/slip-vision-extractor.ts workers/api/test/slip-vision-extractor.test.ts workers/api/src/api-error.ts workers/api/src/middleware/error-handler.ts workers/api/test/error-handler.test.ts workers/api/src/services/slip-import-service.ts
git commit -m "fix: tolerate partial slip AI output"
```

---

### Task 3: Release Verification

**Files:**
- Verify: `workers/api/test/slip-import-service.test.ts`
- Verify: `apps/web/src/features/transactions/transaction-form.test.tsx`
- Verify: `apps/web/src/features/transactions/slip-import-dialog.test.tsx`

**Interfaces:**
- Consumes: canonical partial `SlipAiExtraction` from Tasks 1 and 2.
- Produces: verification that the existing `SlipAnalysisResponse` success draft
  and `fieldsNeedingReview` behavior remain unchanged.

- [ ] **Step 1: Run focused service and web regressions**

Run:

```powershell
npx vitest run workers/api/test/slip-import-service.test.ts
npx vitest run apps/web/src/features/transactions/transaction-form.test.tsx apps/web/src/features/transactions/slip-import-dialog.test.tsx
```

Expected: the existing service, review, and upload tests PASS without
production service or web changes. The service already marks null amount and
date values for review in `draftFrom`.

- [ ] **Step 2: Run complete automated verification**

Run:

```powershell
npm test -- --run
npm run typecheck
npm run build
git diff --check
```

Expected:

- Vitest reports zero failed test files and zero failed tests.
- All workspace TypeScript checks exit `0`.
- Vite production build and Worker dry run exit `0`.
- `git diff --check` exits `0`.

- [ ] **Step 3: Push and verify Cloudflare deployment**

Run:

```powershell
git push origin main
npx wrangler deployments list -c wrangler.jsonc
curl.exe -sS -i https://baan-ngern-dee.newforico-9ea.workers.dev/health
```

Expected:

- `main` pushes successfully.
- A deployment created after the push appears at 100%.
- `/health` returns HTTP `200` and
  `{"ok":true,"service":"systems-credit-api"}`.

- [ ] **Step 4: Test the two supplied images without confirming**

Use the authenticated production slip-import dialog to analyze:

- `C:\Users\ASUS\Downloads\S__75882500.jpg`
- `C:\Users\ASUS\Downloads\S__75882499.jpg`

Do not click the final transaction confirmation button.

Expected:

- The first image opens a review draft with amount `1191.67`, date
  `2026-07-27`, and expense type.
- The second image opens a review draft with amount `60.00`, date
  `2026-07-27`, and expense type.
- Neither image produces `AI_UNAVAILABLE`.
- No image or raw model answer appears in Worker logs.

# Resilient Slip AI Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retry transient Workers AI slip-analysis failures up to three total attempts and count the daily quota only after a usable AI response.

**Architecture:** Add a focused retry wrapper around the existing single-attempt vision extractor, with injectable delay and structured logging for deterministic tests. The slip import service performs a non-mutating quota preflight, runs the retry wrapper, then calls the existing atomic quota RPC exactly once before returning any AI-produced result. The web refreshes quota from the server and distinguishes exhausted AI retries from validation and rate-limit failures.

**Tech Stack:** TypeScript, Cloudflare Workers AI, Hono, React, Zod, Vitest, Supabase PostgreSQL RPC

## Global Constraints

- Use at most three model calls per uploaded image.
- Retry delays are exactly 300 milliseconds and 900 milliseconds.
- Retry only `provider`, `empty_answer`, `invalid_json`, and `invalid_shape`.
- A request that exhausts all retries must not consume daily quota.
- A valid AI response, including `unsupported`, consumes exactly one quota unit.
- Keep the existing workspace limit of 30 successful analyses per UTC day.
- Keep browser analysis concurrency at two images.
- Do not change the Workers AI model or add a fallback model.
- Do not store uploaded image bytes or raw model answers.
- Log only bounded failure category, attempt number, request ID, and request path.
- Do not change duplicate detection, analysis-token scope, or batch confirmation idempotency.
- No database migration is required.

---

## File Structure

- Create `workers/api/src/services/slip-vision-retry.ts`: isolated retry policy, delays, and bounded structured logging.
- Create `workers/api/test/slip-vision-retry.test.ts`: deterministic retry-policy unit tests with fake sleep and logger.
- Modify `workers/api/src/services/slip-import-service.ts`: quota preflight, retry integration, and post-extraction quota consumption.
- Modify `workers/api/src/routes/slip-imports.ts`: pass the request ID into the service command.
- Modify `workers/api/test/slip-import-service.test.ts`: service ordering, quota, unsupported, and final-slot tests.
- Modify `workers/api/test/slip-imports.test.ts`: route request-ID expectation where the analyze command is asserted.
- Modify `apps/web/src/features/transactions/slip-import-dialog.tsx`: specific AI-unavailable copy and authoritative quota refresh.
- Modify `apps/web/src/features/transactions/slip-import-dialog.test.tsx`: UI copy and quota-refresh regressions.

### Task 1: Deterministic Workers AI Retry Policy

**Files:**
- Create: `workers/api/src/services/slip-vision-retry.ts`
- Create: `workers/api/test/slip-vision-retry.test.ts`

**Interfaces:**
- Consumes: `SlipVisionExtractor`, `SlipVisionUnavailableError`, and `SlipAiExtraction`.
- Produces:

```ts
export type SlipVisionRetryEvent = Readonly<{
  code: "SLIP_VISION_RETRY";
  attempt: 1 | 2 | 3;
  maxAttempts: 3;
  slipVisionCategory: SlipVisionFailureCategory;
  requestId: string;
  path: "/v1/slip-imports/analyze";
}>;

export type SlipVisionRetryOptions = Readonly<{
  extractor: SlipVisionExtractor;
  input: Parameters<SlipVisionExtractor["extract"]>[0];
  requestId: string;
  sleep?: (milliseconds: number) => Promise<void>;
  log?: (event: SlipVisionRetryEvent) => void;
}>;

export function extractSlipWithRetry(
  options: SlipVisionRetryOptions
): Promise<SlipAiExtraction>;
```

- [ ] **Step 1: Write retry-policy tests that fail because the module does not exist**

Create tests covering first-attempt success, second-attempt success after
`provider`, third-attempt success after `invalid_json`, three exhausted bounded
failures, and immediate propagation of an unexpected `Error`.

```ts
const sleep = vi.fn().mockResolvedValue(undefined);
const log = vi.fn();
const extractor = {
  extract: vi.fn()
    .mockRejectedValueOnce(new SlipVisionUnavailableError("provider"))
    .mockResolvedValueOnce(extraction)
};

await expect(extractSlipWithRetry({
  extractor,
  input: image,
  requestId: "request-1",
  sleep,
  log
})).resolves.toEqual(extraction);

expect(extractor.extract).toHaveBeenCalledTimes(2);
expect(sleep).toHaveBeenCalledWith(300);
expect(log).toHaveBeenCalledWith({
  code: "SLIP_VISION_RETRY",
  attempt: 1,
  maxAttempts: 3,
  slipVisionCategory: "provider",
  requestId: "request-1",
  path: "/v1/slip-imports/analyze"
});
```

- [ ] **Step 2: Run the focused test and verify the red state**

Run:

```powershell
npx vitest run workers/api/test/slip-vision-retry.test.ts
```

Expected: FAIL because `../src/services/slip-vision-retry` cannot be resolved.

- [ ] **Step 3: Implement the minimal retry wrapper**

Use `[300, 900]` as the delay schedule. The default `sleep` uses
`setTimeout`, and the default `log` calls `console.warn(event)`.

```ts
const delays = [300, 900] as const;

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export async function extractSlipWithRetry(
  options: SlipVisionRetryOptions
): Promise<SlipAiExtraction> {
  const sleep = options.sleep ?? delay;
  const log = options.log ?? ((event) => console.warn(event));

  for (let index = 0; index < 3; index += 1) {
    try {
      return await options.extractor.extract(options.input);
    } catch (error) {
      if (!(error instanceof SlipVisionUnavailableError)) throw error;
      const attempt = (index + 1) as 1 | 2 | 3;
      log({
        code: "SLIP_VISION_RETRY",
        attempt,
        maxAttempts: 3,
        slipVisionCategory: error.category,
        requestId: options.requestId,
        path: "/v1/slip-imports/analyze"
      });
      if (attempt === 3) throw error;
      await sleep(delays[index]!);
    }
  }
  throw new Error("UNREACHABLE_SLIP_VISION_RETRY");
}
```

- [ ] **Step 4: Run retry-policy and existing extractor tests**

Run:

```powershell
npx vitest run workers/api/test/slip-vision-retry.test.ts workers/api/test/slip-vision-extractor.test.ts
```

Expected: both test files PASS, including exact delays `[300, 900]`, three
maximum calls, bounded logs, and no retry for unexpected errors.

- [ ] **Step 5: Commit the retry unit**

```powershell
git add -- workers/api/src/services/slip-vision-retry.ts workers/api/test/slip-vision-retry.test.ts
git commit -m "feat: retry transient slip vision failures"
```

### Task 2: Success-Only Quota Consumption

**Files:**
- Modify: `workers/api/src/services/slip-import-service.ts`
- Modify: `workers/api/src/routes/slip-imports.ts`
- Modify: `workers/api/test/slip-import-service.test.ts`
- Modify: `workers/api/test/slip-imports.test.ts`

**Interfaces:**
- Consumes: `extractSlipWithRetry` from Task 1 and the existing
  `getQuota`/`consumeQuota` repository methods.
- Changes `AnalyzeSlipCommand` to require `requestId: string`.
- Produces: unchanged public HTTP response contracts and error codes.

- [ ] **Step 1: Add failing service tests for quota ordering**

Add these independent cases:

```ts
it("does not consume quota when all AI attempts fail", async () => {
  deps.extractor.extract.mockRejectedValue(
    new SlipVisionUnavailableError("provider")
  );

  await expect(service.analyze(actor, command)).rejects.toMatchObject({
    code: "AI_UNAVAILABLE",
    status: 503
  });
  expect(deps.extractor.extract).toHaveBeenCalledTimes(3);
  expect(deps.repository.consumeQuota).not.toHaveBeenCalled();
});

it("consumes quota once after a usable extraction", async () => {
  await expect(service.analyze(actor, command)).resolves.toMatchObject({
    status: "success"
  });
  expect(deps.repository.getQuota).toHaveBeenCalledBefore(
    deps.extractor.extract
  );
  expect(deps.extractor.extract).toHaveBeenCalledBefore(
    deps.repository.consumeQuota
  );
  expect(deps.repository.consumeQuota).toHaveBeenCalledTimes(1);
});
```

Also test:

- preflight `{ used: 30, limit: 30 }` returns `RATE_LIMITED` without inference;
- `unsupported` consumes one quota unit;
- a post-extraction `consumeQuota` result with `allowed: false` returns
  `RATE_LIMITED` without issuing an analysis token;
- a duplicate image still performs neither inference nor quota mutation.

Use an injected zero-delay sleep in test dependencies so retry tests do not wait
1.2 seconds.

- [ ] **Step 2: Run service tests and verify the red state**

Run:

```powershell
npx vitest run workers/api/test/slip-import-service.test.ts
```

Expected: FAIL because quota is consumed before extraction, no retry occurs, and
`AnalyzeSlipCommand` has no request ID.

- [ ] **Step 3: Pass the request ID from the route**

Update the analyze route command:

```ts
const result = await service.analyze(context.get("auth"), {
  ...parsed.data,
  requestId: context.get("requestId"),
  bytes: new Uint8Array(await image.arrayBuffer()),
  claimedMime: image.type
});
```

Update route tests to expect the bounded request ID while continuing to avoid
asserting image bytes in error logs.

- [ ] **Step 4: Move quota mutation after retry success**

In `analyze`:

```ts
const quotaBefore = await dependencies.repository.getQuota(
  actor,
  command.workspaceId
);
if (quotaBefore.used >= quotaBefore.limit) throw quotaError();

const extraction = await extractSlipWithRetry({
  extractor: dependencies.extractor,
  input: image,
  requestId: command.requestId,
  ...(dependencies.sleep ? { sleep: dependencies.sleep } : {}),
  ...(dependencies.logVisionRetry
    ? { log: dependencies.logVisionRetry }
    : {})
});

const quota = await dependencies.repository.consumeQuota(
  actor,
  command.workspaceId
);
if (!quota.allowed) throw quotaError();
```

Keep `unsupported` handling after `consumeQuota`. Keep image-hash duplicate
checking before `getQuota` and inference. Keep document-identity duplicate
checking after extraction and quota consumption because identifying that
duplicate required a successful AI analysis.

Add optional service dependencies:

```ts
sleep?: (milliseconds: number) => Promise<void>;
logVisionRetry?: (event: SlipVisionRetryEvent) => void;
```

Use the existing `RATE_LIMITED` status, code, and Thai message in one local
`quotaError()` helper to avoid duplicate branches.

```ts
function quotaError() {
  return new ApiError(
    "RATE_LIMITED",
    429,
    "ใช้การอ่านสลิปครบ 30 รูปของวันนี้แล้ว กรุณาลองใหม่วันถัดไป"
  );
}
```

- [ ] **Step 5: Run service and route tests**

Run:

```powershell
npx vitest run workers/api/test/slip-import-service.test.ts workers/api/test/slip-imports.test.ts
```

Expected: both files PASS. Verify three calls on exhausted retry, zero quota
mutation on failure, and exactly one mutation on successful or unsupported
analysis.

- [ ] **Step 6: Commit service integration**

```powershell
git add -- workers/api/src/services/slip-import-service.ts workers/api/src/routes/slip-imports.ts workers/api/test/slip-import-service.test.ts workers/api/test/slip-imports.test.ts
git commit -m "fix: count only completed slip analyses"
```

### Task 3: Accurate Web Quota and Actionable Error Copy

**Files:**
- Modify: `apps/web/src/features/transactions/slip-import-dialog.tsx`
- Modify: `apps/web/src/features/transactions/slip-import-dialog.test.tsx`

**Interfaces:**
- Consumes: existing `FinanceApi.getSlipQuota(workspaceId)` and
  `RemoteFinanceError.code`.
- Produces: no component prop or public API changes.

- [ ] **Step 1: Add failing dialog tests**

Add a test that rejects analysis with:

```ts
new RemoteFinanceError(
  "AI_UNAVAILABLE",
  503,
  "ยังอ่านรูปไม่ได้",
  "request-ai-1"
)
```

Assert the row shows:

```text
AI ขัดข้องชั่วคราว ระบบลองให้แล้ว 3 ครั้งและไม่หักโควตา กรุณาลองใหม่
```

Add a successful-analysis test where the first quota read returns `7/30` and
the post-analysis refresh returns `8/30`. Assert the dialog eventually displays
`วันนี้ใช้ 8/30 รูป`. Keep the existing `RATE_LIMITED` expectation unchanged.

- [ ] **Step 2: Run dialog tests and verify the red state**

Run:

```powershell
npx vitest run apps/web/src/features/transactions/slip-import-dialog.test.tsx
```

Expected: FAIL because AI-unavailable uses generic copy and successful analysis
increments local state rather than refreshing authoritative quota.

- [ ] **Step 3: Implement precise error mapping**

Update `analysisError`:

```ts
if (reason.code === "RATE_LIMITED") {
  return "ใช้โควตาอ่านสลิปครบ 30 รูปของวันนี้แล้ว";
}
if (reason.code === "AI_UNAVAILABLE") {
  return "AI ขัดข้องชั่วคราว ระบบลองให้แล้ว 3 ครั้งและไม่หักโควตา กรุณาลองใหม่";
}
```

Retain the generic validation/network fallback.

- [ ] **Step 4: Refresh quota from the server after a response**

Extract a local `refreshQuota` callback that calls `api.getSlipQuota`, updates
`used` with `Math.max(current.used, nextQuota.used)`, and synchronizes
`quotaReached.current`.

Remove the unconditional local `used + 1` update. After any resolved
`analyzeSlip` response, start `refreshQuota()` without blocking row rendering:

```ts
void refreshQuota();
```

This keeps pre-inference image duplicates at their unchanged server count while
counting successful, unsupported, and post-inference identity-duplicate results
according to the Worker.

- [ ] **Step 5: Run dialog and batch-table tests**

Run:

```powershell
npx vitest run apps/web/src/features/transactions/slip-import-dialog.test.tsx apps/web/src/features/transactions/slip-batch-table.test.tsx
```

Expected: both files PASS, including AI copy, server quota refresh, retry action,
and batch row actions.

- [ ] **Step 6: Commit the web behavior**

```powershell
git add -- apps/web/src/features/transactions/slip-import-dialog.tsx apps/web/src/features/transactions/slip-import-dialog.test.tsx
git commit -m "fix: explain retried slip analysis failures"
```

### Task 4: Full Regression and Production Readiness

**Files:**
- Verify all files committed by Tasks 1-3.

**Interfaces:**
- Consumes: completed Worker retry, service quota ordering, and web copy.
- Produces: a verified commit range ready for push and Cloudflare deployment.

- [ ] **Step 1: Run focused slip tests**

Run:

```powershell
npx vitest run workers/api/test/slip-vision-retry.test.ts workers/api/test/slip-vision-extractor.test.ts workers/api/test/slip-import-service.test.ts workers/api/test/slip-imports.test.ts apps/web/src/features/transactions/slip-import-dialog.test.tsx apps/web/src/features/transactions/slip-batch-table.test.tsx
```

Expected: all focused files PASS with zero failures.

- [ ] **Step 2: Run TypeScript checks**

Run:

```powershell
npm run typecheck --workspace=@systems-credit/api
npm run typecheck --workspace=@systems-credit/web
```

Expected: both commands exit 0.

- [ ] **Step 3: Run the production build**

Run:

```powershell
npm run build
```

Expected: Vite production build and Wrangler dry-run exit 0.

- [ ] **Step 4: Run the complete test suite**

Run:

```powershell
npm test -- --run
```

Expected: all test files and tests PASS with zero failures.

- [ ] **Step 5: Check repository integrity**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors and no uncommitted implementation files.

- [ ] **Step 6: Push and verify Cloudflare deployment**

After user-authorized execution on `main`:

```powershell
git push origin main
npx wrangler deployments list -c wrangler.jsonc
curl.exe -sS -i https://baan-ngern-dee.newforico-9ea.workers.dev/health
```

Expected: `main` pushes successfully, a new deployment version appears, and
health returns HTTP `200` with `{"ok":true,"service":"systems-credit-api"}`.

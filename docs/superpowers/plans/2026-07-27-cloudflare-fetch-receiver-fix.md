# Cloudflare Fetch Receiver Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make authenticated Supabase requests work in Cloudflare Workers by invoking the captured `fetch` function with the correct global receiver.

**Architecture:** Preserve the injectable `fetch` boundary in `SupabaseRestClient`, but call it with `globalThis` as its receiver. This matches Cloudflare's guidance for runtime functions that depend on `this`, keeps existing unit-test injection intact, and fixes every Supabase REST/RPC request through the shared client. Retain privacy-safe error type and Zod issue logging, but remove the temporary TypeError message logging after diagnosis.

**Tech Stack:** TypeScript, Vitest, Hono, Cloudflare Workers/Wrangler, Supabase PostgREST

## Global Constraints

- Do not change Supabase SQL, migrations, RLS policies, finance contracts, or frontend request behavior.
- Do not bypass the Worker or call Supabase directly from the frontend.
- Keep the existing injectable `fetch?: typeof fetch` interface.
- Keep the public 500 response generic.
- Do not retain TypeError messages, stack traces, authorization headers, tokens, email addresses, user IDs, or raw snapshot values in Worker logs.
- Use Cloudflare's documented `call`, `apply`, or `bind` pattern to restore the runtime function receiver: https://developers.cloudflare.com/workers/observability/errors/#illegal-invocation-errors

---

## File Structure

- Modify `workers/api/src/services/supabase-client.ts` to invoke the stored
  fetch function with `globalThis`.
- Modify `workers/api/test/supabase-adapters.test.ts` to reproduce the
  receiver-sensitive Worker runtime behavior.
- Modify `workers/api/src/middleware/error-handler.ts` to remove the temporary
  TypeError message diagnostic while retaining `errorType` and bounded Zod
  metadata.
- Modify `workers/api/test/error-handler.test.ts` to prove TypeError messages
  remain private.

### Task 1: Bind Supabase Requests to the Global Fetch Receiver

**Files:**
- Modify: `workers/api/src/services/supabase-client.ts`
- Test: `workers/api/test/supabase-adapters.test.ts`

**Interfaces:**
- Consumes: `SupabaseConfig.fetch?: typeof fetch`
- Preserves: `SupabaseRestClient.request<T>()` and
  `SupabaseRestClient.rpc<T>()`
- Produces: every request fetch call with `this === globalThis`

- [ ] **Step 1: Write the failing receiver regression test**

Add this test inside `describe("Supabase Worker adapters", ...)`:

```ts
it("calls the injected fetch with the Worker global receiver", async () => {
  const snapshot = {
    version: 1,
    workspace: null,
    categories: [],
    accounts: [],
    accountBalances: {},
    openingTransactions: [],
    transactions: [],
    installmentContracts: [],
    installmentSchedules: {},
    installmentPayments: [],
    installmentPayoffs: []
  };
  let fetchReceiver: unknown;
  const receiverSensitiveFetch = function (
    this: unknown
  ): Promise<Response> {
    fetchReceiver = this;
    if (this !== globalThis) {
      throw new TypeError("Illegal invocation");
    }
    return Promise.resolve(Response.json(snapshot));
  } as typeof fetch;
  const repository = createSupabaseFinanceRepository({
    url: "https://project.supabase.co",
    anonKey: "anon-key",
    fetch: receiverSensitiveFetch
  });

  await expect(repository.getSnapshot(actor)).resolves.toEqual(
    snapshot
  );
  expect(fetchReceiver).toBe(globalThis);
});
```

This test fails if `requestFetch` is invoked as a method of
`SupabaseRestClient`, which recreates the production Cloudflare
`Illegal invocation` failure without network access or user data.

- [ ] **Step 2: Run the targeted test and verify RED**

Run:

```powershell
npx vitest --run --project @systems-credit/api workers/api/test/supabase-adapters.test.ts
```

Expected: the new test rejects with `TypeError: Illegal invocation` because
`this.requestFetch(...)` supplies the `SupabaseRestClient` instance as the
receiver.

- [ ] **Step 3: Implement the minimal receiver fix**

In `SupabaseRestClient.request`, replace:

```ts
    const response = await this.requestFetch(
      `${this.baseUrl}/rest/v1/${path}`,
      {
        ...init,
        headers: {
          apikey: this.config.anonKey,
          authorization: `Bearer ${actor.accessToken}`,
          "content-type": "application/json",
          ...init.headers
        }
      }
    );
```

with:

```ts
    const response = await this.requestFetch.call(
      globalThis,
      `${this.baseUrl}/rest/v1/${path}`,
      {
        ...init,
        headers: {
          apikey: this.config.anonKey,
          authorization: `Bearer ${actor.accessToken}`,
          "content-type": "application/json",
          ...init.headers
        }
      }
    );
```

Do not change request URLs, headers, response decoding, or error mapping.

- [ ] **Step 4: Run the targeted adapter tests and verify GREEN**

Run:

```powershell
npx vitest --run --project @systems-credit/api workers/api/test/supabase-adapters.test.ts
```

Expected: all six Supabase adapter tests pass, including the
receiver-sensitive regression.

### Task 2: Remove Temporary TypeError Message Logging

**Files:**
- Modify: `workers/api/src/middleware/error-handler.ts`
- Test: `workers/api/test/error-handler.test.ts`

**Interfaces:**
- Preserves: `errorType?: string`
- Preserves: bounded
  `validationIssues?: Array<{ code: string; path: string[]; expected?: string }>`
- Removes: `errorMessage` from server logs
- Preserves: generic `ApiErrorResponse`

- [ ] **Step 1: Change the TypeError test to require message privacy**

Replace the current test named
`"logs the message for an unexpected TypeError"` with:

```ts
it("logs the TypeError class without its message", async () => {
  const errorLog = vi
    .spyOn(console, "error")
    .mockImplementation(() => undefined);
  const app = createApp();
  app.get("/type-error", () => {
    throw new TypeError("sensitive receiver detail");
  });

  const response = await app.request("/type-error", {
    headers: { "x-request-id": "request-type-error" }
  });

  expect(response.status).toBe(500);
  expect(errorLog).toHaveBeenCalledWith({
    code: "INTERNAL_ERROR",
    errorType: "TypeError",
    method: "GET",
    path: "/type-error",
    requestId: "request-type-error",
    status: 500
  });
  expect(JSON.stringify(errorLog.mock.calls)).not.toContain(
    "sensitive receiver detail"
  );
  const responseBody = await response.json();
  expect(responseBody).not.toHaveProperty("error.errorMessage");
  errorLog.mockRestore();
});
```

- [ ] **Step 2: Run the error-handler test and verify RED**

Run:

```powershell
npx vitest --run --project @systems-credit/api workers/api/test/error-handler.test.ts
```

Expected: the TypeError privacy test fails because the temporary diagnostic
still adds `errorMessage`.

- [ ] **Step 3: Remove only the temporary message projection**

Delete this helper from
`workers/api/src/middleware/error-handler.ts`:

```ts
function unexpectedTypeErrorMessage(
  error: unknown
): string | undefined {
  return error instanceof TypeError ? error.message : undefined;
}
```

Delete:

```ts
  const errorMessage = unexpectedTypeErrorMessage(error);
```

and delete this property spread:

```ts
    ...(errorMessage ? { errorMessage } : {}),
```

Keep `unexpectedErrorType`, `validationIssuesFrom`, and the public response
unchanged.

- [ ] **Step 4: Run the error-handler tests and verify GREEN**

Run:

```powershell
npx vitest --run --project @systems-credit/api workers/api/test/error-handler.test.ts
```

Expected: all three error-handler tests pass and no test log contains the
TypeError message.

### Task 3: Verify, Commit, Deploy, and Confirm Onboarding

**Files:**
- Verify the four modified TypeScript files
- No database or frontend file changes

**Interfaces:**
- Consumes: receiver-safe Supabase request execution from Task 1
- Produces: authenticated `/v1/snapshot` response without an internal 500

- [ ] **Step 1: Run the API project**

Run:

```powershell
npx vitest --run --project @systems-credit/api
```

Expected: 17 API test files and 41 tests pass.

- [ ] **Step 2: Run all tests**

Run:

```powershell
npm test -- --run
```

Expected: 44 test files and 126 tests pass. If the existing installment form
test hits its known one-off five-second timing timeout, run that file alone
and rerun the full suite without changing its timeout.

- [ ] **Step 3: Run typechecking and build**

Run:

```powershell
npm run typecheck
npm run build
```

Expected: every workspace typechecks, Vite builds, and Wrangler dry-run
exits successfully. The existing JavaScript chunk-size warning is
non-blocking.

- [ ] **Step 4: Verify and commit**

Run:

```powershell
git diff --check
git status --short
git add workers/api/src/services/supabase-client.ts workers/api/test/supabase-adapters.test.ts workers/api/src/middleware/error-handler.ts workers/api/test/error-handler.test.ts docs/superpowers/plans/2026-07-27-cloudflare-fetch-receiver-fix.md
git commit -m "fix: preserve Cloudflare fetch receiver"
```

Expected: the commit contains only the receiver fix, its tests, diagnostic
cleanup, and this plan.

- [ ] **Step 5: Deploy the verified commit directly**

Run:

```powershell
npx wrangler deploy -c wrangler.jsonc
```

Expected: Wrangler reports a new version at
`https://baan-ngern-dee.newforico-9ea.workers.dev`.

- [ ] **Step 6: Verify the confirmed browser session**

Open or reload the production origin in the existing confirmed Chrome
profile.

Expected:

- `/config` returns 200;
- `/v1/snapshot` returns 200 for the confirmed session;
- the page no longer shows `ยังเชื่อมต่อข้อมูลไม่ได้`;
- a new confirmed user with no workspace reaches the onboarding screen;
- no token, email, user ID, or snapshot value is copied into notes or logs.

- [ ] **Step 7: Push only after production verification**

Run:

```powershell
git fetch origin main
git merge-base --is-ancestor origin/main HEAD
git push origin feature/financial-core-pwa
git push origin HEAD:main
```

Expected: both pushes are fast-forward. Cloudflare Git integration may create
another version from the same commit.

- [ ] **Step 8: Make the verified code the final active deployment**

After the Git build completes, run:

```powershell
npx wrangler deploy -c wrangler.jsonc
```

Reload the production page one final time.

Expected: the onboarding or finance application remains visible without the
connection error, and the final active Worker contains the exact verified
commit.

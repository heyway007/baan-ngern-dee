# Snapshot Validation Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add privacy-safe Zod diagnostics to the Worker, reproduce the authenticated production snapshot failure, and capture the exact contract path required for a separate root-cause fix plan.

**Architecture:** Keep the public API error contract unchanged while enriching only the server-side `console.error` event for `ZodError`. The diagnostic records schema metadata, never raw values. Deploy the bounded observability change, trigger one request from the already-confirmed browser session, and use the resulting path/code as the input to the next TDD fix plan.

**Tech Stack:** TypeScript, Hono, Zod, Vitest, Cloudflare Workers/Wrangler, Supabase Auth/PostgREST

## Global Constraints

- Never log access tokens, refresh tokens, authorization headers, email addresses, user IDs, database credentials, or raw snapshot values.
- Never expose validation diagnostics in the HTTP response.
- Preserve the existing `ApiError` response behavior and stable request ID.
- Keep strict snapshot validation; do not use `.passthrough()` or suppress parsing failures.
- Do not change database schema or shared finance contracts until the production diagnostic identifies the exact failing path.
- Do not commit raw Cloudflare logs or browser session data.

---

## File Structure

- Modify `workers/api/src/middleware/error-handler.ts` to project a `ZodError`
  into bounded metadata before logging.
- Modify `workers/api/test/error-handler.test.ts` to verify the observable
  log shape and prove secret values never enter the log or HTTP response.
- No database, contract, repository, or browser code changes belong in this
  diagnostic phase.

### Task 1: Privacy-Safe Zod Error Projection

**Files:**
- Modify: `workers/api/src/middleware/error-handler.ts`
- Test: `workers/api/test/error-handler.test.ts`

**Interfaces:**
- Consumes: `ZodError` and `ZodIssue` from `zod`
- Produces: server log field
  `validationIssues?: Array<{ code: string; path: string[]; expected?: string }>`
- Preserves: `errorHandler: ErrorHandler<AppEnv>` and the current HTTP
  `ApiErrorResponse`

- [ ] **Step 1: Write the failing behavior test**

Add the Zod import:

```ts
import { z } from "zod";
```

Add this test inside `describe("API error handling", ...)`:

```ts
it("logs only bounded Zod issue metadata", async () => {
  const errorLog = vi
    .spyOn(console, "error")
    .mockImplementation(() => undefined);
  const app = createApp();
  const invalidSnapshot = {
    workspace: {
      version: "not-a-number",
      ownerEmail: "owner@example.com"
    },
    accessToken: "token-secret"
  };
  const diagnosticSchema = z.object({
    workspace: z.object({
      version: z.number()
    })
  });
  app.get("/invalid-snapshot", () => {
    diagnosticSchema.parse(invalidSnapshot);
    return new Response(null, { status: 204 });
  });

  const response = await app.request("/invalid-snapshot", {
    headers: { "x-request-id": "request-zod" }
  });

  expect(response.status).toBe(500);
  const responseBody = await response.json();
  expect(responseBody).toMatchObject({
    error: {
      code: "INTERNAL_ERROR",
      requestId: "request-zod"
    }
  });
  expect(responseBody.error).not.toHaveProperty("validationIssues");
  expect(errorLog).toHaveBeenCalledWith({
    code: "INTERNAL_ERROR",
    method: "GET",
    path: "/invalid-snapshot",
    requestId: "request-zod",
    status: 500,
    validationIssues: [
      {
        code: "invalid_type",
        path: ["workspace", "version"],
        expected: "number"
      }
    ]
  });
  const serializedLog = JSON.stringify(errorLog.mock.calls);
  expect(serializedLog).not.toContain("not-a-number");
  expect(serializedLog).not.toContain("owner@example.com");
  expect(serializedLog).not.toContain("token-secret");
  errorLog.mockRestore();
});
```

This test catches a regression where raw Zod inputs are logged, diagnostics
leak into the response, or the schema path needed for production diagnosis is
lost.

- [ ] **Step 2: Run the targeted test and verify RED**

Run:

```powershell
npx vitest --run --project @systems-credit/api workers/api/test/error-handler.test.ts
```

Expected: the new test fails because `console.error` does not yet include
`validationIssues`.

- [ ] **Step 3: Implement the minimal sanitized projection**

Add this import to `workers/api/src/middleware/error-handler.ts`:

```ts
import { ZodError } from "zod";
```

Add these types and helper above `errorHandler`:

```ts
type ValidationIssueLog = Readonly<{
  code: string;
  path: string[];
  expected?: string;
}>;

function validationIssuesFrom(error: unknown):
  | ValidationIssueLog[]
  | undefined {
  if (!(error instanceof ZodError)) {
    return undefined;
  }

  return error.issues.map((issue) => ({
    code: issue.code,
    path: issue.path.map(String),
    ...("expected" in issue &&
    typeof issue.expected === "string"
      ? { expected: issue.expected }
      : {})
  }));
}
```

Build the existing log object once and add the field only for Zod failures:

```ts
  const validationIssues = validationIssuesFrom(error);

  console.error({
    code: apiError.code,
    method: context.req.method,
    path: new URL(context.req.url).pathname,
    requestId,
    status: apiError.status,
    ...(validationIssues ? { validationIssues } : {})
  });
```

Do not change the response body.

- [ ] **Step 4: Run the targeted test and verify GREEN**

Run:

```powershell
npx vitest --run --project @systems-credit/api workers/api/test/error-handler.test.ts
```

Expected: both error-handler tests pass. The generic-error test must retain
its exact log object without `validationIssues`.

- [ ] **Step 5: Run the API test project**

Run:

```powershell
npx vitest --run --project @systems-credit/api
```

Expected: every API test passes.

- [ ] **Step 6: Commit the diagnostic**

```powershell
git add workers/api/src/middleware/error-handler.ts workers/api/test/error-handler.test.ts
git commit -m "fix: add safe snapshot validation diagnostics"
```

### Task 2: Verify the Deployable Diagnostic Build

**Files:**
- Verify only; no additional source files

**Interfaces:**
- Consumes: Task 1's `validationIssues` server log field
- Produces: a tested Worker bundle ready for production diagnosis

- [ ] **Step 1: Run all tests**

Run:

```powershell
npm test -- --run
```

Expected: 44 test files and 124 tests pass after adding the new regression
test.

- [ ] **Step 2: Run typechecking**

Run:

```powershell
npm run typecheck
```

Expected: all workspace TypeScript projects pass.

- [ ] **Step 3: Build the production assets and Worker**

Run:

```powershell
npm run build
```

Expected: Vite completes and Wrangler dry-run exits successfully. The existing
large-chunk warning is non-blocking.

- [ ] **Step 4: Verify repository state**

Run:

```powershell
git diff --check
git status --short
```

Expected: `git diff --check` is clean and the worktree has no uncommitted
files.

### Task 3: Capture the Production Validation Path

**Files:**
- No repository file changes
- Do not create a raw log artifact

**Interfaces:**
- Consumes: deployed `validationIssues` metadata and the confirmed Chrome
  session
- Produces: one exact Zod path/code/expected tuple for the root-cause fix plan

- [ ] **Step 1: Push the diagnostic commit**

Verify a fast-forward and push both the feature branch and `main`:

```powershell
git fetch origin main
git rev-list --left-right --count origin/main...HEAD
git push origin feature/financial-core-pwa
git push origin HEAD:main
```

Expected: the divergence output starts with `0` and GitHub accepts both pushes
without force.

- [ ] **Step 2: Deploy the verified Worker directly**

Run:

```powershell
npx wrangler deploy -c wrangler.jsonc
```

Expected: Wrangler reports a new production version for
`https://baan-ngern-dee.newforico-9ea.workers.dev`.

- [ ] **Step 3: Start a bounded production tail**

Run in a separate terminal:

```powershell
npx wrangler tail baan-ngern-dee --format json --method GET
```

Keep the tail active only while reproducing one request. Do not copy
authorization headers or complete request bodies.

- [ ] **Step 4: Reproduce once from the confirmed session**

In the existing Chrome tab at the Worker origin, click the visible retry
button once.
Confirm the browser still receives the generic 500 response and note its
request ID.

- [ ] **Step 5: Read only the bounded diagnostic**

From the matching Worker log event, retain only:

```text
requestId
validationIssues[].code
validationIssues[].path
validationIssues[].expected
```

Expected: at least one validation issue identifies the exact field rejected by
`financeSnapshotSchema`. Stop the tail immediately after capture.

- [ ] **Step 6: Reconfirm public safety**

Verify that the HTTP response preserves the existing generic shape:

```json
{
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "<existing generic message>",
    "requestId": "..."
  }
}
```

Expected: no `validationIssues`, token, user identifier, email, or snapshot
value appears in the browser response.

- [ ] **Step 7: Create the exact root-cause fix plan**

Use the writing-plans skill again with the captured path/code. The follow-up
plan must:

- name the exact SQL, contract, or repository file that produces the field;
- include a hand-written malformed fixture matching the production type but no
  personal value;
- require a failing regression test before the fix;
- use a forward migration if SQL changes;
- include full tests, database tests when applicable, typecheck, build,
  migration dry-run/push, Worker deploy, and browser onboarding verification.

Do not implement the root-cause fix until that evidence-specific plan exists.

# LINE OA Rich Menu and LINE Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a six-item LINE OA rich menu that opens Baan Ngern Dee, signs users in through LINE-backed Supabase Auth, and automatically creates one isolated private finance workspace per new LINE user.

**Architecture:** Supabase custom OAuth provider `custom:line` owns the LINE OAuth exchange and issues the same Supabase sessions already accepted by the Worker and RLS. A small public web entry flow validates the requested internal destination, starts LINE OAuth, and bootstraps a private workspace through the existing authenticated API before navigating. Deterministic local tooling generates, validates, and provisions the LINE rich-menu image and action definition without putting LINE secrets in the repository.

**Tech Stack:** React 19, React Router, TypeScript, Supabase JS/Auth, Vitest and Testing Library, Cloudflare Workers, PostgreSQL RLS, Node.js tooling, Playwright Chromium, LINE Messaging API.

## Global Constraints

- LINE identity is primary for LINE-created users; they must not enter a Baan Ngern Dee email or password.
- Existing email/password sign-in remains available and behavior-compatible.
- Each LINE Auth user receives one active `private` workspace; finance data stays isolated through the existing `auth.uid()` membership and RLS model.
- Workspace defaults are `THB` and `Asia/Bangkok`.
- Workspace name is `บ้านเงินของ {LINE display name}`, trimmed to 80 characters, or `การเงินของฉัน` when no usable name exists.
- Rich menu size is exactly `2500 x 1686`; final format is PNG and final size is no more than 1 MB.
- Brand colors are forest `#214c3c`, deep forest `#15382d`, leaf `#8aae78`, and cream `#f4f2eb`; typography is Kanit with a Thai-capable sans-serif fallback.
- Rich-menu labels are exactly `ภาพรวม`, `เพิ่มรายรับ`, `เพิ่มรายจ่าย`, `บัญชี`, `ผ่อนและหนี้`, and `สอบถามเรา`.
- Chat bar text is exactly `เมนูบ้านเงินดี`.
- `สอบถามเรา` sends the exact message `สอบถามเรา`; no webhook or automated bot reply is added.
- LINE channel secrets and Messaging API access tokens never enter Git, browser bundles, `/config`, screenshots, logs, or test fixtures.
- The browser never stores LINE ID tokens; only the allowlisted post-login destination may use `sessionStorage`.
- Production origin is `https://baan-ngern-dee.newforico-9ea.workers.dev`.
- Do not add account merging, shared workspaces, profile-image storage, per-user menus, tab switching, broadcasts, or payment integration.

---

## File Structure

### Authentication and entry flow

- Modify `apps/web/src/lib/cloud-auth.ts`: make mapped sessions compatible with email-optional OAuth identities and expose LINE OAuth initiation.
- Modify `apps/web/src/lib/cloud-auth.test.ts`: cover LINE metadata, missing email, provider selection, and legacy email behavior.
- Create `apps/web/src/features/auth/line-entry.ts`: pure allowlist, storage, callback URL, and workspace-name helpers.
- Create `apps/web/src/features/auth/line-entry.test.ts`: exhaustive unit tests for entry helpers.
- Create `apps/web/src/features/auth/line-login-page.tsx`: signed-out OAuth launcher and controlled failure/retry UI.
- Create `apps/web/src/features/auth/line-login-page.test.tsx`: OAuth start and error-state component tests.
- Create `apps/web/src/features/auth/line-workspace-page.tsx`: authenticated idempotent workspace bootstrap and destination navigation.
- Create `apps/web/src/features/auth/line-workspace-page.test.tsx`: existing-workspace, first-use, retry, and destination tests.
- Modify `apps/web/src/app/router.tsx`: expose `/line` and `/line/callback` in signed-out and authenticated route sets.
- Modify `apps/web/src/app/router.test.tsx`: integration tests for the complete LINE route lifecycle.
- Modify `apps/web/src/styles.css`: LINE entry loading, error, and retry presentation.
- Modify `apps/web/src/styles.test.ts`: assert accessible control sizing and responsive entry layout.

### Rich menu assets and tooling

- Create `ops/line/rich-menu.html`: deterministic 3-by-2 branded source artwork.
- Create `ops/line/rich-menu.json`: exact production Messaging API rich-menu definition and tap bounds.
- Create `apps/web/public/line/rich-menu.png`: generated deployable PNG.
- Create `tools/generate-line-rich-menu.mjs`: render the HTML source to exact PNG dimensions with Playwright.
- Create `tools/validate-line-rich-menu.mjs`: validate PNG dimensions/size and the JSON action geometry.
- Create `tools/provision-line-rich-menu.mjs`: validate, create, upload, and set the rich menu as default through LINE APIs.
- Create `tools/line-rich-menu.test.mjs`: Node tests for JSON validation and provisioning request order/failure cleanup.
- Modify `package.json`: add generation, validation, provisioning, and tooling-test scripts.

### Operations

- Create `docs/runbooks/line-oa-setup.md`: owner-only LINE OA, LINE Provider, Messaging API, LINE Login, Supabase custom OAuth, test-user, rollout, and rollback steps.
- Modify `docs/runbooks/deploy-cloudflare-supabase.md`: add LINE callback URLs and cross-link the dedicated runbook.
- Modify `README.md`: document the optional LINE entry and link its runbook.

---

### Task 1: Make Cloud Auth Compatible with LINE OAuth

**Files:**
- Modify: `apps/web/src/lib/cloud-auth.ts`
- Test: `apps/web/src/lib/cloud-auth.test.ts`
- Test support: `apps/web/src/app/router.test.tsx`

**Interfaces:**
- Produces:

```ts
export type CloudSession = Readonly<{
  userId: string;
  email?: string;
  displayName: string;
  accessToken: string;
}>;

export interface CloudAuth {
  // Existing methods remain unchanged.
  startLineSignIn(redirectTo: string): Promise<void>;
}
```

- `startLineSignIn()` calls Supabase with provider `custom:line`.
- `mapSession()` chooses the first non-empty name from `display_name`,
  `name`, `full_name`, and `preferred_username`; then falls back to the email
  prefix; then `ผู้ใช้ LINE`.

- [ ] **Step 1: Write failing tests for an email-less LINE session and OAuth start**

Add a `signInWithOAuth` mock to `createAuthSdk()` and tests equivalent to:

```ts
it("maps an email-less LINE session from provider metadata", async () => {
  const { sdk } = createAuthSdk();
  sdk.getSession.mockResolvedValueOnce({
    data: {
      session: {
        ...session,
        user: {
          ...user,
          email: undefined,
          user_metadata: { name: "มิน LINE" }
        }
      }
    },
    error: null
  });
  const auth = createSupabaseCloudAuth(config);

  await expect(auth.getSession()).resolves.toEqual({
    userId: user.id,
    displayName: "มิน LINE",
    accessToken: "access-token"
  });
});

it("starts the custom LINE provider with the exact callback", async () => {
  const { sdk } = createAuthSdk();
  const auth = createSupabaseCloudAuth(config);

  await auth.startLineSignIn(
    "https://app.example.test/line/callback"
  );

  expect(sdk.signInWithOAuth).toHaveBeenCalledWith({
    provider: "custom:line",
    options: {
      redirectTo: "https://app.example.test/line/callback"
    }
  });
});
```

Define the local `config` fixture once in the test file rather than duplicating
the three public Supabase/Turnstile fields.

- [ ] **Step 2: Run the focused auth test and verify failure**

Run:

```powershell
npm test -- --run apps/web/src/lib/cloud-auth.test.ts
```

Expected: FAIL because an email-less session throws `AUTH_EMAIL_REQUIRED` and
`startLineSignIn`/`signInWithOAuth` do not exist.

- [ ] **Step 3: Implement provider-neutral session mapping and LINE OAuth**

Add helpers and method equivalent to:

```ts
function metadataDisplayName(
  metadata: Record<string, unknown>
): string | undefined {
  for (const key of [
    "display_name",
    "name",
    "full_name",
    "preferred_username"
  ]) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim().slice(0, 80);
    }
  }
  return undefined;
}

function mapSession(session: Session | null): CloudSession | null {
  if (!session) return null;
  const email = session.user.email?.trim().toLowerCase();
  const displayName =
    metadataDisplayName(session.user.user_metadata) ??
    email?.split("@")[0]?.slice(0, 80) ??
    "ผู้ใช้ LINE";
  return {
    userId: session.user.id,
    ...(email ? { email } : {}),
    displayName,
    accessToken: session.access_token
  };
}
```

In `createSupabaseCloudAuth()` add:

```ts
async startLineSignIn(redirectTo) {
  const { error } = await authRequest(() =>
    supabase.auth.signInWithOAuth({
      provider: "custom:line",
      options: { redirectTo }
    })
  );
  throwAuthError(error);
}
```

If the installed Supabase type narrows providers to built-ins, use the library's
documented custom-provider template-literal type or a narrow local cast at this
call only; do not weaken `CloudAuth` or use `any`.

- [ ] **Step 4: Update all test `CloudAuth` fakes with `startLineSignIn`**

Find every structural fake:

```powershell
rg -n "const auth: CloudAuth|satisfies CloudAuth" apps/web/src
```

The current search returns `apps/web/src/app/router.test.tsx`. Add:

```ts
startLineSignIn: vi.fn(),
```

Do not change existing fake behavior.

- [ ] **Step 5: Run auth, type, and legacy sign-in tests**

Run:

```powershell
npm test -- --run apps/web/src/lib/cloud-auth.test.ts apps/web/src/features/auth/sign-in-page.test.tsx apps/web/src/features/auth/accept-invite-page.test.tsx
npm run typecheck -w @systems-credit/web
```

Expected: all PASS. Existing email sessions still include `email`.

- [ ] **Step 6: Commit**

```powershell
git add apps/web/src/lib/cloud-auth.ts apps/web/src/lib/cloud-auth.test.ts apps/web/src/app/router.test.tsx
git commit -m "feat: support LINE OAuth cloud sessions"
```

### Task 2: Add Safe LINE Destination and Workspace-Name Helpers

**Files:**
- Create: `apps/web/src/features/auth/line-entry.ts`
- Test: `apps/web/src/features/auth/line-entry.test.ts`

**Interfaces:**
- Produces:

```ts
export const LINE_DESTINATION_KEY =
  "baan-ngern-dee:line-destination:v1";

export type LineDestination =
  | "/overview"
  | "/transactions/new?type=income"
  | "/transactions/new?type=expense"
  | "/accounts"
  | "/installments";

export function resolveLineDestination(
  value: string | null | undefined
): LineDestination;

export function rememberLineDestination(
  storage: Pick<Storage, "setItem">,
  destination: LineDestination
): void;

export function readLineDestination(
  storage: Pick<Storage, "getItem">
): LineDestination;

export function clearLineDestination(
  storage: Pick<Storage, "removeItem">
): void;

export function lineWorkspaceName(displayName: string): string;
```

- [ ] **Step 1: Write the allowlist and naming tests**

Create tests equivalent to:

```ts
it.each([
  "/overview",
  "/transactions/new?type=income",
  "/transactions/new?type=expense",
  "/accounts",
  "/installments"
] as const)("accepts %s", (destination) => {
  expect(resolveLineDestination(destination)).toBe(destination);
});

it.each([
  null,
  "",
  "https://evil.example",
  "//evil.example",
  "/transactions/new?type=transfer",
  "/admin/users",
  "/overview#fragment"
])("falls back to overview for %s", (destination) => {
  expect(resolveLineDestination(destination)).toBe("/overview");
});

it("stores only a normalized destination", () => {
  const storage = new MemoryStorage();
  rememberLineDestination(
    storage,
    resolveLineDestination("https://evil.example")
  );
  expect(readLineDestination(storage)).toBe("/overview");
});

it("builds bounded Thai workspace names", () => {
  expect(lineWorkspaceName(" มิน ")).toBe("บ้านเงินของ มิน");
  expect(lineWorkspaceName("")).toBe("การเงินของฉัน");
  expect(lineWorkspaceName("ก".repeat(100))).toHaveLength(80);
});
```

Use a minimal Map-backed object implementing only `getItem`, `setItem`, and
`removeItem`; no browser global is needed.

- [ ] **Step 2: Run the test and verify failure**

```powershell
npm test -- --run apps/web/src/features/auth/line-entry.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement exact allowlist, storage, and naming behavior**

Use a readonly `Set<LineDestination>` and default to `/overview`. Build the
workspace name with code-point-safe truncation:

```ts
const LINE_DESTINATIONS = new Set<LineDestination>([
  "/overview",
  "/transactions/new?type=income",
  "/transactions/new?type=expense",
  "/accounts",
  "/installments"
]);

export function lineWorkspaceName(displayName: string): string {
  const name = displayName.trim();
  if (!name || name === "ผู้ใช้ LINE") return "การเงินของฉัน";
  return Array.from(`บ้านเงินของ ${name}`).slice(0, 80).join("");
}
```

`readLineDestination()` must normalize stored content again so manually
tampered session storage cannot become an open redirect.

- [ ] **Step 4: Run the helper test and web typecheck**

```powershell
npm test -- --run apps/web/src/features/auth/line-entry.test.ts
npm run typecheck -w @systems-credit/web
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/src/features/auth/line-entry.ts apps/web/src/features/auth/line-entry.test.ts
git commit -m "feat: validate LINE entry destinations"
```

### Task 3: Build LINE Login and Workspace Bootstrap Pages

**Files:**
- Create: `apps/web/src/features/auth/line-login-page.tsx`
- Create: `apps/web/src/features/auth/line-login-page.test.tsx`
- Create: `apps/web/src/features/auth/line-workspace-page.tsx`
- Create: `apps/web/src/features/auth/line-workspace-page.test.tsx`
- Modify: `apps/web/src/styles.css`
- Modify: `apps/web/src/styles.test.ts`

**Interfaces:**
- Consumes: `CloudAuth.startLineSignIn()`, `LineDestination`,
  `rememberLineDestination()`, `readLineDestination()`,
  `clearLineDestination()`, and `lineWorkspaceName()` from Tasks 1-2.
- Produces:

```ts
export function LineLoginPage(props: Readonly<{
  auth: Pick<CloudAuth, "startLineSignIn">;
  destination: LineDestination;
  destinationStorage: Pick<Storage, "setItem">;
  callbackUrl: string;
}>): JSX.Element;

export function LineLoginFailurePage(props: Readonly<{
  destination: LineDestination;
}>): JSX.Element;

export function LineWorkspacePage(props: Readonly<{
  session: CloudSession;
  hasWorkspace: boolean;
  api: Pick<FinanceApi, "createPrivateWorkspace">;
  destination: LineDestination;
  destinationStorage: Pick<Storage, "removeItem">;
  onWorkspaceChanged(): Promise<void>;
}>): JSX.Element;
```

- `LineWorkspacePage` uses `useNavigate()` only after `hasWorkspace` is true.
- Workspace creation is attempted once per mounted page. On create error it
  reloads the snapshot once; a newly visible workspace wins over the error.

- [ ] **Step 1: Write failing login-page tests**

Cover automatic start, exact storage, exact callback, controlled error, and
retry:

```tsx
it("stores the destination and starts LINE OAuth once", async () => {
  const auth = { startLineSignIn: vi.fn().mockResolvedValue(undefined) };
  const storage = new MemoryStorage();
  render(
    <LineLoginPage
      auth={auth}
      destination="/accounts"
      destinationStorage={storage}
      callbackUrl="https://app.example.test/line/callback"
    />
  );
  await waitFor(() => {
    expect(auth.startLineSignIn).toHaveBeenCalledOnce();
  });
  expect(readLineDestination(storage)).toBe("/accounts");
});
```

For a rejected OAuth promise, assert an alert containing
`ยังเข้าสู่ระบบด้วย LINE ไม่สำเร็จ` and a `ลองอีกครั้ง` button that makes one
new call.

- [ ] **Step 2: Write failing bootstrap-page tests**

Use `MemoryRouter` and a location probe. Cover:

```tsx
it("navigates immediately when a workspace already exists", async () => {
  renderBootstrap({ hasWorkspace: true, destination: "/accounts" });
  expect(await screen.findByTestId("location")).toHaveTextContent(
    "/accounts"
  );
});

it("creates a first workspace and waits for refreshed state", async () => {
  const view = renderBootstrap({
    hasWorkspace: false,
    session: { ...lineSession, displayName: "มิน" }
  });
  await waitFor(() => {
    expect(api.createPrivateWorkspace).toHaveBeenCalledWith({
      name: "บ้านเงินของ มิน",
      baseCurrency: "THB",
      timeZone: "Asia/Bangkok"
    });
  });
  expect(onWorkspaceChanged).toHaveBeenCalledOnce();
  expect(screen.getByTestId("location")).toHaveTextContent("/line");

  view.rerender(renderedBootstrap({ hasWorkspace: true }));
  expect(await screen.findByTestId("location")).toHaveTextContent(
    "/overview"
  );
});
```

Also test fallback name `การเงินของฉัน`, creation rejection followed by retry,
and clearing the destination only after successful navigation.

- [ ] **Step 3: Run both component tests and verify failure**

```powershell
npm test -- --run apps/web/src/features/auth/line-login-page.test.tsx apps/web/src/features/auth/line-workspace-page.test.tsx
```

Expected: FAIL because both components do not exist.

- [ ] **Step 4: Implement the minimal OAuth launcher**

`LineLoginPage` uses an internal `attempt` counter in its effect dependency so
the first call is automatic and the retry button triggers exactly one new call.
Before each attempt:

```ts
rememberLineDestination(
  destinationStorage,
  destination
);
await auth.startLineSignIn(callbackUrl);
```

Show `กำลังพาเข้าสู่บ้านเงินดี` while pending. Do not show or log raw auth
errors. `LineLoginFailurePage` links back to:

```ts
`/line?next=${encodeURIComponent(destination)}`
```

and offers `/sign-in` as the legacy alternative.

- [ ] **Step 5: Implement idempotent workspace bootstrap**

The bootstrap effect follows:

```ts
if (hasWorkspace) {
  clearLineDestination(destinationStorage);
  navigate(destination, { replace: true });
  return;
}
if (started.current) return;
started.current = true;
void api
  .createPrivateWorkspace({
    name: lineWorkspaceName(session.displayName),
    baseCurrency: "THB",
    timeZone: "Asia/Bangkok"
  })
  .then(onWorkspaceChanged)
  .catch(async () => {
    try {
      await onWorkspaceChanged();
    } catch {
      // The controlled Thai retry state is set below.
    }
    setFailed(true);
  });
```

The retry button clears `started.current`, clears the controlled error, and
increments an attempt counter. Do not navigate after the create response;
wait for `hasWorkspace` from the refreshed authoritative snapshot.

- [ ] **Step 6: Add responsive accessible styling**

Add focused classes:

```css
.line-entry-shell {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 1.5rem;
  background:
    radial-gradient(circle at 50% 0%, rgba(138, 174, 120, 0.2), transparent 28rem),
    var(--cream);
}

.line-entry-card {
  width: min(100%, 30rem);
  padding: 2rem;
  border: 1px solid var(--line);
  border-radius: 1.25rem;
  background: var(--paper);
  box-shadow: var(--shadow);
  text-align: center;
}

.line-entry-actions {
  display: grid;
  gap: 0.75rem;
}

.line-entry-actions a,
.line-entry-actions button {
  min-height: 44px;
}
```

Add a styles test that inserts `.line-entry-shell`, `.line-entry-card`, and
`.line-entry-actions > button` and asserts grid display, bounded card width, and
44px minimum control height.

- [ ] **Step 7: Run component, style, and type tests**

```powershell
npm test -- --run apps/web/src/features/auth/line-login-page.test.tsx apps/web/src/features/auth/line-workspace-page.test.tsx apps/web/src/styles.test.ts
npm run typecheck -w @systems-credit/web
```

Expected: PASS with no React act warnings.

- [ ] **Step 8: Commit**

```powershell
git add apps/web/src/features/auth/line-login-page.tsx apps/web/src/features/auth/line-login-page.test.tsx apps/web/src/features/auth/line-workspace-page.tsx apps/web/src/features/auth/line-workspace-page.test.tsx apps/web/src/styles.css apps/web/src/styles.test.ts
git commit -m "feat: add LINE entry and workspace bootstrap"
```

### Task 4: Wire LINE Entry Through the Cloud Router

**Files:**
- Modify: `apps/web/src/app/router.tsx`
- Test: `apps/web/src/app/router.test.tsx`

**Interfaces:**
- Consumes all Task 3 components.
- Extends `CloudRouterDependencies` with:

```ts
destinationStorage: Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;
```

- Default value is `window.sessionStorage`; legacy cleanup continues using
  the existing `window.localStorage` dependency.

- [ ] **Step 1: Extend router test dependencies without changing behavior**

Add a second `MemoryStorage` instance to `createDependencies()`:

```ts
destinationStorage:
  options.destinationStorage ?? new MemoryStorage()
```

Add `startLineSignIn: vi.fn()` to the auth fake and
`createPrivateWorkspace: vi.fn()` to the finance API fake. Return these spies
from the test helper.

- [ ] **Step 2: Write failing signed-out entry tests**

Add tests:

```tsx
it("starts LINE OAuth from an allowlisted rich-menu destination", async () => {
  const {
    auth,
    dependencies,
    destinationStorage
  } = createDependencies({ session: null });
  render(
    <MemoryRouter
      initialEntries={[
        "/line?next=%2Ftransactions%2Fnew%3Ftype%3Dincome"
      ]}
    >
      <FinanceRoutes dependencies={dependencies} />
    </MemoryRouter>
  );
  await waitFor(() => {
    expect(auth.startLineSignIn).toHaveBeenCalledWith(
      `${window.location.origin}/line/callback`
    );
  });
  expect(readLineDestination(destinationStorage)).toBe(
    "/transactions/new?type=income"
  );
});
```

Add one invalid external target case and assert stored `/overview`.

- [ ] **Step 3: Write failing authenticated and bootstrap integration tests**

Cover:

- authenticated `/line?next=%2Faccounts` with `workspaceSnapshot` reaches the
  Accounts heading without starting OAuth;
- `/line/callback` reads the stored destination;
- an empty snapshot calls `createPrivateWorkspace` with the LINE display name,
  then a second `workspaceSnapshot` causes destination navigation;
- workspace creation failure shows `ลองอีกครั้ง`;
- signed-out `/line/callback` shows controlled failure rather than starting a
  fresh redirect loop;
- normal `/overview`, `/sign-in`, invitation, and onboarding tests stay
  unchanged.

- [ ] **Step 4: Run the router test and verify failure**

```powershell
npm test -- --run apps/web/src/app/router.test.tsx
```

Expected: FAIL because LINE routes and dependency do not exist.

- [ ] **Step 5: Add destination resolution at the router boundary**

In `FinanceRoutes`, compute:

```ts
const requestedLineDestination =
  location.pathname === "/line"
    ? resolveLineDestination(searchParams.get("next"))
    : readLineDestination(dependencies.destinationStorage);
const lineCallbackUrl =
  `${window.location.origin}/line/callback`;
```

Do not accept a callback URL from query parameters or public config.

- [ ] **Step 6: Add signed-out LINE routes**

Before the signed-out wildcard:

```tsx
<Route
  path="/line"
  element={
    <LineLoginPage
      auth={auth}
      destination={requestedLineDestination}
      destinationStorage={dependencies.destinationStorage}
      callbackUrl={lineCallbackUrl}
    />
  }
/>
<Route
  path="/line/callback"
  element={
    <LineLoginFailurePage
      destination={requestedLineDestination}
    />
  }
/>
```

- [ ] **Step 7: Add authenticated LINE routes**

Before the `SessionGuard` route:

```tsx
<Route
  path="/line"
  element={
    <LineWorkspacePage
      session={session}
      hasWorkspace={Boolean(snapshot.workspace)}
      api={api}
      destination={requestedLineDestination}
      destinationStorage={dependencies.destinationStorage}
      onWorkspaceChanged={refreshSnapshot}
    />
  }
/>
<Route
  path="/line/callback"
  element={
    <LineWorkspacePage
      session={session}
      hasWorkspace={Boolean(snapshot.workspace)}
      api={api}
      destination={requestedLineDestination}
      destinationStorage={dependencies.destinationStorage}
      onWorkspaceChanged={refreshSnapshot}
    />
  }
/>
```

Do not put these pages inside `AppLayout` or the onboarding `SessionGuard`.

- [ ] **Step 8: Run router, auth, and type tests**

```powershell
npm test -- --run apps/web/src/app/router.test.tsx apps/web/src/app/cloud-state.test.ts apps/web/src/features/auth/session-guard.test.tsx
npm run typecheck -w @systems-credit/web
```

Expected: PASS.

- [ ] **Step 9: Commit**

```powershell
git add apps/web/src/app/router.tsx apps/web/src/app/router.test.tsx
git commit -m "feat: route LINE login into private workspaces"
```

### Task 5: Generate and Validate the Rich Menu

**Files:**
- Create: `ops/line/rich-menu.html`
- Create: `ops/line/rich-menu.json`
- Create: `apps/web/public/line/rich-menu.png`
- Create: `tools/generate-line-rich-menu.mjs`
- Create: `tools/validate-line-rich-menu.mjs`
- Create: `tools/provision-line-rich-menu.mjs`
- Create: `tools/line-rich-menu.test.mjs`
- Modify: `package.json`

**Interfaces:**
- `generate-line-rich-menu.mjs` writes
  `apps/web/public/line/rich-menu.png`.
- `validate-line-rich-menu.mjs` exports:

```js
export function validateRichMenu(definition, pngBytes) {
  return { width: 2500, height: 1686, bytes: pngBytes.length };
}
```

- `provision-line-rich-menu.mjs` exports:

```js
export async function provisionRichMenu({
  accessToken,
  definition,
  pngBytes,
  fetchImpl = fetch
}) {
  return { richMenuId };
}
```

- [ ] **Step 1: Add failing Node tests for geometry and provisioning**

Use `node:test` and `node:assert/strict`. Test:

1. valid six-area definition passes;
2. overlapping/out-of-bounds/missing areas fail;
3. wrong PNG dimensions fail;
4. PNG larger than 1 MB fails;
5. provisioning requests occur in this exact order:
   `validate` → `create` → `upload` → `set default`;
6. upload or default failure attempts `DELETE /v2/bot/richmenu/{id}`;
7. error messages never include the access token.

The mock fetch records URLs, methods, headers, and bodies and returns:

```js
Response.json({ richMenuId: "richmenu-test" })
```

for create, with empty 200 responses for the other successful calls.

- [ ] **Step 2: Add scripts and run the test to verify failure**

Add to `package.json`:

```json
"test:line": "node --test tools/line-rich-menu.test.mjs",
"generate:line-menu": "node tools/generate-line-rich-menu.mjs",
"validate:line-menu": "node tools/validate-line-rich-menu.mjs",
"provision:line-menu": "node tools/provision-line-rich-menu.mjs"
```

Run:

```powershell
npm run test:line
```

Expected: FAIL because the tool modules do not exist.

- [ ] **Step 3: Create the exact production rich-menu JSON**

Use these non-overlapping bounds:

```json
{
  "size": { "width": 2500, "height": 1686 },
  "selected": true,
  "name": "baan-ngern-dee-default-v1",
  "chatBarText": "เมนูบ้านเงินดี",
  "areas": [
    {
      "bounds": { "x": 0, "y": 0, "width": 834, "height": 843 },
      "action": {
        "type": "uri",
        "label": "ภาพรวม",
        "uri": "https://baan-ngern-dee.newforico-9ea.workers.dev/line?next=%2Foverview"
      }
    },
    {
      "bounds": { "x": 834, "y": 0, "width": 833, "height": 843 },
      "action": {
        "type": "uri",
        "label": "เพิ่มรายรับ",
        "uri": "https://baan-ngern-dee.newforico-9ea.workers.dev/line?next=%2Ftransactions%2Fnew%3Ftype%3Dincome"
      }
    },
    {
      "bounds": { "x": 1667, "y": 0, "width": 833, "height": 843 },
      "action": {
        "type": "uri",
        "label": "เพิ่มรายจ่าย",
        "uri": "https://baan-ngern-dee.newforico-9ea.workers.dev/line?next=%2Ftransactions%2Fnew%3Ftype%3Dexpense"
      }
    },
    {
      "bounds": { "x": 0, "y": 843, "width": 834, "height": 843 },
      "action": {
        "type": "uri",
        "label": "บัญชี",
        "uri": "https://baan-ngern-dee.newforico-9ea.workers.dev/line?next=%2Faccounts"
      }
    },
    {
      "bounds": { "x": 834, "y": 843, "width": 833, "height": 843 },
      "action": {
        "type": "uri",
        "label": "ผ่อนและหนี้",
        "uri": "https://baan-ngern-dee.newforico-9ea.workers.dev/line?next=%2Finstallments"
      }
    },
    {
      "bounds": { "x": 1667, "y": 843, "width": 833, "height": 843 },
      "action": {
        "type": "message",
        "label": "สอบถามเรา",
        "text": "สอบถามเรา"
      }
    }
  ]
}
```

- [ ] **Step 4: Create deterministic branded artwork**

`ops/line/rich-menu.html` must:

- have a `2500px x 1686px` root with no margin or scrollbars;
- use the same six grid bounds as JSON;
- use flat cream/forest/leaf panels and thin high-contrast separators;
- embed simple inline SVG icons for dashboard, income, expense, wallet, debt,
  and chat;
- render each exact Thai label once in at least 72px semibold type;
- include small `บ้านเงินดี` brand text without creating a seventh visual
  control;
- contain no URL, secret, personal data, photographic asset, or watermark.

Use:

```css
font-family: "Kanit", "Leelawadee UI", Tahoma, sans-serif;
```

and load Kanit through the same Google Fonts family already used by
`apps/web/src/styles.css`. The generator waits for `document.fonts.ready`; if
the remote font cannot load, the Thai-capable local fallback still produces a
valid asset.

- [ ] **Step 5: Implement the generator**

Use `chromium` from `@playwright/test`:

```js
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 2500, height: 1686 },
  deviceScaleFactor: 1
});
await page.goto(pathToFileURL(sourcePath).href);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({
  path: outputPath,
  type: "png",
  fullPage: false
});
await browser.close();
```

Create the output directory before the screenshot. Always close the browser in
`finally`.

- [ ] **Step 6: Implement strict validation**

Parse PNG signature and IHDR width/height directly from the Buffer. Validate:

- PNG signature;
- width `2500`;
- height `1686`;
- byte length `<= 1_048_576`;
- JSON size equals the PNG size;
- exactly six areas;
- integer positive bounds;
- every area is in bounds;
- every pixel is covered once by the specified six rectangles;
- first five actions are HTTPS URI actions on the exact production origin;
- their decoded `next` values pass the five-entry allowlist encoded in this
  tool;
- final action is exact `message`/`สอบถามเรา`;
- `selected === true`, name and chat-bar text match exact values.

The CLI prints only dimensions, byte count, and `Rich menu valid`; it must not
read secrets.

- [ ] **Step 7: Implement safe provisioning and cleanup**

Use `Authorization: Bearer ${accessToken}` only in request headers. Endpoints:

```text
POST https://api.line.me/v2/bot/richmenu/validate
POST https://api.line.me/v2/bot/richmenu
POST https://api-data.line.me/v2/bot/richmenu/{richMenuId}/content
POST https://api.line.me/v2/bot/user/all/richmenu/{richMenuId}
DELETE https://api.line.me/v2/bot/richmenu/{richMenuId}
```

Upload uses `content-type: image/png` and the raw PNG Buffer. If creation
succeeds but upload/default fails, attempt cleanup and throw a bounded message
containing the failed phase and status only.

CLI behavior:

```js
const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
if (!accessToken) {
  throw new Error(
    "Set LINE_CHANNEL_ACCESS_TOKEN in the current shell."
  );
}
```

Do not accept the token as a command-line argument because process lists and
shell history can expose it.

- [ ] **Step 8: Generate, validate, and inspect the PNG**

Run:

```powershell
npm run generate:line-menu
npm run validate:line-menu
npm run test:line
```

Expected:

```text
2500x1686
Rich menu valid
```

and a byte count at or below `1048576`.

Open the final PNG with the local image viewer and visually verify:

- all six labels are correct and legible;
- no text is clipped;
- row and column boundaries match JSON;
- contrast remains readable at phone scale;
- the chat tile is visually distinguishable but not misleading.

If the screenshot is over 1 MB, reduce decorative texture/shadows and regenerate;
do not lower text legibility or change dimensions.

- [ ] **Step 9: Commit**

```powershell
git add ops/line apps/web/public/line/rich-menu.png tools/generate-line-rich-menu.mjs tools/validate-line-rich-menu.mjs tools/provision-line-rich-menu.mjs tools/line-rich-menu.test.mjs package.json
git commit -m "feat: add LINE OA rich menu assets"
```

### Task 6: Document Owner Setup, Test Rollout, and Rollback

**Files:**
- Create: `docs/runbooks/line-oa-setup.md`
- Modify: `docs/runbooks/deploy-cloudflare-supabase.md`
- Modify: `README.md`

**Interfaces:**
- Consumes the exact production callback
  `https://baan-ngern-dee.newforico-9ea.workers.dev/line/callback`.
- Consumes the provisioning command `npm run provision:line-menu`.
- Produces the owner-operated setup procedure; no code reads this file.

- [ ] **Step 1: Write the dedicated runbook**

Include these exact ordered sections:

1. create LINE Official Account `บ้านเงินดี`;
2. enable Messaging API;
3. create one LINE Provider and put Messaging API and LINE Login channels under
   it;
4. configure LINE Login as a Web App with `openid` and `profile`, not email;
5. copy the Supabase Auth callback URL shown by the `custom:line` provider into
   the LINE Login callback settings;
6. configure Supabase custom OAuth provider `custom:line`, email optional,
   using LINE OAuth 2.1 authorize/token/user-info endpoints;
7. add the production and local `/line/callback` URLs to Supabase Auth redirect
   URLs;
8. deploy the application;
9. locally set the token without printing it:

```powershell
$env:LINE_CHANNEL_ACCESS_TOKEN = Read-Host -MaskInput
npm run validate:line-menu
npm run provision:line-menu
Remove-Item Env:LINE_CHANNEL_ACCESS_TOKEN
```

10. test one owner-only rich menu before setting default if the owner elects to
    use LINE's per-user linking flow;
11. test two separate LINE accounts and confirm different workspace IDs/data;
12. verify all six tap areas on LINE mobile, because rich menus do not appear
    on LINE desktop;
13. rollback by removing the default rich menu, disabling `custom:line`, and
    retaining email/password access;
14. rotate the channel token immediately if it is exposed.

State clearly that Codex cannot create or accept terms for the owner's LINE
account without the owner completing LINE's interactive account steps.

- [ ] **Step 2: Update existing deployment documentation**

In the Auth redirect list add:

```text
https://baan-ngern-dee.newforico-9ea.workers.dev/line/callback
http://127.0.0.1:8787/line/callback
http://127.0.0.1:5173/line/callback
```

Change the introduction from “Email/Password Auth only” to “Supabase Auth with
email/password and optional LINE custom OAuth”. Add a cross-link to the new
runbook near the Auth configuration section.

- [ ] **Step 3: Update README**

Add a short `LINE OA` section explaining:

- LINE login is optional until `custom:line` is configured;
- existing email login remains available;
- rich-menu assets live under `ops/line` and `apps/web/public/line`;
- owner setup is in `docs/runbooks/line-oa-setup.md`.

- [ ] **Step 4: Scan documentation for secrets and stale claims**

Run:

```powershell
rg -n "LINE_CHANNEL_ACCESS_TOKEN=|channel secret|Email/Password Auth only" README.md docs ops tools
git diff --check
```

Expected: no literal secret assignment, no old “only” claim, and no
stale authentication claim. Mentions that explain secret names without values
are allowed.

- [ ] **Step 5: Commit**

```powershell
git add docs/runbooks/line-oa-setup.md docs/runbooks/deploy-cloudflare-supabase.md README.md
git commit -m "docs: add LINE OA setup runbook"
```

### Task 7: Full Verification and Release Readiness

**Files:**
- Verify all files changed by Tasks 1-6.
- No new production feature is added in this task.

**Interfaces:**
- Consumes the complete feature.
- Produces verification evidence and a clean worktree.

- [ ] **Step 1: Run focused LINE and auth verification**

```powershell
npm run test:line
npm run validate:line-menu
npm test -- --run apps/web/src/lib/cloud-auth.test.ts apps/web/src/features/auth/line-entry.test.ts apps/web/src/features/auth/line-login-page.test.tsx apps/web/src/features/auth/line-workspace-page.test.tsx apps/web/src/app/router.test.tsx
```

Expected: all PASS.

- [ ] **Step 2: Run complete repository checks**

```powershell
npm test -- --run
npm run test:db
npm run typecheck
npm run build
```

Expected: all PASS. If the local Supabase database prerequisites are not
available, report `npm run test:db` separately with the exact infrastructure
error; do not describe database verification as passing.

- [ ] **Step 3: Perform static security checks**

```powershell
rg -n "LINE_CHANNEL_ACCESS_TOKEN|channel_secret|Channel Secret|Bearer [A-Za-z0-9_-]{20,}" apps workers packages ops tools docs README.md
git diff --check
git status --short
```

Expected: only environment-variable names and documentation warnings; no token
value, no browser secret, no whitespace errors, and only intentional changes.

- [ ] **Step 4: Perform local browser smoke tests**

Run the Worker-served SPA:

```powershell
npm run build
npm run dev:api
```

Verify:

- `/line?next=%2Faccounts` shows the controlled LINE entry state when
  `custom:line` is not configured;
- `/sign-in` still supports the existing email flow;
- a normal authenticated session still reaches `/overview`;
- refresh on `/line/callback` serves the SPA rather than a 404.

Do not attempt live LINE OAuth until the owner has configured the channel and
Supabase provider.

- [ ] **Step 5: Inspect final rich-menu image again**

Confirm the committed file is the same file validated in Step 1:

```powershell
Get-FileHash apps/web/public/line/rich-menu.png -Algorithm SHA256
npm run validate:line-menu
```

Record the hash in the handoff response, not in source code.

- [ ] **Step 6: Resolve failures at their owning task**

Do not create a catch-all verification commit. If a check fails, return to the
task that owns the failing file, add or adjust its regression test, rerun that
task's exact verification commands, and use that task's explicit commit step.
Then rerun Task 7 from Step 1. If no corrections are needed, create no commit.

## Manual Production Acceptance

These steps require the owner's LINE/Supabase access and occur after code
verification:

- configure `custom:line` and LINE callback URLs;
- deploy the verified commit;
- provision the menu with a local environment token;
- sign in with LINE account A and create finance data;
- sign in with LINE account B and confirm account A's workspace/data are absent;
- return with account A and confirm its original workspace is reused;
- tap each of the five web actions and confirm the exact destination;
- tap `สอบถามเรา` and confirm the exact message arrives in OA Manager;
- remove the test default/per-user menu if any acceptance step fails.

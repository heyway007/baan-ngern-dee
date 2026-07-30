# LINE Login Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a visible LINE sign-in action to the standard sign-in page and route it through the existing LINE OAuth flow.

**Architecture:** `SignInPage` renders a normal link to the existing `/line` route, preserving the current callback, safe destination, and workspace bootstrap behavior. The new UI is isolated to the sign-in component and its CSS; no authentication API or backend behavior changes.

**Tech Stack:** React 19, React Router 7, TypeScript, Vitest, Testing Library, CSS

## Global Constraints

- Reuse `/line?next=/overview`; do not add a second OAuth implementation.
- Show the LINE action in sign-in and sign-up modes.
- Hide the LINE action in password-reset mode.
- Run automated checks and inspect the local desktop and mobile layouts before any push or deployment.

---

### Task 1: Add the LINE entry to the sign-in panel

**Files:**
- Modify: `apps/web/src/features/auth/sign-in-page.test.tsx`
- Modify: `apps/web/src/features/auth/sign-in-page.tsx`
- Modify: `apps/web/src/styles.test.ts`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: Existing browser route `/line?next=/overview`
- Produces: An accessible link named `เข้าสู่ระบบด้วย LINE`

- [x] **Step 1: Write the failing component test**

Add this test to `apps/web/src/features/auth/sign-in-page.test.tsx`:

```tsx
it("links LINE login from account modes and hides it during reset", async () => {
  const user = userEvent.setup();
  render(
    <SignInPage
      auth={authActions()}
      turnstileSiteKey="turnstile-site-key"
      onAuthenticated={vi.fn()}
    />
  );

  const lineLogin = screen.getByRole("link", {
    name: "เข้าสู่ระบบด้วย LINE"
  });
  expect(lineLogin).toHaveAttribute("href", "/line?next=/overview");

  await user.click(
    screen.getByRole("button", { name: "สมัครสมาชิก" })
  );
  expect(
    screen.getByRole("link", { name: "เข้าสู่ระบบด้วย LINE" })
  ).toBeInTheDocument();

  await user.click(
    screen.getByRole("button", { name: "ลืมรหัสผ่าน" })
  );
  expect(
    screen.queryByRole("link", { name: "เข้าสู่ระบบด้วย LINE" })
  ).not.toBeInTheDocument();
});
```

- [x] **Step 2: Run the component test and verify the missing link fails**

Run:

```powershell
npx vitest run apps/web/src/features/auth/sign-in-page.test.tsx
```

Expected: FAIL because no link named `เข้าสู่ระบบด้วย LINE` exists.

- [x] **Step 3: Add the minimal component markup**

In `apps/web/src/features/auth/sign-in-page.tsx`, render this block after the
introductory muted paragraph and before the email form:

```tsx
{mode !== "reset" ? (
  <div className="line-login-options">
    <a
      className="line-login-button"
      href="/line?next=/overview"
    >
      <span className="line-login-mark" aria-hidden="true">
        LINE
      </span>
      <span>เข้าสู่ระบบด้วย LINE</span>
    </a>
    <div className="auth-divider" aria-hidden="true">
      <span>หรือเข้าสู่ระบบด้วยอีเมล</span>
    </div>
  </div>
) : null}
```

- [x] **Step 4: Run the component test and verify it passes**

Run:

```powershell
npx vitest run apps/web/src/features/auth/sign-in-page.test.tsx
```

Expected: PASS.

- [x] **Step 5: Write the failing style test**

Add this test to `apps/web/src/styles.test.ts`:

```ts
it("renders the LINE login action as a full-width accessible control", () => {
  document.body.innerHTML = `
    <section class="sign-in-panel">
      <div class="line-login-options">
        <a class="line-login-button">
          <span class="line-login-mark">LINE</span>
          <span>เข้าสู่ระบบด้วย LINE</span>
        </a>
        <div class="auth-divider"><span>หรือเข้าสู่ระบบด้วยอีเมล</span></div>
      </div>
    </section>
  `;

  const action = getComputedStyle(
    document.querySelector(".line-login-button")!
  );
  expect(action.display).toBe("flex");
  expect(action.minHeight).toBe("48px");
  expect(action.backgroundColor).toBe("rgb(6, 199, 85)");
  expect(
    getComputedStyle(document.querySelector(".auth-divider")!).display
  ).toBe("flex");
});
```

- [x] **Step 6: Run the style test and verify the missing CSS fails**

Run:

```powershell
npx vitest run apps/web/src/styles.test.ts
```

Expected: FAIL because `.line-login-button` and `.auth-divider` have no layout
or brand styles.

- [x] **Step 7: Add responsive LINE button and divider styles**

Add these rules near the existing sign-in panel rules in
`apps/web/src/styles.css`:

```css
.line-login-options {
  display: grid;
  gap: 1rem;
  margin-bottom: 1rem;
}

.line-login-button {
  display: flex;
  width: 100%;
  min-height: 48px;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  border-radius: 0.75rem;
  background: #06c755;
  color: #fff;
  font-weight: 700;
  text-decoration: none;
  transition: filter 160ms ease, transform 160ms ease;
}

.line-login-button:hover {
  filter: brightness(0.94);
  transform: translateY(-1px);
}

.line-login-button:focus-visible {
  outline: 3px solid rgba(6, 199, 85, 0.28);
  outline-offset: 3px;
}

.line-login-mark {
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: -0.02em;
}

.auth-divider {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  color: var(--muted);
  font-size: 0.78rem;
}

.auth-divider::before,
.auth-divider::after {
  height: 1px;
  flex: 1;
  background: rgba(33, 76, 60, 0.14);
  content: "";
}
```

- [x] **Step 8: Run focused tests**

Run:

```powershell
npx vitest run apps/web/src/features/auth/sign-in-page.test.tsx apps/web/src/styles.test.ts
```

Expected: both test files PASS.

- [x] **Step 9: Run full verification**

Run:

```powershell
npm test -- --run
npm run typecheck
npm run build
```

Expected: all tests pass, TypeScript exits with code 0, and the production
build exits with code 0.

- [x] **Step 10: Run and inspect locally**

Run:

```powershell
npm run dev
```

Inspect `/sign-in` at desktop and mobile widths. Verify the LINE action is
full-width, the divider does not overflow, the password-reset mode hides the
LINE action, and clicking it opens the existing `/line` flow. Stop the local
server after inspection.

- [x] **Step 11: Commit the implementation without pushing**

```powershell
git add -- apps/web/src/features/auth/sign-in-page.test.tsx apps/web/src/features/auth/sign-in-page.tsx apps/web/src/styles.test.ts apps/web/src/styles.css docs/superpowers/plans/2026-07-30-line-login-button.md
git commit -m "feat: add LINE login to sign-in page"
```

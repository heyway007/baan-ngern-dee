# UI Control Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align recurring-page controls and place sign-up fields in the correct visual, DOM, and keyboard order.

**Architecture:** Keep the recurring alignment fix scoped to the existing page class so shared headings remain unchanged. Reorder the actual sign-up JSX instead of applying visual CSS ordering, preserving accessible keyboard navigation and all existing auth behavior.

**Tech Stack:** React, TypeScript, CSS, Vitest, Testing Library

## Global Constraints

- Recurring-page month input and compact action button remain `2.7rem` high.
- Final sign-up order is display name, email, password, confirm password, Turnstile, submit.
- Sign-in, password reset, validation, authentication payloads, and Turnstile behavior remain unchanged.
- No new dependencies.

---

### Task 1: Correct sign-up DOM order

**Files:**
- Modify: `apps/web/src/features/auth/sign-in-page.tsx:241-311`
- Test: `apps/web/src/features/auth/sign-in-page.test.tsx`

**Interfaces:**
- Consumes: Existing `AuthMode`, form state, and `TurnstileWidget`.
- Produces: The same form controls in the required DOM order without changing submission behavior.

- [ ] **Step 1: Write the failing DOM-order test**

Add a test that enters sign-up mode and verifies every adjacent control
appears later in the DOM:

```tsx
it("orders sign-up fields for visual and keyboard navigation", async () => {
  const user = userEvent.setup();
  render(
    <SignInPage
      auth={authActions()}
      turnstileSiteKey="turnstile-site-key"
      onAuthenticated={vi.fn()}
    />
  );

  await user.click(
    screen.getByRole("button", { name: "สมัครสมาชิก" })
  );

  const controls = [
    screen.getByLabelText("ชื่อที่แสดง"),
    screen.getByLabelText("อีเมล"),
    screen.getByLabelText("รหัสผ่าน"),
    screen.getByLabelText("ยืนยันรหัสผ่าน"),
    screen.getByRole("button", {
      name: "ผ่านการตรวจสอบความปลอดภัย"
    }),
    screen.getByRole("button", { name: "สร้างบัญชี" })
  ];

  for (let index = 0; index < controls.length - 1; index += 1) {
    expect(
      controls[index]!.compareDocumentPosition(controls[index + 1]!) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  }
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm test -- --run apps/web/src/features/auth/sign-in-page.test.tsx
```

Expected: FAIL because the confirmation-password field currently
precedes the email and password fields.

- [ ] **Step 3: Move sign-up-only controls after the password field**

Keep only display name in the first sign-up fragment. After the shared
password fragment, render confirmation password and Turnstile:

```tsx
{mode === "sign-up" ? (
  <>
    <label htmlFor="confirm-password">ยืนยันรหัสผ่าน</label>
    <input
      id="confirm-password"
      type="password"
      value={confirmPassword}
      onChange={(event) => setConfirmPassword(event.target.value)}
      autoComplete="new-password"
      minLength={8}
      disabled={submitting}
    />
    <TurnstileWidget
      siteKey={turnstileSiteKey}
      onToken={setCaptchaToken}
      resetKey={turnstileResetKey}
    />
  </>
) : null}
```

- [ ] **Step 4: Run auth tests and verify GREEN**

Run:

```bash
npm test -- --run apps/web/src/features/auth/sign-in-page.test.tsx
```

Expected: all sign-in-page tests PASS.

- [ ] **Step 5: Commit the sign-up ordering fix**

```bash
git add apps/web/src/features/auth/sign-in-page.tsx apps/web/src/features/auth/sign-in-page.test.tsx
git commit -m "fix: order sign-up controls naturally"
```

### Task 2: Align recurring-page actions

**Files:**
- Modify: `apps/web/src/styles.css:2466-2480`
- Test: `apps/web/src/styles.test.ts`

**Interfaces:**
- Consumes: Existing `.recurring-page`, `.page-actions`, `.month-selector`, and `.primary-button.compact` classes.
- Produces: Page-scoped bottom alignment while retaining existing control sizes.

- [ ] **Step 1: Write the failing style regression test**

Add a focused test:

```ts
it("aligns recurring month and action controls on the same baseline", () => {
  document.body.innerHTML = `
    <main class="recurring-page">
      <div class="page-actions">
        <label class="month-selector">
          <span>เดือนที่แสดง</span>
          <input type="month" />
        </label>
        <button class="primary-button compact">เพิ่มรายการประจำ</button>
      </div>
    </main>
  `;

  expect(
    getComputedStyle(document.querySelector(".page-actions")!)
      .alignItems
  ).toBe("flex-end");
});
```

- [ ] **Step 2: Run the style test and verify RED**

Run:

```bash
npm test -- --run apps/web/src/styles.test.ts
```

Expected: FAIL because the shared rule currently computes
`align-items: center`.

- [ ] **Step 3: Add the scoped alignment rule**

Place this adjacent to the month selector styles:

```css
.recurring-page .page-actions {
  align-items: flex-end;
}
```

- [ ] **Step 4: Run style and recurring tests and verify GREEN**

Run:

```bash
npm test -- --run apps/web/src/styles.test.ts apps/web/src/features/recurring/recurring-page.test.tsx
```

Expected: all selected tests PASS.

- [ ] **Step 5: Commit the alignment fix**

```bash
git add apps/web/src/styles.css apps/web/src/styles.test.ts
git commit -m "fix: align recurring page controls"
```

### Task 3: Verify the combined UI changes

**Files:**
- Verify only; no production files should change.

**Interfaces:**
- Consumes: Completed Tasks 1 and 2.
- Produces: Evidence that auth behavior, responsive layout, and production output remain valid.

- [ ] **Step 1: Run the full test suite**

```bash
npm test -- --run
```

Expected: zero failed tests.

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: exit code `0`.

- [ ] **Step 3: Run the production build**

```bash
npm run build
```

Expected: Vite and Wrangler dry-run exit with code `0`.

- [ ] **Step 4: Inspect both responsive surfaces**

Open the local app and confirm:

- Desktop recurring page: month input and action button have aligned
  bottom edges and equal control height.
- Mobile sign-up page: display name, email, password, confirmation,
  Turnstile, and submit appear in the required order.

- [ ] **Step 5: Confirm a clean worktree**

```bash
git diff --check
git status --short
```

Expected: no whitespace errors and no uncommitted implementation files.

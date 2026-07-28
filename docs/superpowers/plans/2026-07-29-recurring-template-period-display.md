# Recurring Template Period Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the localized start month and optional inclusive end month on every recurring-template card.

**Architecture:** Keep the existing recurring contracts, API, database, and form unchanged because they already own and enforce `startMonth` and `endMonth`. Add a timezone-safe formatter beside `RecurringTemplateManager`, render one read-only period line per card, and protect both finite and open-ended output with component tests.

**Tech Stack:** React 19, TypeScript, `Intl.DateTimeFormat`, Testing Library, Vitest

## Global Constraints

- Display `เริ่ม ก.ค. 2026 · สิ้นสุด ธ.ค. 2026` when `endMonth` exists.
- Display `เริ่ม ก.ค. 2026 · ไม่มีกำหนดสิ้นสุด` when `endMonth` is absent.
- Use Thai abbreviated month names with Gregorian years and Latin digits.
- Avoid timezone-dependent parsing that can shift the displayed month.
- Keep the period visible for active, paused, and cancelled templates.
- Do not change the API, contracts, Supabase schema, or materialization behavior.

---

### Task 1: Display the recurring-template period

**Files:**
- Modify: `apps/web/src/features/recurring/recurring-template-manager.tsx:19-24,88-97`
- Test: `apps/web/src/features/recurring/recurring-template-manager.test.tsx`

**Interfaces:**
- Consumes: `RecurringTemplate.startMonth: string` and `RecurringTemplate.endMonth?: string`, both in `YYYY-MM`.
- Produces: `formatRecurringMonth(month: string): string` and one human-readable period line on every template card.

- [ ] **Step 1: Write failing component tests**

Extend the test factory with an optional end month:

```tsx
function template(
  id: string,
  name: string,
  status: RecurringTemplate["status"],
  version: number,
  endMonth?: string
): RecurringTemplate {
  return {
    id,
    workspaceId,
    name,
    kind: name === "เงินเดือน" ? "income" : "expense",
    amount: "8000.00",
    currency: "THB",
    accountId: "22222222-2222-4222-8222-222222222222",
    categoryId: "33333333-3333-4333-8333-333333333333",
    dayOfMonth: 1,
    startMonth: "2026-01",
    ...(endMonth ? { endMonth } : {}),
    status,
    version
  };
}
```

Add one test covering both forms and a cancelled template:

```tsx
it("shows the localized inclusive period for every template", () => {
  const finite = template(
    "77777777-7777-4777-8777-777777777777",
    "ประกัน",
    "active",
    1,
    "2026-12"
  );
  const openEnded = template(
    "88888888-8888-4888-8888-888888888888",
    "เงินเดือน",
    "cancelled",
    1
  );

  renderManager({ templates: [finite, openEnded] });

  expect(
    screen.getByText("เริ่ม ม.ค. 2026 · สิ้นสุด ธ.ค. 2026")
  ).toBeInTheDocument();
  expect(
    screen.getByText("เริ่ม ม.ค. 2026 · ไม่มีกำหนดสิ้นสุด")
  ).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused test and confirm the red state**

Run:

```bash
npx vitest run apps/web/src/features/recurring/recurring-template-manager.test.tsx --reporter=dot
```

Expected: FAIL because neither period string is rendered.

- [ ] **Step 3: Add the timezone-safe Thai month formatter**

Add beside `statusLabels`:

```tsx
const recurringMonthFormatter = new Intl.DateTimeFormat(
  "th-TH-u-ca-gregory-nu-latn",
  {
    month: "short",
    year: "numeric",
    timeZone: "UTC"
  }
);

function formatRecurringMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return recurringMonthFormatter.format(
    new Date(Date.UTC(year!, monthNumber! - 1, 1))
  );
}
```

This uses explicit UTC construction and the Gregorian calendar, so January
2026 cannot become December 2025 and the displayed year remains `2026`
instead of the Buddhist year.

- [ ] **Step 4: Render the period on every card**

Below the existing amount/day paragraph, add:

```tsx
<p className="recurring-template-period">
  เริ่ม {formatRecurringMonth(template.startMonth)}{" · "}
  {template.endMonth
    ? `สิ้นสุด ${formatRecurringMonth(template.endMonth)}`
    : "ไม่มีกำหนดสิ้นสุด"}
</p>
```

Keep this inside the common card body, outside the status/action condition,
so cancelled templates display it too.

- [ ] **Step 5: Run focused recurring tests**

Run:

```bash
npx vitest run apps/web/src/features/recurring/recurring-template-manager.test.tsx apps/web/src/features/recurring/recurring-template-form.test.tsx apps/web/src/features/recurring/recurring-page.test.tsx --reporter=dot
```

Expected: all selected test files pass.

- [ ] **Step 6: Commit the tested feature**

```bash
git add apps/web/src/features/recurring/recurring-template-manager.tsx apps/web/src/features/recurring/recurring-template-manager.test.tsx
git commit -m "feat: show recurring item end month"
```

### Task 2: Verify and publish

**Files:**
- Verify only; no planned source modifications.

**Interfaces:**
- Consumes: the committed recurring-period display from Task 1.
- Produces: a type-safe production build, a green repository-wide test run, and a deployed `main`.

- [ ] **Step 1: Run TypeScript validation**

Run:

```bash
npm run typecheck
```

Expected: exit code 0 for every workspace.

- [ ] **Step 2: Build the production application and Worker**

Run:

```bash
npm run build
```

Expected: Vite production assets build and Wrangler dry-run exit with code 0.

- [ ] **Step 3: Run the complete test suite**

Run:

```bash
npm test -- --run --reporter=dot
```

Expected: all test files and tests pass with exit code 0.

- [ ] **Step 4: Confirm a clean, synchronized change set**

Run:

```bash
git diff --check
git status --short --branch
```

Expected: no uncommitted source changes and `main` ahead of `origin/main`
only by the approved design, plan, and implementation commits.

- [ ] **Step 5: Push and verify production**

```bash
git push origin main
npx wrangler deployments list -c wrangler.jsonc --json
curl.exe -sS -o NUL -w "%{http_code} %{content_type}" "https://baan-ngern-dee.newforico-9ea.workers.dev/recurring"
```

Expected: a deployment newer than the pre-push version and
`200 text/html` from the recurring page.

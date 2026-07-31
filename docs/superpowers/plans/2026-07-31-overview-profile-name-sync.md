# Overview Profile Name Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Overview greeting and personal workspace label render the latest server-confirmed profile display name.

**Architecture:** Keep `effectiveProfileState.profile` as the single UI identity source in `FinanceRoutes`. Pass only its `displayName` into `OverviewPage`, where both personal heading lines are derived without mutating the persisted workspace record.

**Tech Stack:** React 19, React Router, TypeScript, Vitest, Testing Library

## Global Constraints

- Both `สวัสดี <ชื่อที่แสดง>` and `บ้านเงินของ <ชื่อที่แสดง>` must use the latest confirmed profile name.
- Do not rename the persisted Supabase workspace.
- Do not add an API endpoint, dependency, or database migration.
- Preserve the session-derived fallback while profile loading is pending or failed.
- A profile name change must not reload the finance snapshot.

---

### Task 1: Flow the Effective Profile Name Into Overview

**Files:**
- Modify: `apps/web/src/app/router.test.tsx`
- Modify: `apps/web/src/app/router.tsx:798-803`
- Modify: `apps/web/src/features/dashboard/overview-page.tsx:15-50`
- Modify: `apps/web/src/features/dashboard/overview-page.test.tsx`

**Interfaces:**
- Consumes: `effectiveProfileState.profile.displayName: string` from `FinanceRoutes`.
- Produces: `OverviewPage({ displayName, snapshot })`, where `displayName: string` drives both personal heading lines.

- [ ] **Step 1: Add the failing router regression**

Extend the existing test named
`updates the layout immediately from a server-confirmed profile change`. Capture
`getSnapshot`, navigate to Overview after the confirmed update, and assert both
personal labels:

```tsx
const { dependencies, getSnapshot } = createDependencies({
  session,
  snapshot: workspaceSnapshot,
  profileApi: profileApi({ update })
});

// Existing edit and save interaction remains unchanged.

await user.click(
  screen.getByRole("link", { name: "ภาพรวม" })
);

expect(
  await screen.findByRole("heading", {
    name: "สวัสดี มินยืนยันแล้ว"
  })
).toBeInTheDocument();
expect(
  screen.getByText("บ้านเงินของ มินยืนยันแล้ว")
).toBeInTheDocument();
expect(getSnapshot).toHaveBeenCalledOnce();
```

This test catches any implementation that continues to render
`session.displayName`, continues to render `snapshot.workspace.name`, or
refreshes finance data just to update a personal label.

- [ ] **Step 2: Run the router test and verify RED**

Run:

```powershell
npx vitest run apps/web/src/app/router.test.tsx
```

Expected: FAIL because the Overview heading still contains the original session
name and the workspace label still contains its persisted name.

- [ ] **Step 3: Replace the Overview session prop with displayName**

In `apps/web/src/features/dashboard/overview-page.tsx`, remove the
`CloudSession` import and change the prop contract:

```tsx
type OverviewPageProps = Readonly<{
  displayName: string;
  snapshot: FinanceSnapshot;
}>;

export function OverviewPage({
  displayName,
  snapshot
}: OverviewPageProps) {
```

Render both personal lines from the same value:

```tsx
<h1>สวัสดี {displayName}</h1>
<p>บ้านเงินของ {displayName}</p>
```

Do not update `snapshot.workspace.name` or call a finance API.

- [ ] **Step 4: Pass the effective profile name from the router**

In the `/overview` route, replace the session prop:

```tsx
<OverviewPage
  displayName={effectiveProfileState.profile.displayName}
  snapshot={snapshot}
/>
```

This preserves the existing fallback because `effectiveProfileState.profile`
already falls back to `sessionProfile(session)` when no confirmed profile is
available.

- [ ] **Step 5: Update the focused component test**

Remove the unused `CloudSession` import and `session` fixture from
`overview-page.test.tsx`. Render the component with a literal name and assert
both labels before the existing month behavior:

```tsx
render(
  <MemoryRouter>
    <OverviewPage displayName="มินใหม่" snapshot={snapshot} />
  </MemoryRouter>
);

expect(
  screen.getByRole("heading", { name: "สวัสดี มินใหม่" })
).toBeInTheDocument();
expect(screen.getByText("บ้านเงินของ มินใหม่")).toBeInTheDocument();
```

Keep the existing selected-month assertions unchanged.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run:

```powershell
npx vitest run apps/web/src/app/router.test.tsx apps/web/src/features/dashboard/overview-page.test.tsx
```

Expected: both test files pass with zero failures.

- [ ] **Step 7: Run full verification**

Run:

```powershell
npx vitest run
npm run typecheck
npm run build
git diff --check
```

Expected: all tests, type checking, build, and whitespace validation pass. The
existing Vite large-chunk warning is acceptable because this change adds no
bundle dependency.

- [ ] **Step 8: Commit the implementation**

```powershell
git add apps/web/src/app/router.test.tsx apps/web/src/app/router.tsx apps/web/src/features/dashboard/overview-page.tsx apps/web/src/features/dashboard/overview-page.test.tsx
git commit -m "fix: sync overview with profile name"
```

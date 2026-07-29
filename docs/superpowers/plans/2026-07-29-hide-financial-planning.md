# Hide Financial Planning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ซ่อนเมนูแผนการเงินและป้องกันการเปิด `/planning` โดยตรงผ่าน feature flag กลาง โดยไม่ลบโค้ดหรือข้อมูลเดิม

**Architecture:** สร้าง feature flag แบบค่าคงที่ใน app layer แล้วให้ทั้ง navigation และ router อ่านค่าจากแหล่งเดียวกัน เมื่อ flag ปิด navigation จะไม่มีรายการแผนการเงิน และ router จะ redirect `/planning` ไป `/overview`

**Tech Stack:** React 19, React Router, TypeScript, Vitest, Testing Library

## Global Constraints

- ค่าเริ่มต้นของ `financialPlanning` เป็น `false`
- ซ่อนเมนูทั้ง sidebar และ bottom navigation
- `/planning` ต้อง redirect ไป `/overview`
- ไม่ลบ PlanningPage, Finance API, Worker routes, migrations หรือข้อมูล Supabase
- เปิดคืนได้โดยแก้ feature flag เพียงจุดเดียว

---

### Task 1: Gate financial planning in navigation and routing

**Files:**
- Create: `apps/web/src/app/feature-flags.ts`
- Modify: `apps/web/src/app/layout.tsx:20-70`
- Modify: `apps/web/src/app/layout.test.tsx:15-30`
- Modify: `apps/web/src/app/router.tsx:650-670`
- Modify: `apps/web/src/app/router.test.tsx:210-235`

**Interfaces:**
- Produces: `featureFlags.financialPlanning: false`
- Consumes: `featureFlags.financialPlanning` ใน `layout.tsx` และ `router.tsx`

- [x] **Step 1: Write failing navigation and route tests**

เปลี่ยน layout test ให้ยืนยันว่าไม่มีลิงก์แผนการเงิน:

```tsx
it("hides financial planning while the feature is disabled", () => {
  render(
    <MemoryRouter>
      <AppLayout session={session} onSignOut={vi.fn()} />
    </MemoryRouter>
  );

  expect(
    screen.queryByRole("link", { name: "แผนการเงิน" })
  ).not.toBeInTheDocument();
});
```

เปลี่ยน router test ให้ยืนยัน direct URL ถูกส่งกลับหน้าภาพรวม:

```tsx
it("redirects the disabled financial planning route to overview", async () => {
  const { dependencies } = createDependencies({
    session,
    snapshot: workspaceSnapshot
  });
  render(
    <MemoryRouter initialEntries={["/planning"]}>
      <FinanceRoutes dependencies={dependencies} />
    </MemoryRouter>
  );

  expect(
    await screen.findByRole("heading", { name: "สวัสดี Admin" })
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "แผนการเงิน" })
  ).not.toBeInTheDocument();
});
```

- [x] **Step 2: Run focused tests and verify RED**

Run:

```powershell
npx vitest --run apps/web/src/app/layout.test.tsx apps/web/src/app/router.test.tsx
```

Expected: ทั้งสอง test ล้ม เพราะ navigation และ route ยังเปิดอยู่

- [x] **Step 3: Add the central feature flag**

สร้าง `apps/web/src/app/feature-flags.ts`:

```ts
export const featureFlags = {
  financialPlanning: false
} as const;
```

- [x] **Step 4: Gate navigation and route with the flag**

ใน `layout.tsx` import flag และเพิ่ม planning navigation แบบมีเงื่อนไข:

```tsx
import { featureFlags } from "./feature-flags";

const navigation = [
  // existing overview, accounts, transactions and recurring items
  ...(featureFlags.financialPlanning
    ? [{
        to: "/planning",
        label: "แผนการเงิน",
        mobileLabel: "แผน",
        icon: Target
      }]
    : []),
  // existing installments item
] as const;
```

ใน `router.tsx` import flag และ gate route:

```tsx
import { featureFlags } from "./feature-flags";

<Route
  path="/planning"
  element={
    featureFlags.financialPlanning ? (
      <PlanningPage
        api={api}
        snapshot={snapshot}
        onChanged={refreshSnapshot}
      />
    ) : (
      <Navigate to="/overview" replace />
    )
  }
/>
```

- [x] **Step 5: Run focused tests and verify GREEN**

Run:

```powershell
npx vitest --run apps/web/src/app/layout.test.tsx apps/web/src/app/router.test.tsx
```

Expected: focused tests ผ่านทั้งหมด

- [x] **Step 6: Run project verification**

Run:

```powershell
npm test -- --run
npm run typecheck -w @systems-credit/web
npm run build -w @systems-credit/web
```

Expected: ทุกคำสั่ง exit code 0

- [x] **Step 7: Commit**

```powershell
git add -- apps/web/src/app/feature-flags.ts apps/web/src/app/layout.tsx apps/web/src/app/layout.test.tsx apps/web/src/app/router.tsx apps/web/src/app/router.test.tsx docs/superpowers/plans/2026-07-29-hide-financial-planning.md
git commit -m "feat: hide financial planning behind flag"
```

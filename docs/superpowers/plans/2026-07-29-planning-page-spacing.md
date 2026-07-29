# Planning Page Spacing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เพิ่มพื้นที่ว่างรอบหน้าแผนการเงินเพื่อไม่ให้คอนเทนต์ชิดขอบ โดยรักษาโครงสร้างและ responsive behavior เดิม

**Architecture:** ใช้ `.planning-page` เป็นขอบเขตของการปรับ layout โดยลด `max-width` จากค่ากลางของ `.page-content` และจัดกึ่งกลางด้วย logical margins ส่วนหน้าจอมือถือจะคืนความกว้างเต็มภายใน padding หลักที่มีอยู่แล้ว

**Tech Stack:** CSS, Vitest, JSDOM, Vite

## Global Constraints

- แก้เฉพาะระยะขอบและความกว้างของหน้าแผนการเงิน
- ไม่เปลี่ยน component, ข้อมูล, API, การ์ด หรือลำดับเนื้อหา
- หน้าจอไม่เกิน 760px ต้องใช้ความกว้างเต็มภายใน padding หลัก

---

### Task 1: Center and constrain the planning page

**Files:**
- Modify: `apps/web/src/styles.test.ts:186`
- Modify: `apps/web/src/styles.css:4376`

**Interfaces:**
- Consumes: `.page-content` ซึ่งกำหนด width, margin และ responsive padding ระดับแอป
- Produces: `.planning-page` ที่มี `max-width: 82rem`, `margin-inline: auto` และ mobile override

- [x] **Step 1: Write the failing style test**

เพิ่ม planning page ลงใน fixture เดิมและตรวจค่า layout:

```ts
const planningPage = document.querySelector(".planning-page")!;
const planningStyle = getComputedStyle(planningPage);

expect(planningStyle.maxWidth).toBe("82rem");
expect(planningStyle.marginLeft).toBe("auto");
expect(planningStyle.marginRight).toBe("auto");
```

จากนั้นตรวจว่า stylesheet มี mobile override:

```ts
expect(css).toContain("@media (max-width: 760px)");
expect(css).toMatch(/\.planning-page\s*\{[^}]*max-width:\s*100%/);
```

- [x] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npx vitest --run apps/web/src/styles.test.ts
```

Expected: FAIL เพราะ `.planning-page` ยังไม่มี `max-width: 82rem`

- [x] **Step 3: Implement the desktop and mobile spacing**

ปรับ base rule:

```css
.planning-page {
  display: grid;
  width: 100%;
  max-width: 82rem;
  margin-inline: auto;
  gap: 24px;
}
```

เพิ่มใน media query เดิมที่ `max-width: 760px`:

```css
.planning-page {
  max-width: 100%;
}
```

- [x] **Step 4: Run verification and verify GREEN**

Run:

```powershell
npx vitest --run apps/web/src/styles.test.ts
npm run typecheck -w @systems-credit/web
npm run build -w @systems-credit/web
```

Expected: ทุกคำสั่ง exit code 0

- [x] **Step 5: Commit**

```powershell
git add -- apps/web/src/styles.css apps/web/src/styles.test.ts docs/superpowers/plans/2026-07-29-planning-page-spacing.md
git commit -m "style: add breathing room to planning page"
```

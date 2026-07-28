# Slip Action Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align all slip-table action controls to equal widths and heights on desktop and mobile.

**Architecture:** Keep the existing semantic buttons, labels, handlers, and responsive table unchanged. Replace only the action container's desktop flex layout with a three-column CSS grid, then retain the existing two-column compact-mobile override.

**Tech Stack:** CSS Grid, React, Vitest, TypeScript, Vite

## Global Constraints

- Desktop and tablet use three equal-width action columns.
- Every action control fills its grid cell and uses the same minimum height.
- Small mobile screens use two equal-width action columns.
- Do not change action availability, accessibility labels, event handling, or batch confirmation.

---

### Task 1: Equalize slip action controls

**Files:**
- Modify: `apps/web/src/styles.css:4194-4214`
- Test: `apps/web/src/features/transactions/slip-batch-table.test.tsx`

**Interfaces:**
- Consumes: existing `.slip-batch-row-actions` container with `button` and `label` children.
- Produces: three equal desktop columns and two equal compact-mobile columns.

- [ ] **Step 1: Verify the current CSS does not satisfy the design**

Run:

```powershell
rg -n -A 20 "\.slip-batch-row-actions \{" apps/web/src/styles.css
```

Expected: the desktop rule reports `display: flex` and has no three-column `grid-template-columns`.

- [ ] **Step 2: Implement the desktop grid and equal control sizing**

Change the desktop rules to:

```css
.slip-batch-row-actions {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
  width: min(100%, 300px);
}

.slip-batch-row-actions button,
.slip-batch-row-actions label {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 40px;
  padding: 6px 8px;
}
```

Keep the existing border, radius, typography, cursor, and hidden file-input rules.

- [ ] **Step 3: Verify desktop and compact-mobile grid declarations**

Run:

```powershell
rg -n -A 24 "\.slip-batch-row-actions \{" apps/web/src/styles.css
```

Expected: desktop contains `repeat(3, minmax(0, 1fr))`; the rule under `@media (max-width: 480px)` still contains `grid-template-columns: 1fr 1fr`.

- [ ] **Step 4: Run component tests and production checks**

Run:

```powershell
npx vitest run apps/web/src/features/transactions/slip-batch-table.test.tsx
npm run typecheck --workspace=@systems-credit/web
npm run build
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/src/styles.css
git commit -m "fix: align slip action controls"
```

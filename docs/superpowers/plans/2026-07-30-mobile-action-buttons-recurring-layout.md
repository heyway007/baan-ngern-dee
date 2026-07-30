# Mobile Action Buttons and Recurring Header Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make mobile page-heading actions exactly 44px by 44px and move the recurring month controls into a collision-free row below the heading.

**Architecture:** Keep the change in the existing shared stylesheet so every affected page inherits one mobile action standard without duplicating component logic. Add CSS regression assertions before each production change, then validate the generated production assets and deployed Worker.

**Tech Stack:** React 19, TypeScript, CSS, Vitest, jsdom, Vite, Cloudflare Workers

## Global Constraints

- Apply responsive changes only at `620px` and below.
- Keep desktop button sizes, labels, icons, and page content unchanged.
- Preserve real button text for accessible names; hide it visually only on mobile.
- Do not alter recurring data fetching or mutation behavior.
- Do not include unrelated existing working-tree changes in commits.

---

## File Structure

- Modify `apps/web/src/styles.css`: own shared button dimensions and responsive page-heading layouts.
- Modify `apps/web/src/styles.test.ts`: own stylesheet regression assertions for the mobile invariants.
- No component files are required because the affected pages already use the shared `.page-heading`, `.page-actions`, `.primary-button`, `.secondary-button`, and `.month-selector` structure.

### Task 1: Exact Mobile Page-Action Dimensions

**Files:**
- Modify: `apps/web/src/styles.test.ts:134-159`
- Modify: `apps/web/src/styles.css:3697-3760`

**Interfaces:**
- Consumes: Existing `.page-heading`, `.primary-button`, and `.secondary-button` selectors.
- Produces: One mobile CSS invariant in which every page-heading action is exactly `44px` wide and `44px` high and cannot shrink.

- [ ] **Step 1: Write the failing stylesheet test**

Add this test to `apps/web/src/styles.test.ts`:

```ts
it("keeps every mobile page-heading action exactly 44 pixels square", () => {
  const css = [...document.styleSheets]
    .flatMap((sheet) => {
      try {
        return [...sheet.cssRules].map((rule) => rule.cssText);
      } catch {
        return [];
      }
    })
    .join("\n");

  expect(css).toMatch(
    /@media \(max-width: 620px\)[\s\S]*?\.page-heading \.primary-button,\s*\.page-heading \.secondary-button\s*\{[^}]*box-sizing:\s*border-box;[^}]*width:\s*44px;[^}]*min-width:\s*44px;[^}]*height:\s*44px;[^}]*min-height:\s*44px;[^}]*flex:\s*0 0 44px;/
  );
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
npx vitest run --project @systems-credit/web apps/web/src/styles.test.ts
```

Expected: FAIL because the current mobile rules use `width: 2.8rem`, retain the compact button's variable height, and do not prevent flex shrinking.

- [ ] **Step 3: Implement the shared mobile size**

Inside the existing `@media (max-width: 620px)` block in `apps/web/src/styles.css`, replace the separate page-heading button width rules with:

```css
.page-heading .primary-button,
.page-heading .secondary-button {
  box-sizing: border-box;
  width: 44px;
  min-width: 44px;
  height: 44px;
  min-height: 44px;
  flex: 0 0 44px;
  overflow: hidden;
  padding: 0;
  color: transparent;
  gap: 0;
}

.page-heading .primary-button svg,
.page-heading .secondary-button svg {
  position: static;
  flex: 0 0 auto;
}

.page-heading .secondary-button svg {
  color: var(--forest);
}

.page-heading .primary-button svg {
  color: white;
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
npx vitest run --project @systems-credit/web apps/web/src/styles.test.ts
```

Expected: PASS, including the pre-existing typography, recurring alignment, planning, and LINE entry assertions.

- [ ] **Step 5: Commit the independently testable size fix**

```bash
git add apps/web/src/styles.css apps/web/src/styles.test.ts
git commit -m "fix: standardize mobile page action sizes"
```

### Task 2: Collision-Free Mobile Page Headings and Recurring Controls

**Files:**
- Modify: `apps/web/src/styles.test.ts:134-180`
- Modify: `apps/web/src/styles.css:3697-3865`

**Interfaces:**
- Consumes: The exact `44px` action invariant from Task 1.
- Produces: A single-column mobile page heading plus a recurring control grid with `minmax(0, 1fr) 44px`.

- [ ] **Step 1: Write the failing recurring-layout test**

Add this test to `apps/web/src/styles.test.ts`:

```ts
it("gives the mobile recurring month selector its own flexible action row", () => {
  const css = [...document.styleSheets]
    .flatMap((sheet) => {
      try {
        return [...sheet.cssRules].map((rule) => rule.cssText);
      } catch {
        return [];
      }
    })
    .join("\n");

  expect(css).toMatch(
    /@media \(max-width: 620px\)[\s\S]*?\.page-heading\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/
  );
  expect(css).toMatch(
    /\.recurring-page \.page-actions\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 44px;[^}]*align-items:\s*end;/
  );
  expect(css).toMatch(
    /\.recurring-page \.month-selector\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;/
  );
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
npx vitest run --project @systems-credit/web apps/web/src/styles.test.ts
```

Expected: FAIL because `.page-heading` remains a horizontal flex row and `.month-selector` has a fixed `8.4rem` width.

- [ ] **Step 3: Implement the responsive layout**

Inside the existing `@media (max-width: 620px)` block, update the mobile layout with:

```css
.page-heading {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-items: start;
  gap: 1rem;
}

.page-actions {
  width: 100%;
  justify-content: flex-end;
}

.page-heading > .primary-button,
.page-heading > .secondary-button {
  justify-self: end;
}

.recurring-page .page-actions {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 44px;
  align-items: end;
}

.recurring-page .month-selector {
  width: 100%;
  min-width: 0;
}
```

Remove the obsolete mobile-only `.month-selector { width: 8.4rem; }` declaration.

- [ ] **Step 4: Run focused component and stylesheet tests**

Run:

```bash
npx vitest run --project @systems-credit/web apps/web/src/styles.test.ts apps/web/src/features/recurring/recurring-page.test.tsx apps/web/src/features/recurring/recurring-occurrence-list.test.tsx
```

Expected: PASS. The recurring page still changes periods and opens/closes its form while the stylesheet assertions enforce the new mobile geometry.

- [ ] **Step 5: Commit the independently testable layout fix**

```bash
git add apps/web/src/styles.css apps/web/src/styles.test.ts
git commit -m "fix: prevent mobile recurring header collisions"
```

### Task 3: Full Verification and Production Deployment

**Files:**
- Verify: `apps/web/src/styles.css`
- Verify: `apps/web/src/styles.test.ts`
- Verify: `apps/web/dist/assets/*.css`

**Interfaces:**
- Consumes: The two committed mobile CSS changes.
- Produces: A tested production bundle and a live Cloudflare Worker deployment.

- [ ] **Step 1: Check the final diff**

Run:

```bash
git diff --check HEAD~2..HEAD
git status --short
```

Expected: No whitespace errors. Pre-existing unrelated changes remain unstaged and are not included in the two UI commits.

- [ ] **Step 2: Run the complete automated suite**

Run:

```bash
npm test
```

Expected: All test files and tests pass.

- [ ] **Step 3: Run type checking**

Run:

```bash
npm run typecheck
```

Expected: All workspace TypeScript projects pass.

- [ ] **Step 4: Build the production assets**

Run:

```bash
npm run build
```

Expected: Vite and the Worker dry run complete successfully. The existing large-chunk advisory may remain, but there must be no build error.

- [ ] **Step 5: Inspect the generated stylesheet**

Run:

```bash
rg -n "44px|minmax\\(0, ?1fr\\)" apps/web/dist/assets -g "*.css"
```

Expected: The generated CSS contains the 44-pixel page-action invariant and the recurring two-column control grid.

- [ ] **Step 6: Inspect the affected pages at a mobile viewport**

Start the web app:

```bash
npm run dev:web -- --host 127.0.0.1
```

Using the browser-control skill, open the authenticated accounts, transactions,
installments, and recurring routes at a `390px by 844px` viewport. Verify:

1. Every icon-only page-heading action is a visually equal `44px` square.
2. Single actions align to the right and multi-action groups remain within the viewport.
3. The recurring title occupies its own row.
4. The recurring month selector fills the next row without overlapping the fixed-size add/close action.
5. Switching the recurring form between closed and open states does not change the action size.

Expected: No horizontal overflow, clipped icons, heading collision, or month-control collision.

- [ ] **Step 7: Deploy the verified build**

Run:

```bash
npx wrangler deploy
```

Expected: Deployment succeeds and prints the production URL plus a new Worker version ID.

- [ ] **Step 8: Verify the live asset and request physical-device confirmation**

Run:

```bash
curl.exe -sSI "https://baan-ngern-dee.newforico-9ea.workers.dev/recurring"
```

Expected: HTTP `200` with `Cache-Control: public, max-age=0, must-revalidate`.

Ask the user to confirm on their phone that:

1. Accounts, transactions, installments, and recurring add/close actions appear as equal square buttons.
2. The recurring month input and add/close action occupy a separate row and do not overlap the heading.

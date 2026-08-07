# LINE Production Origin Change Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the obsolete LINE OA production origin with `https://baan-ngern-dee.workplatform.workers.dev` and keep Supabase redirect documentation consistent.

**Architecture:** The checked-in Messaging API rich-menu definition remains the deployable source. Its validator and regression tests enforce the same production origin, while Supabase local configuration and runbooks document the matching Auth destinations.

**Tech Stack:** Node.js, LINE Messaging API rich menus, Supabase Auth, Cloudflare Workers

## Global Constraints

- Do not change the Supabase custom OAuth callback configured in LINE Developers.
- Do not add or run a database migration.
- Do not expose or commit a LINE channel access token.
- Validate locally before provisioning the production rich menu.

---

### Task 1: Lock the new LINE production origin with a regression test

**Files:**
- Modify: `tools/line-rich-menu.test.mjs`
- Test: `tools/line-rich-menu.test.mjs`

**Interfaces:**
- Consumes: `validateRichMenu(definition, imageBytes)` from `tools/validate-line-rich-menu.mjs`
- Produces: a test fixture whose URI actions use `https://baan-ngern-dee.workplatform.workers.dev`

- [ ] **Step 1: Change the test fixture origin only**

Set `ORIGIN` to `https://baan-ngern-dee.workplatform.workers.dev` while leaving the production validator and rich-menu JSON unchanged.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm run test:line`

Expected: FAIL because the validator still requires the obsolete origin.

### Task 2: Update production configuration and documentation

**Files:**
- Modify: `ops/line/rich-menu.json`
- Modify: `tools/validate-line-rich-menu.mjs`
- Modify: `supabase/config.toml`
- Modify: `docs/runbooks/line-oa-setup.md`
- Modify: `docs/runbooks/deploy-cloudflare-supabase.md`

**Interfaces:**
- Consumes: the canonical origin fixed by Task 1
- Produces: five valid `/line?next=...` URI actions and complete Supabase Auth redirect examples

- [ ] **Step 1: Replace the obsolete origin in the five rich-menu URI actions**

Preserve every encoded `next` value exactly.

- [ ] **Step 2: Update the validator origin**

Set `PRODUCTION_ORIGIN` to `https://baan-ngern-dee.workplatform.workers.dev`.

- [ ] **Step 3: Update Supabase local Auth configuration**

Use the new Site URL and add exact production and local `/line/callback` URLs without removing the existing root and reset-password entries.

- [ ] **Step 4: Update both operational runbooks**

Replace production examples and health-check commands with the new origin.

- [ ] **Step 5: Run focused verification and verify GREEN**

Run: `npm run test:line && npm run validate:line-menu`

Expected: both commands exit 0.

### Task 3: Verify and commit

**Files:**
- Verify all files modified by Tasks 1 and 2

**Interfaces:**
- Consumes: the completed origin change
- Produces: a tested local commit ready for production rich-menu provisioning

- [ ] **Step 1: Scan for the obsolete origin**

Run: `rg -n "baan-ngern-dee\\.newforico-9ea\\.workers\\.dev" ops tools supabase docs/runbooks README.md`

Expected: no matches.

- [ ] **Step 2: Run project verification**

Run: `npx vitest run`, `npm run typecheck`, `npm run build`, and `git diff --check`.

Expected: all commands exit 0.

- [ ] **Step 3: Commit the change**

```powershell
git add ops/line/rich-menu.json tools/validate-line-rich-menu.mjs tools/line-rich-menu.test.mjs supabase/config.toml docs/runbooks/line-oa-setup.md docs/runbooks/deploy-cloudflare-supabase.md docs/superpowers/specs/2026-08-07-line-production-origin-change-design.md docs/superpowers/plans/2026-08-07-line-production-origin-change.md
git commit -m "fix: update LINE production origin"
```

- [ ] **Step 4: Provision only with a securely entered token**

Run the existing `Read-Host -AsSecureString` procedure from `docs/runbooks/line-oa-setup.md`; never paste the token into chat or a command-line argument.


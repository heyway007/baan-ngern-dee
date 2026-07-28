# Production User Management Migration Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install the missing production Supabase migrations so the deployed Worker can list registered Auth users.

**Architecture:** Keep the deployed Worker and web application unchanged. Bring the linked Supabase production schema forward from migration 012 through 015 in recorded order, then verify database history, focused regression tests, and the authenticated production page.

**Tech Stack:** Supabase CLI, PostgreSQL migrations, Vitest, Cloudflare Worker, React

## Global Constraints

- Apply only migrations already committed in `supabase/migrations`.
- Do not confirm, suspend, delete, or otherwise mutate an Auth user.
- Stop on the first migration error; do not repair migration history or run ad hoc SQL.
- Treat migration history and the authenticated production page as the authoritative rollout signals.

---

### Task 1: Apply the pending production migrations

**Files:**
- Read: `supabase/migrations/202607270013_user_invitations.sql`
- Read: `supabase/migrations/202607280014_user_management.sql`
- Read: `supabase/migrations/202607280015_transaction_void_history.sql`
- Modify: linked Supabase production migration history and schema

**Interfaces:**
- Consumes: the Supabase project already linked in `supabase/.temp/project-ref`
- Produces: the `list_admin_users` RPC and all database objects expected by the deployed Worker

- [ ] **Step 1: Capture the pre-deployment migration state**

Run:

```powershell
npx supabase migration list
```

Expected: migrations 013, 014, and 015 have local versions and blank remote versions.

- [ ] **Step 2: Apply committed migrations in order**

Run:

```powershell
npx supabase db push --include-all
```

Expected: the CLI applies 013, then 014, then 015 without repair or destructive prompts.

- [ ] **Step 3: Verify remote migration history**

Run:

```powershell
npx supabase migration list
```

Expected: local and remote versions match for 013, 014, and 015.

### Task 2: Verify user-management behavior

**Files:**
- Test: `workers/api/test/user-management-database.test.ts`
- Test: `workers/api/test/supabase-user-management-repository.test.ts`
- Test: `workers/api/test/user-management.test.ts`
- Inspect: production `/admin/users`

**Interfaces:**
- Consumes: the production `list_admin_users` RPC installed by Task 1
- Produces: evidence that the repository contract and production page can list users

- [ ] **Step 1: Run focused database and Worker regressions**

Run:

```powershell
npm test -- --run workers/api/test/user-management-database.test.ts workers/api/test/supabase-user-management-repository.test.ts workers/api/test/user-management.test.ts
```

Expected: every selected test passes.

- [ ] **Step 2: Run type checking and the production build**

Run:

```powershell
npm run typecheck
npm run build
```

Expected: both commands exit with code 0.

- [ ] **Step 3: Verify the authenticated production page**

Reload the existing production `/admin/users` page as the configured Super
Admin. Expected: the generic management error is absent and at least the
Super Admin Auth user is displayed.

### Task 3: Record and publish the recovery documentation

**Files:**
- Create: `docs/superpowers/specs/2026-07-28-production-user-management-migration-recovery-design.md`
- Create: `docs/superpowers/plans/2026-07-28-production-user-management-migration-recovery.md`

**Interfaces:**
- Consumes: rollout and verification evidence from Tasks 1 and 2
- Produces: auditable Git history for the production recovery

- [ ] **Step 1: Confirm the worktree contains documentation only**

Run:

```powershell
git status --short
git diff --check
```

Expected: no source-code changes and no whitespace errors.

- [ ] **Step 2: Commit the implementation plan**

Run:

```powershell
git add docs/superpowers/plans/2026-07-28-production-user-management-migration-recovery.md
git commit -m "docs: plan production migration recovery"
```

- [ ] **Step 3: Push the recovery documentation**

Run:

```powershell
git push origin main
```

Expected: `origin/main` advances to the documentation commit after production verification succeeds.

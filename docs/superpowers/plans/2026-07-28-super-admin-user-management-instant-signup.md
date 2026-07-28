# Super Admin User Management and Instant Signup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ให้ผู้ใช้สมัครแล้วเข้าใช้งานได้ทันทีโดยยืนยันรหัสผ่านสองครั้งและผ่าน Cloudflare Turnstile พร้อมให้ Super Admin ดูแล ยืนยัน ระงับ คืนสถานะ รีเซ็ตรหัสผ่าน และลบบัญชีผู้ใช้อย่างปลอดภัยได้

**Architecture:** เว็บเรียก Supabase Auth โดยตรงสำหรับรหัสผ่านและ CAPTCHA ส่วนการจัดการผู้ใช้ทั้งหมดเรียก Worker ด้วย access token และ Worker ใช้ Service Role ติดต่อ Supabase เท่านั้น การลบบัญชีเป็น state machine ที่ retry ได้: ระงับและทำเครื่องหมาย `deletion_pending`, ลบเฉพาะข้อมูล private ผ่าน RPC, แล้วจึงลบ Auth user; บัญชี Super Admin, บัญชีตัวเอง และผู้ใช้ที่มีข้อมูล shared/family จะถูกป้องกัน

**Tech Stack:** TypeScript 5.8, React 19, React Router 7, Supabase Auth/Postgres, Hono 4, Zod 3, Vitest 3, Testing Library, pgTAP, PGlite, Cloudflare Workers และ Cloudflare Turnstile

## Global Constraints

- ห้ามส่งรหัสผ่านผ่าน Finance Worker; browser ต้องส่งรหัสผ่านตรงไป Supabase Auth เท่านั้น
- สมัครบัญชีใหม่แล้วต้องได้ session ทันที; ถ้า Supabase ไม่คืน session ให้แสดง configuration error และห้ามแสดงว่าสมัครสำเร็จ
- ฟอร์มสมัครต้องมี `password` และ `confirmPassword` และต้องเท่ากันก่อนเรียก Supabase
- การสมัครต้องส่ง Turnstile token ด้วย `options.captchaToken`; token หมดอายุหรือใช้แล้วต้องให้ widget สร้าง token ใหม่
- `TURNSTILE_SITE_KEY` เป็นค่า public ที่ส่งผ่าน `/config`; secret key อยู่ใน Supabase CAPTCHA settings เท่านั้นและห้ามอยู่ใน repository หรือ Worker response
- ทุก `/v1/admin/users*` endpoint ต้องตรวจ JWT และตรวจ `actor.userId === SUPER_ADMIN_USER_ID`
- ห้ามระงับหรือลบ Super Admin และห้าม Super Admin ระงับหรือลบบัญชีที่กำลังใช้ดำเนินการ
- การลบถาวรต้องรับอีเมลที่ normalized แล้วตรงกับบัญชีเป้าหมายและต้องรับ `clientMutationId` แบบ UUID
- ลบได้เฉพาะ private workspace; ถ้าผู้ใช้เป็น owner/member/author ของ shared หรือ family workspace ให้ตอบ `USER_SHARED_DATA_CONFLICT` โดยไม่ลบข้อมูล
- การลบต้อง retry ได้: หลังตั้ง `baan_ngern_dee_deletion_pending=true` ผู้ใช้ต้องถูก ban แม้ขั้นลบ Auth user ล้มเหลว
- Error contracts สำหรับส่วนนี้ต้องมี `USER_NOT_FOUND`, `USER_PROTECTED`, `USER_EMAIL_MISMATCH`, `USER_DELETION_PENDING`, `USER_SHARED_DATA_CONFLICT`, `USER_ADMIN_RATE_LIMITED` และ `USER_ADMIN_ACTION_FAILED`
- Password reset ต้องใช้ recovery email มาตรฐานของ Supabase; API และ audit log ห้ามเก็บหรือคืน reset link, token หรือรหัสผ่าน
- `user_admin_audit` เปิดให้ Service Role เท่านั้นและต้องไม่บันทึก access token, password, CAPTCHA token หรือ Supabase keys
- ไม่เพิ่ม dependency ฝั่งเว็บสำหรับ Turnstile; ใช้ official script `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit`
- การเปลี่ยน Supabase production, migration remote, Cloudflare variables และ deploy ต้องหยุดขออนุมัติผู้ใช้อีกครั้งก่อนดำเนินการ

## File Map

### Shared contracts

- Create `packages/contracts/src/user-management.ts`: schemas และ types สำหรับรายชื่อผู้ใช้, pagination และ admin mutations
- Modify `packages/contracts/src/cloud.ts`: เพิ่ม public Turnstile site key
- Modify `packages/contracts/src/invitations.ts`: เพิ่ม `canManageUsers` ใน capabilities เดิม
- Modify `packages/contracts/src/errors.ts`: เพิ่ม user-management error codes
- Modify `packages/contracts/src/index.ts`: export contracts ใหม่
- Create `packages/contracts/test/user-management.test.ts`: contract tests
- Modify `packages/contracts/test/cloud.test.ts`: public config test
- Modify `packages/contracts/test/invitations.test.ts`: capability strictness test

### Database

- Create `supabase/migrations/202607280014_user_management.sql`: audit table, Service Role RPCs, deletion constraints และแก้ FK ของ invitation
- Create `supabase/tests/database/user_management.test.sql`: pgTAP coverage สำหรับ privilege, listing, shared-data guard, purge idempotency และ audit
- Create `workers/api/test/user-management-database.test.ts`: PGlite regression test
- Modify `package.json`: เพิ่ม PGlite database test ใน `test:db`

### Worker

- Create `workers/api/src/services/user-management-service.ts`: authorization และ state machine
- Create `workers/api/src/services/supabase-user-management-repository.ts`: RPC adapter
- Create `workers/api/src/services/supabase-user-auth-admin.ts`: Supabase Auth Admin adapter
- Create `workers/api/src/routes/users.ts`: Hono routes และ request validation
- Modify `workers/api/src/services/invitation-service.ts`: capabilities เพิ่ม user management
- Modify `workers/api/src/app.ts`: dependency และ route wiring
- Modify `workers/api/src/index.ts`: instantiate adapters/service และ expose Turnstile key
- Modify `workers/api/src/types.ts`: เพิ่ม `TURNSTILE_SITE_KEY`
- Create `workers/api/test/user-management-service.test.ts`
- Create `workers/api/test/supabase-user-management-repository.test.ts`
- Create `workers/api/test/supabase-user-auth-admin.test.ts`
- Create `workers/api/test/user-management.test.ts`
- Modify `workers/api/test/invitations.test.ts`: capability response regression
- Modify `workers/api/test/app.test.ts`: public config regression

### Web

- Modify `apps/web/src/lib/cloud-auth.ts`: instant signup, CAPTCHA และ stable auth error mapping
- Modify `apps/web/src/lib/cloud-auth.test.ts`
- Create `apps/web/src/features/auth/turnstile-widget.tsx`: official Turnstile lifecycle
- Create `apps/web/src/features/auth/turnstile-widget.test.tsx`
- Modify `apps/web/src/features/auth/sign-in-page.tsx`: confirm password, CAPTCHA และ actionable messages
- Modify `apps/web/src/features/auth/sign-in-page.test.tsx`
- Create `apps/web/src/lib/user-management-api.ts`: authenticated admin API client
- Create `apps/web/src/lib/user-management-api.test.ts`
- Create `apps/web/src/features/admin/users-page.tsx`: search/list/actions/delete confirmation
- Create `apps/web/src/features/admin/users-page.test.tsx`
- Modify `apps/web/src/app/router.tsx`: API lifecycle และ `/admin/users`
- Modify `apps/web/src/app/router.test.tsx`
- Modify `apps/web/src/app/layout.tsx`: navigation capability
- Modify `apps/web/src/app/layout.test.tsx`
- Modify `apps/web/src/styles.css`: responsive user table/dialog/Turnstile styles
- Modify `apps/web/src/styles.test.ts`

### Configuration and operations

- Modify `supabase/config.toml`: local email autoconfirm
- Modify `.dev.vars.example`: local Turnstile site key
- Modify `wrangler.jsonc`: required public binding
- Create `docs/deployment/user-management-rollout.md`: ordered rollout, rollback และ friend-account recovery

---

### Task 1: Shared Contracts for Signup Configuration and User Administration

**Files:**
- Create: `packages/contracts/src/user-management.ts`
- Modify: `packages/contracts/src/cloud.ts`
- Modify: `packages/contracts/src/invitations.ts`
- Modify: `packages/contracts/src/errors.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/test/user-management.test.ts`
- Test: `packages/contracts/test/cloud.test.ts`
- Test: `packages/contracts/test/invitations.test.ts`

**Interfaces:**
- Consumes: Zod conventions and strict object schemas already used by `@systems-credit/contracts`
- Produces: `AdminUser`, `AdminUserStatus`, `ListAdminUsersQuery`, `AdminUserListResponse`, `AdminUserMutationResponse`, `DeleteAdminUserInput`, `listAdminUsersQuerySchema`, `deleteAdminUserSchema`, `turnstileSiteKey`, and `AdminCapabilities.canManageUsers`

- [ ] **Step 1: Write failing contract tests**

```ts
import {
  adminUserListResponseSchema,
  deleteAdminUserSchema,
  listAdminUsersQuerySchema
} from "../src";

it("normalizes search and validates cursor pagination", () => {
  expect(
    listAdminUsersQuerySchema.parse({
      search: "  Friend@Example.COM ",
      limit: "25",
      cursor: "2026-07-28T10:00:00.000Z|00000000-0000-4000-8000-000000000001"
    })
  ).toEqual({
    search: "friend@example.com",
    limit: 25,
    cursor: "2026-07-28T10:00:00.000Z|00000000-0000-4000-8000-000000000001"
  });
});

it("requires exact normalized email and a UUID for permanent deletion", () => {
  expect(
    deleteAdminUserSchema.parse({
      email: " FRIEND@Example.com ",
      clientMutationId: "00000000-0000-4000-8000-000000000002"
    })
  ).toEqual({
    email: "friend@example.com",
    clientMutationId: "00000000-0000-4000-8000-000000000002"
  });
});

it("parses all admin user states", () => {
  expect(
    adminUserListResponseSchema.parse({
      users: [{
        userId: "00000000-0000-4000-8000-000000000003",
        email: "friend@example.com",
        displayName: "Friend",
        status: "deletion_pending",
        createdAt: "2026-07-28T10:00:00.000Z",
        privateWorkspaceCount: 1,
        deletionPending: true
      }],
      nextCursor: null
    }).users[0]?.status
  ).toBe("deletion_pending");
});
```

Add assertions to existing tests that `/config` requires `turnstileSiteKey` and capabilities require both booleans.

- [ ] **Step 2: Run the contract tests and verify they fail**

Run: `npm test -w @systems-credit/contracts -- --run test/user-management.test.ts test/cloud.test.ts test/invitations.test.ts`

Expected: FAIL because the new schemas and properties are not exported.

- [ ] **Step 3: Implement the exact schemas and exports**

Create `user-management.ts` with:

```ts
import { z } from "zod";

const uuidSchema = z.string().uuid();
const timestampSchema = z.string().datetime({ offset: true });
const normalizedEmailSchema = z.string().trim().email()
  .transform((value) => value.toLowerCase());

export const adminUserStatusSchema = z.enum([
  "unconfirmed",
  "active",
  "suspended",
  "deletion_pending"
]);
export type AdminUserStatus = z.infer<typeof adminUserStatusSchema>;

export const adminUserSchema = z.object({
  userId: uuidSchema,
  email: normalizedEmailSchema,
  displayName: z.string().min(1).max(80),
  status: adminUserStatusSchema,
  createdAt: timestampSchema,
  lastSignInAt: timestampSchema.optional(),
  emailConfirmedAt: timestampSchema.optional(),
  bannedUntil: timestampSchema.optional(),
  privateWorkspaceCount: z.number().int().nonnegative(),
  deletionPending: z.boolean()
}).strict();
export type AdminUser = z.infer<typeof adminUserSchema>;

export const listAdminUsersQuerySchema = z.object({
  search: z.string().trim().max(120)
    .transform((value) => value.toLowerCase())
    .default(""),
  limit: z.coerce.number().int().min(1).max(50).default(25),
  cursor: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}T[^|]+\|[0-9a-f-]{36}$/i)
    .optional()
}).strict();
export type ListAdminUsersQuery = z.infer<
  typeof listAdminUsersQuerySchema
>;

export const adminUserListResponseSchema = z.object({
  users: z.array(adminUserSchema),
  nextCursor: z.string().nullable()
}).strict();
export type AdminUserListResponse = z.infer<
  typeof adminUserListResponseSchema
>;

export const adminUserMutationResponseSchema = z.object({
  user: adminUserSchema
}).strict();
export type AdminUserMutationResponse = z.infer<
  typeof adminUserMutationResponseSchema
>;

export const deleteAdminUserSchema = z.object({
  email: normalizedEmailSchema,
  clientMutationId: uuidSchema
}).strict();
export type DeleteAdminUserInput = z.infer<
  typeof deleteAdminUserSchema
>;
```

Add `turnstileSiteKey: z.string().min(1)` to `publicAppConfigSchema`, add `canManageUsers: z.boolean()` to `adminCapabilitiesSchema`, add the seven exact user-management error codes listed in Global Constraints, and export `./user-management` from `src/index.ts`.

- [ ] **Step 4: Run contract tests and typecheck**

Run: `npm test -w @systems-credit/contracts`

Expected: PASS.

Run: `npm run typecheck -w @systems-credit/contracts`

Expected: PASS.

- [ ] **Step 5: Commit the contract slice**

```powershell
git add packages/contracts
git commit -m "feat: define user management contracts"
```

---

### Task 2: Instant Signup, Password Confirmation, and Turnstile

**Files:**
- Modify: `apps/web/src/lib/cloud-auth.ts`
- Modify: `apps/web/src/lib/cloud-auth.test.ts`
- Create: `apps/web/src/features/auth/turnstile-widget.tsx`
- Create: `apps/web/src/features/auth/turnstile-widget.test.tsx`
- Modify: `apps/web/src/features/auth/sign-in-page.tsx`
- Modify: `apps/web/src/features/auth/sign-in-page.test.tsx`

**Interfaces:**
- Consumes: `PublicAppConfig.turnstileSiteKey`
- Produces: `CloudAuth.signUp(input: { displayName: string; email: string; password: string; captchaToken: string }): Promise<CloudSession>`, `CloudAuthFailure`, and `TurnstileWidget`

- [ ] **Step 1: Write failing cloud-auth tests**

Mock `createClient` and assert:

```ts
await auth.signUp({
  displayName: "Friend",
  email: "friend@example.com",
  password: "correct horse",
  captchaToken: "turnstile-token"
});

expect(signUp).toHaveBeenCalledWith({
  email: "friend@example.com",
  password: "correct horse",
  options: {
    data: { display_name: "Friend" },
    captchaToken: "turnstile-token"
  }
});
```

Add a second test returning `{ data: { session: null }, error: null }` and expect a `CloudAuthFailure` with code `AUTH_SIGNUP_SESSION_REQUIRED`. Add table tests mapping Supabase codes `user_already_exists`, `email_exists`, `email_not_confirmed`, `invalid_credentials`, `user_banned`, `weak_password`, `captcha_failed`, and `over_request_rate_limit` to stable app codes. Simulate a rejected `fetch`/Supabase promise and assert `AUTH_NETWORK_UNAVAILABLE`.

- [ ] **Step 2: Write failing UI tests**

Use Testing Library to verify:

```ts
await user.type(screen.getByLabelText("รหัสผ่าน"), "password-123");
await user.type(screen.getByLabelText("ยืนยันรหัสผ่าน"), "password-456");
await user.click(screen.getByRole("button", { name: "สร้างบัญชี" }));
expect(auth.signUp).not.toHaveBeenCalled();
expect(screen.getByRole("alert")).toHaveTextContent("รหัสผ่านไม่ตรงกัน");
```

Add cases for missing CAPTCHA, expired CAPTCHA, successful signup calling `onAuthenticated`, and specific Thai messages for duplicate email, waiting-for-admin confirmation, invalid credentials, suspended account, weak password, CAPTCHA failure, rate limiting, and network failure. Verify upstream signup never receives `confirmPassword`, and password plus confirmation fields are cleared after every upstream signup/sign-in attempt while display name and email remain.

- [ ] **Step 3: Run focused web tests and verify they fail**

Run: `npx vitest run apps/web/src/lib/cloud-auth.test.ts apps/web/src/features/auth/turnstile-widget.test.tsx apps/web/src/features/auth/sign-in-page.test.tsx`

Expected: FAIL because the new input, component, and confirmation field do not exist.

- [ ] **Step 4: Implement stable auth errors and instant signup**

Add:

```ts
export type CloudAuthErrorCode =
  | "AUTH_EMAIL_EXISTS"
  | "AUTH_EMAIL_NOT_CONFIRMED"
  | "AUTH_INVALID_CREDENTIALS"
  | "AUTH_USER_SUSPENDED"
  | "AUTH_WEAK_PASSWORD"
  | "AUTH_CAPTCHA_FAILED"
  | "AUTH_RATE_LIMITED"
  | "AUTH_NETWORK_UNAVAILABLE"
  | "AUTH_SIGNUP_SESSION_REQUIRED"
  | "AUTH_UNKNOWN";

export class CloudAuthFailure extends Error {
  constructor(readonly code: CloudAuthErrorCode) {
    super(code);
    this.name = "CloudAuthFailure";
  }
}
```

Map Supabase `AuthError.code` without copying raw server messages into the UI. Change `signUp` to pass `captchaToken`, remove `emailRedirectTo`, require a mapped session, and return only `CloudSession`.

- [ ] **Step 5: Implement the isolated Turnstile component**

Declare the minimum global interface:

```ts
type TurnstileApi = {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      callback(token: string): void;
      "expired-callback"(): void;
      "error-callback"(): void;
      theme: "auto";
    }
  ): string;
  remove(widgetId: string): void;
  reset(widgetId: string): void;
};
```

`TurnstileWidget` must load the official script once, render explicitly, call `onToken("")` on expiry/error, remove its widget on unmount, and expose `resetKey` so the signup page can force a fresh token after every submission attempt.

- [ ] **Step 6: Implement signup confirmation and actionable messages**

Add `confirmPassword` and `captchaToken` state. Only render Turnstile in signup mode. Validate in this order: email, display name, password length, exact confirmation match, CAPTCHA token. After a failed signup, clear the token and increment `turnstileResetKey`. On success, call `onAuthenticated(session)` directly and remove the old confirmation-email success branch.

Use these Thai messages:

```ts
const authMessages = {
  AUTH_EMAIL_EXISTS: "อีเมลนี้มีบัญชีอยู่แล้ว กรุณาเข้าสู่ระบบหรือกดลืมรหัสผ่าน",
  AUTH_EMAIL_NOT_CONFIRMED:
    "บัญชีนี้ยังไม่ยืนยัน กรุณาให้ผู้ดูแลระบบยืนยันบัญชีให้",
  AUTH_INVALID_CREDENTIALS: "อีเมลหรือรหัสผ่านไม่ถูกต้อง",
  AUTH_USER_SUSPENDED: "บัญชีนี้ถูกระงับ กรุณาติดต่อผู้ดูแลระบบ",
  AUTH_WEAK_PASSWORD: "รหัสผ่านไม่ผ่านนโยบายความปลอดภัย กรุณาใช้รหัสที่เดายากขึ้น",
  AUTH_CAPTCHA_FAILED: "การตรวจสอบความปลอดภัยไม่สำเร็จ กรุณาลองใหม่",
  AUTH_RATE_LIMITED: "ลองหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่",
  AUTH_NETWORK_UNAVAILABLE:
    "ยังเชื่อมต่อระบบบัญชีไม่ได้ กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่",
  AUTH_SIGNUP_SESSION_REQUIRED:
    "สร้างบัญชีแล้วแต่ยังเข้าใช้งานไม่ได้ กรุณาให้ผู้ดูแลตรวจการตั้งค่า Confirm Email"
} as const;
```

Clear `password` and `confirmPassword` in `finally` after an upstream sign-in/signup attempt. Do not clear display name or email, and do not clear any password field when validation stops the request locally.

- [ ] **Step 7: Run focused tests and typecheck**

Run: `npx vitest run apps/web/src/lib/cloud-auth.test.ts apps/web/src/features/auth/turnstile-widget.test.tsx apps/web/src/features/auth/sign-in-page.test.tsx`

Expected: PASS.

Run: `npm run typecheck -w @systems-credit/web`

Expected: FAIL only where router has not supplied `turnstileSiteKey`; record the exact compiler locations for Task 8, while all files in this task have no local type errors.

- [ ] **Step 8: Commit the authentication slice**

```powershell
git add apps/web/src/lib/cloud-auth.ts apps/web/src/lib/cloud-auth.test.ts apps/web/src/features/auth
git commit -m "feat: add instant protected signup"
```

---

### Task 3: User Management Database Boundary

**Files:**
- Create: `supabase/migrations/202607280014_user_management.sql`
- Create: `supabase/tests/database/user_management.test.sql`
- Create: `workers/api/test/user-management-database.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: Supabase `auth.users`, `profiles`, `workspaces`, `workspace_members`, all finance tables, and `user_invitations`
- Produces: `public.user_admin_audit`, `public.list_admin_users(text, integer, timestamptz, uuid)`, `public.record_user_admin_action(uuid, uuid, text, jsonb)`, `public.get_user_deletion_state(uuid, uuid)`, `public.purge_private_user_data(uuid, uuid, uuid, text)`, and `public.complete_user_deletion(uuid, uuid, uuid)`

- [ ] **Step 1: Write failing pgTAP tests**

Cover these exact assertions:

1. `anon` and `authenticated` cannot select/insert/update/delete `user_admin_audit`.
2. Service Role can execute both RPCs.
3. Listing derives `unconfirmed`, `active`, `suspended`, and `deletion_pending` from Auth fields and app metadata.
4. Search matches normalized email and display name.
5. Pagination orders by `created_at DESC, id DESC` and returns no duplicate row at the cursor boundary.
6. Purge deletes the target user's private workspaces and cascaded finance rows.
7. Purge rejects ownership, membership, or authored data in `shared`/`family` workspaces with SQLSTATE `P0001` and message `USER_SHARED_DATA_CONFLICT`.
8. A repeated `clientMutationId` returns the prior purge result without a second purge, while `completed_at` remains null until Auth deletion is acknowledged.
9. `complete_user_deletion` sets `completed_at`; calling it again is idempotent.
10. `record_user_admin_action` stores confirm/suspend/resume/reset actions and rejects a second password reset for the same actor/target within 60 seconds with `USER_ADMIN_RATE_LIMITED`.
11. `user_invitations.redeemed_user_id` becomes `ON DELETE SET NULL`.

- [ ] **Step 2: Write the failing PGlite regression test**

Create an `auth.users` compatibility table with:

```sql
create schema auth;
create table auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  raw_app_meta_data jsonb default '{}'::jsonb,
  email_confirmed_at timestamptz,
  banned_until timestamptz,
  last_sign_in_at timestamptz,
  created_at timestamptz not null default now()
);
```

Load migrations through `202607280014_user_management.sql`, seed one private and one shared user, and test list/purge/idempotency using the same fixtures.

- [ ] **Step 3: Run database tests and verify they fail**

Run: `supabase test db`

Expected: FAIL because migration 014 and the RPCs do not exist.

Run: `npx vitest run workers/api/test/user-management-database.test.ts`

Expected: FAIL for the same reason.

- [ ] **Step 4: Implement migration 014**

Create `user_admin_audit` with UUID primary key, unique `client_mutation_id` when non-null, `actor_user_id`, `target_user_id`, enum-constrained `action`, JSONB `details`, `created_at`, `purge_completed_at`, and `completed_at`. The actor/target columns deliberately do not reference `auth.users`, so deletion history survives. Enable RLS, revoke all from `public`/`anon`/`authenticated`, grant table/RPC access only to `service_role`, and set every security-definer function to `search_path = public, auth, pg_temp`.

`list_admin_users` must:

- accept normalized search, bounded limit, cursor timestamp, cursor UUID;
- derive status with priority `deletion_pending`, `suspended`, `unconfirmed`, `active`;
- use `coalesce(profile.display_name, split_part(email, '@', 1))`;
- count only `workspaces.kind = 'private'`;
- fetch `limit + 1` rows so the Worker can derive `nextCursor`.

`purge_private_user_data` must:

- obtain `pg_advisory_xact_lock(hashtextextended(target_user_id::text, 0))`;
- return the existing purge result for the same target and `clientMutationId`;
- reject shared/family ownership/membership plus authorship in `categories.created_by`, `tags.created_by`, `merchants.created_by`, `audit_events.actor_user_id`, `accounts.created_by`, `transactions.created_by`, `transactions.voided_by`, `transfers.created_by`, `installment_contracts.created_by`, `installment_payments.created_by`, `installment_payoffs.created_by`, and `recurring_templates.created_by`;
- insert an audit row before deletion;
- delete private workspaces owned by the target and rely on existing cascades;
- delete any remaining safe `workspace_members` and `profiles` rows for the target after the private-workspace cascade;
- set `purge_completed_at` and details `{ "email": normalizedEmail, "privateWorkspacesDeleted": number }`, leaving `completed_at` null;
- return that count.

`record_user_admin_action` must accept only `confirmed`, `suspended`, `resumed`, and `password_reset_requested`; for reset it must lock the actor/target pair and raise `USER_ADMIN_RATE_LIMITED` if the previous reset audit is newer than 60 seconds. `get_user_deletion_state` returns `purgeCompleted` and `completed` only for the exact target/mutation pair. `complete_user_deletion` locks that audit row and sets `completed_at` after the Auth Admin delete returns success.

Drop and recreate `user_invitations_redeemed_user_id_fkey` with `ON DELETE SET NULL`.

- [ ] **Step 5: Add the PGlite test to the root database script**

Append `workers/api/test/user-management-database.test.ts` to the explicit file list in `test:db`.

- [ ] **Step 6: Run both database suites**

Run: `npx vitest run workers/api/test/user-management-database.test.ts`

Expected: PASS.

Run: `supabase test db`

Expected: PASS when local Supabase is running; if Docker is unavailable, record that environment limitation and do not claim pgTAP verification.

- [ ] **Step 7: Commit the database slice**

```powershell
git add supabase/migrations/202607280014_user_management.sql supabase/tests/database/user_management.test.sql workers/api/test/user-management-database.test.ts package.json
git commit -m "feat: add user management database boundary"
```

---

### Task 4: User Management Domain Service

**Files:**
- Create: `workers/api/src/services/user-management-service.ts`
- Create: `workers/api/test/user-management-service.test.ts`

**Interfaces:**
- Consumes: contracts from Task 1
- Produces: `UserManagementService`, `UserManagementRepository`, `UserAuthAdmin`, and `createUserManagementService`

- [ ] **Step 1: Write failing service tests with in-memory fakes**

Test all branches:

- non-Super Admin gets `SUPER_ADMIN_REQUIRED`;
- list passes normalized query to repository;
- confirm updates a legacy unconfirmed user;
- suspend/resume reject self and configured Super Admin with `USER_PROTECTED`;
- resume rejects a deletion-pending target with `USER_DELETION_PENDING`;
- password reset passes only target email to auth adapter;
- password reset reserves an audited 60-second actor/target rate-limit slot before contacting Supabase;
- deletion rejects mismatched email before mutation;
- deletion rejects shared-data conflict before Auth deletion;
- deletion calls `markDeletionPending`, then `purgePrivateData`, then `deleteUser`, then `completeDeletion`;
- Auth deletion failure leaves the target pending/banned;
- retry of a pending target skips `markDeletionPending`, calls idempotent purge, then retries Auth deletion;
- retry after Auth deletion succeeded but audit completion failed treats Auth 404 plus a matching purged mutation as success and completes the audit;
- a completed target/mutation returns success without another Auth or database mutation.

Assert the operation sequence explicitly:

```ts
expect(events).toEqual([
  "repository.getDeletionState",
  "auth.getUser",
  "auth.markDeletionPending",
  "repository.purgePrivateData",
  "auth.deleteUser",
  "repository.completeDeletion"
]);
```

- [ ] **Step 2: Run the focused service test and verify it fails**

Run: `npx vitest run workers/api/test/user-management-service.test.ts`

Expected: FAIL because the service module does not exist.

- [ ] **Step 3: Define the service ports**

```ts
export interface UserManagementRepository {
  list(input: ListAdminUsersQuery): Promise<AdminUserListResponse>;
  recordAction(input: {
    actorUserId: string;
    targetUserId: string;
    action: "confirmed" | "suspended" | "resumed" | "password_reset_requested";
    details: Readonly<Record<string, string | number | boolean>>;
  }): Promise<void>;
  getDeletionState(input: {
    targetUserId: string;
    clientMutationId: string;
  }): Promise<{
    purgeCompleted: boolean;
    completed: boolean;
  } | null>;
  purgePrivateData(input: {
    actorUserId: string;
    targetUserId: string;
    clientMutationId: string;
    normalizedEmail: string;
  }): Promise<{ privateWorkspacesDeleted: number }>;
  completeDeletion(input: {
    actorUserId: string;
    targetUserId: string;
    clientMutationId: string;
  }): Promise<void>;
}

export interface UserAuthAdmin {
  getUser(userId: string): Promise<AdminUser>;
  confirmUser(userId: string): Promise<AdminUser>;
  suspendUser(userId: string): Promise<AdminUser>;
  resumeUser(userId: string): Promise<AdminUser>;
  sendPasswordReset(email: string): Promise<void>;
  markDeletionPending(userId: string): Promise<AdminUser>;
  deleteUser(userId: string): Promise<void>;
}

export interface UserManagementService {
  list(actor: InvitationActor, query: ListAdminUsersQuery):
    Promise<AdminUserListResponse>;
  confirm(actor: InvitationActor, userId: string):
    Promise<AdminUserMutationResponse>;
  suspend(actor: InvitationActor, userId: string):
    Promise<AdminUserMutationResponse>;
  resume(actor: InvitationActor, userId: string):
    Promise<AdminUserMutationResponse>;
  sendPasswordReset(actor: InvitationActor, userId: string):
    Promise<void>;
  delete(actor: InvitationActor, userId: string, input: DeleteAdminUserInput):
    Promise<void>;
}
```

- [ ] **Step 4: Implement authorization and deletion state machine**

Use one `requireSuperAdmin` guard and one `requireMutableTarget` guard. Confirm/suspend/resume record a successful audit after the Auth mutation. Password reset calls `recordAction(..., "password_reset_requested", {})` before Supabase; the repository's database function supplies the distributed 60-second rate limit.

For deletion, normalize both email values before exact comparison and follow this exact algorithm:

```ts
const state = await repository.getDeletionState({
  targetUserId: userId,
  clientMutationId: input.clientMutationId
});
if (state?.completed) return;

let target: AdminUser;
try {
  target = await authAdmin.getUser(userId);
} catch (error) {
  if (isUserNotFound(error) && state?.purgeCompleted) {
    await repository.completeDeletion({
      actorUserId: actor.userId,
      targetUserId: userId,
      clientMutationId: input.clientMutationId
    });
    return;
  }
  throw error;
}

requireMutableTarget(actor, target);
if (target.email.trim().toLowerCase() !== input.email) {
  throw new ApiError("USER_EMAIL_MISMATCH", 409, "อีเมลยืนยันไม่ตรงกับบัญชี");
}
if (!target.deletionPending) await authAdmin.markDeletionPending(userId);
await repository.purgePrivateData({
  actorUserId: actor.userId,
  targetUserId: userId,
  clientMutationId: input.clientMutationId,
  normalizedEmail: input.email
});
await authAdmin.deleteUser(userId);
await repository.completeDeletion({
  actorUserId: actor.userId,
  targetUserId: userId,
  clientMutationId: input.clientMutationId
});
```

Convert port failures only to defined `ApiErrorCode` values and preserve `USER_SHARED_DATA_CONFLICT` and `USER_ADMIN_RATE_LIMITED`.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `npx vitest run workers/api/test/user-management-service.test.ts`

Expected: PASS.

Run: `npm run typecheck -w @systems-credit/api`

Expected: PASS for the new service; wiring is added in Task 6.

- [ ] **Step 6: Commit the service slice**

```powershell
git add workers/api/src/services/user-management-service.ts workers/api/test/user-management-service.test.ts
git commit -m "feat: add user management service"
```

---

### Task 5: Supabase Repository and Auth Admin Adapters

**Files:**
- Create: `workers/api/src/services/supabase-user-management-repository.ts`
- Create: `workers/api/src/services/supabase-user-auth-admin.ts`
- Create: `workers/api/test/supabase-user-management-repository.test.ts`
- Create: `workers/api/test/supabase-user-auth-admin.test.ts`

**Interfaces:**
- Consumes: `SupabaseAdminConfig` from `supabase-invitation-repository.ts` and service ports from Task 4
- Produces: `createSupabaseUserManagementRepository(config)` and `createSupabaseUserAuthAdmin(config)`

- [ ] **Step 1: Write failing repository adapter tests**

Mock `fetch` and verify:

- list POSTs `/rest/v1/rpc/list_admin_users`, validates the returned rows, drops the extra row, and constructs `nextCursor` from the last visible `createdAt|userId`;
- action audit POSTs `/rest/v1/rpc/record_user_admin_action` and maps `USER_ADMIN_RATE_LIMITED`;
- deletion-state lookup POSTs `/rest/v1/rpc/get_user_deletion_state`;
- purge POSTs `/rest/v1/rpc/purge_private_user_data` with actor, target, mutation ID, and normalized email in snake_case SQL parameter names;
- completion POSTs `/rest/v1/rpc/complete_user_deletion`;
- PostgREST message `USER_SHARED_DATA_CONFLICT` maps to `ApiError("USER_SHARED_DATA_CONFLICT", 409, ...)`;
- malformed Supabase payload maps to `USER_ADMIN_ACTION_FAILED`.

- [ ] **Step 2: Write failing Auth Admin adapter tests**

Mock these exact requests:

- `GET /auth/v1/admin/users/{userId}`;
- `PUT /auth/v1/admin/users/{userId}` with `{ email_confirm: true }`;
- suspend with `{ ban_duration: "876000h" }`;
- resume with `{ ban_duration: "none" }`;
- pending deletion with `{ ban_duration: "876000h", app_metadata: { baan_ngern_dee_deletion_pending: true } }` while preserving existing app metadata;
- password recovery `POST /auth/v1/recover` with `{ email }`;
- `DELETE /auth/v1/admin/users/{userId}?should_soft_delete=false`.

Every request must include `apikey: serviceRoleKey` and `Authorization: Bearer serviceRoleKey`.

- [ ] **Step 3: Run focused adapter tests and verify they fail**

Run: `npx vitest run workers/api/test/supabase-user-management-repository.test.ts workers/api/test/supabase-user-auth-admin.test.ts`

Expected: FAIL because both adapters are missing.

- [ ] **Step 4: Implement the repository adapter**

Create Zod schemas for RPC snake_case rows and map them to `AdminUser`. Pass:

```ts
{
  search_text: input.search,
  page_limit: input.limit + 1,
  cursor_created_at: parsedCursor?.createdAt ?? null,
  cursor_user_id: parsedCursor?.userId ?? null
}
```

Parse cursors by splitting at the final `|`, reject invalid values as `VALIDATION_FAILED`, and never log the Service Role key or response headers.

Implement all four mutation RPC methods from `UserManagementRepository`. Treat PostgREST `P0001` messages `USER_SHARED_DATA_CONFLICT` and `USER_ADMIN_RATE_LIMITED` as their matching 409/429 `ApiError`; map all other database errors to `USER_ADMIN_ACTION_FAILED`. `getDeletionState` returns `null` for an empty result and rejects multiple rows as an invalid upstream payload.

- [ ] **Step 5: Implement the Auth Admin adapter**

Map Supabase Auth user fields into `AdminUser` using:

```ts
const deletionPending =
  user.app_metadata?.baan_ngern_dee_deletion_pending === true;
const status = deletionPending
  ? "deletion_pending"
  : user.banned_until && Date.parse(user.banned_until) > Date.now()
    ? "suspended"
    : !user.email_confirmed_at
      ? "unconfirmed"
      : "active";
```

Fetch the current user before updating app metadata. Use `privateWorkspaceCount: 0` in single-user mutation responses because authoritative counts come from the list RPC. Map 404 to `USER_NOT_FOUND`, 429 to `USER_ADMIN_RATE_LIMITED`, and other non-2xx responses to `USER_ADMIN_ACTION_FAILED`.

For `confirmUser`, `suspendUser`, and `resumeUser`, treat an already-achieved state as success. `resumeUser` must reject metadata `baan_ngern_dee_deletion_pending === true` with `USER_DELETION_PENDING` before sending an update. Catch network failures and map them to `USER_ADMIN_ACTION_FAILED` without including upstream bodies in logs or error messages.

- [ ] **Step 6: Run adapter tests and typecheck**

Run: `npx vitest run workers/api/test/supabase-user-management-repository.test.ts workers/api/test/supabase-user-auth-admin.test.ts`

Expected: PASS.

Run: `npm run typecheck -w @systems-credit/api`

Expected: PASS.

- [ ] **Step 7: Commit the adapters**

```powershell
git add workers/api/src/services/supabase-user-management-repository.ts workers/api/src/services/supabase-user-auth-admin.ts workers/api/test/supabase-user-management-repository.test.ts workers/api/test/supabase-user-auth-admin.test.ts
git commit -m "feat: connect user management to supabase"
```

---

### Task 6: Worker Routes, Capabilities, and Configuration

**Files:**
- Create: `workers/api/src/routes/users.ts`
- Create: `workers/api/test/user-management.test.ts`
- Modify: `workers/api/src/services/invitation-service.ts`
- Modify: `workers/api/src/app.ts`
- Modify: `workers/api/src/index.ts`
- Modify: `workers/api/src/types.ts`
- Modify: `workers/api/test/invitations.test.ts`
- Modify: `workers/api/test/app.test.ts`

**Interfaces:**
- Consumes: Task 1 request schemas, Task 4 service, Task 5 adapters
- Produces: seven `/v1/admin/users*` routes, `canManageUsers`, and `/config.turnstileSiteKey`

- [ ] **Step 1: Write failing route tests**

Test:

```text
GET    /v1/admin/users?search=friend&limit=25
POST   /v1/admin/users/{userId}/confirm
POST   /v1/admin/users/{userId}/suspend
POST   /v1/admin/users/{userId}/resume
POST   /v1/admin/users/{userId}/password-reset
DELETE /v1/admin/users/{userId}
```

Assert JWT middleware is required, UUID route params are validated, query/body schemas reject unknown keys, status codes are 200/204, and the DELETE body reaches `service.delete`. Add regression assertions that `/v1/admin/capabilities` returns both booleans and `/config` returns `turnstileSiteKey`.

- [ ] **Step 2: Run route tests and verify they fail**

Run: `npx vitest run workers/api/test/user-management.test.ts workers/api/test/invitations.test.ts workers/api/test/app.test.ts`

Expected: FAIL because routes, capability field, and config property are missing.

- [ ] **Step 3: Implement routes**

Use `listAdminUsersQuerySchema.safeParse(Object.fromEntries(new URL(context.req.url).searchParams))`, the shared delete schema, and a local UUID schema for path params. Return:

```ts
routes.get("/users", async (context) =>
  context.json(await service.list(context.get("auth"), validQuery(context))));
routes.post("/users/:userId/confirm", mutation(service.confirm));
routes.post("/users/:userId/suspend", mutation(service.suspend));
routes.post("/users/:userId/resume", mutation(service.resume));
routes.post("/users/:userId/password-reset", noContent(service.sendPasswordReset));
routes.delete("/users/:userId", async (context) => {
  await service.delete(
    context.get("auth"),
    validUserId(context.req.param("userId")),
    await validDeleteBody(context)
  );
  return context.body(null, 204);
});
```

Bind methods with closures so `this` is never lost.

- [ ] **Step 4: Wire dependencies and configuration**

Add `userManagementService` to `AppDependencies`, mount `adminUserRoutes` below authenticated `/v1/admin`, instantiate both Supabase adapters in `index.ts`, and add `TURNSTILE_SITE_KEY: string` to `Bindings`. Extend invitation capabilities:

```ts
return {
  canManageInvitations: isSuperAdmin,
  canManageUsers: isSuperAdmin
};
```

Return `turnstileSiteKey: context.env.TURNSTILE_SITE_KEY` from `/config`.

- [ ] **Step 5: Run Worker tests, typecheck, and dry build**

Run: `npm test -w @systems-credit/api`

Expected: PASS.

Run: `npm run typecheck -w @systems-credit/api`

Expected: PASS.

Run: `npm run build -w @systems-credit/api`

Expected: PASS with a Wrangler dry-run bundle and no missing local compile-time binding.

- [ ] **Step 6: Commit the Worker HTTP slice**

```powershell
git add workers/api/src workers/api/test
git commit -m "feat: expose super admin user routes"
```

---

### Task 7: Authenticated User Management API Client

**Files:**
- Create: `apps/web/src/lib/user-management-api.ts`
- Create: `apps/web/src/lib/user-management-api.test.ts`

**Interfaces:**
- Consumes: `CloudAuth.refreshSession`, Task 1 schemas, and Task 6 endpoints
- Produces: `UserManagementApi` and `createUserManagementApi`

- [ ] **Step 1: Write failing API client tests**

Test list query encoding, response parsing, each mutation method, empty 204 responses, one token refresh/retry after a 401, structured `ApiErrorResponse` mapping, and malformed response rejection.

The public interface is:

```ts
export interface UserManagementApi {
  list(query: ListAdminUsersQuery): Promise<AdminUserListResponse>;
  confirm(userId: string): Promise<AdminUserMutationResponse>;
  suspend(userId: string): Promise<AdminUserMutationResponse>;
  resume(userId: string): Promise<AdminUserMutationResponse>;
  sendPasswordReset(userId: string): Promise<void>;
  delete(userId: string, input: DeleteAdminUserInput): Promise<void>;
}
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npx vitest run apps/web/src/lib/user-management-api.test.ts`

Expected: FAIL because the client module does not exist.

- [ ] **Step 3: Implement the API client**

Use `encodeURIComponent(userId)` for path segments and `URLSearchParams` for list filters. Send JSON only for DELETE. Parse success payloads with shared schemas. On 401, call the supplied `refreshSession` once and retry with the new access token. Throw a typed `UserManagementApiFailure` containing only `code`, user-safe `message`, and `requestId`.

- [ ] **Step 4: Run test and web typecheck**

Run: `npx vitest run apps/web/src/lib/user-management-api.test.ts`

Expected: PASS.

Run: `npm run typecheck -w @systems-credit/web`

Expected: only Task 8 integration errors may remain; the new client itself must typecheck.

- [ ] **Step 5: Commit the client**

```powershell
git add apps/web/src/lib/user-management-api.ts apps/web/src/lib/user-management-api.test.ts
git commit -m "feat: add user management web client"
```

---

### Task 8: Super Admin Users Screen and App Integration

**Files:**
- Create: `apps/web/src/features/admin/users-page.tsx`
- Create: `apps/web/src/features/admin/users-page.test.tsx`
- Modify: `apps/web/src/app/router.tsx`
- Modify: `apps/web/src/app/router.test.tsx`
- Modify: `apps/web/src/app/layout.tsx`
- Modify: `apps/web/src/app/layout.test.tsx`
- Modify: `apps/web/src/styles.css`
- Modify: `apps/web/src/styles.test.ts`

**Interfaces:**
- Consumes: `UserManagementApi`, `AdminCapabilities.canManageUsers`, and `PublicAppConfig.turnstileSiteKey`
- Produces: route `/admin/users`, navigation item `จัดการผู้ใช้`, search/pagination/actions, and typed-email permanent-delete dialog

- [ ] **Step 1: Write failing page tests**

Use a fake `UserManagementApi` and cover:

- initial loading and 25-row list;
- debounced email/display-name search resets the cursor;
- next page uses `nextCursor`;
- status labels `ยังไม่ยืนยัน`, `ใช้งานอยู่`, `ระงับ`, `กำลังลบ`;
- confirm appears only for unconfirmed accounts;
- suspend appears only for active/unconfirmed accounts;
- resume appears only for suspended accounts;
- reset password asks for confirmation and shows a non-sensitive success toast;
- delete button is disabled for the signed-in user and configured protected user representation;
- permanent delete requires exact email, generates `crypto.randomUUID()`, calls delete, and refreshes the first page;
- `USER_SHARED_DATA_CONFLICT` explains that shared/family ownership or history must be transferred first;
- controls are disabled while their request is pending.

- [ ] **Step 2: Write failing router/layout tests**

Assert `/admin/users` renders only when `canManageUsers` is true, unauthorized navigation redirects to `/overview`, the layout displays `จัดการผู้ใช้`, and `SignInPage` receives `config.turnstileSiteKey`.

- [ ] **Step 3: Run UI tests and verify they fail**

Run: `npx vitest run apps/web/src/features/admin/users-page.test.tsx apps/web/src/app/router.test.tsx apps/web/src/app/layout.test.tsx apps/web/src/styles.test.ts`

Expected: FAIL because the page, route, nav item, and required auth prop do not exist.

- [ ] **Step 4: Implement the focused users page**

Keep server state in:

```ts
type PageState = Readonly<{
  search: string;
  cursor?: string;
}>;
```

Keep a cursor stack for Back/Next, reload after every mutation, and use a native `<dialog>` only if the existing test environment supports it; otherwise render the existing accessible overlay pattern with `role="dialog"` and `aria-modal="true"`. Display email and status in the confirmation header. The destructive button stays disabled until `typedEmail.trim().toLowerCase() === target.email`.

- [ ] **Step 5: Integrate router, capabilities, and navigation**

Create the user API beside the invitation API after authentication. Fetch existing `/v1/admin/capabilities` once and retain both flags. Pass `turnstileSiteKey` into `SignInPage`. Add a protected `/admin/users` route and the layout link without changing invitation behavior.

- [ ] **Step 6: Add responsive styles and stable selectors**

Add scoped classes `.admin-users-*`, `.user-status-*`, `.turnstile-slot`, and `.danger-confirm-*`. At widths under 760px, turn each table row into a labelled card and keep action buttons at least 44px tall. Extend `styles.test.ts` to assert these selectors and the mobile media query exist.

- [ ] **Step 7: Run all web tests, typecheck, and build**

Run: `npx vitest run apps/web/src`

Expected: PASS.

Run: `npm run typecheck -w @systems-credit/web`

Expected: PASS.

Run: `npm run build -w @systems-credit/web`

Expected: PASS and emit `apps/web/dist`.

- [ ] **Step 8: Commit the UI slice**

```powershell
git add apps/web/src
git commit -m "feat: add super admin user management"
```

---

### Task 9: Local Configuration, Rollout Runbook, and Whole-System Verification

**Files:**
- Modify: `supabase/config.toml`
- Modify: `.dev.vars.example`
- Modify: `wrangler.jsonc`
- Create: `docs/deployment/user-management-rollout.md`

**Interfaces:**
- Consumes: all prior tasks
- Produces: reproducible local configuration and an operator-controlled production procedure

- [ ] **Step 1: Write the failing configuration regression assertions**

Extend `workers/api/test/app.test.ts` to fail when `TURNSTILE_SITE_KEY` is absent from the test binding or `/config`. Extend `apps/web/src/lib/cloud-config.test.ts` to reject config without the site key.

- [ ] **Step 2: Run config tests and verify they fail before config edits**

Run: `npx vitest run workers/api/test/app.test.ts apps/web/src/lib/cloud-config.test.ts`

Expected: FAIL until fixtures and runtime config include `turnstileSiteKey`.

- [ ] **Step 3: Configure local instant signup and Turnstile binding**

Set:

```toml
[auth.email]
enable_signup = true
double_confirm_changes = true
enable_confirmations = false
secure_password_change = false
max_frequency = "1m0s"
otp_length = 6
otp_expiry = 3600
```

Add `TURNSTILE_SITE_KEY=1x00000000000000000000AA` to `.dev.vars.example`; this is Cloudflare's always-pass local test site key. Add `TURNSTILE_SITE_KEY` to `wrangler.jsonc` `secrets.required` so Git deploy fails early when the binding is absent, while documenting that the value itself is public.

- [ ] **Step 4: Write the production rollout runbook**

The document must contain these ordered commands and gates:

1. Back up Supabase and record the current Cloudflare deployment version.
2. Run `npx supabase migration list` and verify remote migration 013 is missing before applying it.
3. Run `npx supabase db push --include-all` to apply 013 then 014; inspect both remote entries afterward.
4. Create a Cloudflare Turnstile widget for the production hostname and copy the public site key.
5. In Supabase Authentication CAPTCHA settings, enable Turnstile with the secret key.
6. Add `TURNSTILE_SITE_KEY` to Cloudflare Variables and Secrets using the public site key.
7. Deploy Worker/web and smoke-test `/health`, `/config`, signup, login, reset, and admin list.
8. Only after the deployed instant-signup code passes smoke tests, disable Confirm Email in Supabase Authentication Providers.
9. Recover the friend's existing account through `Confirm` if unconfirmed, or `ส่งรีเซ็ตรหัสผ่าน` if credentials are unknown.
10. Roll back by re-enabling Confirm Email, rolling back the Cloudflare version, and leaving migration 014 in place because it is additive; do not reverse user deletions.

The document must state that no production command is authorized by this plan alone.

- [ ] **Step 5: Run the complete local verification suite**

Run:

```powershell
npm test -- --run
npm run test:db
npm run typecheck
npm run build
```

Expected: every command exits 0.

If local Supabase/Docker is available, also run:

```powershell
npm run test:db:supabase
```

Expected: all pgTAP tests pass.

- [ ] **Step 6: Run a local browser smoke test**

Start Supabase and both dev processes:

```powershell
npx supabase start
npm run dev:api
npm run dev:web
```

Verify at `http://127.0.0.1:5173`:

- signup rejects mismatched confirmation;
- Turnstile test widget produces a token;
- successful signup immediately opens onboarding/overview;
- Super Admin can open `/admin/users`;
- a seeded normal user cannot open `/admin/users`;
- suspend blocks the target's next sign-in;
- resume restores sign-in;
- password reset returns only a success notice;
- shared-data deletion is blocked;
- private-user deletion removes the user after typed-email confirmation.

- [ ] **Step 7: Commit configuration and runbook**

```powershell
git add supabase/config.toml .dev.vars.example wrangler.jsonc docs/deployment/user-management-rollout.md
git commit -m "docs: add user management rollout controls"
```

- [ ] **Step 8: Stop before production mutation**

Report the verification results, current commit hash, migrations pending remotely, and exact Cloudflare/Supabase values the operator still needs to enter. Ask for explicit approval before `supabase db push`, changing Supabase Auth/CAPTCHA settings, adding Cloudflare production bindings, deploying, or modifying the friend's production account.

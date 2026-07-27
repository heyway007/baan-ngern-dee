# Super Admin User Invitations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the single configured Super Admin create, copy, replace, and revoke 24-hour one-time invitation links whose recipients choose a password, sign in, and create an isolated private workspace.

**Architecture:** Add invitation contracts, Service Role-only Supabase tables and atomic RPCs, and a focused Worker invitation service that owns token hashing and Auth Admin calls. Add an authenticated admin API/UI plus a signed-out acceptance API/UI; the raw token travels in a URL fragment and component memory only.

**Tech Stack:** TypeScript 5.8, React 19, React Router, Hono, Zod, Supabase Auth/PostgREST/PostgreSQL, Cloudflare Workers Web Crypto, Vitest, Testing Library, PGlite, Kanit CSS.

## Global Constraints

- Only the Supabase UID in `SUPER_ADMIN_USER_ID` may perform admin invitation actions.
- `newforico@gmail.com` is the intended Super Admin account, but runtime authorization must never compare email addresses.
- Tokens contain 256 random bits, expire after 24 hours, are single-use, and are stored only as lowercase SHA-256 hashes.
- Raw tokens, passwords, authorization headers, and `SUPABASE_SERVICE_ROLE_KEY` must never be persisted or logged.
- An email with an existing Supabase Auth account cannot be invited.
- A redeemed recipient follows the existing onboarding flow and receives an isolated private workspace.
- The existing Kanit typography remains global.
- Every behavior change follows red-green-refactor and receives a focused commit.

---

## File Structure

### New files

- `packages/contracts/src/invitations.ts`: shared invitation schemas and types.
- `supabase/migrations/202607270013_user_invitations.sql`: private tables, constraints, and atomic RPCs.
- `supabase/tests/database/user_invitations.test.sql`: pgTAP coverage for access and state transitions.
- `workers/api/src/services/invitation-service.ts`: authorization, token generation/hashing, state orchestration, and error mapping.
- `workers/api/src/services/supabase-invitation-repository.ts`: Service Role PostgREST/RPC adapter.
- `workers/api/src/services/supabase-auth-admin.ts`: narrow Supabase Auth Admin create-user adapter.
- `workers/api/src/routes/invitations.ts`: public and Super Admin HTTP routes.
- `workers/api/test/invitation-service.test.ts`: token and orchestration unit tests.
- `workers/api/test/invitations.test.ts`: route authorization and response tests.
- `workers/api/test/user-invitations-database.test.ts`: PGlite coverage for the portable table constraints and access rules.
- `apps/web/src/lib/invitation-api.ts`: public and authenticated invitation clients.
- `apps/web/src/lib/invitation-api.test.ts`: request and response contract tests.
- `apps/web/src/features/admin/invitations-page.tsx`: Super Admin management page.
- `apps/web/src/features/admin/invitations-page.test.tsx`: management UI tests.
- `apps/web/src/features/auth/accept-invite-page.tsx`: recipient acceptance page.
- `apps/web/src/features/auth/accept-invite-page.test.tsx`: token clearing, validation, redeem, and sign-in tests.

### Modified files

- `packages/contracts/src/errors.ts`: invitation error codes.
- `packages/contracts/src/index.ts`: invitation exports.
- `packages/contracts/test/cloud.test.ts`: shared contract coverage.
- `workers/api/src/app.ts`: route ordering and invitation dependencies.
- `workers/api/src/index.ts`: production adapters and required secrets.
- `workers/api/src/types.ts`: new Worker bindings.
- `workers/api/test/config.test.ts`: prove secrets never reach `/config`.
- `apps/web/src/app/router.tsx`: public acceptance route, capability load, and admin route.
- `apps/web/src/app/router.test.tsx`: signed-out acceptance and admin routing.
- `apps/web/src/app/layout.tsx`: capability-controlled navigation item.
- `apps/web/src/lib/remote-finance-api.ts`: no invitation methods; keep finance client focused.
- `apps/web/src/styles.css`: admin/acceptance responsive presentation.
- `.dev.vars.example`: secret placeholders.
- `wrangler.jsonc`: required secret declarations and public API asset routing.
- `package.json`: include invitation DB integration test in `test:db`.
- `docs/runbooks/deploy-cloudflare-supabase.md`: local and production setup.

---

### Task 1: Shared Invitation Contracts and Error Codes

**Files:**
- Create: `packages/contracts/src/invitations.ts`
- Modify: `packages/contracts/src/errors.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `packages/contracts/test/invitations.test.ts`

**Interfaces:**
- Produces: `InvitationStatus`, `AdminInvitation`, `AdminCapabilities`, `CreateInvitationInput`, `CreateInvitationResponse`, `InspectInvitationInput`, `InspectInvitationResponse`, `RedeemInvitationInput`, and `RedeemInvitationResponse`.
- Produces: invitation error codes consumable by `ApiError`, Worker routes, and `RemoteInvitationError`.

- [ ] **Step 1: Write failing contract tests**

```ts
import { describe, expect, it } from "vitest";
import {
  adminCapabilitiesSchema,
  adminInvitationSchema,
  createInvitationSchema,
  inspectInvitationSchema,
  redeemInvitationSchema
} from "../src";

describe("invitation contracts", () => {
  it("normalizes a create request", () => {
    expect(createInvitationSchema.parse({
      email: "  PERSON@EXAMPLE.COM ",
      displayName: "  Person  "
    })).toEqual({
      email: "person@example.com",
      displayName: "Person"
    });
  });

  it("rejects weak redemption passwords", () => {
    expect(redeemInvitationSchema.safeParse({
      token: "a".repeat(43),
      password: "short"
    }).success).toBe(false);
  });

  it("accepts sanitized admin and inspect responses", () => {
    expect(adminCapabilitiesSchema.parse({
      canManageInvitations: true
    })).toEqual({ canManageInvitations: true });
    expect(adminInvitationSchema.parse({
      id: "93b2ea61-500a-4db3-bb62-1246049bdf7a",
      email: "person@example.com",
      displayName: "Person",
      status: "ready",
      createdAt: "2026-07-27T10:00:00.000Z",
      expiresAt: "2026-07-28T10:00:00.000Z"
    }).status).toBe("ready");
    expect(inspectInvitationSchema.parse({
      token: "b".repeat(43)
    }).token).toHaveLength(43);
  });
});
```

- [ ] **Step 2: Run the contracts test and verify RED**

Run:

```powershell
npm test -- packages/contracts/test/invitations.test.ts
```

Expected: FAIL because `packages/contracts/src/invitations.ts` and its exports do not exist.

- [ ] **Step 3: Implement the invitation schemas**

```ts
import { z } from "zod";

const uuidSchema = z.string().uuid();
const timestampSchema = z.string().datetime({ offset: true });
const normalizedEmailSchema = z.string().trim().email()
  .transform((value) => value.toLowerCase());
const base64UrlTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const invitationStatusSchema = z.enum([
  "ready",
  "busy",
  "redeemed",
  "expired",
  "revoked"
]);
export type InvitationStatus = z.infer<typeof invitationStatusSchema>;

export const createInvitationSchema = z.object({
  email: normalizedEmailSchema,
  displayName: z.string().trim().min(1).max(80)
}).strict();
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;

export const adminInvitationSchema = z.object({
  id: uuidSchema,
  email: normalizedEmailSchema,
  displayName: z.string().min(1).max(80),
  status: invitationStatusSchema,
  createdAt: timestampSchema,
  expiresAt: timestampSchema,
  redeemedAt: timestampSchema.optional(),
  revokedAt: timestampSchema.optional()
}).strict();
export type AdminInvitation = z.infer<typeof adminInvitationSchema>;

export const adminCapabilitiesSchema = z.object({
  canManageInvitations: z.boolean()
}).strict();
export type AdminCapabilities = z.infer<typeof adminCapabilitiesSchema>;

export const createInvitationResponseSchema = z.object({
  invitation: adminInvitationSchema,
  invitationUrl: z.string().url()
}).strict();
export type CreateInvitationResponse =
  z.infer<typeof createInvitationResponseSchema>;

export const inspectInvitationSchema = z.object({
  token: base64UrlTokenSchema
}).strict();
export type InspectInvitationInput =
  z.infer<typeof inspectInvitationSchema>;

export const inspectInvitationResponseSchema = z.object({
  displayName: z.string().min(1).max(80),
  maskedEmail: z.string().min(3),
  status: z.literal("ready")
}).strict();
export type InspectInvitationResponse =
  z.infer<typeof inspectInvitationResponseSchema>;

export const redeemInvitationSchema = z.object({
  token: base64UrlTokenSchema,
  password: z.string().min(8).max(128)
}).strict();
export type RedeemInvitationInput =
  z.infer<typeof redeemInvitationSchema>;

export const redeemInvitationResponseSchema = z.object({
  email: normalizedEmailSchema
}).strict();
export type RedeemInvitationResponse =
  z.infer<typeof redeemInvitationResponseSchema>;
```

Add these exact codes to `apiErrorCodes`:

```ts
"SUPER_ADMIN_REQUIRED",
"EMAIL_ALREADY_REGISTERED",
"ACTIVE_INVITATION_EXISTS",
"INVITATION_INVALID",
"INVITATION_EXPIRED",
"INVITATION_REDEEMED",
"INVITATION_BUSY",
"PASSWORD_POLICY_FAILED",
"INVITATION_CREATE_FAILED",
```

Export every schema and type from `packages/contracts/src/index.ts`.

- [ ] **Step 4: Run focused and package tests**

Run:

```powershell
npm test -- packages/contracts/test/invitations.test.ts packages/contracts/test/cloud.test.ts
npm run typecheck -w @systems-credit/contracts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add packages/contracts
git commit -m "feat: define user invitation contracts"
```

---

### Task 2: Private Invitation Storage and Atomic State Functions

**Files:**
- Create: `supabase/migrations/202607270013_user_invitations.sql`
- Create: `supabase/tests/database/user_invitations.test.sql`
- Create: `workers/api/test/user-invitations-database.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces RPCs: `invitation_auth_user_exists`, `create_user_invitation`, `list_user_invitations`, `claim_user_invitation`, `complete_user_invitation`, `release_user_invitation`, `revoke_user_invitation`, and `replace_user_invitation`.
- Consumes: normalized email and 64-character lowercase SHA-256 hex hashes.
- All functions are executable by `service_role` only.

- [ ] **Step 1: Write failing database tests**

The pgTAP test must establish a Super Admin user, then assert:

```sql
select has_table('public', 'user_invitations');
select has_table('public', 'user_invitation_audit');
select policies_are(
  'public',
  'user_invitations',
  array[]::text[],
  'invitation rows have no client policies'
);
select function_privs_are(
  'public',
  'claim_user_invitation',
  array['text'],
  'service_role',
  array['EXECUTE'],
  'only service role can claim'
);
```

Add state assertions that:

```sql
select throws_ok(
  $$select * from public.create_user_invitation(
    'person@example.com',
    'Person',
    repeat('a', 64),
    '00000000-0000-0000-0000-000000000001'
  )$$,
  'P0001',
  'EMAIL_ALREADY_REGISTERED'
);

select is(
  (select status from public.claim_user_invitation(repeat('b', 64))),
  'claimed',
  'a pending invitation is claimed once'
);

select throws_ok(
  $$select * from public.claim_user_invitation(repeat('b', 64))$$,
  'P0001',
  'INVITATION_BUSY'
);
```

The PGlite test loads migrations `001` through `013`, creates `anon`,
`authenticated`, and `service_role`, and proves direct `anon` and
`authenticated` selects fail.

- [ ] **Step 2: Run DB tests and verify RED**

Run:

```powershell
npm run test:db:supabase
npm test -- workers/api/test/user-invitations-database.test.ts
```

Expected: FAIL because migration `013` does not exist.

- [ ] **Step 3: Add tables, constraints, and grants**

Use this schema:

```sql
create table public.user_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null check (
    email = lower(btrim(email))
    and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  ),
  display_name text not null check (
    char_length(btrim(display_name)) between 1 and 80
  ),
  token_hash text not null unique check (
    token_hash ~ '^[0-9a-f]{64}$'
  ),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null default 'pending' check (
    status in ('pending', 'claimed', 'redeemed', 'revoked')
  ),
  claim_id uuid,
  claimed_at timestamptz,
  redeemed_at timestamptz,
  redeemed_user_id uuid references auth.users(id),
  revoked_at timestamptz,
  check (expires_at > created_at),
  check ((status = 'claimed') = (claim_id is not null)),
  check ((status = 'redeemed') = (redeemed_at is not null)),
  check ((status = 'revoked') = (revoked_at is not null))
);

create unique index user_invitations_one_live_email
on public.user_invitations(email)
where status in ('pending', 'claimed');

create table public.user_invitation_audit (
  id bigint generated always as identity primary key,
  invitation_id uuid references public.user_invitations(id)
    on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_name text not null check (
    event_name in (
      'created', 'replaced', 'revoked', 'claimed',
      'released', 'redeemed'
    )
  ),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.user_invitations enable row level security;
alter table public.user_invitation_audit enable row level security;
revoke all on public.user_invitations from public, anon, authenticated;
revoke all on public.user_invitation_audit from public, anon, authenticated;
grant all on public.user_invitations to service_role;
grant all on public.user_invitation_audit to service_role;
```

- [ ] **Step 4: Add exact atomic function behavior**

Every function uses:

```sql
language plpgsql
security definer
set search_path = public, auth, pg_temp
```

After creating the functions, apply these exact privileges:

```sql
revoke all on function public.invitation_auth_user_exists(text) from public;
revoke all on function public.create_user_invitation(text, text, text, uuid) from public;
revoke all on function public.list_user_invitations() from public;
revoke all on function public.claim_user_invitation(text) from public;
revoke all on function public.complete_user_invitation(uuid, uuid, uuid) from public;
revoke all on function public.release_user_invitation(uuid, uuid) from public;
revoke all on function public.revoke_user_invitation(uuid, uuid) from public;
revoke all on function public.replace_user_invitation(uuid, text, uuid) from public;

grant execute on function public.invitation_auth_user_exists(text) to service_role;
grant execute on function public.create_user_invitation(text, text, text, uuid) to service_role;
grant execute on function public.list_user_invitations() to service_role;
grant execute on function public.claim_user_invitation(text) to service_role;
grant execute on function public.complete_user_invitation(uuid, uuid, uuid) to service_role;
grant execute on function public.release_user_invitation(uuid, uuid) to service_role;
grant execute on function public.revoke_user_invitation(uuid, uuid) to service_role;
grant execute on function public.replace_user_invitation(uuid, text, uuid) to service_role;
```

Implement these guards and transitions:

```sql
-- invitation_auth_user_exists(p_email text) returns boolean
return exists (
  select 1 from auth.users
  where lower(email) = lower(btrim(p_email))
);

-- create_user_invitation(...)
if public.invitation_auth_user_exists(p_email) then
  raise exception using errcode = 'P0001',
    message = 'EMAIL_ALREADY_REGISTERED';
end if;
if (
  select count(*) from public.user_invitation_audit
  where actor_user_id = p_created_by
    and event_name in ('created', 'replaced')
    and created_at > now() - interval '1 hour'
) >= 20 then
  raise exception using errcode = 'P0001',
    message = 'INVITATION_CREATE_FAILED';
end if;
-- insert with expires_at = now() + interval '24 hours';
-- convert unique_violation into ACTIVE_INVITATION_EXISTS;
-- insert audit event 'created';
-- return the inserted row.

-- claim_user_invitation(p_token_hash text)
-- SELECT ... FOR UPDATE by token hash.
-- Unknown/revoked -> INVITATION_INVALID.
-- redeemed -> INVITATION_REDEEMED.
-- expires_at <= now() -> INVITATION_EXPIRED.
-- non-stale claimed_at >= now() - interval '5 minutes'
--   -> INVITATION_BUSY.
-- repeat the auth-user existence check.
-- update to claimed with claim_id = gen_random_uuid(), claimed_at = now();
-- audit 'claimed' and return id, email, display_name, claim_id.

-- complete_user_invitation(p_id uuid, p_claim_id uuid, p_user_id uuid)
-- update only matching claimed id and claim_id;
-- set status redeemed, redeemed_at now(), redeemed_user_id p_user_id,
-- claim_id null, keep claimed_at for audit;
-- no match -> INVITATION_BUSY; audit 'redeemed'.

-- release_user_invitation(p_id uuid, p_claim_id uuid)
-- update only matching claimed id and claim_id;
-- set status pending, claim_id null, claimed_at null;
-- audit 'released'.

-- revoke_user_invitation(p_id uuid, p_actor uuid)
-- allow only pending or stale claimed;
-- set status revoked, revoked_at now(), claim fields null;
-- audit 'revoked'.

-- replace_user_invitation(...)
-- lock the original; require pending, expired, or stale claimed;
-- revoke it and insert a new 24-hour pending row in one transaction;
-- enforce auth-user and rate checks; audit 'replaced';
-- return the new row.
```

`list_user_invitations()` returns raw database status plus timestamps. The
Worker derives `ready`, `busy`, `redeemed`, `expired`, or `revoked` and never
returns claim or hash fields.

- [ ] **Step 5: Run all database tests**

Run:

```powershell
npm run test:db:supabase
npm test -- workers/api/test/user-invitations-database.test.ts
npm run test:db
```

Expected: PASS. If PGlite lacks a Supabase-specific feature, keep the pgTAP
test authoritative and assert the supported constraints/transitions in
PGlite; do not weaken the migration.

- [ ] **Step 6: Commit**

```powershell
git add supabase package.json workers/api/test/user-invitations-database.test.ts
git commit -m "feat: persist one-time user invitations"
```

---

### Task 3: Invitation Domain Service with Token Safety

**Files:**
- Create: `workers/api/src/services/invitation-service.ts`
- Create: `workers/api/test/invitation-service.test.ts`

**Interfaces:**
- Consumes: `InvitationRepository`, `InvitationAuthAdmin`, `superAdminUserId`, `appOrigin`, and Web Crypto.
- Produces: `InvitationService` used by HTTP routes.
- Token utilities: `generateInvitationToken(): string` and `hashInvitationToken(token: string): Promise<string>`.

- [ ] **Step 1: Write failing token tests**

```ts
it("generates a 256-bit base64url token and a stable SHA-256 hash", async () => {
  const token = generateInvitationToken();
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  await expect(hashInvitationToken(token))
    .resolves.toMatch(/^[0-9a-f]{64}$/);
});

it("returns a raw token only in a newly created link", async () => {
  const service = createInvitationService(dependencies);
  const result = await service.create(adminActor, {
    email: "person@example.com",
    displayName: "Person"
  });
  expect(result.invitationUrl).toMatch(
    /^https:\/\/app\.example\/accept-invite#token=/
  );
  expect(repository.create).toHaveBeenCalledWith(
    expect.objectContaining({
      tokenHash: expect.stringMatching(/^[0-9a-f]{64}$/)
    })
  );
  expect(JSON.stringify(result.invitation)).not.toContain("tokenHash");
});
```

Add tests for non-admin rejection, masking, inspect errors, successful
claim/create/complete order, Auth Admin failure release, and a complete
failure that does not release an already-created Auth user.

- [ ] **Step 2: Run service tests and verify RED**

Run:

```powershell
npm test -- workers/api/test/invitation-service.test.ts
```

Expected: FAIL because the service is missing.

- [ ] **Step 3: Define focused ports**

```ts
export type InvitationActor = Readonly<{ userId: string }>;

export interface InvitationRepository {
  list(): Promise<readonly StoredInvitation[]>;
  create(input: CreateStoredInvitation): Promise<StoredInvitation>;
  replace(input: ReplaceStoredInvitation): Promise<StoredInvitation>;
  revoke(id: string, actorUserId: string): Promise<void>;
  claim(tokenHash: string): Promise<ClaimedInvitation>;
  complete(
    invitationId: string,
    claimId: string,
    userId: string
  ): Promise<void>;
  release(invitationId: string, claimId: string): Promise<void>;
}

export interface InvitationAuthAdmin {
  createUser(input: {
    email: string;
    displayName: string;
    password: string;
  }): Promise<{ userId: string }>;
}

export interface InvitationService {
  capabilities(actor: InvitationActor): {
    canManageInvitations: boolean;
  };
  list(actor: InvitationActor): Promise<readonly AdminInvitation[]>;
  create(
    actor: InvitationActor,
    input: CreateInvitationInput
  ): Promise<CreateInvitationResponse>;
  replace(
    actor: InvitationActor,
    invitationId: string
  ): Promise<CreateInvitationResponse>;
  revoke(actor: InvitationActor, invitationId: string): Promise<void>;
  inspect(token: string): Promise<InspectInvitationResponse>;
  redeem(input: RedeemInvitationInput): Promise<RedeemInvitationResponse>;
}
```

- [ ] **Step 4: Implement token and orchestration logic**

```ts
export function generateInvitationToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export async function hashInvitationToken(token: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token)
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
```

Admin methods call this guard before repository access:

```ts
function requireSuperAdmin(actor: InvitationActor) {
  if (actor.userId !== options.superAdminUserId) {
    throw new ApiError(
      "SUPER_ADMIN_REQUIRED",
      403,
      "ไม่มีสิทธิ์จัดการคำเชิญ"
    );
  }
}
```

`redeem` must execute in this order:

```ts
const tokenHash = await hashInvitationToken(input.token);
const claim = await repository.claim(tokenHash);
let authUserCreated = false;
try {
  const created = await authAdmin.createUser({
    email: claim.email,
    displayName: claim.displayName,
    password: input.password
  });
  authUserCreated = true;
  await repository.complete(claim.id, claim.claimId, created.userId);
  return { email: claim.email };
} catch (error) {
  if (!authUserCreated) {
    await repository.release(claim.id, claim.claimId)
      .catch(() => undefined);
  }
  throw mapInvitationCreationError(error);
}
```

A failure from `complete` after `createUser` therefore does not release the
claim. Map it to `INVITATION_CREATE_FAILED` and leave the claim for operator
reconciliation; releasing it would allow a second password reset attempt
against the newly created account.

Mask emails with a pure tested helper:

```ts
export function maskInvitationEmail(email: string) {
  const [local, domain] = email.split("@");
  const visible = local!.slice(0, Math.min(2, local!.length));
  return `${visible}${"*".repeat(Math.max(3, local!.length - visible.length))}@${domain}`;
}
```

- [ ] **Step 5: Verify GREEN and refactor**

Run:

```powershell
npm test -- workers/api/test/invitation-service.test.ts
npm run typecheck -w @systems-credit/api
```

Expected: PASS with no console output containing token or password values.

- [ ] **Step 6: Commit**

```powershell
git add workers/api/src/services/invitation-service.ts workers/api/test/invitation-service.test.ts
git commit -m "feat: orchestrate secure invitation redemption"
```

---

### Task 4: Supabase Service Role and Auth Admin Adapters

**Files:**
- Create: `workers/api/src/services/supabase-invitation-repository.ts`
- Create: `workers/api/src/services/supabase-auth-admin.ts`
- Create: `workers/api/test/supabase-invitation-adapters.test.ts`

**Interfaces:**
- Implements `InvitationRepository`.
- Implements `InvitationAuthAdmin`.
- Consumes server-only `SupabaseAdminConfig = {url, serviceRoleKey, fetch?}`.

- [ ] **Step 1: Write failing adapter tests**

Test exact outbound behavior:

```ts
expect(fetchMock).toHaveBeenCalledWith(
  "https://project.supabase.co/rest/v1/rpc/claim_user_invitation",
  expect.objectContaining({
    method: "POST",
    headers: expect.objectContaining({
      apikey: "service-role",
      authorization: "Bearer service-role"
    }),
    body: JSON.stringify({ p_token_hash: "a".repeat(64) })
  })
);
```

For Auth Admin:

```ts
expect(fetchMock).toHaveBeenCalledWith(
  "https://project.supabase.co/auth/v1/admin/users",
  expect.objectContaining({
    method: "POST",
    body: JSON.stringify({
      email: "person@example.com",
      password: "strong-password",
      email_confirm: true,
      user_metadata: { display_name: "Person" }
    })
  })
);
```

Assert an error response never includes the Service Role value in the thrown
message.

- [ ] **Step 2: Run adapter tests and verify RED**

Run:

```powershell
npm test -- workers/api/test/supabase-invitation-adapters.test.ts
```

Expected: FAIL because both adapters are missing.

- [ ] **Step 3: Implement one private request helper per adapter**

Use:

```ts
const headers = {
  apikey: config.serviceRoleKey,
  authorization: `Bearer ${config.serviceRoleKey}`,
  "content-type": "application/json"
};
```

Repository RPC mapping must use these exact parameter names:

```ts
create_user_invitation: {
  p_email, p_display_name, p_token_hash, p_created_by
}
replace_user_invitation: {
  p_original_id, p_token_hash, p_actor
}
revoke_user_invitation: { p_id, p_actor }
claim_user_invitation: { p_token_hash }
complete_user_invitation: { p_id, p_claim_id, p_user_id }
release_user_invitation: { p_id, p_claim_id }
```

Map Postgres `P0001` message values to the matching `ApiError` codes. Map
unknown upstream failures to `INTERNAL_ERROR` without including response
headers, request bodies, passwords, or keys.

- [ ] **Step 4: Verify GREEN**

Run:

```powershell
npm test -- workers/api/test/supabase-invitation-adapters.test.ts
npm run typecheck -w @systems-credit/api
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add workers/api/src/services/supabase-invitation-repository.ts workers/api/src/services/supabase-auth-admin.ts workers/api/test/supabase-invitation-adapters.test.ts
git commit -m "feat: connect invitation service to Supabase admin APIs"
```

---

### Task 5: Worker Routes, Authorization, and Secret Wiring

**Files:**
- Create: `workers/api/src/routes/invitations.ts`
- Create: `workers/api/test/invitations.test.ts`
- Modify: `workers/api/src/app.ts`
- Modify: `workers/api/src/index.ts`
- Modify: `workers/api/src/types.ts`
- Modify: `workers/api/src/api-error.ts`
- Modify: `workers/api/test/config.test.ts`
- Modify: `.dev.vars.example`
- Modify: `wrangler.jsonc`

**Interfaces:**
- Produces the API paths specified in the design.
- Public inspect/redeem routes run before `requireAuth`.
- Admin routes receive `context.get("auth")`.

- [ ] **Step 1: Write failing route tests**

Cover:

```ts
it("exposes capability false to a normal authenticated user");
it("rejects invitation creation from a normal user");
it("creates and lists invitations for the Super Admin");
it("revokes and replaces eligible invitations");
it("inspects and redeems without bearer authentication");
it("rejects malformed public bodies before calling the service");
it("does not expose admin secrets from GET /config");
```

The public test calls:

```ts
await app.request("/v1/public/invitations/inspect", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ token: "a".repeat(43) })
});
```

and expects `200` without an Authorization header.

- [ ] **Step 2: Run route tests and verify RED**

Run:

```powershell
npm test -- workers/api/test/invitations.test.ts workers/api/test/config.test.ts
```

Expected: FAIL with missing routes and dependency types.

- [ ] **Step 3: Add thin Hono routes**

```ts
publicInvitationRoutes.post("/inspect", async (context) => {
  const input = inspectInvitationSchema.parse(
    await context.req.json()
  );
  return context.json(await service.inspect(input.token));
});

publicInvitationRoutes.post("/redeem", async (context) => {
  const input = redeemInvitationSchema.parse(
    await context.req.json()
  );
  return context.json(await service.redeem(input));
});

adminInvitationRoutes.get("/capabilities", (context) =>
  context.json(service.capabilities(context.get("auth")))
);
adminInvitationRoutes.get("/invitations", async (context) =>
  context.json({ invitations: await service.list(context.get("auth")) })
);
```

Add create, replace, and delete handlers using contract parsing and UUID
validation.

Register in `createApp` in this order:

```ts
app.route(
  "/v1/public/invitations",
  publicInvitationRoutes(invitationService)
);
app.use("/v1/*", requireAuth(authVerifier));
app.route(
  "/v1/admin",
  adminInvitationRoutes(invitationService)
);
```

- [ ] **Step 4: Wire server-only production dependencies**

Extend bindings:

```ts
SUPABASE_SERVICE_ROLE_KEY: string;
SUPER_ADMIN_USER_ID: string;
```

Instantiate the repository, Auth Admin, and service in `index.ts`. Validate
`SUPER_ADMIN_USER_ID` as a UUID before serving requests. Add placeholders:

```dotenv
SUPABASE_SERVICE_ROLE_KEY=your-server-only-service-role-key
SUPER_ADMIN_USER_ID=00000000-0000-0000-0000-000000000000
```

Add both names to Wrangler's `secrets.required` list and add `/v1/*` only
once to `assets.run_worker_first`.

The browser `/config` response remains exactly:

```json
{
  "supabaseUrl": "https://project.supabase.co",
  "supabasePublishableKey": "sb_publishable_public"
}
```

- [ ] **Step 5: Verify Worker tests and typecheck**

Run:

```powershell
npm test -- workers/api/test/invitations.test.ts workers/api/test/config.test.ts workers/api/test/error-handler.test.ts
npm run typecheck -w @systems-credit/api
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add workers/api .dev.vars.example wrangler.jsonc
git commit -m "feat: expose secure invitation APIs"
```

---

### Task 6: Browser Invitation API Client

**Files:**
- Create: `apps/web/src/lib/invitation-api.ts`
- Create: `apps/web/src/lib/invitation-api.test.ts`

**Interfaces:**
- Produces `PublicInvitationApi` for inspect/redeem without a session.
- Produces `AdminInvitationApi` for capability/list/create/replace/revoke with refresh-once authentication.
- Must not add invitation operations to `RemoteFinanceApi`.

- [ ] **Step 1: Write failing client tests**

```ts
it("inspects and redeems without an authorization header", async () => {
  const api = createPublicInvitationApi({ fetch: fetchMock });
  await api.inspect("a".repeat(43));
  await api.redeem({
    token: "a".repeat(43),
    password: "strong-password"
  });
  expect(fetchMock.mock.calls[0]![1]?.headers)
    .not.toHaveProperty("authorization");
});

it("refreshes an admin request once after 401", async () => {
  const api = createAdminInvitationApi({
    auth,
    fetch: fetchMock,
    onUnauthenticated
  });
  await api.list();
  expect(auth.refreshSession).toHaveBeenCalledOnce();
});
```

Also test Zod response validation and stable error-code parsing.

- [ ] **Step 2: Run client tests and verify RED**

Run:

```powershell
npm test -- apps/web/src/lib/invitation-api.test.ts
```

Expected: FAIL because the module is missing.

- [ ] **Step 3: Implement the two focused clients**

```ts
export interface PublicInvitationApi {
  inspect(token: string): Promise<InspectInvitationResponse>;
  redeem(input: RedeemInvitationInput): Promise<RedeemInvitationResponse>;
}

export interface AdminInvitationApi {
  capabilities(): Promise<AdminCapabilities>;
  list(): Promise<readonly AdminInvitation[]>;
  create(input: CreateInvitationInput): Promise<CreateInvitationResponse>;
  replace(id: string): Promise<CreateInvitationResponse>;
  revoke(id: string): Promise<void>;
}
```

Use `apiErrorCodes` to parse error envelopes into:

```ts
export class RemoteInvitationError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    readonly status: number,
    message: string,
    readonly requestId?: string
  ) {
    super(message);
  }
}
```

Public requests use only `accept` and `content-type`. Admin requests mirror
the existing refresh-once behavior in `remote-finance-api.ts`.

- [ ] **Step 4: Verify GREEN**

Run:

```powershell
npm test -- apps/web/src/lib/invitation-api.test.ts
npm run typecheck -w @systems-credit/web
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/src/lib/invitation-api.ts apps/web/src/lib/invitation-api.test.ts
git commit -m "feat: add invitation API clients"
```

---

### Task 7: Super Admin Invitation Management UI

**Files:**
- Create: `apps/web/src/features/admin/invitations-page.tsx`
- Create: `apps/web/src/features/admin/invitations-page.test.tsx`
- Modify: `apps/web/src/app/layout.tsx`
- Modify: `apps/web/src/app/router.tsx`
- Modify: `apps/web/src/app/router.test.tsx`

**Interfaces:**
- Consumes `AdminInvitationApi`.
- `AppLayout` gains `canManageInvitations: boolean`.
- The route is `/admin/invitations`.

- [ ] **Step 1: Write failing management page tests**

Test:

```ts
it("creates an invitation and copies the returned one-time link");
it("lists ready, busy, redeemed, expired, and revoked statuses");
it("revokes an eligible invitation after confirmation");
it("replaces an invitation and displays the new one-time link");
it("shows EMAIL_ALREADY_REGISTERED in Thai");
it("warns that closing the result loses the raw link");
```

Use `navigator.clipboard.writeText = vi.fn()` and assert it receives the
exact returned URL.

Add a router test asserting:

```ts
expect(
  screen.queryByRole("link", { name: "คำเชิญผู้ใช้" })
).not.toBeInTheDocument();
```

for a false capability, and the matching link exists for true.

- [ ] **Step 2: Run UI tests and verify RED**

Run:

```powershell
npm test -- apps/web/src/features/admin/invitations-page.test.tsx apps/web/src/app/router.test.tsx
```

Expected: FAIL because page, route, and layout capability do not exist.

- [ ] **Step 3: Implement the management page**

The component signature is:

```ts
export function InvitationsPage({
  api
}: Readonly<{ api: AdminInvitationApi }>)
```

On mount call `api.list()`. Submit:

```ts
const result = await api.create({ email, displayName });
setCreatedLink(result.invitationUrl);
setInvitations((current) => [
  result.invitation,
  ...current.filter((item) => item.id !== result.invitation.id)
]);
```

Never put `createdLink` in browser storage. Clearing the success panel sets
it to `null`.

Use status labels:

```ts
const labels = {
  ready: "พร้อมใช้",
  busy: "กำลังดำเนินการ",
  redeemed: "ใช้แล้ว",
  expired: "หมดอายุ",
  revoked: "ยกเลิก"
} satisfies Record<InvitationStatus, string>;
```

- [ ] **Step 4: Load capability and protect navigation**

After session restoration, create the admin client and call
`capabilities()`. A failure defaults to false without breaking finance boot.
Pass the boolean to `AppLayout`.

Add:

```tsx
{canManageInvitations ? (
  <NavLink to="/admin/invitations">
    <UserRoundPlus aria-hidden="true" />
    <span>คำเชิญผู้ใช้</span>
  </NavLink>
) : null}
```

The admin route must still handle a server `403`; hidden navigation is not
the authorization boundary.

- [ ] **Step 5: Verify GREEN**

Run:

```powershell
npm test -- apps/web/src/features/admin/invitations-page.test.tsx apps/web/src/app/router.test.tsx
npm run typecheck -w @systems-credit/web
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add apps/web/src/features/admin apps/web/src/app
git commit -m "feat: manage user invitations as super admin"
```

---

### Task 8: Recipient Acceptance, Password Choice, and Automatic Sign-In

**Files:**
- Create: `apps/web/src/features/auth/accept-invite-page.tsx`
- Create: `apps/web/src/features/auth/accept-invite-page.test.tsx`
- Modify: `apps/web/src/app/router.tsx`
- Modify: `apps/web/src/app/router.test.tsx`

**Interfaces:**
- Consumes `PublicInvitationApi`.
- Consumes `Pick<CloudAuth, "signIn">`.
- Calls `onAuthenticated(session)` after redemption and sign-in.

- [ ] **Step 1: Write failing acceptance tests**

```ts
it("reads the fragment token and clears it before inspecting");
it("shows the display name and masked email only");
it("rejects a password shorter than eight characters");
it("rejects mismatched password confirmation");
it("redeems, signs in, and reports the authenticated session");
it("shows safe messages for expired, redeemed, and invalid links");
it("asks the user to reopen the link after a refresh with no fragment");
```

For token clearing:

```ts
window.history.replaceState(
  null,
  "",
  `/accept-invite#token=${"a".repeat(43)}`
);
render(<AcceptInvitePage {...props} />);
await waitFor(() => expect(window.location.hash).toBe(""));
expect(api.inspect).toHaveBeenCalledWith("a".repeat(43));
```

- [ ] **Step 2: Run acceptance tests and verify RED**

Run:

```powershell
npm test -- apps/web/src/features/auth/accept-invite-page.test.tsx apps/web/src/app/router.test.tsx
```

Expected: FAIL because the component and route do not exist.

- [ ] **Step 3: Implement fragment extraction and immediate clearing**

```ts
export function readInvitationToken(location: Location, history: History) {
  const params = new URLSearchParams(location.hash.slice(1));
  const token = params.get("token");
  history.replaceState(null, "", `${location.pathname}${location.search}`);
  return token;
}
```

Call it once through a lazy state initializer so React rerenders never read
the fragment again.

- [ ] **Step 4: Implement redemption and sign-in**

```ts
const redeemed = await api.redeem({ token, password });
const session = await auth.signIn({
  email: redeemed.email,
  password
});
onAuthenticated(session);
```

After `onAuthenticated`, navigate to `/onboarding`. Clear password state in
`finally`. Do not include token or password in thrown UI messages.

Add the signed-out route before the wildcard:

```tsx
<Route
  path="/accept-invite"
  element={
    <AcceptInvitePage
      api={publicInvitationApi}
      auth={auth}
      onAuthenticated={(session) => {
        acceptAuthenticatedSession(session);
        navigate("/onboarding", { replace: true });
      }}
    />
  }
/>
```

When already signed in, show a prompt to sign out before accepting another
identity rather than redeeming under the wrong session.

- [ ] **Step 5: Verify GREEN**

Run:

```powershell
npm test -- apps/web/src/features/auth/accept-invite-page.test.tsx apps/web/src/app/router.test.tsx apps/web/src/lib/cloud-auth.test.ts
npm run typecheck -w @systems-credit/web
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add apps/web/src/features/auth/accept-invite-page.tsx apps/web/src/features/auth/accept-invite-page.test.tsx apps/web/src/app
git commit -m "feat: accept invitations with a chosen password"
```

---

### Task 9: Responsive Styling, Runbook, and End-to-End Verification

**Files:**
- Modify: `apps/web/src/styles.css`
- Modify: `apps/web/src/styles.test.ts`
- Modify: `docs/runbooks/deploy-cloudflare-supabase.md`

**Interfaces:**
- Keeps Kanit for every new component.
- Documents local and production secret setup without secret values.

- [ ] **Step 1: Write failing style assertions**

Extend `styles.test.ts` with:

```ts
document.body.innerHTML += `
  <main class="invitation-admin-page">
    <section class="invitation-link-panel">ลิงก์</section>
    <span class="invitation-status ready">พร้อมใช้</span>
  </main>
  <main class="accept-invite-page">
    <form class="accept-invite-card"><input value="" /></form>
  </main>
`;

for (const selector of [
  ".invitation-admin-page",
  ".invitation-link-panel",
  ".invitation-status",
  ".accept-invite-page",
  ".accept-invite-card"
]) {
  expect(getComputedStyle(document.querySelector(selector)!).fontFamily)
    .toBe('"Kanit", sans-serif');
}
```

- [ ] **Step 2: Run the style test and verify RED**

Run:

```powershell
npm test -- apps/web/src/styles.test.ts
```

Expected: FAIL until the new selectors inherit or explicitly use Kanit and
their layout rules exist.

- [ ] **Step 3: Add responsive styles**

Add classes for:

- a two-column desktop admin form/history layout;
- a single-column layout below `760px`;
- a monospaced, selectable, wrapping link value without changing the
  surrounding Kanit UI;
- distinct accessible status colors with text labels;
- a centered acceptance card;
- visible focus states; and
- disabled/loading buttons.

Do not import another font. Keep controls at least 44px high on mobile.

- [ ] **Step 4: Update the deployment runbook**

Document these commands without values:

```powershell
supabase db reset
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put SUPER_ADMIN_USER_ID
npm run build
npx wrangler deploy
```

Document how to find the UID for `newforico@gmail.com` in Supabase
Authentication > Users and state that the Service Role key is server-only.

- [ ] **Step 5: Run complete automated verification**

Run:

```powershell
npm test
npm run typecheck
npm run build
npm run test:db
npm run test:db:supabase
git diff --check
```

Expected: every command exits `0` with no secret material in output.

- [ ] **Step 6: Run the local smoke test**

Start local Supabase, the Worker, and the web client using the documented
commands. Verify:

1. a normal user has no admin navigation and gets `403` from admin APIs;
2. the configured Super Admin creates a link;
3. the link disappears from recoverable history after its success panel is
   closed;
4. the recipient opens the link in a private window;
5. the fragment clears immediately;
6. the recipient sets a password and signs in;
7. the recipient reaches onboarding and creates a private workspace;
8. the same invitation cannot be used again;
9. the Super Admin can revoke and replace pending links; and
10. finance data is isolated between both accounts.

- [ ] **Step 7: Commit**

```powershell
git add apps/web/src/styles.css apps/web/src/styles.test.ts docs/runbooks/deploy-cloudflare-supabase.md
git commit -m "docs: finalize invitation rollout"
```

---

## Final Review Gate

Before production:

- inspect `git diff` for any secret values;
- confirm the database migration is applied locally;
- confirm all automated commands are green;
- confirm the local smoke flow is complete;
- resolve the exact Supabase UID for `newforico@gmail.com`;
- ask the user before applying the hosted migration, adding production
  secrets, deploying, or pushing commits; and
- after deployment, verify one disposable production invitation without
  exposing its token in chat or logs.

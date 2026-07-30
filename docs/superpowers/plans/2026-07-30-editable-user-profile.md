# Editable User Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a secure `/profile` page where signed-in email and LINE users can edit their display name and private profile photo while viewing their immutable sign-in channel.

**Architecture:** `public.profiles` is authoritative for the editable name and custom avatar path. An authenticated Hono profile service coordinates PostgREST, Supabase Auth Admin, and the private `profile-avatars` Storage bucket; the React router loads profile state independently from finance state so profile failures never block finance pages.

**Tech Stack:** TypeScript, React 19, React Router, Hono, Zod, Supabase Auth/PostgREST/Storage REST APIs, PostgreSQL migrations, Vitest, Testing Library, PGlite, Wrangler.

## Global Constraints

- Display names are trimmed and contain 1–80 characters.
- Accept only JPG, PNG, and WebP images no larger than 2 MB.
- Validate image signatures from bytes rather than trusting extensions or request headers.
- Keep `profile-avatars` private and return only expiring signed URLs.
- Derive the target user ID from the verified bearer token; never accept it in profile mutation input.
- Email or `LINE` is read-only and cannot be changed by this feature.
- A custom avatar overrides the LINE avatar; the first display-name character is the final fallback.
- A failed profile request must not replace a usable finance screen with the global cloud error screen.
- Apply profile changes to shared layout state only after the server confirms success.
- Support desktop and mobile without horizontal overflow; controls remain at least 44 px high.
- Work and verify locally. Do not push or deploy without a separate explicit user instruction.

## File Structure

### Shared contracts

- Create `packages/contracts/src/profile.ts` — profile types, request schemas, response schema, avatar limit.
- Create `packages/contracts/src/profile.test.ts` — contract boundary tests.
- Modify `packages/contracts/src/errors.ts` — profile-specific API error codes.
- Modify `packages/contracts/src/index.ts` — export profile contracts.

### Database and Worker

- Create `supabase/migrations/202607300021_editable_profiles.sql` — profile constraints, `avatar_path`, private bucket.
- Create `workers/api/test/profile-database.test.ts` — migration and ownership constraint coverage.
- Create `workers/api/src/services/profile-image.ts` — byte-signature validation.
- Create `workers/api/test/profile-image.test.ts` — image validator tests.
- Create `workers/api/src/services/profile-service.ts` — profile orchestration and fallback order.
- Create `workers/api/test/profile-service.test.ts` — service behavior and mutation ordering.
- Create `workers/api/src/services/supabase-profile-gateway.ts` — Auth Admin, PostgREST, and Storage REST adapter.
- Create `workers/api/test/supabase-profile-gateway.test.ts` — request/response adapter tests.
- Create `workers/api/src/routes/profile.ts` — authenticated profile HTTP routes.
- Create `workers/api/test/profile.test.ts` — route validation/delegation tests.
- Modify `workers/api/src/app.ts` — register optional profile service.
- Modify `workers/api/src/index.ts` — construct and inject the production profile service.

### Web

- Create `apps/web/src/lib/profile-api.ts` — bearer-authenticated profile client.
- Create `apps/web/src/lib/profile-api.test.ts` — refresh, parsing, raw upload, and error tests.
- Create `apps/web/src/features/profile/profile-avatar.tsx` — reusable image/initial avatar.
- Create `apps/web/src/features/profile/profile-avatar.test.tsx` — fallback behavior tests.
- Create `apps/web/src/features/profile/profile-page.tsx` — profile editor.
- Create `apps/web/src/features/profile/profile-page.test.tsx` — editor interaction tests.
- Modify `apps/web/src/lib/cloud-auth.ts` — map optional provider avatar into `CloudSession`.
- Modify `apps/web/src/lib/cloud-auth.test.ts` — LINE avatar metadata mapping.
- Modify `apps/web/src/app/layout.tsx` — desktop/mobile links and effective profile.
- Modify `apps/web/src/app/layout.test.tsx` — profile navigation and rendering tests.
- Modify `apps/web/src/app/router.tsx` — independent profile state, API lifecycle, `/profile` route.
- Modify `apps/web/src/app/router.test.tsx` — loading isolation and immediate layout update tests.
- Modify `apps/web/src/styles.css` — responsive profile page and avatar styles.
- Modify `apps/web/src/styles.test.ts` — control size and narrow-screen overflow assertions.

---

### Task 1: Define Profile Contracts and Error Codes

**Files:**
- Create: `packages/contracts/src/profile.ts`
- Create: `packages/contracts/src/profile.test.ts`
- Modify: `packages/contracts/src/errors.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Consumes: Zod from the existing contracts package.
- Produces:
  - `PROFILE_AVATAR_MAX_BYTES: 2097152`
  - `UpdateProfileInput`
  - `ProfileAccountChannel`
  - `ProfileAvatar`
  - `UserProfile`
  - `updateProfileSchema`
  - `userProfileSchema`

- [ ] **Step 1: Write failing contract tests**

```ts
import { describe, expect, it } from "vitest";

import {
  PROFILE_AVATAR_MAX_BYTES,
  updateProfileSchema,
  userProfileSchema
} from "./profile";

describe("profile contracts", () => {
  it("trims a valid display name and rejects unknown fields", () => {
    expect(
      updateProfileSchema.parse({ displayName: "  New Name  " })
    ).toEqual({ displayName: "New Name" });
    expect(() =>
      updateProfileSchema.parse({
        displayName: "New Name",
        email: "replacement@example.test"
      })
    ).toThrow();
  });

  it("accepts email, LINE, and avatar fallback response shapes", () => {
    expect(
      userProfileSchema.parse({
        userId: "11111111-1111-4111-8111-111111111111",
        displayName: "Min",
        accountChannel: {
          kind: "email",
          label: "min@example.test"
        },
        avatar: { source: "initial", url: null }
      })
    ).toMatchObject({ displayName: "Min" });
    expect(PROFILE_AVATAR_MAX_BYTES).toBe(2_097_152);
  });
});
```

Extend `packages/contracts/src/errors.ts` test coverage indirectly by asserting
the exported `apiErrorCodes` contains:

```ts
[
  "PROFILE_LOAD_FAILED",
  "PROFILE_NAME_INVALID",
  "PROFILE_IMAGE_TOO_LARGE",
  "PROFILE_IMAGE_UNSUPPORTED",
  "PROFILE_IMAGE_UPLOAD_FAILED"
]
```

- [ ] **Step 2: Run the contract test and verify RED**

Run:

```powershell
npx vitest run packages/contracts/src/profile.test.ts --reporter=verbose
```

Expected: FAIL because `./profile` and the profile error codes do not exist.

- [ ] **Step 3: Implement the profile schemas and exports**

Create the discriminated contracts:

```ts
import { z } from "zod";

export const PROFILE_AVATAR_MAX_BYTES = 2_097_152;

export const updateProfileSchema = z
  .object({
    displayName: z.string().trim().min(1).max(80)
  })
  .strict();
export type UpdateProfileInput = z.infer<
  typeof updateProfileSchema
>;

const profileAccountChannelSchema = z.discriminatedUnion(
  "kind",
  [
    z.object({
      kind: z.literal("email"),
      label: z.string().email()
    }).strict(),
    z.object({
      kind: z.literal("line"),
      label: z.literal("LINE")
    }).strict()
  ]
);
export type ProfileAccountChannel = z.infer<
  typeof profileAccountChannelSchema
>;

const profileAvatarSchema = z.discriminatedUnion(
  "source",
  [
    z.object({
      source: z.enum(["custom", "line"]),
      url: z.string().url()
    }).strict(),
    z.object({
      source: z.literal("initial"),
      url: z.null()
    }).strict()
  ]
);
export type ProfileAvatar = z.infer<
  typeof profileAvatarSchema
>;

export const userProfileSchema = z.object({
  userId: z.string().uuid(),
  displayName: z.string().min(1).max(80),
  accountChannel: profileAccountChannelSchema,
  avatar: profileAvatarSchema
}).strict();
export type UserProfile = z.infer<typeof userProfileSchema>;
```

Add the five exact profile codes to `apiErrorCodes`, and export every public
profile symbol from `packages/contracts/src/index.ts`.

- [ ] **Step 4: Run contract tests and typecheck**

Run:

```powershell
npx vitest run packages/contracts/src/profile.test.ts --reporter=verbose
npm run typecheck -w @systems-credit/contracts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- packages/contracts/src/profile.ts packages/contracts/src/profile.test.ts packages/contracts/src/errors.ts packages/contracts/src/index.ts
git commit -m "feat: define editable profile contracts"
```

### Task 2: Add Profile Columns and Private Avatar Bucket

**Files:**
- Create: `supabase/migrations/202607300021_editable_profiles.sql`
- Create: `workers/api/test/profile-database.test.ts`

**Interfaces:**
- Consumes: `public.profiles` and its existing self-select/self-update RLS.
- Produces:
  - `public.profiles.avatar_path text null`
  - private Storage bucket `profile-avatars`
  - database constraints for normalized names and owner-prefixed avatar paths.

- [ ] **Step 1: Write the failing PGlite migration test**

Set up `auth.users`, `auth.uid()`, and a minimal compatible
`storage.buckets` table. Load
`202607260001_identity_workspaces.sql`, then the new migration.

Assert these literal behaviors:

```ts
expect(bucket.rows).toEqual([{
  id: "profile-avatars",
  public: false,
  file_size_limit: 2_097_152,
  allowed_mime_types: [
    "image/jpeg",
    "image/png",
    "image/webp"
  ]
}]);

await expect(
  database.query(
    "update public.profiles set display_name = $1 where id = $2",
    [" ", ownerId]
  )
).rejects.toThrow();

await expect(
  database.query(
    "update public.profiles set avatar_path = $1 where id = $2",
    [`${strangerId}/avatar.png`, ownerId]
  )
).rejects.toThrow();
```

Also prove a valid `${ownerId}/avatar.png` update succeeds and another
authenticated user cannot select the owner's profile through RLS.

- [ ] **Step 2: Run the database test and verify RED**

Run:

```powershell
npx vitest run workers/api/test/profile-database.test.ts --reporter=verbose
```

Expected: FAIL because the migration is missing.

- [ ] **Step 3: Write the migration**

Use exact normalized constraints and an idempotent bucket upsert:

```sql
update public.profiles
set display_name = nullif(btrim(display_name), '')
where display_name is not null;

alter table public.profiles
add column avatar_path text;

alter table public.profiles
add constraint profiles_display_name_valid
check (
  display_name is null
  or (
    display_name = btrim(display_name)
    and char_length(display_name) between 1 and 80
  )
);

alter table public.profiles
add constraint profiles_avatar_path_owned
check (
  avatar_path is null
  or avatar_path like id::text || '/%'
);

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'profile-avatars',
  'profile-avatars',
  false,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
```

Do not add browser-facing `storage.objects` policies: avatar operations go
through the authenticated Worker and its service key, which bypasses Storage
RLS while remaining server-only.

- [ ] **Step 4: Run migration tests**

Run:

```powershell
npx vitest run workers/api/test/profile-database.test.ts workers/api/test/identity-database.test.ts --reporter=verbose
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- supabase/migrations/202607300021_editable_profiles.sql workers/api/test/profile-database.test.ts
git commit -m "feat: store editable profile data"
```

### Task 3: Validate Avatar Bytes

**Files:**
- Create: `workers/api/src/services/profile-image.ts`
- Create: `workers/api/test/profile-image.test.ts`

**Interfaces:**
- Consumes: `PROFILE_AVATAR_MAX_BYTES`.
- Produces:

```ts
export type ValidProfileImage = Readonly<{
  bytes: Uint8Array;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  extension: "jpg" | "png" | "webp";
}>;

export function validateProfileImage(
  bytes: Uint8Array
): ValidProfileImage;
```

- [ ] **Step 1: Write failing table-driven signature tests**

Use hand-written byte fixtures:

```ts
it.each([
  [new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg", "jpg"],
  [
    new Uint8Array([
      0x89, 0x50, 0x4e, 0x47,
      0x0d, 0x0a, 0x1a, 0x0a
    ]),
    "image/png",
    "png"
  ],
  [
    new Uint8Array([
      0x52, 0x49, 0x46, 0x46,
      0, 0, 0, 0,
      0x57, 0x45, 0x42, 0x50
    ]),
    "image/webp",
    "webp"
  ]
] as const)("detects %s", (bytes, contentType, extension) => {
  expect(validateProfileImage(bytes)).toMatchObject({
    contentType,
    extension
  });
});
```

Add separate tests for zero bytes, an unsupported GIF header, and
`PROFILE_AVATAR_MAX_BYTES + 1` bytes. Assert the exact `ApiError` codes
`PROFILE_IMAGE_UNSUPPORTED` and `PROFILE_IMAGE_TOO_LARGE`.

- [ ] **Step 2: Run the validator test and verify RED**

Run:

```powershell
npx vitest run workers/api/test/profile-image.test.ts --reporter=verbose
```

Expected: FAIL because the validator does not exist.

- [ ] **Step 3: Implement minimal signature detection**

Check size before signature detection. Match JPEG bytes `FF D8 FF`, the
eight-byte PNG signature, and `RIFF....WEBP`. Throw:

```ts
throw new ApiError(
  "PROFILE_IMAGE_TOO_LARGE",
  413,
  "รูปโปรไฟล์ต้องมีขนาดไม่เกิน 2 MB"
);
```

or:

```ts
throw new ApiError(
  "PROFILE_IMAGE_UNSUPPORTED",
  415,
  "รองรับเฉพาะรูป JPG, PNG และ WebP"
);
```

Return the original bytes plus the canonical media type and extension.

- [ ] **Step 4: Run validator tests**

Run:

```powershell
npx vitest run workers/api/test/profile-image.test.ts --reporter=verbose
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- workers/api/src/services/profile-image.ts workers/api/test/profile-image.test.ts
git commit -m "feat: validate profile avatar images"
```

### Task 4: Build the Profile Service

**Files:**
- Create: `workers/api/src/services/profile-service.ts`
- Create: `workers/api/test/profile-service.test.ts`

**Interfaces:**
- Consumes:
  - `AuthSession`
  - `UpdateProfileInput`
  - `UserProfile`
  - `validateProfileImage(bytes)`
- Produces:

```ts
export type StoredProfile = Readonly<{
  displayName: string | null;
  avatarPath: string | null;
}>;

export type ProfileIdentity = Readonly<{
  email?: string;
  fallbackDisplayName: string;
  lineAvatarUrl?: string;
}>;

export interface ProfileGateway {
  readProfile(userId: string): Promise<StoredProfile>;
  readIdentity(userId: string): Promise<ProfileIdentity>;
  updateDisplayName(userId: string, displayName: string): Promise<void>;
  updateAvatarPath(userId: string, avatarPath: string | null): Promise<void>;
  uploadAvatar(input: {
    path: string;
    bytes: Uint8Array;
    contentType: "image/jpeg" | "image/png" | "image/webp";
  }): Promise<void>;
  signAvatar(path: string, expiresIn: number): Promise<string>;
  deleteAvatar(path: string): Promise<void>;
}

export interface ProfileService {
  get(actor: AuthSession): Promise<UserProfile>;
  update(
    actor: AuthSession,
    input: UpdateProfileInput
  ): Promise<UserProfile>;
  replaceAvatar(
    actor: AuthSession,
    bytes: Uint8Array
  ): Promise<UserProfile>;
  removeAvatar(actor: AuthSession): Promise<UserProfile>;
}

export function createProfileService(options: {
  gateway: ProfileGateway;
  randomUUID?: () => string;
}): ProfileService;
```

- [ ] **Step 1: Write failing service tests**

Cover:

1. Stored name overrides Auth fallback.
2. Email identity returns `{kind:"email", label:email}`.
3. Email-less identity returns `{kind:"line", label:"LINE"}`.
4. Custom signed avatar overrides a LINE avatar.
5. LINE avatar overrides the initial fallback.
6. Update trims and writes the authenticated user's name.
7. Replacement order is upload new → update path → delete old.
8. Upload failure leaves the old path untouched.
9. Path-update failure deletes the newly uploaded orphan and keeps the old
   path.
10. Removal clears the path before deleting and is idempotent.

Use an operation log rather than mock call-order helpers:

```ts
expect(operations).toEqual([
  `upload:${userId}/44444444-4444-4444-8444-444444444444.png`,
  `path:${userId}/44444444-4444-4444-8444-444444444444.png`,
  `delete:${userId}/old.png`
]);
```

- [ ] **Step 2: Run service tests and verify RED**

Run:

```powershell
npx vitest run workers/api/test/profile-service.test.ts --reporter=verbose
```

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement service orchestration**

Implement a private `readCurrent(userId)` that loads stored profile and Auth
identity in parallel, then returns:

```ts
const displayName =
  stored.displayName ?? identity.fallbackDisplayName;
const accountChannel = identity.email
  ? { kind: "email" as const, label: identity.email }
  : { kind: "line" as const, label: "LINE" as const };
```

Avatar order:

```ts
const avatar = stored.avatarPath
  ? {
      source: "custom" as const,
      url: await gateway.signAvatar(
        stored.avatarPath,
        24 * 60 * 60
      )
    }
  : identity.lineAvatarUrl
    ? {
        source: "line" as const,
        url: identity.lineAvatarUrl
      }
    : { source: "initial" as const, url: null };
```

Generate a new path only from `actor.userId`, injected `randomUUID`, and the
validated extension. Never accept a path or user ID from request input.
Preserve the replacement and cleanup ordering asserted above. Map unexpected
avatar storage failures to `PROFILE_IMAGE_UPLOAD_FAILED`; map profile reads to
`PROFILE_LOAD_FAILED`.

- [ ] **Step 4: Run service and validator tests**

Run:

```powershell
npx vitest run workers/api/test/profile-service.test.ts workers/api/test/profile-image.test.ts --reporter=verbose
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- workers/api/src/services/profile-service.ts workers/api/test/profile-service.test.ts
git commit -m "feat: orchestrate user profile updates"
```

### Task 5: Implement the Supabase Profile Gateway

**Files:**
- Create: `workers/api/src/services/supabase-profile-gateway.ts`
- Create: `workers/api/test/supabase-profile-gateway.test.ts`

**Interfaces:**
- Consumes:

```ts
export type SupabaseProfileConfig = Readonly<{
  url: string;
  serviceRoleKey: string;
  fetch?: typeof fetch;
}>;
```

- Produces:

```ts
export function createSupabaseProfileGateway(
  config: SupabaseProfileConfig
): ProfileGateway;
```

- [ ] **Step 1: Write failing adapter tests**

Use an injected fetch fake and assert exact boundaries:

- `GET /rest/v1/profiles?id=eq.<uuid>&select=display_name,avatar_path&limit=1`
  parses one strict row.
- `GET /auth/v1/admin/users/<uuid>` maps normalized email, display-name
  fallback keys (`display_name`, `name`, `full_name`,
  `preferred_username`), and LINE avatar keys (`avatar_url`, `picture`).
- `PATCH /rest/v1/profiles?id=eq.<uuid>` sends only the requested field and
  `Prefer: return=minimal`.
- `POST /storage/v1/object/profile-avatars/<encoded-path>` sends raw bytes,
  canonical content type, `cache-control: max-age=3600`, and
  `x-upsert: false`.
- `POST /storage/v1/object/sign/profile-avatars/<encoded-path>` sends
  `{"expiresIn":86400}` and converts returned `signedURL` into an absolute
  URL.
- `DELETE /storage/v1/object/profile-avatars` sends
  `{"prefixes":["<path>"]}`.
- Every request uses the service role in both `apikey` and
  `Authorization: Bearer ...`.
- Malformed or unsuccessful responses become controlled profile `ApiError`
  values and never include the service key.

- [ ] **Step 2: Run adapter tests and verify RED**

Run:

```powershell
npx vitest run workers/api/test/supabase-profile-gateway.test.ts --reporter=verbose
```

Expected: FAIL because the gateway does not exist.

- [ ] **Step 3: Implement the REST adapter**

Use strict Zod schemas:

```ts
const storedProfileRowSchema = z.object({
  display_name: z.string().nullable(),
  avatar_path: z.string().nullable()
}).strict();

const authUserSchema = z.object({
  email: z.string().email().nullable().optional(),
  user_metadata: z.record(z.unknown()).default({})
}).passthrough();

const signedUrlSchema = z.object({
  signedURL: z.string().min(1)
}).passthrough();
```

Encode each path segment without encoding `/` separators:

```ts
const encodedPath = path
  .split("/")
  .map(encodeURIComponent)
  .join("/");
```

Centralize admin headers in the adapter and preserve binary bodies without
adding JSON content type. Normalize Auth fallback strings to trimmed,
80-character values; use `"ผู้ใช้ LINE"` only if Auth provides no usable
name or email prefix.

- [ ] **Step 4: Run gateway and service tests**

Run:

```powershell
npx vitest run workers/api/test/supabase-profile-gateway.test.ts workers/api/test/profile-service.test.ts --reporter=verbose
npm run typecheck -w @systems-credit/api
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- workers/api/src/services/supabase-profile-gateway.ts workers/api/test/supabase-profile-gateway.test.ts
git commit -m "feat: connect profiles to Supabase storage"
```

### Task 6: Expose Authenticated Profile Routes

**Files:**
- Create: `workers/api/src/routes/profile.ts`
- Create: `workers/api/test/profile.test.ts`
- Modify: `workers/api/src/app.ts`
- Modify: `workers/api/src/index.ts`

**Interfaces:**
- Consumes: `ProfileService`, `updateProfileSchema`,
  `PROFILE_AVATAR_MAX_BYTES`.
- Produces:
  - `GET /v1/profile`
  - `PATCH /v1/profile`
  - `POST /v1/profile/avatar`
  - `DELETE /v1/profile/avatar`

- [ ] **Step 1: Write failing route tests**

Create a fake `ProfileService`, inject it through `createApp`, and prove:

- no bearer token returns 401 and calls no service method;
- GET delegates with `context.get("auth")`;
- PATCH parses and trims `{displayName}` and rejects unknown keys with
  `PROFILE_NAME_INVALID`;
- POST rejects `Content-Length: 2097153` without reading/calling the service;
- POST passes the actual request bytes as `Uint8Array`;
- DELETE returns the fallback profile response;
- every successful endpoint validates and returns `userProfileSchema`.

- [ ] **Step 2: Run route tests and verify RED**

Run:

```powershell
npx vitest run workers/api/test/profile.test.ts --reporter=verbose
```

Expected: FAIL because the route and app dependency are absent.

- [ ] **Step 3: Implement routes and production wiring**

Route parser:

```ts
const parsed = updateProfileSchema.safeParse(
  await context.req.json().catch(() => null)
);
if (!parsed.success) {
  throw new ApiError(
    "PROFILE_NAME_INVALID",
    400,
    "ชื่อที่แสดงต้องมีความยาว 1–80 ตัวอักษร"
  );
}
```

Reject a numeric `Content-Length` larger than
`PROFILE_AVATAR_MAX_BYTES` before calling `arrayBuffer()`. The service remains
the authoritative byte validator when the header is absent or incorrect.

Add optional `profileService?: ProfileService` to `AppDependencies`, and after
the existing `app.use("/v1/*", requireAuth(...))`, register:

```ts
if (dependencies.profileService) {
  app.route("/v1/profile", profileRoutes(
    dependencies.profileService
  ));
}
```

In `workers/api/src/index.ts`, construct one gateway with `adminConfig`, wrap
it with `createProfileService`, and inject it into `createApp`.

- [ ] **Step 4: Run Worker profile suites and typecheck**

Run:

```powershell
npx vitest run workers/api/test/profile.test.ts workers/api/test/profile-service.test.ts workers/api/test/supabase-profile-gateway.test.ts workers/api/test/profile-image.test.ts --reporter=verbose
npm run typecheck -w @systems-credit/api
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- workers/api/src/routes/profile.ts workers/api/test/profile.test.ts workers/api/src/app.ts workers/api/src/index.ts
git commit -m "feat: expose authenticated profile API"
```

### Task 7: Add the Browser Profile API Adapter

**Files:**
- Create: `apps/web/src/lib/profile-api.ts`
- Create: `apps/web/src/lib/profile-api.test.ts`

**Interfaces:**
- Consumes: `CloudAuth`, `UserProfile`, `UpdateProfileInput`,
  `userProfileSchema`, profile error codes.
- Produces:

```ts
export interface ProfileApi {
  get(): Promise<UserProfile>;
  update(input: UpdateProfileInput): Promise<UserProfile>;
  replaceAvatar(file: Blob): Promise<UserProfile>;
  removeAvatar(): Promise<UserProfile>;
}

export class ProfileApiFailure extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly requestId?: string
  );
}

export function createProfileApi(options: {
  auth: CloudAuth;
  fetch?: typeof fetch;
  onUnauthenticated(): void;
}): ProfileApi;
```

- [ ] **Step 1: Write failing adapter tests**

Prove:

- GET includes the current bearer token and parses `userProfileSchema`;
- a 401 refreshes once and retries with the new token;
- a second 401 calls `onUnauthenticated`;
- PATCH sends only `{displayName}`;
- avatar upload sends the `Blob` directly with its media type and does not
  force JSON content type;
- DELETE uses `/v1/profile/avatar`;
- structured profile errors preserve code, Thai message, and request ID;
- malformed success responses and network failures become
  `PROFILE_LOAD_FAILED` or `PROFILE_IMAGE_UPLOAD_FAILED` as appropriate.

- [ ] **Step 2: Run browser adapter tests and verify RED**

Run:

```powershell
npx vitest run apps/web/src/lib/profile-api.test.ts --reporter=verbose
```

Expected: FAIL because the profile API adapter does not exist.

- [ ] **Step 3: Implement authenticated requests**

Follow the token refresh structure in `user-management-api.ts`, but allow
request-specific content types:

```ts
const send = (accessToken: string) =>
  requestFetch(path, {
    ...init,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${accessToken}`,
      ...init.headers
    }
  });
```

Use `content-type: application/json` only for PATCH. Use the Blob's validated
browser media type for upload. Parse all successful responses with
`userProfileSchema`.

- [ ] **Step 4: Run adapter tests and web typecheck**

Run:

```powershell
npx vitest run apps/web/src/lib/profile-api.test.ts --reporter=verbose
npm run typecheck -w @systems-credit/web
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- apps/web/src/lib/profile-api.ts apps/web/src/lib/profile-api.test.ts
git commit -m "feat: add profile API client"
```

### Task 8: Build the Profile Editor and Avatar Component

**Files:**
- Create: `apps/web/src/features/profile/profile-avatar.tsx`
- Create: `apps/web/src/features/profile/profile-avatar.test.tsx`
- Create: `apps/web/src/features/profile/profile-page.tsx`
- Create: `apps/web/src/features/profile/profile-page.test.tsx`
- Modify: `apps/web/src/styles.css`
- Modify: `apps/web/src/styles.test.ts`

**Interfaces:**
- Consumes: `UserProfile`, `ProfileApi`, `PROFILE_AVATAR_MAX_BYTES`.
- Produces:

```ts
export function ProfileAvatar(props: Readonly<{
  displayName: string;
  url: string | null;
  size?: "small" | "large";
}>): JSX.Element;

export function ProfilePage(props: Readonly<{
  profile: UserProfile;
  api: ProfileApi;
  loading: boolean;
  loadError?: string;
  onRetry(): void;
  onProfileChanged(profile: UserProfile): void;
}>): JSX.Element;
```

- [ ] **Step 1: Write failing avatar and editor tests**

Avatar tests:

- URL renders an image with alt text `รูปโปรไฟล์ของ <name>`.
- missing URL renders the first non-space character.
- image `error` hides the broken image and restores the initial.

Page tests:

- shows name and read-only email or LINE channel;
- saves a trimmed changed name and calls `onProfileChanged` only after the API
  resolves;
- a failed save keeps the existing shared profile and shows a Thai alert;
- file input accepts `.jpg,.jpeg,.png,.webp`;
- client rejects a file over 2 MB before calling the API;
- selected file creates a local preview;
- upload success replaces the profile and revokes the object URL;
- upload failure revokes/discards the preview and keeps the old avatar;
- custom avatars show `ลบรูป`; removal restores the returned fallback;
- load error shows retry without hiding the current fallback profile.

- [ ] **Step 2: Run component tests and verify RED**

Run:

```powershell
npx vitest run apps/web/src/features/profile/profile-avatar.test.tsx apps/web/src/features/profile/profile-page.test.tsx --reporter=verbose
```

Expected: FAIL because the components do not exist.

- [ ] **Step 3: Implement the focused UI**

`ProfileAvatar` owns only broken-image fallback. `ProfilePage` owns independent
`savingName`, `uploadingAvatar`, and `removingAvatar` states so one mutation
does not disable unrelated read-only content.

Use labels and copy:

```tsx
<label htmlFor="profile-display-name">ชื่อที่แสดง</label>
<input
  id="profile-display-name"
  value={displayName}
  maxLength={80}
  autoComplete="name"
/>

<span className="profile-account-label">
  ช่องทางเข้าสู่ระบบ
</span>
<strong>{profile.accountChannel.label}</strong>
```

File selection must check `file.size` and the browser MIME type for early
feedback, but the Worker remains authoritative. Always clean up
`URL.createObjectURL` in replacement, error, success, and unmount paths.

Add styles with:

```css
.profile-page .profile-card {
  width: min(100%, 760px);
}

.profile-avatar.large {
  width: 112px;
  height: 112px;
}

.profile-page button,
.profile-page input {
  min-height: 44px;
}

.profile-account-value {
  overflow-wrap: anywhere;
}

@media (max-width: 640px) {
  .profile-avatar-actions,
  .profile-form-actions {
    align-items: stretch;
    flex-direction: column;
  }
}
```

Extend `styles.test.ts` with a 390 px container assertion for no horizontal
overflow and computed `min-height: 44px`.

- [ ] **Step 4: Run component and style tests**

Run:

```powershell
npx vitest run apps/web/src/features/profile/profile-avatar.test.tsx apps/web/src/features/profile/profile-page.test.tsx apps/web/src/styles.test.ts --reporter=verbose
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- apps/web/src/features/profile/profile-avatar.tsx apps/web/src/features/profile/profile-avatar.test.tsx apps/web/src/features/profile/profile-page.tsx apps/web/src/features/profile/profile-page.test.tsx apps/web/src/styles.css apps/web/src/styles.test.ts
git commit -m "feat: build editable profile page"
```

### Task 9: Integrate Profile State, Navigation, and LINE Avatar Fallback

**Files:**
- Modify: `apps/web/src/lib/cloud-auth.ts`
- Modify: `apps/web/src/lib/cloud-auth.test.ts`
- Modify: `apps/web/src/app/layout.tsx`
- Modify: `apps/web/src/app/layout.test.tsx`
- Modify: `apps/web/src/app/router.tsx`
- Modify: `apps/web/src/app/router.test.tsx`

**Interfaces:**
- Consumes: `ProfileApi`, `ProfilePage`, `ProfileAvatar`, `UserProfile`.
- Produces:
  - `CloudSession.avatarUrl?: string`
  - authenticated route `/profile`
  - independent router-owned effective profile state.

- [ ] **Step 1: Write failing integration tests**

In `cloud-auth.test.ts`, map either `user_metadata.avatar_url` or
`user_metadata.picture` into `CloudSession.avatarUrl`, ignoring non-URL values.

In `layout.test.tsx`, assert:

```ts
expect(
  screen.getByRole("link", { name: "เปิดโปรไฟล์" })
).toHaveAttribute("href", "/profile");
expect(
  screen.getByRole("link", { name: "ตั้งค่า" })
).toHaveAttribute("href", "/profile");
```

In `router.test.tsx`, add cases proving:

- an authenticated `/profile` route receives the loaded profile;
- the finance overview renders even when `profileApi.get()` rejects;
- profile load failure does not dispatch `BOOT_FAILED` or reload the finance
  snapshot;
- a successful `onProfileChanged` updates the sidebar name/avatar immediately;
- signing out clears profile state;
- LINE session fallback uses its mapped LINE avatar before the profile request
  resolves.

- [ ] **Step 2: Run integration tests and verify RED**

Run:

```powershell
npx vitest run apps/web/src/lib/cloud-auth.test.ts apps/web/src/app/layout.test.tsx apps/web/src/app/router.test.tsx --reporter=verbose
```

Expected: FAIL because profile navigation/state and `avatarUrl` are absent.

- [ ] **Step 3: Implement independent profile lifecycle**

Extend `CloudSession`:

```ts
export type CloudSession = Readonly<{
  userId: string;
  email?: string;
  displayName: string;
  avatarUrl?: string;
  accessToken: string;
}>;
```

Map the first valid URL string from `avatar_url` and `picture`.

Extend `CloudRouterDependencies` with:

```ts
createProfileApi(
  auth: CloudAuth,
  onUnauthenticated: () => void
): ProfileApi;
```

Keep profile state outside `cloudReducer`:

```ts
type ProfileViewState = Readonly<{
  profile: UserProfile;
  loading: boolean;
  error?: string;
}>;
```

Build a session fallback with email/LINE channel, LINE avatar when present, and
initial otherwise. When a session is found, set this fallback synchronously,
then call `profileApi.get()` without awaiting it in finance boot. Guard async
completion with the existing active/session-user checks. Profile failure sets
only `ProfileViewState.error`.

Change `AppLayout` to receive `profile: UserProfile`, render `ProfileAvatar`,
make the desktop profile row a `NavLink` with accessible name `เปิดโปรไฟล์`,
and make the mobile settings control a `NavLink` to `/profile`.

Register:

```tsx
<Route
  path="/profile"
  element={
    <ProfilePage
      profile={profileState.profile}
      api={profileApi}
      loading={profileState.loading}
      loadError={profileState.error}
      onRetry={() => void loadProfile(session.userId)}
      onProfileChanged={(profile) =>
        setProfileState({
          profile,
          loading: false
        })
      }
    />
  }
/>
```

Do not add `/profile` to finance navigation or bottom navigation.

- [ ] **Step 4: Run all affected web tests and typecheck**

Run:

```powershell
npx vitest run apps/web/src/lib/cloud-auth.test.ts apps/web/src/lib/profile-api.test.ts apps/web/src/features/profile/profile-avatar.test.tsx apps/web/src/features/profile/profile-page.test.tsx apps/web/src/app/layout.test.tsx apps/web/src/app/router.test.tsx apps/web/src/styles.test.ts --reporter=verbose
npm run typecheck -w @systems-credit/web
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- apps/web/src/lib/cloud-auth.ts apps/web/src/lib/cloud-auth.test.ts apps/web/src/app/layout.tsx apps/web/src/app/layout.test.tsx apps/web/src/app/router.tsx apps/web/src/app/router.test.tsx
git commit -m "feat: integrate editable user profiles"
```

### Task 10: Full Local Verification

**Files:**
- Verify only; change files only if a test or browser check reveals a defect,
  then repeat the failing test-first cycle in the owning task's files.

**Interfaces:**
- Consumes: all completed profile contracts, migrations, Worker endpoints, web
  components, and routes.
- Produces: local evidence that the approved profile design works without a
  push or deployment.

- [ ] **Step 1: Run the full automated suite**

```powershell
npx vitest run --reporter=dot --silent
npm run typecheck
npm run build
git diff --check
```

Expected: every command exits 0. The Vite chunk-size warning may remain; no new
test, type, build, or whitespace error is acceptable.

- [ ] **Step 2: Apply and verify the local Supabase migration**

Against the configured local/test Supabase project:

```powershell
supabase db reset
npm run test:db
```

Expected: migration `202607300021_editable_profiles.sql` applies, the
`profile-avatars` bucket is private with a 2 MB limit, and all database tests
pass.

Do not run a remote migration or production deploy during this task.

- [ ] **Step 3: Start the local integrated Worker**

```powershell
npm run build
npx wrangler dev --remote --port 8787 --ip 127.0.0.1 -c wrangler.jsonc
```

Expected:

- `GET http://127.0.0.1:8787/config` returns 200.
- `http://127.0.0.1:8787/sign-in` loads.
- No production deployment is created.

- [ ] **Step 4: Verify the approved browser flows**

Use the local site and check:

1. Email session: `/profile` shows the email read-only.
2. LINE session: `/profile` shows `LINE` and the LINE avatar when available.
3. Sidebar profile row and mobile settings icon both open `/profile`.
4. Name save updates the sidebar immediately and survives a reload.
5. JPG, PNG, and WebP uploads below 2 MB succeed.
6. A file above 2 MB and a GIF are rejected with Thai messages.
7. Replacing an avatar does not flash a broken image.
8. Removing a custom avatar restores LINE or initial fallback.
9. At 390 × 844 there is no horizontal overflow and actions remain usable.
10. Simulated profile API failure leaves `/overview` and finance navigation
    usable while `/profile` shows retry.
11. Browser console has no new error or warning from the profile flow.

- [ ] **Step 5: Record final local state**

```powershell
git status --short --branch
git log --oneline -10
```

Expected: `main` contains the task commits, the working tree is clean, and the
branch remains unpushed until the user explicitly requests push/deploy.

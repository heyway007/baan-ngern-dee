# Super Admin User Invitations Design

## Purpose

Add a secure, copyable one-time invitation link that only the designated
Super Admin can create. The recipient opens the link, chooses their own
password, is signed in, and continues through the existing onboarding flow
to create a private finance workspace.

The designated Super Admin account is `newforico@gmail.com`. Authorization
must use that account's immutable Supabase User UID from a Worker secret,
not an email comparison.

## Approved Product Decisions

- Only one Super Admin can manage invitations.
- The Super Admin enters the recipient's display name and email.
- The system generates a link for the Super Admin to copy and send manually.
- Invitations expire 24 hours after creation.
- Each invitation can be redeemed once.
- A recipient opens the link, sets a password, and is signed in.
- A redeemed recipient gets a new private workspace through the existing
  onboarding flow and never gains access to the Super Admin's finance data.
- Creating an invitation for an email that already has a Supabase Auth
  account is rejected.
- Pending invitations can be revoked or replaced with a newly generated link.

## Chosen Approach

Use an application-owned invitation token instead of Supabase's email invite
or recovery link. The Worker generates 256 random bits, returns the raw token
only in the newly created link, and stores only a SHA-256 hash in Supabase.

This approach provides exact 24-hour expiry, revocation, replacement,
single-use semantics, and a management history without depending on
Supabase's email rate limit. Supabase remains the source of truth for user
identity and passwords.

## System Boundaries

### Web application

The web application owns:

- the Super Admin invitation management page;
- the public invitation acceptance page;
- client-side password validation;
- copying newly generated links;
- signing in with the newly chosen password after redemption; and
- routing the new user into the existing onboarding flow.

The browser never receives the Supabase Service Role key. It receives the
raw invitation token only through the link copied by the Super Admin.

### Cloudflare Worker

The Worker owns:

- checking the authenticated caller's UID against `SUPER_ADMIN_USER_ID`;
- generating cryptographically random tokens;
- hashing tokens with SHA-256;
- validating and claiming invitations;
- creating a confirmed Supabase Auth user through the Admin API;
- completing or safely releasing an invitation claim;
- returning sanitized invitation records; and
- writing invitation audit events.

The Worker uses `SUPABASE_SERVICE_ROLE_KEY` only for narrowly scoped
invitation database operations and Supabase Auth Admin operations.

### Supabase

Supabase owns:

- persistent invitation state;
- atomic claim, complete, release, revoke, and replacement operations;
- Supabase Auth users and password hashing;
- the profile trigger for newly created users; and
- row-level isolation for all finance data.

## Configuration

Add these required Worker secrets:

- `SUPABASE_SERVICE_ROLE_KEY`: the project's server-only Service Role key.
- `SUPER_ADMIN_USER_ID`: the Supabase User UID for
  `newforico@gmail.com`.

Keep `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `ALLOWED_ORIGIN` as currently
configured. Add the two new values to `.dev.vars.example` as placeholders
and to Wrangler's required secret declaration. Never commit their values.

Startup configuration should fail clearly when a required value is absent.

## Data Model

Create `public.user_invitations` with:

- `id uuid primary key`;
- `email text`, normalized to lowercase and trimmed;
- `display_name text`;
- `token_hash text unique`, containing exactly 64 lowercase hexadecimal
  SHA-256 characters;
- `created_by uuid references auth.users`;
- `created_at timestamptz`;
- `expires_at timestamptz`;
- `status text` constrained to `pending`, `claimed`, `redeemed`, or
  `revoked`;
- `claim_id uuid null`;
- `claimed_at timestamptz null`;
- `redeemed_at timestamptz null`;
- `redeemed_user_id uuid null references auth.users`; and
- `revoked_at timestamptz null`.

Create `public.user_invitation_audit` with:

- invitation ID when known;
- actor UID when authenticated;
- event name;
- timestamp; and
- non-sensitive metadata only.

Audit metadata must never contain the raw token, password, Service Role key,
or authorization header.

Enable RLS on both tables and grant no direct access to `anon` or
`authenticated`. Only Service Role calls and tightly scoped database
functions may access the rows.

## Invitation State Rules

The database is the authority for state transitions:

- `pending -> claimed` when a valid, unexpired token is redeemed;
- `claimed -> redeemed` after the Auth user is created;
- `claimed -> pending` when Auth creation fails and the same claim releases
  it;
- `pending -> revoked` when the Super Admin revokes it; and
- `pending -> revoked` followed by a new `pending` row when the Super Admin
  explicitly replaces a link.

A claim receives a unique `claim_id`. A complete or release operation must
match both the invitation ID and claim ID. A claim older than five minutes
is stale and can be reclaimed, protecting against a Worker interruption.

Expiry is derived from `expires_at <= now()`. Expired rows remain `pending`
in storage for audit purposes but are presented as `expired` and cannot be
claimed.

Only one non-expired `pending` or non-stale `claimed` invitation may exist
for the same normalized email. Replacement is an explicit operation.

## Email and Existing-Account Checks

Before creating or replacing an invitation, a Service Role-only database
function checks `auth.users` for the normalized email. If it exists, the
Worker returns `409 EMAIL_ALREADY_REGISTERED`.

The same check is repeated during redemption immediately before claiming.
This closes the race where the recipient registers through another path
after the invitation is created.

The Auth Admin create-user call also relies on Supabase's unique-email
constraint as the final safeguard.

## API Design

All responses use the existing API error envelope and request ID behavior.

### Authenticated capability endpoint

`GET /v1/admin/capabilities`

Returns:

```json
{
  "canManageInvitations": true
}
```

Any authenticated user may call this endpoint. The boolean is determined by
comparing the verified session UID to `SUPER_ADMIN_USER_ID`. The UI uses it
only for visibility; every admin action repeats authorization on the Worker.

### Super Admin endpoints

`GET /v1/admin/invitations`

Returns sanitized invitation records with the derived display status. It
never returns `token_hash`, `claim_id`, or the raw token.

`POST /v1/admin/invitations`

Accepts:

```json
{
  "email": "person@example.com",
  "displayName": "Person"
}
```

Returns the created invitation plus `invitationUrl`. The URL is returned
only from this create response.

`POST /v1/admin/invitations/:id/replace`

Revokes an eligible pending invitation and creates a replacement. It returns
the replacement `invitationUrl` once.

`DELETE /v1/admin/invitations/:id`

Revokes an eligible pending invitation. Redeemed and already revoked
invitations cannot be changed.

Every admin endpoint returns `403 SUPER_ADMIN_REQUIRED` when the UID does not
match.

### Public invitation endpoints

These routes are registered before the existing `/v1/*` authentication
middleware.

`POST /v1/public/invitations/inspect`

Accepts a raw token and returns only:

```json
{
  "displayName": "Person",
  "maskedEmail": "pe***@example.com",
  "status": "ready"
}
```

Invalid, revoked, and unknown tokens share a generic invalid response.
Expired and already-used tokens may return their specific safe status
without returning identity data.

`POST /v1/public/invitations/redeem`

Accepts:

```json
{
  "token": "raw-token",
  "password": "recipient-chosen-password"
}
```

The Worker:

1. hashes the token;
2. atomically claims a valid invitation;
3. creates a confirmed Supabase Auth user with the invitation email,
   display name, and submitted password;
4. completes the invitation using its claim ID; and
5. returns the email needed for the browser's normal password sign-in.

The password is accepted only over HTTPS, sent directly to Supabase Auth
Admin, never stored, and never logged.

If Auth creation fails, the Worker releases the matching claim. If a Worker
interruption leaves a claim incomplete, it becomes reclaimable after five
minutes.

## Link Format and Token Handling

Generate links in this form:

```text
https://app-origin.example/accept-invite#token=<base64url-token>
```

Use a URL fragment so the token is not sent in the initial HTTP request or
included in ordinary referrer headers. The acceptance page reads the token
once, stores it only in component memory, and immediately removes the
fragment with `history.replaceState`.

The token must not be written to local storage, session storage, analytics,
console output, error messages, or logs.

## Super Admin User Experience

Add a navigation item named `คำเชิญผู้ใช้` only when the capability endpoint
returns `canManageInvitations: true`.

The page contains:

- a form for display name and email;
- a `สร้างลิงก์เชิญ` action;
- a success panel with the one-time link and `คัดลอกลิงก์`;
- a history table or responsive cards;
- display statuses `พร้อมใช้`, `กำลังดำเนินการ`, `ใช้แล้ว`,
  `หมดอายุ`, and `ยกเลิก`;
- `ยกเลิก` for an eligible pending invitation; and
- `สร้างลิงก์ใหม่` for an eligible pending or expired invitation.

The UI must warn that navigating away loses access to the raw newly created
link. The history view cannot reconstruct it because only its hash is stored.

## Recipient User Experience

Add a public `/accept-invite` route that remains reachable while signed out.

The page:

1. reads and clears the token fragment;
2. inspects the invitation;
3. displays the recipient name and masked email;
4. accepts a password and password confirmation;
5. requires at least eight characters and matching values;
6. redeems the invitation;
7. signs in through the existing `CloudAuth.signIn`; and
8. routes to `/onboarding`.

After onboarding, the current workspace creation logic creates a private
workspace owned by the new user. No membership is added to the Super Admin's
workspace.

Refreshing after the fragment is cleared shows a safe message asking the
recipient to reopen the original link. The raw token is deliberately not
persisted.

## Error Behavior

Use stable error codes and Thai user-facing messages:

- `SUPER_ADMIN_REQUIRED` -> ไม่มีสิทธิ์จัดการคำเชิญ
- `EMAIL_ALREADY_REGISTERED` -> อีเมลนี้มีบัญชีแล้ว
- `ACTIVE_INVITATION_EXISTS` -> อีเมลนี้มีคำเชิญที่ยังใช้งานได้
- `INVITATION_INVALID` -> ลิงก์เชิญไม่ถูกต้องหรือถูกยกเลิกแล้ว
- `INVITATION_EXPIRED` -> ลิงก์เชิญหมดอายุแล้ว
- `INVITATION_REDEEMED` -> ลิงก์เชิญนี้ถูกใช้แล้ว
- `INVITATION_BUSY` -> คำเชิญกำลังถูกดำเนินการ กรุณาลองใหม่อีกครั้ง
- `PASSWORD_POLICY_FAILED` -> รหัสผ่านไม่ผ่านเงื่อนไข
- `INVITATION_CREATE_FAILED` -> ยังสร้างบัญชีไม่ได้ กรุณาลองใหม่

Unknown tokens must not reveal whether an email or user exists.

## Abuse Controls

- Limit the Super Admin to 20 invitation creations or replacements per
  rolling hour using an atomic database check.
- Record create, replace, revoke, claim, release, and redeem events.
- Do not audit invalid raw tokens or passwords.
- Apply a bounded request-body size to public redemption.
- Reject malformed tokens before database access.
- Use constant-format token hashes and generic unknown-token errors.

The 256-bit token is the primary defense against guessing; the database claim
rules are the primary defense against replay and concurrent redemption.

## Testing Strategy

### Database tests

Verify:

- direct `anon` and `authenticated` access is denied;
- token hashes and normalized email constraints;
- create-rate enforcement;
- one active invitation per email;
- atomic claim and matching claim ID;
- stale claim recovery;
- complete and release transitions;
- expiry, revoke, and replacement behavior; and
- Service Role-only existing-user checks.

### Worker tests

Verify:

- capability results for the configured UID;
- every admin action rejects other authenticated users;
- create returns a raw link once and never exposes the hash;
- inspect masks identity data;
- malformed, invalid, expired, revoked, busy, and redeemed responses;
- successful redeem calls Auth Admin and completes the claim;
- Auth Admin failure releases the claim;
- request bodies and password policy are validated; and
- logs and errors contain no token, password, or Service Role value.

### Web tests

Verify:

- the admin navigation item appears only with the capability;
- invitation creation, copy, listing, replacement, and revoke flows;
- the acceptance page clears the URL fragment;
- recipient identity is masked;
- password and confirmation validation;
- redeem followed by normal sign-in;
- routing to onboarding after success; and
- safe screens for missing, invalid, expired, and used links.

### Completion checks

Run the focused tests first, then:

```text
npm test
npm run typecheck
npm run build
npm run test:db
```

Finally run the full flow against local Supabase and the local Worker before
configuring production secrets or deploying.

## Deployment

1. Apply the invitation migration to local Supabase.
2. Resolve the Supabase User UID for `newforico@gmail.com`.
3. Add `SUPABASE_SERVICE_ROLE_KEY` and `SUPER_ADMIN_USER_ID` to local
   `.dev.vars`.
4. Verify create, copy, redeem, sign-in, and onboarding locally.
5. Apply the migration to the hosted Supabase project.
6. Add both secrets to the Cloudflare Worker production environment.
7. Deploy the tested commit.
8. Run a production smoke test with a disposable email.

No production secret is committed to Git or printed in deployment output.

## Out of Scope

- Sending invitation emails automatically.
- Multiple Super Admins or an admin management UI.
- Inviting users into another person's workspace.
- Editing or deleting existing Supabase Auth users from this UI.
- Recovering a raw invitation link after the create response is dismissed.
- Using an invitation to reset an existing user's password.

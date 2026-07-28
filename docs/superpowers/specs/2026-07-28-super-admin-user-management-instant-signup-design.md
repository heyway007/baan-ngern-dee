# Super Admin User Management and Instant Signup Design

Date: 2026-07-28

## Summary

Baan Ngern Dee will allow a person to register with email and password and
enter the application immediately, without an email-confirmation step. The
registration form will require password confirmation and Cloudflare
Turnstile. The existing Super Admin will receive a private user-management
surface for confirming legacy accounts, suspending and resuming access,
requesting password resets, and permanently deleting an account together
with its private financial workspace.

Passwords continue to travel directly from the browser to Supabase Auth.
The Worker never receives, stores, or logs a signup or login password.
Elevated Auth operations remain behind the Worker and use the server-only
Supabase key.

## Evidence and Current Failure

The production checks on 2026-07-28 established:

- the Worker root, `/health`, and `/config` respond successfully;
- email/password signup is enabled;
- Supabase reports `mailer_autoconfirm: false`;
- the web client collapses all sign-in errors into one generic message; and
- production database migrations stop at `202607270012`, while
  `202607270013_user_invitations.sql` is still local-only.

The friend's self-signup therefore entered the confirmation-required flow.
If that confirmation did not complete, the account cannot sign in and the
current UI does not explain the `email_not_confirmed` error. The exact
account status will be verified from the new Admin page. Missing migration
`013` is a separate confirmed production defect affecting invitation APIs;
it is not the cause of a direct self-signup being unconfirmed.

## Goals

- Let a new user register and receive a valid session immediately.
- Require the password and confirmation fields to match before signup.
- Keep passwords exclusively between the browser and Supabase Auth.
- Give only the configured Super Admin a user-management UI and API.
- Let the Super Admin confirm an existing unconfirmed account.
- Let the Super Admin suspend and resume a non-admin account.
- Let the Super Admin request a password-reset email for a user.
- Let the Super Admin permanently delete a user and all private financial
  data after explicit typed confirmation.
- Make permanent deletion safe to retry after a partial external failure.
- Give users specific, safe Thai authentication errors.
- Preserve private-workspace isolation and keep elevated keys out of the
  browser.

## Non-goals

- Admins do not view, set, or receive user passwords.
- Admins do not impersonate users.
- This work does not add social login, MFA, shared workspace transfer, or
  organization roles.
- This work does not silently delete a shared/family workspace.
- This work does not remove the one-time invitation module.
- This work does not expose Auth users or user-management audit rows through
  browser-accessible RLS policies.

## Chosen Architecture

### Signup and login

The browser continues to use `@supabase/supabase-js` directly for
email/password authentication.

The signup page collects:

- display name;
- normalized email;
- password;
- password confirmation; and
- a Cloudflare Turnstile token.

The page validates required values, the existing minimum password length,
and exact password equality before calling Supabase. The confirmation value
is UI-only and is never sent to Supabase.

`CloudAuth.signUp` accepts a CAPTCHA token and passes it to Supabase as
`options.captchaToken`. When Supabase returns a session, the router loads
the finance snapshot and sends a user without a workspace to onboarding.

Production Supabase Auth will have **Confirm Email disabled**. Supabase then
implicitly confirms a successful email signup and returns a session. If a
future configuration change causes signup to return no session, the client
shows a configuration error rather than presenting email confirmation as a
supported flow.

### Turnstile

The signup form contains a small isolated `TurnstileWidget` that loads the
official Cloudflare script. The public site key is returned by `/config`;
the Turnstile secret is configured in Supabase Auth CAPTCHA settings and is
never stored in the application repository or Worker.

Production Turnstile hostnames include the Workers domain and the approved
local development hostnames. Signup fails closed with a retryable message
when the widget cannot produce a token. Sign-in and password reset are not
blocked by this signup CAPTCHA.

### Auth error mapping

The auth adapter maps stable Supabase Auth codes into application errors
without exposing raw upstream messages:

- `email_exists` -> this email already has an account;
- `email_not_confirmed` -> the account is waiting for admin recovery;
- invalid credentials -> email or password is incorrect;
- banned user -> the account is suspended;
- weak password -> the password does not meet policy;
- CAPTCHA failure -> verification failed, retry the widget;
- rate limit -> too many attempts, wait and retry; and
- network/upstream errors -> the service is temporarily unavailable.

The signup and sign-in pages render the specific Thai message and retain
non-secret form values. Password fields are cleared after an upstream
attempt.

## Super Admin Authorization

The existing `SUPER_ADMIN_USER_ID` remains the sole authority. Email is
never used for authorization.

The existing capability response gains `canManageUsers`. Navigation and
routes use this capability for visibility, but every Worker endpoint
independently verifies the authenticated caller UID against
`SUPER_ADMIN_USER_ID`.

The Worker refuses to suspend, resume, or delete the configured Super Admin.
The Worker also refuses an operation where the authenticated actor and
target user IDs are equal.

The Supabase Secret/Service Role key remains only in Worker runtime secrets.
No user-management operation is added to the browser's direct Supabase
client.

## User Read Model

Migration `202607280014_user_management.sql` adds a Service Role-only
`list_admin_users` database function. It reads `auth.users`, `profiles`,
workspace membership, and private workspace counts, returning sanitized
rows:

- user ID;
- normalized email;
- display name;
- created timestamp;
- last sign-in timestamp;
- email-confirmed timestamp;
- banned-until timestamp;
- private workspace count; and
- deletion-pending status from server-controlled app metadata.

The function supports normalized name/email search and stable cursor
pagination ordered by creation time and user ID. It never returns password
data, identities, tokens, provider secrets, raw metadata, or recovery data.

The RPC and its backing audit data are revoked from `public`, `anon`, and
`authenticated` and granted only to `service_role`.

## Admin API

All routes use the existing error envelope and request ID behavior.

### `GET /v1/admin/users`

Accepts optional `search`, `cursor`, and bounded `limit`. Returns sanitized
users and the next cursor.

### `POST /v1/admin/users/:id/confirm`

Confirms a legacy unconfirmed email through the Supabase Auth Admin API.
Calling it for an already confirmed account is idempotent.

### `POST /v1/admin/users/:id/suspend`

Bans a non-admin account for a long bounded duration. Repeating the action
is idempotent.

### `POST /v1/admin/users/:id/resume`

Removes the ban from a non-admin account unless deletion is pending.
Deletion-pending accounts cannot be resumed accidentally.

### `POST /v1/admin/users/:id/password-reset`

Requests Supabase's normal password-recovery email for the target account.
The Worker never generates or returns a recovery link and never sets a
temporary password. The endpoint is rate limited per target and actor and
returns a neutral result to avoid leaking upstream recovery details.

Password-reset delivery still depends on valid Supabase SMTP configuration.
Disabling signup confirmation does not disable recovery emails.

### `DELETE /v1/admin/users/:id`

Requires:

- the target user ID in the path;
- the exact normalized target email in the request body;
- a client mutation ID; and
- an authenticated Super Admin actor.

The Worker fetches the authoritative Auth user and rejects an email
mismatch, a protected Super Admin target, or a shared-workspace ownership
conflict before changing state.

## Permanent Deletion State Machine

Deleting an Auth user first is currently blocked by foreign keys from
workspaces and finance rows. Deleting finance data first can leave an active
Auth account if the Auth Admin request later fails. The deletion flow
therefore uses a retryable state machine:

1. Verify target ID, target email, actor, and client mutation ID.
2. Reject the configured Super Admin and self-targeting operations.
3. Reject a target that owns a family/shared workspace or has financial
   authorship in another user's workspace. No shared data is deleted
   silently.
4. Ban the target and write server-controlled app metadata
   `baan_ngern_dee_deletion_pending: true`.
5. Call the Service Role-only `purge_private_user_data` RPC.
6. The RPC locks the target deletion record and records the mutation ID.
7. Delete target-owned private workspaces; workspace cascades remove
   accounts, transactions, transfers, installment data, recurring data,
   categories, tags, merchants, and workspace audit rows.
8. Remove the target profile and membership rows that are safe to remove.
9. Write a global user-admin audit event.
10. Delete the Supabase Auth user through the Auth Admin API.
11. Mark the global deletion audit as completed.

The purge RPC is idempotent by target and client mutation ID. If step 10
fails, the Auth user remains banned and marked deletion-pending with no
private finance workspace. A retry skips completed purge work and retries
the Auth deletion. Resume is forbidden while deletion is pending.

The Admin UI requires the actor to type the target's full email before
enabling the final delete button. It states that deletion is permanent.

## Database Changes

Migration `202607280014_user_management.sql` adds:

- `public.user_admin_audit`, readable and writable only by Service Role;
- a uniqueness constraint for destructive client mutation IDs;
- `public.list_admin_users(...)`;
- `public.purge_private_user_data(...)`;
- explicit grants only to `service_role`; and
- `user_invitations.redeemed_user_id` changed to `on delete set null` so
  invitation audit history survives after a redeemed user is deleted.

The global audit records:

- actor user ID;
- target user ID;
- action;
- mutation ID when relevant;
- safe status/result metadata; and
- timestamp.

It does not record passwords, CAPTCHA tokens, access/refresh tokens,
authorization headers, raw invitation tokens, reset links, Supabase keys,
or raw upstream response bodies.

## Admin UI

The `/admin/users` page is visible only with `canManageUsers`.

It provides:

- paginated user rows;
- name/email search;
- status badges for unconfirmed, active, suspended, and deletion pending;
- signup and last-sign-in timestamps;
- private workspace count;
- confirm, suspend, resume, and password-reset actions; and
- a destructive deletion dialog with typed-email confirmation.

Actions use in-page pending states and disable duplicate submissions.
Success refreshes only the affected row or page. Safe Thai error messages
explain conflicts, rate limits, shared-workspace blocks, and retryable
upstream failures.

## Existing Friend Account Recovery

After deployment, the Super Admin opens `/admin/users`, finds the friend's
email, and:

- clicks **ยืนยันบัญชี** if it is unconfirmed;
- clicks **เปิดใช้งาน** if it is suspended; or
- clicks **ส่งรีเซ็ตรหัสผ่าน** if the password is unknown.

No database row is manually edited and no password is sent to the Admin.

## Security Controls

- Keep signup/login passwords browser-to-Supabase only.
- Require Turnstile for public signup.
- Use Supabase and Worker rate limits.
- Enforce Super Admin authorization in every admin endpoint.
- Keep Service Role and Secret keys in Worker secrets only.
- Use sanitized contracts for every Auth Admin response.
- Prevent Super Admin self-suspension and self-deletion.
- Re-fetch authoritative target email before permanent deletion.
- Require a client mutation ID for permanent deletion.
- Keep private data purge RPCs Service Role-only.
- Do not log secrets, password fields, CAPTCHA tokens, recovery links, or
  raw upstream bodies.

Disabling email confirmation means the application does not prove that a
registrant owns the submitted email. Turnstile limits automated abuse but
does not provide email ownership. This is an accepted product trade-off for
instant signup.

## Testing

### Web

- password mismatch prevents the Supabase signup call;
- password confirmation is never sent upstream;
- missing/failed Turnstile prevents signup safely;
- successful signup returns a session and routes to onboarding;
- a no-session signup result is treated as configuration failure;
- stable Auth codes render the correct Thai messages;
- normal users never see the user-management navigation or route;
- user search, pagination, and row actions render correctly;
- destructive deletion remains disabled until the email matches; and
- duplicate clicks do not duplicate admin operations.

### Worker

- every user-management route requires a valid bearer token;
- a normal authenticated user receives 403;
- only the configured Super Admin can manage users;
- Auth Admin responses are sanitized;
- protected Super Admin and self-target operations are rejected;
- confirm, suspend, resume, and password reset are idempotent where
  applicable;
- deletion requires exact authoritative email and a mutation ID;
- deletion-pending accounts cannot be resumed; and
- Auth deletion failure leaves the account banned and retryable.

### Database

- `anon` and `authenticated` cannot select audit rows or execute admin RPCs;
- Service Role can list only the approved sanitized fields;
- search and cursor pagination are stable;
- purge removes all target-owned private finance data;
- purge does not remove another user's workspace data;
- shared/family ownership blocks purge;
- repeated mutation IDs do not repeat destructive work;
- invitation/global audit history survives target deletion; and
- user-admin audit events contain no forbidden secrets.

### Full verification

Run:

```powershell
npm test -- --run
npm run test:db
npm run typecheck
npm run build
```

Run Supabase pgTAP tests when the local Docker-backed stack is available.

## Rollout

The safe production order is:

1. Verify tests and production environment values.
2. Apply missing migration `202607270013_user_invitations.sql`.
3. Apply `202607280014_user_management.sql`.
4. Configure Cloudflare Turnstile and Supabase CAPTCHA.
5. Add the public Turnstile site key to Worker configuration.
6. Deploy the Worker and SPA.
7. Confirm `/health`, `/config`, unauthorized API behavior, and admin
   capability behavior.
8. Disable **Confirm Email** in Supabase Auth provider settings.
9. Recover the friend's legacy account from the Admin page.
10. Create a disposable signup, verify immediate onboarding, exercise
    suspend/resume/reset, and delete it with its data.

Database migrations, Supabase Auth configuration changes, production
secrets, and production deployment require explicit user authorization at
execution time.

## Rollback

- Re-enable Confirm Email to stop instant signup if abuse occurs.
- Disable public signup temporarily in Supabase Auth if necessary.
- Roll back the Worker to the preceding deployment.
- Leave forward database migrations in place and issue corrective forward
  migrations; do not drop production financial data.
- A deletion already completed is intentionally irreversible and cannot be
  restored by Worker rollback.

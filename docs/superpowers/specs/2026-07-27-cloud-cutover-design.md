# Baan Ngern Dee Cloud Cutover Design

## Objective

Replace the production browser's local-only session and finance storage with
Supabase Email Auth and the existing Cloudflare Worker API. Production becomes
cloud-only: finance data is read from and written to Supabase under Row Level
Security (RLS), with no offline finance fallback and no import of old local
data.

## Approved Decisions

- Use Supabase Email and Password authentication.
- Keep Supabase's existing email-confirmation requirement.
- Use the browser for Supabase Auth only.
- Send every finance read and mutation through the Cloudflare Worker.
- Use the Supabase publishable key and the signed-in user's JWT; never use a
  `service_role` or secret key.
- Do not migrate old local finance data.
- Delete the legacy local session and finance keys only after a valid cloud
  session is available.
- Keep the React SPA and API on the same Worker origin.

## Current State

The deployed Worker already serves the React SPA, `/health`, and mutation
routes under `/v1/*`. The browser still creates `LocalFinanceApi`, stores a
display-name-only session, and reads a synchronous snapshot from Local
Storage. The Worker has Supabase-backed mutation repositories but no finance
read endpoint.

Supabase Auth settings verified on 2026-07-27:

- Email provider enabled.
- User signup enabled.
- Email confirmation required.
- Phone and Google providers disabled.

## Target Architecture

### Browser

The browser loads public Supabase configuration from the Worker, initializes
`@supabase/supabase-js`, and subscribes to auth-session changes. It uses a
remote finance client that obtains the current access token for every request
and calls same-origin `/v1/*` endpoints.

The router has explicit boot states:

1. `loading-config`
2. `loading-session`
3. `signed-out`
4. `loading-finance`
5. `ready`
6. `recoverable-error`

Protected pages render only in `ready`. The browser never silently falls back
to local finance storage when cloud initialization fails.

### Cloudflare Worker

The Worker exposes three route classes:

- Public SPA static assets.
- Public infrastructure routes: `/health` and `/config`.
- Authenticated finance routes under `/v1/*`.

`/config` returns only the public configuration needed by the browser:

```json
{
  "supabaseUrl": "https://project-ref.supabase.co",
  "supabasePublishableKey": "sb_publishable_..."
}
```

The endpoint must never return a `service_role`, `sb_secret_...`, database
password, or connection string. Static-asset routing runs the Worker first for
`/config`, `/health`, and `/v1/*`.

### Supabase

Supabase Auth owns user registration, email confirmation, access-token refresh,
password reset, and sign-out. PostgreSQL remains the source of truth for all
finance data. RLS filters every read and mutation using the user's JWT.

A security-invoker database function returns one finance snapshot for the
current user. The Worker calls it with the user's JWT and does not aggregate
data with elevated credentials.

## Authentication Experience

### Sign In

The sign-in form accepts email and password. A successful response establishes
the Supabase session, clears the two legacy keys, loads the finance snapshot,
and routes to onboarding or overview.

### Sign Up

The sign-up form accepts display name, email, and password. The display name is
stored in Supabase user metadata. After signup, the page shows a confirmation
message and does not create a local session.

### Email Confirmation

Supabase redirects confirmed users back to the Worker origin. The SPA restores
the session from the callback and continues to onboarding when no private
workspace exists.

### Password Reset

The sign-in page can request a reset email. The reset link returns to
`/reset-password`, where the user enters and confirms a new password. A
successful update returns to the protected application.

### Sign Out and Expiry

Sign out revokes the local Supabase session and routes to `/sign-in`. Before
each Worker request the finance client asks Supabase for the current session,
allowing the SDK to refresh an expiring token. A Worker `401` triggers one
session refresh attempt. If no valid token is available, the browser signs out
and returns to `/sign-in`.

## Legacy Local Data Removal

The cutover removes only these legacy keys:

- `systems-credit:session:v1`
- `systems-credit:finance:v1`

Removal occurs once, after Supabase reports a valid authenticated session. The
implementation must not call `localStorage.clear()` because that would remove
the Supabase auth session and unrelated browser data. No legacy finance record
is imported or merged.

## Finance Snapshot Contract

The shared contracts package owns `FinanceSnapshot` and its nested read-model
types. The snapshot includes:

- Version number.
- Active private workspace or `null`.
- Categories.
- Accounts and current balances.
- Opening transactions.
- Posted and voided transactions required by the UI.
- Installment contracts.
- Installment schedule rows grouped by contract.
- Installment payments.
- Installment payoffs.

Money remains a decimal string. Dates retain the current financial-date and
ISO timestamp formats. Database snake_case fields are mapped to the shared
camelCase contract at the Worker boundary.

## API Contracts

### `GET /config`

- Authentication: none.
- Success: `200` with public Supabase configuration.
- Misconfiguration: `500` with a safe generic error; no partial key value.

### `GET /v1/snapshot`

- Authentication: Supabase bearer token.
- Success: `200` with `FinanceSnapshot`.
- No workspace: `200` with an empty snapshot and `workspace: null`.
- Invalid or expired token: `401`.
- RLS violation: `403`.

### Mutations

Existing mutation routes remain authoritative. After a successful mutation,
the browser reloads `/v1/snapshot`. Existing `clientMutationId` idempotency and
`expectedVersion` conflict checks remain unchanged.

## Database Read Model

Add a forward-only Supabase migration containing a security-invoker
`get_finance_snapshot()` function. It uses the caller's RLS-visible rows and
returns JSON matching the shared snapshot contract. It must:

- Select at most one active private workspace owned by or shared with the
  current user.
- Return an empty snapshot if none exists.
- Include only rows belonging to that workspace.
- Preserve deterministic ordering for categories, accounts, transactions,
  contracts, schedules, payments, and payoffs.
- Coalesce collection fields to empty arrays or objects rather than `null`.
- Avoid dynamic SQL and elevated execution.

The Worker repository adds a read method that invokes this RPC using the user's
access token.

## Browser Finance Client

`RemoteFinanceApi` implements the existing mutation interface and adds an
asynchronous `getSnapshot()`. It:

- Uses same-origin relative URLs.
- Gets a fresh access token immediately before each request.
- Sends JSON and `Authorization: Bearer <token>`.
- Validates response bodies with shared schemas before exposing them to React.
- Maps structured API errors into UI-safe error objects.
- Never writes finance state to Local Storage.

The router owns the current immutable snapshot. It loads after sign-in and
reloads after every successful mutation. Pages continue receiving a
`FinanceApi` and snapshot through props, minimizing unrelated UI changes.

## Error Handling

- `400`: keep the form open and display field or request validation feedback.
- `401`: attempt one session refresh, then sign out if authentication remains
  invalid.
- `403`: show an access-denied state without revealing another workspace.
- `409`: show the conflict message and reload the snapshot.
- Network error or `5xx`: show a Thai retry state and keep the last successful
  in-memory snapshot visible when available.
- Invalid `/config` or snapshot payload: fail closed with a retry action and no
  local fallback.

Mutation buttons remain disabled while their request is pending. Retrying an
uncertain mutation reuses the original `clientMutationId`.

## Supabase Dashboard Configuration

Before production acceptance:

- Set Auth Site URL to
  `https://baan-ngern-dee.newforico-9ea.workers.dev`.
- Allow redirect URLs for the Worker origin and `/reset-password`.
- Keep email confirmation enabled.
- Keep the runtime `SUPABASE_URL` and `SUPABASE_ANON_KEY` bindings on the
  `baan-ngern-dee` Worker.
- Confirm the configured key is publishable/anon, not service role.

## Testing Strategy

### Unit and Component Tests

- Auth state transitions: loading, signed out, confirmation pending, signed in,
  expired, and signed out.
- Sign-in, sign-up, reset request, password update, and sign-out UI.
- Legacy-key removal occurs after valid cloud auth and never uses
  `localStorage.clear()`.
- Remote client sends the current bearer token.
- Remote client retries authentication once and maps API errors.
- Router selects onboarding versus overview from the remote snapshot.

### Worker Tests

- `/config` is public and returns only allowed fields.
- `/v1/snapshot` requires a valid bearer token.
- Snapshot responses satisfy the shared schema.
- Existing mutation behavior and error responses do not regress.

### Database Tests

- A user can read their own complete snapshot.
- A second user cannot read the first user's workspace or finance rows.
- A new user receives the empty snapshot.
- Snapshot ordering and decimal-string values are deterministic.

### Integration and Production Checks

- Tests, typecheck, web build, and Wrangler dry-run pass.
- Local combined Worker serves the SPA, `/config`, `/health`, and authenticated
  `/v1/snapshot`.
- Production signup sends a confirmation email.
- Confirmed login survives refresh and token renewal.
- Onboarding creates the first cloud workspace.
- Account, transaction, and installment mutations persist after reload.
- Sign out prevents access to protected pages.

## Delivery Sequence

1. Add shared snapshot contracts and the read-model migration.
2. Add repository and Worker snapshot/config routes.
3. Add Supabase browser auth and remote finance client.
4. Refactor the router to asynchronous cloud state.
5. Replace the local sign-in experience and add password reset.
6. Run database, API, component, build, and local integration tests.
7. Apply the Supabase migration.
8. Configure production Auth URLs.
9. Deploy the Worker and complete production acceptance checks.

## Non-Goals

- Importing or merging legacy Local Storage finance data.
- Offline finance writes or background synchronization.
- Google, phone, or other OAuth providers.
- Family-workspace invitation UI.
- Administrative access using elevated Supabase credentials.

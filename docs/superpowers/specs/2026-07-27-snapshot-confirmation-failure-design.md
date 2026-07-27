# Snapshot Failure After Email Confirmation

## Context

After a user confirms their email, Supabase Auth restores a valid browser
session. The application then requests `GET /v1/snapshot`, but the Worker
returns `500 INTERNAL_ERROR` and the UI shows the recoverable cloud error
screen.

Production evidence collected on 2026-07-27:

- The browser has a valid authenticated session.
- `GET /v1/snapshot` reaches the Worker and returns HTTP 500.
- The public Supabase RPC exists and returns the expected empty snapshot
  structure without a user token.
- Running `get_finance_snapshot()` in production as the `authenticated` role
  with the latest confirmed user's `auth.uid()` returns the expected empty
  snapshot.
- The Worker converts known Supabase failures to `ApiError`. The generic
  response therefore places the remaining failure boundary in an unexpected
  runtime error, most likely strict snapshot contract validation.

Email confirmation, redirect configuration, RPC availability, and the empty
snapshot SQL path are not the failing components.

## Goal

Identify the exact invalid snapshot field without exposing user data, reproduce
the mismatch in an automated test, fix the value at its source, and verify the
complete confirmation-to-onboarding flow in production.

## Diagnostic Design

The Worker error handler will emit a sanitized diagnostic only when the caught
error is a Zod validation error. Each issue records:

- the schema path;
- the Zod issue code;
- the expected type or format when Zod supplies it.

The log must not include:

- access or refresh tokens;
- request headers;
- raw snapshot values;
- email addresses or user IDs;
- database credentials;
- complete request or response bodies.

Known `ApiError` responses keep their existing public behavior. Unknown errors
continue returning the same generic Thai message and request ID, so no internal
diagnostic is exposed to the browser.

## Reproduction and Root-Cause Test

Deploy the sanitized diagnostic and reproduce one snapshot request from the
already-confirmed Chrome session. Use the reported schema path and issue code
to create the smallest failing automated test around the relevant contract,
repository mapping, or SQL snapshot helper.

The regression test must fail before the production fix and must use a raw
payload shaped like the production response without copying personal values.

## Fix Boundary

Fix one source of truth:

- If SQL serializes the wrong type or nullable field, add a forward Supabase
  migration that normalizes that field.
- If the shared contract incorrectly rejects a valid database representation,
  update the shared schema narrowly.
- If the repository transforms the response incorrectly, correct that mapping.

Do not use `.passthrough()`, broadly relax strict schemas, suppress parse
errors, or bypass the Worker by calling finance tables directly from the
browser.

## Verification

Before deployment:

1. Run the new regression test and confirm it passes after the fix.
2. Run all Vitest tests.
3. Run database tests when SQL changes.
4. Run TypeScript typechecking.
5. Build the production Worker and web assets.

After deployment:

1. Retry `GET /v1/snapshot` from the confirmed session.
2. Confirm it returns 200.
3. Confirm the user is routed to onboarding when no workspace exists.
4. Confirm `/health` remains 200 and an unauthenticated snapshot remains 401.
5. Confirm browser and Worker logs contain no unexpected errors.

The sanitized validation diagnostic may remain as bounded observability because
it contains schema metadata only. If the final evidence shows it is not useful
after the fix, remove it before the final commit.


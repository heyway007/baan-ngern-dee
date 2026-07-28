# Production User Management Migration Recovery

## Problem

The production Worker exposes the Super Admin user-management routes, but
the linked Supabase database has only applied migrations through
`202607270012`. The production database is missing:

- `202607270013_user_invitations.sql`
- `202607280014_user_management.sql`
- `202607280015_transaction_void_history.sql`

The user-management repository calls the `list_admin_users` RPC created by
migration 014. Because that RPC did not exist in production, the API initially
returned the controlled `USER_ADMIN_ACTION_FAILED` response.

After migrations 013–015 were applied, the production request still returned
the same controlled error. Request tracing and inspection of the SQL contract
identified a second defect: for normal Auth users without the
`baan_ngern_dee_deletion_pending` metadata key, PostgreSQL evaluates
`(raw_app_meta_data ->> key) = 'true'` as `null`. The Worker repository
requires `deletion_pending` to be a boolean, so response parsing fails before
the users reach the web page.

## Selected Approach

Apply all three pending migrations to the already linked Supabase project in
their recorded order with the Supabase CLI. Then add migration 016 to replace
only `list_admin_users`, using `coalesce(..., false)` so every row satisfies
the existing non-null boolean contract. This preserves migration history and
keeps the deployed Worker contract strict.

No Auth user will be confirmed, suspended, deleted, or otherwise modified by
this rollout. The migrations add database functions, audit structures,
constraints, and transaction-void history support.

## Rejected Alternatives

- Bypassing `list_admin_users` with the Supabase Auth Admin HTTP API would lose
  the workspace count and database-backed management/audit behavior.
- Applying migration 014 manually would leave migration history inconsistent
  and skip its dependency on migration 013.
- Relaxing the Worker schema to accept `null` would hide an invalid RPC
  contract and require an unnecessary Worker deployment.

## Rollout

1. Confirm the linked production migration list still shows 013–015 as local
   only.
2. Run `npx supabase db push --include-all`.
3. Re-read the remote migration list and require 013–015 to match locally and
   remotely.
4. Add a database regression assertion proving users without deletion metadata
   return `deletion_pending = false`; verify it fails against migration 014.
5. Add migration 016 with `create or replace function list_admin_users(...)`
   and `coalesce` the deletion flag to `false`.
6. Run the database user-management regression test and the relevant Worker
   user-management tests.
7. Apply migration 016 to the linked Supabase project.
8. Verify the production user-management page can load the Auth user list.

## Failure Handling

If migration application fails, stop without attempting migration repair or
manual SQL. Preserve the CLI error and inspect the exact failed migration.
Because these migrations are forward-only and additive, rollback is performed
through a reviewed corrective migration rather than deleting migration history.

## Success Criteria

- Remote migration history includes 013, 014, 015, and 016.
- The `list_admin_users` RPC is callable by the service role through the Worker.
- Every RPC row contains a non-null boolean `deletion_pending` value.
- The Super Admin page lists registered users without the generic management
  error.
- Existing authentication and finance tests remain green.

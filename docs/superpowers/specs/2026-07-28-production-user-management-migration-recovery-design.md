# Production User Management Migration Recovery

## Problem

The production Worker exposes the Super Admin user-management routes, but
the linked Supabase database has only applied migrations through
`202607270012`. The production database is missing:

- `202607270013_user_invitations.sql`
- `202607280014_user_management.sql`
- `202607280015_transaction_void_history.sql`

The user-management repository calls the `list_admin_users` RPC created by
migration 014. Because that RPC does not exist in production, the API returns
the controlled `USER_ADMIN_ACTION_FAILED` response and the web page cannot
display any users.

## Selected Approach

Apply all three pending migrations to the already linked Supabase project in
their recorded order with the Supabase CLI. This preserves migration history
and installs every database object expected by the Worker version currently
deployed on `main`.

No Auth user will be confirmed, suspended, deleted, or otherwise modified by
this rollout. The migrations add database functions, audit structures,
constraints, and transaction-void history support.

## Rejected Alternatives

- Bypassing `list_admin_users` with the Supabase Auth Admin HTTP API would lose
  the workspace count and database-backed management/audit behavior.
- Applying migration 014 manually would leave migration history inconsistent
  and skip its dependency on migration 013.

## Rollout

1. Confirm the linked production migration list still shows 013–015 as local
   only.
2. Run `npx supabase db push --include-all`.
3. Re-read the remote migration list and require 013–015 to match locally and
   remotely.
4. Run the database user-management regression test and the relevant Worker
   user-management tests.
5. Verify the production user-management page can load the Auth user list.

## Failure Handling

If migration application fails, stop without attempting migration repair or
manual SQL. Preserve the CLI error and inspect the exact failed migration.
Because these migrations are forward-only and additive, rollback is performed
through a reviewed corrective migration rather than deleting migration history.

## Success Criteria

- Remote migration history includes 013, 014, and 015.
- The `list_admin_users` RPC is callable by the service role through the Worker.
- The Super Admin page lists registered users without the generic management
  error.
- Existing authentication and finance tests remain green.

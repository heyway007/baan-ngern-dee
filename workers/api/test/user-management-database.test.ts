import { PGlite } from "@electric-sql/pglite";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationDirectory = fileURLToPath(
  new URL("../../../supabase/migrations/", import.meta.url)
);

const adminId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const otherId = "33333333-3333-4333-8333-333333333333";
const mutationId = "44444444-4444-4444-8444-444444444444";

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (
      id uuid primary key,
      email text unique,
      raw_user_meta_data jsonb not null default '{}'::jsonb,
      raw_app_meta_data jsonb not null default '{}'::jsonb,
      email_confirmed_at timestamptz,
      banned_until timestamptz,
      last_sign_in_at timestamptz,
      created_at timestamptz not null default now()
    );
    create function auth.uid()
    returns uuid
    language sql
    stable
    as $$
      select nullif(
        current_setting('request.jwt.claim.sub', true),
        ''
      )::uuid
    $$;
  `);

  const migrationFiles = (await readdir(migrationDirectory))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const name of migrationFiles) {
    await database.exec(
      await readFile(`${migrationDirectory}${name}`, "utf8")
    );
  }
  await database.query(
    `insert into auth.users (
      id,
      email,
      raw_user_meta_data,
      email_confirmed_at,
      created_at
    ) values
      ($1, 'admin@example.test', '{"display_name":"Admin"}', now(), now()),
      ($2, 'friend@example.test', '{"display_name":"Friend"}', now(), now() - interval '1 minute'),
      ($3, 'other@example.test', '{"display_name":"Other"}', null, now() - interval '2 minutes')`,
    [adminId, userId, otherId]
  );
  return database;
}

describe("local PostgreSQL user management migration", () => {
  it("keeps the audit and RPCs private while listing sanitized users", async () => {
    const database = await createDatabase();
    try {
      for (const role of ["anon", "authenticated"]) {
        await database.exec(`set role ${role}`);
        await expect(
          database.query("select * from public.user_admin_audit")
        ).rejects.toThrow(/permission denied/i);
        await expect(
          database.query(
            "select * from public.list_admin_users('', 25, null, null)"
          )
        ).rejects.toThrow(/permission denied/i);
        await database.exec("reset role");
      }

      await database.exec("set role service_role");
      const listed = await database.query<{
        user_id: string;
        email: string;
        display_name: string;
        status: string;
        deletion_pending: boolean;
      }>(
        "select user_id, email, display_name, status, deletion_pending from public.list_admin_users($1, 25, null, null)",
        ["FRIEND"]
      );
      expect(listed.rows).toEqual([
        {
          user_id: userId,
          email: "friend@example.test",
          display_name: "Friend",
          status: "active",
          deletion_pending: false
        }
      ]);
    } finally {
      await database.close();
    }
  });

  it("purges a private workspace once and completes deletion separately", async () => {
    const database = await createDatabase();
    try {
      const workspaceId =
        "55555555-5555-4555-8555-555555555555";
      await database.query(
        `insert into public.workspaces (
          id,
          owner_user_id,
          name,
          kind,
          base_currency,
          timezone
        ) values ($1, $2, 'Friend finance', 'private', 'THB', 'Asia/Bangkok')`,
        [workspaceId, userId]
      );
      await database.query(
        `insert into public.workspace_members (
          workspace_id,
          user_id,
          role
        ) values ($1, $2, 'owner')`,
        [workspaceId, userId]
      );
      await database.exec("set role service_role");

      const first = await database.query<{
        private_workspaces_deleted: number;
      }>(
        "select * from public.purge_private_user_data($1, $2, $3, $4)",
        [adminId, userId, mutationId, "friend@example.test"]
      );
      const repeated = await database.query<{
        private_workspaces_deleted: number;
      }>(
        "select * from public.purge_private_user_data($1, $2, $3, $4)",
        [adminId, userId, mutationId, "friend@example.test"]
      );
      expect(first.rows[0]?.private_workspaces_deleted).toBe(1);
      expect(repeated.rows).toEqual(first.rows);

      const pending = await database.query<{
        purge_completed_at: string | null;
        completed_at: string | null;
      }>(
        `select purge_completed_at, completed_at
        from public.user_admin_audit
        where client_mutation_id = $1`,
        [mutationId]
      );
      expect(pending.rows[0]?.purge_completed_at).not.toBeNull();
      expect(pending.rows[0]?.completed_at).toBeNull();

      await database.query(
        "select public.complete_user_deletion($1, $2, $3)",
        [adminId, userId, mutationId]
      );
      await database.query(
        "select public.complete_user_deletion($1, $2, $3)",
        [adminId, userId, mutationId]
      );
      const state = await database.query<{
        purge_completed: boolean;
        completed: boolean;
      }>(
        "select * from public.get_user_deletion_state($1, $2)",
        [userId, mutationId]
      );
      expect(state.rows).toEqual([
        { purge_completed: true, completed: true }
      ]);
    } finally {
      await database.close();
    }
  });

  it("rejects deleting a user connected to a family workspace", async () => {
    const database = await createDatabase();
    try {
      const workspaceId =
        "66666666-6666-4666-8666-666666666666";
      await database.query(
        `insert into public.workspaces (
          id,
          owner_user_id,
          name,
          kind,
          base_currency,
          timezone
        ) values ($1, $2, 'Family finance', 'family', 'THB', 'Asia/Bangkok')`,
        [workspaceId, adminId]
      );
      await database.query(
        `insert into public.workspace_members (
          workspace_id,
          user_id,
          role
        ) values ($1, $2, 'editor')`,
        [workspaceId, userId]
      );
      await database.exec("set role service_role");

      await expect(
        database.query(
          "select * from public.purge_private_user_data($1, $2, $3, $4)",
          [adminId, userId, mutationId, "friend@example.test"]
        )
      ).rejects.toThrow(/USER_SHARED_DATA_CONFLICT/);
    } finally {
      await database.close();
    }
  });

  it("rate limits password reset audits and preserves invitation history", async () => {
    const database = await createDatabase();
    try {
      await database.exec("set role service_role");
      await database.query(
        "select public.record_user_admin_action($1, $2, $3, $4)",
        [
          adminId,
          userId,
          "password_reset_requested",
          JSON.stringify({})
        ]
      );
      await expect(
        database.query(
          "select public.record_user_admin_action($1, $2, $3, $4)",
          [
            adminId,
            userId,
            "password_reset_requested",
            JSON.stringify({})
          ]
        )
      ).rejects.toThrow(/USER_ADMIN_RATE_LIMITED/);

      const constraint = await database.query<{
        confdeltype: string;
      }>(
        `select confdeltype
        from pg_constraint
        where conname = 'user_invitations_redeemed_user_id_fkey'`
      );
      expect(constraint.rows).toEqual([{ confdeltype: "n" }]);

      await database.query(
        `insert into public.user_invitations (
          email,
          display_name,
          token_hash,
          created_by,
          expires_at,
          status,
          redeemed_claim_id,
          redeemed_at,
          redeemed_user_id
        ) values (
          'friend@example.test',
          'Friend',
          $1,
          $2,
          now() + interval '1 day',
          'redeemed',
          $3,
          now(),
          $4
        )`,
        [
          "f".repeat(64),
          adminId,
          "77777777-7777-4777-8777-777777777777",
          userId
        ]
      );
      await database.exec("reset role");
      await database.query(
        "delete from auth.users where id = $1",
        [userId]
      );
      const preserved = await database.query<{
        redeemed_user_id: string | null;
      }>(
        `select redeemed_user_id
        from public.user_invitations
        where email = 'friend@example.test'`
      );
      expect(preserved.rows).toEqual([
        { redeemed_user_id: null }
      ]);
    } finally {
      await database.close();
    }
  });
});

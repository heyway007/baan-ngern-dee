import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationDirectory = fileURLToPath(
  new URL("../../../supabase/migrations/", import.meta.url)
);

async function loadMigration(name: string) {
  return readFile(`${migrationDirectory}${name}`, "utf8");
}

describe("local PostgreSQL account migration", () => {
  it("creates zero-balance metadata and hides it from an outsider", async () => {
    const database = new PGlite();
    await database.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create schema auth;
      create table auth.users (id uuid primary key, email text);
      create function auth.uid()
      returns uuid language sql stable
      as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
    `);
    for (const migration of [
      "202607260001_identity_workspaces.sql",
      "202607260002_catalog_audit_rls.sql",
      "202607260003_accounts.sql"
    ]) {
      await database.exec(await loadMigration(migration));
    }

    const ownerId = "11111111-1111-4111-8111-111111111111";
    const outsiderId = "22222222-2222-4222-8222-222222222222";
    await database.query(
      "insert into auth.users (id) values ($1), ($2)",
      [ownerId, outsiderId]
    );
    await database.exec(`
      grant usage on schema auth to authenticated;
      grant execute on function auth.uid() to authenticated;
      set role authenticated;
      select set_config(
        'request.jwt.claim.sub',
        '11111111-1111-4111-8111-111111111111',
        false
      );
    `);
    const workspace = await database.query<{ id: string }>(
      "select id from public.create_private_workspace($1, $2, $3)",
      ["การเงินของฉัน", "THB", "Asia/Bangkok"]
    );
    const workspaceId = workspace.rows[0]?.id;
    const account = await database.query<{
      id: string;
      currency: string;
      type: string;
    }>(
      "select id, currency, type from public.create_account($1, $2, $3, $4, $5)",
      [workspaceId, "บัญชีเงินเดือน", "bank", "THB", null]
    );
    expect(account.rows[0]).toMatchObject({
      currency: "THB",
      type: "bank"
    });

    const openingBalanceColumn = await database.query<{ count: number }>(
      `select count(*)::int as count
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'accounts'
         and column_name = 'opening_balance'`
    );
    expect(openingBalanceColumn.rows[0]?.count).toBe(0);

    await database.exec(
      `select set_config('request.jwt.claim.sub', '${outsiderId}', false)`
    );
    const hidden = await database.query<{ id: string }>(
      "select id from public.accounts where workspace_id = $1",
      [workspaceId]
    );
    expect(hidden.rows).toEqual([]);

    await database.close();
  });
});

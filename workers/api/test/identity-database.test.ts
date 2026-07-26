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

describe("local PostgreSQL identity and RLS migrations", () => {
  it("creates one private workspace, seeds categories, and isolates another user", async () => {
    const database = new PGlite();
    await database.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create schema auth;
      create table auth.users (
        id uuid primary key,
        email text
      );
      create function auth.uid()
      returns uuid
      language sql
      stable
      as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
    `);
    await database.exec(
      await loadMigration("202607260001_identity_workspaces.sql")
    );
    await database.exec(
      await loadMigration("202607260002_catalog_audit_rls.sql")
    );

    const ownerId = "11111111-1111-4111-8111-111111111111";
    const strangerId = "22222222-2222-4222-8222-222222222222";
    await database.query(
      "insert into auth.users (id, email) values ($1, 'owner@example.test'), ($2, 'stranger@example.test')",
      [ownerId, strangerId]
    );
    await database.exec(`
      grant usage on schema auth to authenticated;
      grant execute on function auth.uid() to authenticated;
      set role authenticated;
    `);
    await database.exec(
      `select set_config('request.jwt.claim.sub', '${ownerId}', false)`
    );
    const created = await database.query<{
      id: string;
      base_currency: string;
      timezone: string;
    }>(
      "select id, base_currency, timezone from public.create_private_workspace($1, $2, $3)",
      ["การเงินของฉัน", "THB", "Asia/Bangkok"]
    );

    expect(created.rows).toHaveLength(1);
    expect(created.rows[0]).toMatchObject({
      base_currency: "THB",
      timezone: "Asia/Bangkok"
    });

    const workspaceId = created.rows[0]?.id;
    const categories = await database.query<{ count: number }>(
      "select count(*)::int as count from public.categories where workspace_id = $1",
      [workspaceId]
    );
    expect(categories.rows[0]?.count).toBe(18);

    await database.exec(
      `select set_config('request.jwt.claim.sub', '${strangerId}', false)`
    );
    const hidden = await database.query<{ id: string }>(
      "select id from public.workspaces where id = $1",
      [workspaceId]
    );
    expect(hidden.rows).toEqual([]);

    await database.close();
  });
});

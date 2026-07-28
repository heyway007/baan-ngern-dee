import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationDirectory = fileURLToPath(
  new URL("../../../supabase/migrations/", import.meta.url)
);

async function migration(name: string) {
  return readFile(`${migrationDirectory}${name}`, "utf8");
}

describe("slip import database migration", () => {
  it("enforces quotas and stores a document with its transaction atomically", async () => {
    const db = new PGlite();
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create schema auth;
      create table auth.users (id uuid primary key, email text);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
    `);
    for (const name of [
      "202607260001_identity_workspaces.sql",
      "202607260002_catalog_audit_rls.sql",
      "202607260003_accounts.sql",
      "202607260004_transactions.sql",
      "202607280017_slip_imports.sql",
      "202607290018_batch_slip_imports.sql"
    ]) {
      await db.exec(await migration(name));
    }
    const userId = "11111111-1111-4111-8111-111111111111";
    const secondUserId = "22222222-2222-4222-8222-222222222222";
    await db.query("insert into auth.users (id) values ($1), ($2)", [
      userId,
      secondUserId
    ]);
    await db.exec(`
      grant usage on schema auth to authenticated;
      grant execute on function auth.uid() to authenticated;
      set role authenticated;
      select set_config('request.jwt.claim.sub',
        '11111111-1111-4111-8111-111111111111', false);
    `);
    const workspace = await db.query<{ id: string }>(
      "select id from public.create_private_workspace($1,$2,$3)",
      ["ทดสอบ", "THB", "Asia/Bangkok"]
    );
    const workspaceId = workspace.rows[0]!.id;
    const initial = await db.query<{
      result: { used: number; limit: number };
    }>(
      "select public.get_slip_analysis_quota($1) result",
      [workspaceId]
    );
    expect(initial.rows[0]!.result).toEqual({ used: 0, limit: 30 });

    for (let index = 0; index < 30; index += 1) {
      const result = await db.query<{
        result: { allowed: boolean; used: number; limit: number };
      }>(
        "select public.consume_slip_analysis_quota($1) result",
        [workspaceId]
      );
      expect(result.rows[0]!.result).toEqual({
        allowed: true,
        used: index + 1,
        limit: 30
      });
    }

    const after = await db.query<{
      result: { used: number; limit: number };
    }>(
      "select public.get_slip_analysis_quota($1) result",
      [workspaceId]
    );
    expect(after.rows[0]!.result).toEqual({ used: 30, limit: 30 });
    await db.exec("reset role");
    const count = await db.query<{ count: number }>(
      "select count(*)::int count from public.slip_analysis_attempts"
    );
    expect(count.rows[0]!.count).toBe(30);

    await db.query(
      `insert into public.workspace_members (workspace_id, user_id, role)
       values ($1, $2, 'editor')`,
      [workspaceId, secondUserId]
    );
    await db.exec(`
      set role authenticated;
      select set_config('request.jwt.claim.sub',
        '22222222-2222-4222-8222-222222222222', false);
    `);
    const denied = await db.query<{
      result: {
        allowed: boolean;
        reason: string;
        used: number;
        limit: number;
      };
    }>(
      "select public.consume_slip_analysis_quota($1) result",
      [workspaceId]
    );
    expect(denied.rows[0]!.result).toEqual({
      allowed: false,
      reason: "workspace_day",
      used: 30,
      limit: 30
    });
    await db.exec("reset role");
    const finalCount = await db.query<{ count: number }>(
      "select count(*)::int count from public.slip_analysis_attempts"
    );
    expect(finalCount.rows[0]!.count).toBe(30);
  });
});

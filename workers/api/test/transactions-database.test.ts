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

describe("local PostgreSQL transaction migration", () => {
  it("posts, rejects partial splits, and voids atomically", async () => {
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
      "202607260003_accounts.sql",
      "202607260004_transactions.sql"
    ]) {
      await database.exec(await loadMigration(migration));
    }

    const ownerId = "11111111-1111-4111-8111-111111111111";
    await database.query("insert into auth.users (id) values ($1)", [
      ownerId
    ]);
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
    const workspaceId = workspace.rows[0]!.id;
    const accountResult = await database.query<{
      result: {
        account: { id: string };
        accountBalance: { amount: string };
      };
    }>(
      "select public.create_account_with_opening_balance($1::jsonb) as result",
      [
        JSON.stringify({
          workspaceId,
          name: "เงินสด",
          type: "cash",
          currency: "THB",
          openingBalance: "1000.00"
        })
      ]
    );
    const accountId = accountResult.rows[0]!.result.account.id;
    expect(accountResult.rows[0]!.result.accountBalance.amount).toBe(
      "1000.00"
    );
    const category = await database.query<{ id: string }>(
      "select id from public.categories where workspace_id = $1 and slug = 'food'",
      [workspaceId]
    );
    const categoryId = category.rows[0]!.id;

    const posted = await database.query<{
      result: {
        transactionId: string;
        accountBalances: Array<{ amount: string }>;
      };
    }>("select public.post_transaction($1::jsonb) as result", [
      JSON.stringify({
        workspaceId,
        accountId,
        type: "expense",
        amount: "125.50",
        currency: "THB",
        financialDate: "2026-07-27",
        categoryId,
        clientMutationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
      })
    ]);
    expect(posted.rows[0]!.result.accountBalances[0]!.amount).toBe(
      "874.50"
    );

    await expect(
      database.query("select public.post_transaction($1::jsonb)", [
        JSON.stringify({
          workspaceId,
          accountId,
          type: "expense",
          amount: "100.00",
          currency: "THB",
          financialDate: "2026-07-27",
          splits: [
            { categoryId, amount: "60.00" },
            { categoryId, amount: "39.99" }
          ],
          clientMutationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
        })
      ])
    ).rejects.toThrow(/split total mismatch/i);
    const countAfterFailure = await database.query<{ count: number }>(
      "select count(*)::int as count from public.transactions where type = 'expense'"
    );
    expect(countAfterFailure.rows[0]!.count).toBe(1);

    const transactionId = posted.rows[0]!.result.transactionId;
    await expect(
      database.query(
        "select public.void_transaction($1, $2, $3)",
        [transactionId, 9, "stale"]
      )
    ).rejects.toThrow(/stale version/i);
    const voided = await database.query<{
      result: {
        state: string;
        accountBalances: Array<{ amount: string }>;
      };
    }>(
      "select public.void_transaction($1, $2, $3) as result",
      [transactionId, 1, "บันทึกผิดรายการ"]
    );
    expect(voided.rows[0]!.result.state).toBe("void");
    expect(voided.rows[0]!.result.accountBalances[0]!.amount).toBe(
      "1000.00"
    );

    await database.close();
  });
});

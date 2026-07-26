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

describe("local PostgreSQL transfer migration", () => {
  it("posts both principal legs once and excludes them from income and expense", async () => {
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
      "202607260004_transactions.sql",
      "202607260005_transfers.sql"
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

    async function createAccount(name: string, openingBalance: string) {
      const result = await database.query<{
        result: { account: { id: string } };
      }>(
        "select public.create_account_with_opening_balance($1::jsonb) as result",
        [
          JSON.stringify({
            workspaceId,
            name,
            type: "cash",
            currency: "THB",
            openingBalance
          })
        ]
      );
      return result.rows[0]!.result.account.id;
    }

    const sourceAccountId = await createAccount("ต้นทาง", "1000.00");
    const destinationAccountId = await createAccount("ปลายทาง", "0.00");
    const transferInput = {
      workspaceId,
      sourceAccountId,
      destinationAccountId,
      sourceAmount: "300.00",
      sourceCurrency: "THB",
      destinationAmount: "300.00",
      destinationCurrency: "THB",
      feeAmount: "0.00",
      financialDate: "2026-07-27",
      clientMutationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    };
    const posted = await database.query<{
      result: {
        transferId: string;
        accountBalances: Array<{ accountId: string; amount: string }>;
      };
    }>("select public.post_transfer($1::jsonb) as result", [
      JSON.stringify(transferInput)
    ]);
    expect(posted.rows[0]!.result.accountBalances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          accountId: sourceAccountId,
          amount: "700.00"
        }),
        expect.objectContaining({
          accountId: destinationAccountId,
          amount: "300.00"
        })
      ])
    );

    const retry = await database.query<{
      result: { transferId: string };
    }>("select public.post_transfer($1::jsonb) as result", [
      JSON.stringify(transferInput)
    ]);
    expect(retry.rows[0]!.result.transferId).toBe(
      posted.rows[0]!.result.transferId
    );
    const counts = await database.query<{
      transfers: number;
      income_expense: number;
    }>(`
      select
        (select count(*)::int from public.transfers) as transfers,
        (
          select count(*)::int
          from public.transactions
          where type in ('income', 'expense')
        ) as income_expense
    `);
    expect(counts.rows[0]).toEqual({
      transfers: 1,
      income_expense: 0
    });

    await database.close();
  });
});

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

describe("financial planning database migration", () => {
  it("calculates rollover, follows account balances, and isolates workspaces", async () => {
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
      "202607260005_transfers.sql",
      "202607270009_installment_contracts.sql",
      "202607270010_finance_snapshot.sql",
      "202607270011_recurring_items.sql",
      "202607270012_recurring_snapshot.sql",
      "202607290019_financial_planning.sql"
    ]) {
      await database.exec(await loadMigration(migration));
    }

    const ownerId = "11111111-1111-4111-8111-111111111111";
    const strangerId = "22222222-2222-4222-8222-222222222222";
    await database.query(
      "insert into auth.users (id) values ($1), ($2)",
      [ownerId, strangerId]
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
      ["แผนของฉัน", "THB", "Asia/Bangkok"]
    );
    const workspaceId = workspace.rows[0]!.id;
    const account = await database.query<{
      result: { account: { id: string } };
    }>(
      "select public.create_account_with_opening_balance($1::jsonb) as result",
      [
        JSON.stringify({
          workspaceId,
          name: "บัญชีออม",
          type: "bank",
          currency: "THB",
          openingBalance: "12000.00"
        })
      ]
    );
    const accountId = account.rows[0]!.result.account.id;
    const category = await database.query<{ id: string }>(
      "select id from public.categories where workspace_id = $1 and slug = 'food'",
      [workspaceId]
    );
    const categoryId = category.rows[0]!.id;

    for (const month of ["2026-01", "2026-02", "2026-03"]) {
      await database.query(
        "select public.set_monthly_budget($1::jsonb)",
        [
          JSON.stringify({
            workspaceId,
            categoryId,
            month,
            amount: "1000.00"
          })
        ]
      );
    }
    for (const [date, amount, mutation] of [
      ["2026-01-15", "700.00", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
      ["2026-02-15", "1500.00", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
      ["2026-03-15", "200.00", "cccccccc-cccc-4ccc-8ccc-cccccccccccc"]
    ]) {
      await database.query(
        "select public.post_transaction($1::jsonb)",
        [
          JSON.stringify({
            workspaceId,
            accountId,
            categoryId,
            type: "expense",
            amount,
            currency: "THB",
            financialDate: date,
            tagIds: [],
            clientMutationId: mutation
          })
        ]
      );
    }

    const goal = await database.query<{
      result: { id: string; accountType: string };
    }>(
      "select public.create_savings_goal($1::jsonb) as result",
      [
        JSON.stringify({
          workspaceId,
          name: "เงินฉุกเฉิน",
          targetAmount: "50000.00",
          currency: "THB",
          accountId
        })
      ]
    );
    expect(goal.rows[0]!.result.accountType).toBe("bank");

    const plan = await database.query<{
      result: {
        totals: {
          baseBudget: string;
          priorCarry: string;
          available: string;
          spent: string;
          remaining: string;
        };
        goals: Array<{
          currentAmount: string;
          percent: number;
          reached: boolean;
        }>;
      };
    }>(
      "select public.get_financial_plan($1, $2) as result",
      [workspaceId, "2026-03"]
    );
    expect(plan.rows[0]!.result.totals).toEqual({
      baseBudget: "1000.00",
      priorCarry: "-200.00",
      available: "800.00",
      spent: "200.00",
      remaining: "600.00"
    });
    expect(plan.rows[0]!.result.goals[0]).toMatchObject({
      currentAmount: "9600.00",
      percent: 19.2,
      reached: false
    });

    await expect(
      database.query(
        "select public.create_savings_goal($1::jsonb)",
        [
          JSON.stringify({
            workspaceId,
            name: "เที่ยว",
            targetAmount: "20000.00",
            currency: "THB",
            accountId
          })
        ]
      )
    ).rejects.toThrow(/active savings goal|already linked/i);

    await database.query(
      "select set_config('request.jwt.claim.sub', $1, false)",
      [strangerId]
    );
    expect(
      (
        await database.query<{ count: number }>(
          "select count(*)::int as count from public.monthly_budget_allocations"
        )
      ).rows[0]!.count
    ).toBe(0);
    await expect(
      database.query(
        "select public.get_financial_plan($1, $2)",
        [workspaceId, "2026-03"]
      )
    ).rejects.toThrow(/access denied/i);

    await database.close();
  });
});

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

describe("local PostgreSQL installment migration", () => {
  it("creates, pays, and closes a contract atomically and idempotently", async () => {
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
      "202607270009_installment_contracts.sql"
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
    const expenseCategories = await database.query<{
      id: string;
      slug: string;
    }>(
      "select id, slug from public.categories where workspace_id = $1 and slug in ('debt-interest', 'financial-fees')",
      [workspaceId]
    );
    const interestCategoryId = expenseCategories.rows.find(
      (category) => category.slug === "debt-interest"
    )!.id;
    const feeCategoryId = expenseCategories.rows.find(
      (category) => category.slug === "financial-fees"
    )!.id;
    const account = await database.query<{
      result: { account: { id: string } };
    }>(
      "select public.create_account_with_opening_balance($1::jsonb) as result",
      [
        JSON.stringify({
          workspaceId,
          name: "บัญชีจ่ายหนี้",
          type: "bank",
          currency: "THB",
          openingBalance: "50000.00"
        })
      ]
    );
    const accountId = account.rows[0]!.result.account.id;

    const createInput = {
      workspaceId,
      name: "หนี้ทดสอบ",
      kind: "debt",
      originalPrincipal: "12000.00",
      downPayment: "0.00",
      financedPrincipal: "12000.00",
      financedFees: "0.00",
      currency: "THB",
      interestMethod: "flat",
      annualRate: "12",
      periods: 2,
      firstDueDate: "2026-08-01",
      interestCategoryId,
      expenseCategoryId: feeCategoryId,
      clientMutationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      schedule: [
        {
          sequence: 1,
          dueDate: "2026-08-01",
          openingPrincipal: "12000.00",
          principal: "6000.00",
          interest: "120.00",
          fees: "0.00",
          total: "6120.00",
          closingPrincipal: "6000.00"
        },
        {
          sequence: 2,
          dueDate: "2026-09-01",
          openingPrincipal: "6000.00",
          principal: "6000.00",
          interest: "120.00",
          fees: "0.00",
          total: "6120.00",
          closingPrincipal: "0.00"
        }
      ]
    };
    const created = await database.query<{
      result: {
        contract: { id: string; version: number };
        schedule: unknown[];
      };
    }>(
      "select public.create_installment_contract($1::jsonb) -> 'response' as result",
      [JSON.stringify(createInput)]
    );
    const retried = await database.query<{
      result: { contract: { id: string } };
    }>(
      "select public.create_installment_contract($1::jsonb) -> 'response' as result",
      [JSON.stringify(createInput)]
    );
    expect(created.rows[0]!.result.schedule).toHaveLength(2);
    expect(retried.rows[0]!.result.contract.id).toBe(
      created.rows[0]!.result.contract.id
    );

    const contractId = created.rows[0]!.result.contract.id;
    const paid = await database.query<{
      result: {
        paymentId: string;
        allocation: Record<string, string>;
        contractVersion: number;
        accountBalance: { amount: string };
      };
    }>(
      "select public.post_installment_payment($1::jsonb) -> 'response' as result",
      [
        JSON.stringify({
          workspaceId,
          contractId,
          sequence: 1,
          accountId,
          amount: "6120.00",
          penaltyAmount: "0.00",
          currency: "THB",
          financialDate: "2026-08-01",
          expectedVersion: 1,
          clientMutationId:
            "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
        })
      ]
    );
    const paidRetry = await database.query<{
      result: { paymentId: string };
    }>(
      "select public.post_installment_payment($1::jsonb) -> 'response' as result",
      [
        JSON.stringify({
          workspaceId,
          contractId,
          sequence: 1,
          accountId,
          amount: "6120.00",
          penaltyAmount: "0.00",
          currency: "THB",
          financialDate: "2026-08-01",
          expectedVersion: 1,
          clientMutationId:
            "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
        })
      ]
    );
    expect(paidRetry.rows[0]!.result.paymentId).toBe(
      paid.rows[0]!.result.paymentId
    );
    expect(paid.rows[0]!.result.allocation).toMatchObject({
      interest: "120.00",
      principal: "6000.00",
      total: "6120.00"
    });
    expect(paid.rows[0]!.result.contractVersion).toBe(2);
    expect(paid.rows[0]!.result.accountBalance.amount).toBe(
      "43880.00"
    );

    const payoff = await database.query<{
      result: {
        reportableExpense: string;
        totalCashRequired: string;
        contractStatus: string;
        accountBalance: { amount: string };
      };
    }>(
      "select public.post_installment_payoff($1::jsonb) -> 'response' as result",
      [
        JSON.stringify({
          workspaceId,
          contractId,
          accountId,
          action: "payoff",
          expectedRemainingPrincipal: "6000.00",
          quotedInterest: "100.00",
          quotedFees: "50.00",
          principalPayment: "6000.00",
          totalCashRequired: "6150.00",
          remainingPrincipal: "0.00",
          interestSaved: "20.00",
          currency: "THB",
          financialDate: "2026-08-02",
          expectedVersion: 2,
          regeneratedRows: [],
          clientMutationId:
            "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
        })
      ]
    );
    expect(payoff.rows[0]!.result).toMatchObject({
      reportableExpense: "150.00",
      totalCashRequired: "6150.00",
      contractStatus: "paid_off",
      accountBalance: { amount: "37730.00" }
    });

    const partialContractInput = {
      ...createInput,
      name: "หนี้จ่ายบางส่วน",
      originalPrincipal: "100.00",
      financedPrincipal: "100.00",
      interestMethod: "manual",
      annualRate: "0",
      firstDueDate: "2026-10-01",
      clientMutationId:
        "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      schedule: [
        {
          sequence: 1,
          dueDate: "2026-10-01",
          openingPrincipal: "100.00",
          principal: "50.00",
          interest: "10.00",
          fees: "2.00",
          total: "62.00",
          closingPrincipal: "50.00"
        },
        {
          sequence: 2,
          dueDate: "2026-11-01",
          openingPrincipal: "50.00",
          principal: "50.00",
          interest: "10.00",
          fees: "2.00",
          total: "62.00",
          closingPrincipal: "0.00"
        }
      ]
    };
    const partialContract = await database.query<{
      result: { contract: { id: string } };
    }>(
      "select public.create_installment_contract($1::jsonb) -> 'response' as result",
      [JSON.stringify(partialContractInput)]
    );
    const partialContractId =
      partialContract.rows[0]!.result.contract.id;
    await database.query(
      "select public.post_installment_payment($1::jsonb)",
      [
        JSON.stringify({
          workspaceId,
          contractId: partialContractId,
          sequence: 1,
          accountId,
          amount: "10.00",
          penaltyAmount: "0.00",
          currency: "THB",
          financialDate: "2026-10-01",
          expectedVersion: 1,
          clientMutationId:
            "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
        })
      ]
    );
    const maliciousExtra = {
      workspaceId,
      contractId: partialContractId,
      accountId,
      action: "extra_principal",
      strategy: "reduce_payment",
      extraPrincipal: "20.00",
      expectedRemainingPrincipal: "100.00",
      quotedInterest: "0.00",
      quotedFees: "0.00",
      principalPayment: "20.00",
      totalCashRequired: "20.00",
      remainingPrincipal: "80.00",
      interestSaved: "12.00",
      currency: "THB",
      financialDate: "2026-10-02",
      expectedVersion: 2,
      regeneratedRows: [
        {
          sequence: 1,
          dueDate: "2026-10-01",
          openingPrincipal: "1.00",
          principal: "1.00",
          interest: "0.00",
          fees: "0.00",
          total: "1.00",
          closingPrincipal: "0.00"
        }
      ],
      clientMutationId:
        "ffffffff-ffff-4fff-8fff-ffffffffffff"
    };
    await expect(
      database.query(
        "select public.post_installment_payoff($1::jsonb)",
        [JSON.stringify(maliciousExtra)]
      )
    ).rejects.toThrow(/regenerated schedule/);

    const validExtra = {
      ...maliciousExtra,
      interestSaved: "0.00",
      regeneratedRows: [
        {
          sequence: 1,
          dueDate: "2026-10-01",
          openingPrincipal: "80.00",
          principal: "40.00",
          interest: "6.00",
          fees: "1.00",
          total: "47.00",
          closingPrincipal: "40.00"
        },
        {
          sequence: 2,
          dueDate: "2026-11-01",
          openingPrincipal: "40.00",
          principal: "40.00",
          interest: "6.00",
          fees: "1.00",
          total: "47.00",
          closingPrincipal: "0.00"
        }
      ],
      clientMutationId:
        "abababab-abab-4bab-8bab-abababababab"
    };
    const extra = await database.query<{
      result: {
        contractStatus: string;
        remainingPrincipal: string;
        accountBalance: { amount: string };
      };
    }>(
      "select public.post_installment_payoff($1::jsonb) -> 'response' as result",
      [JSON.stringify(validExtra)]
    );
    expect(extra.rows[0]!.result).toMatchObject({
      contractStatus: "active",
      remainingPrincipal: "80.00",
      accountBalance: { amount: "37700.00" }
    });
    const scheduleHistory = await database.query<{
      total: number;
      cancelled: number;
      active_principal: string;
    }>(
      `
        select
          count(*)::int as total,
          count(*) filter (where status = 'cancelled')::int
            as cancelled,
          sum(scheduled_principal) filter (
            where status not in ('cancelled', 'waived')
          )::numeric(20, 4)::text as active_principal
        from public.installment_schedule_rows
        where contract_id = $1
      `,
      [partialContractId]
    );
    expect(scheduleHistory.rows[0]).toEqual({
      total: 4,
      cancelled: 2,
      active_principal: "80.0000"
    });
    await expect(
      database.query(
        "select public.create_installment_contract($1::jsonb)",
        [
          JSON.stringify({
            ...createInput,
            name: "เปลี่ยน payload แต่ใช้ mutation เดิม"
          })
        ]
      )
    ).rejects.toThrow(/mutation payload mismatch/);
    await expect(
      database.query(
        "select public.post_installment_payment($1::jsonb)",
        [
          JSON.stringify({
            workspaceId,
            contractId: partialContractId,
            sequence: 1,
            accountId,
            amount: "1.00",
            penaltyAmount: "0.00",
            currency: "THB",
            financialDate: "2026-10-03",
            expectedVersion: 2,
            clientMutationId:
              "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd"
          })
        ]
      )
    ).rejects.toThrow(/stale version/);
    const concurrentInput = {
      ...createInput,
      name: "สัญญาส่งซ้ำพร้อมกัน",
      clientMutationId:
        "dededede-dede-4ede-8ede-dededededede"
    };
    const concurrent = await Promise.all([
      database.query<{
        result: {
          response: { contract: { id: string } };
          replayed: boolean;
        };
      }>(
        "select public.create_installment_contract($1::jsonb) as result",
        [JSON.stringify(concurrentInput)]
      ),
      database.query<{
        result: {
          response: { contract: { id: string } };
          replayed: boolean;
        };
      }>(
        "select public.create_installment_contract($1::jsonb) as result",
        [JSON.stringify(concurrentInput)]
      )
    ]);
    expect(
      concurrent.map((result) => result.rows[0]!.result.replayed)
    ).toEqual([false, true]);
    expect(
      concurrent[0]!.rows[0]!.result.response.contract.id
    ).toBe(concurrent[1]!.rows[0]!.result.response.contract.id);

    const counts = await database.query<{
      contracts: number;
      payments: number;
      payoffs: number;
      expenses: string;
    }>(`
      select
        (select count(*)::int from public.installment_contracts)
          as contracts,
        (select count(*)::int from public.installment_payments)
          as payments,
        (select count(*)::int from public.installment_payoffs)
          as payoffs,
        (
          select sum(amount)::numeric(20, 4)::text
          from public.transactions
          where type = 'expense'
        ) as expenses
    `);
    expect(counts.rows[0]).toEqual({
      contracts: 3,
      payments: 2,
      payoffs: 2,
      expenses: "280.0000"
    });
    const categorizedExpenses = await database.query<{
      slug: string;
      amount: string;
    }>(`
      select
        category.slug,
        sum(transaction.amount)::numeric(20, 4)::text as amount
      from public.transactions transaction
      join public.categories category
        on category.id = transaction.category_id
      where transaction.type = 'expense'
      group by category.slug
      order by category.slug
    `);
    expect(categorizedExpenses.rows).toEqual([
      { slug: "debt-interest", amount: "228.0000" },
      { slug: "financial-fees", amount: "52.0000" }
    ]);

    await database.exec("reset role");
    await database.query(
      "delete from public.workspace_members where workspace_id = $1 and user_id = $2",
      [workspaceId, ownerId]
    );
    const removedMembership = await database.query<{ count: number }>(
      "select count(*)::int as count from public.workspace_members where workspace_id = $1 and user_id = $2",
      [workspaceId, ownerId]
    );
    expect(removedMembership.rows[0]!.count).toBe(0);
    await database.exec(`
      set role authenticated;
      select set_config(
        'request.jwt.claim.sub',
        '11111111-1111-4111-8111-111111111111',
        false
      );
    `);
    await expect(
      database.query(
        "select public.post_installment_payment($1::jsonb)",
        [
          JSON.stringify({
            workspaceId,
            contractId,
            sequence: 1,
            accountId,
            amount: "6120.00",
            penaltyAmount: "0.00",
            currency: "THB",
            financialDate: "2026-08-01",
            expectedVersion: 1,
            clientMutationId:
              "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
          })
        ]
      )
    ).rejects.toThrow(/access denied/);

    const outsiderId =
      "99999999-9999-4999-8999-999999999999";
    await database.exec("reset role");
    await database.query("insert into auth.users (id) values ($1)", [
      outsiderId
    ]);
    await database.exec(`
      set role authenticated;
      select set_config(
        'request.jwt.claim.sub',
        '99999999-9999-4999-8999-999999999999',
        false
      );
    `);
    const hidden = await database.query<{ count: number }>(
      "select count(*)::int as count from public.installment_contracts"
    );
    expect(hidden.rows[0]!.count).toBe(0);
    await expect(
      database.query(
        "select public.post_installment_payment($1::jsonb)",
        [
          JSON.stringify({
            workspaceId,
            contractId: partialContractId,
            sequence: 1,
            accountId,
            amount: "1.00",
            penaltyAmount: "0.00",
            currency: "THB",
            financialDate: "2026-08-02",
            expectedVersion: 3,
            clientMutationId:
              "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
          })
        ]
      )
    ).rejects.toThrow(/access denied/);

    await database.close();
  });
});

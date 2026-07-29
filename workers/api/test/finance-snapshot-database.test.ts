import { PGlite } from "@electric-sql/pglite";
import { financeSnapshotSchema } from "@systems-credit/contracts";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationDirectory = fileURLToPath(
  new URL("../../../supabase/migrations/", import.meta.url)
);

async function loadMigration(name: string) {
  return readFile(`${migrationDirectory}${name}`, "utf8");
}

describe("finance snapshot migration", () => {
  it("returns the owner's complete read model and hides it from a stranger", async () => {
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
      "202607280015_transaction_void_history.sql"
    ]) {
      await database.exec(await loadMigration(migration));
    }

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
      select set_config(
        'request.jwt.claim.sub',
        '${ownerId}',
        false
      );
    `);

    const workspace = await database.query<{ id: string }>(
      "select id from public.create_private_workspace($1, $2, $3)",
      ["Owner workspace", "THB", "Asia/Bangkok"]
    );
    const workspaceId = workspace.rows[0]!.id;
    const category = await database.query<{ id: string }>(
      "select id from public.categories where workspace_id = $1 and slug = 'salary'",
      [workspaceId]
    );
    const categoryId = category.rows[0]!.id;
    const feeCategory = await database.query<{ id: string }>(
      `select id
       from public.categories
       where workspace_id = $1
         and slug = 'financial-fees'`,
      [workspaceId]
    );
    const feeCategoryId = feeCategory.rows[0]!.id;
    const account = await database.query<{
      result: { account: { id: string } };
    }>(
      "select public.create_account_with_opening_balance($1::jsonb) as result",
      [
        JSON.stringify({
          workspaceId,
          name: "Main account",
          type: "bank",
          currency: "THB",
          openingBalance: "1000.00"
        })
      ]
    );
    const accountId = account.rows[0]!.result.account.id;
    const posted = await database.query<{
      result: { transactionId: string };
    }>(
      "select public.post_transaction($1::jsonb) as result",
      [
        JSON.stringify({
          workspaceId,
          accountId,
          type: "income",
          amount: "250.00",
          currency: "THB",
          financialDate: "2026-07-27",
          categoryId,
          tagIds: [],
          clientMutationId:
            "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        })
      ]
    );
    await database.query(
      "select public.void_transaction($1, $2, $3)",
      [
        posted.rows[0]!.result.transactionId,
        1,
        "บันทึกรายการผิด"
      ]
    );

    const voidSnapshotResult = await database.query<{
      snapshot: unknown;
    }>("select public.get_finance_snapshot() as snapshot");
    const voidSnapshot = financeSnapshotSchema.parse(
      voidSnapshotResult.rows[0]!.snapshot
    );
    expect(voidSnapshot.accountBalances[accountId]?.amount).toBe(
      "1000.00"
    );
    expect(voidSnapshot.transactions).toEqual([
      expect.objectContaining({
        id: posted.rows[0]!.result.transactionId,
        state: "void",
        version: 2,
        voidReason: "บันทึกรายการผิด"
      })
    ]);
    expect(voidSnapshot.transactions[0]?.voidedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T/
    );

    const destinationAccount = await database.query<{
      result: { account: { id: string } };
    }>(
      "select public.create_account_with_opening_balance($1::jsonb) as result",
      [
        JSON.stringify({
          workspaceId,
          name: "Destination account",
          type: "bank",
          currency: "THB",
          openingBalance: "0.00"
        })
      ]
    );
    const destinationAccountId =
      destinationAccount.rows[0]!.result.account.id;
    const transfer = await database.query<{
      result: { transferId: string };
    }>("select public.post_transfer($1::jsonb) as result", [
      JSON.stringify({
        workspaceId,
        sourceAccountId: accountId,
        destinationAccountId,
        sourceAmount: "300.00",
        sourceCurrency: "THB",
        destinationAmount: "300.00",
        destinationCurrency: "THB",
        exchangeRate: "1",
        feeAmount: "10.00",
        feeCategoryId,
        financialDate: "2026-07-28",
        clientMutationId:
          "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
      })
    ]);
    const feeTransaction = await database.query<{
      id: string;
    }>(
      `select fee_transaction_id as id
       from public.transfer_links
       where transfer_id = $1`,
      [transfer.rows[0]!.result.transferId]
    );
    const feeTransactionId = feeTransaction.rows[0]!.id;

    const contract = await database.query<{
      result: { contract: { id: string } };
    }>(
      "select public.create_installment_contract($1::jsonb) -> 'response' as result",
      [
        JSON.stringify({
          workspaceId,
          name: "Zero-interest purchase",
          kind: "purchase",
          originalPrincipal: "1200.00",
          downPayment: "200.00",
          financedPrincipal: "1000.00",
          financedFees: "0.00",
          currency: "THB",
          interestMethod: "zero",
          annualRate: "0",
          periods: 1,
          firstDueDate: "2026-08-27",
          categoryId,
          clientMutationId:
            "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          schedule: [
            {
              sequence: 1,
              dueDate: "2026-08-27",
              openingPrincipal: "1000.00",
              principal: "1000.00",
              interest: "0.00",
              fees: "0.00",
              total: "1000.00",
              closingPrincipal: "0.00"
            }
          ]
        })
      ]
    );
    const contractId = contract.rows[0]!.result.contract.id;
    const periodResult = await database.query<{ period: string }>(
      "select to_char(date_trunc('month', now() at time zone 'Asia/Bangkok'), 'YYYY-MM') as period"
    );
    const period = periodResult.rows[0]!.period;
    const recurringTemplate = await database.query<{
      result: { id: string };
    }>(
      "select public.create_recurring_template($1::jsonb) as result",
      [
        JSON.stringify({
          workspaceId,
          name: "Monthly salary",
          kind: "income",
          amount: "30000.00",
          currency: "THB",
          accountId,
          categoryId,
          dayOfMonth: 25,
          startMonth: period
        })
      ]
    );
    const recurringTemplateId =
      recurringTemplate.rows[0]!.result.id;
    await database.query(
      "select public.materialize_recurring_period($1::jsonb)",
      [JSON.stringify({ workspaceId, period })]
    );
    const recurringOccurrence = await database.query<{
      id: string;
      version: number;
    }>(
      `select id, version
       from public.recurring_occurrences
       where template_id = $1`,
      [recurringTemplateId]
    );
    const recurringOccurrenceId =
      recurringOccurrence.rows[0]!.id;
    const recurringPost = await database.query<{
      result: {
        response: {
          transaction: { transactionId: string };
        };
      };
    }>(
      "select public.post_recurring_occurrence($1, $2::jsonb) as result",
      [
        recurringOccurrenceId,
        JSON.stringify({
          version: recurringOccurrence.rows[0]!.version,
          clientMutationId:
            "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
        })
      ]
    );
    const recurringTransactionId =
      recurringPost.rows[0]!.result.response.transaction.transactionId;

    const ownerResult = await database.query<{ snapshot: unknown }>(
      "select public.get_finance_snapshot() as snapshot"
    );
    const ownerSnapshot = financeSnapshotSchema.parse(
      ownerResult.rows[0]!.snapshot
    );
    expect(ownerSnapshot).toMatchObject({
      version: 1,
      workspace: {
        id: workspaceId,
        role: "owner"
      },
      accountBalances: {
        [accountId]: {
          amount: "30690.00",
          currency: "THB"
        },
        [destinationAccountId]: {
          amount: "300.00",
          currency: "THB"
        }
      }
    });
    expect(ownerSnapshot.categories).toHaveLength(18);
    expect(ownerSnapshot.accounts).toHaveLength(2);
    expect(ownerSnapshot.openingTransactions).toHaveLength(1);
    expect(ownerSnapshot.transactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: posted.rows[0]!.result.transactionId,
          state: "void",
          version: 2,
          voidReason: "บันทึกรายการผิด"
        }),
        expect.objectContaining({
          id: feeTransactionId,
          state: "posted",
          source: "transfer_fee",
          sourceId: transfer.rows[0]!.result.transferId
        }),
        expect.objectContaining({
          id: recurringTransactionId,
          state: "posted",
          source: "recurring_occurrence",
          sourceId: recurringOccurrenceId
        })
      ])
    );
    expect(ownerSnapshot.transactions).toHaveLength(3);
    expect(ownerSnapshot.installmentContracts).toEqual([
      expect.objectContaining({
        id: contractId,
        annualRate: "0",
        version: 1
      })
    ]);
    expect(ownerSnapshot.installmentSchedules[contractId]).toEqual([
      expect.objectContaining({
        sequence: 1,
        principal: "1000.00",
        status: "upcoming"
      })
    ]);
    expect(ownerSnapshot.recurringTemplates).toEqual([
      expect.objectContaining({
        id: recurringTemplateId,
        name: "Monthly salary",
        status: "active"
      })
    ]);
    expect(ownerSnapshot.recurringOccurrences).toEqual([
      expect.objectContaining({
        templateId: recurringTemplateId,
        period,
        status: "posted",
        transactionId: recurringTransactionId
      })
    ]);

    await database.exec(
      `select set_config(
        'request.jwt.claim.sub',
        '${strangerId}',
        false
      )`
    );
    const strangerResult = await database.query<{ snapshot: unknown }>(
      "select public.get_finance_snapshot() as snapshot"
    );
    expect(
      financeSnapshotSchema.parse(strangerResult.rows[0]!.snapshot)
    ).toEqual({
      version: 1,
      workspace: null,
      categories: [],
      accounts: [],
      accountBalances: {},
      openingTransactions: [],
      transactions: [],
      installmentContracts: [],
      installmentSchedules: {},
      installmentPayments: [],
      installmentPayoffs: [],
      recurringTemplates: [],
      recurringOccurrences: [],
      budgetAllocations: [],
      savingsGoals: []
    });

    await database.close();
  });
});

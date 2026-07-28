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

describe("batch slip database migration", () => {
  it("posts atomically, replays safely, blocks invalid batches, and enforces roles", async () => {
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

    const ownerId = "11111111-1111-4111-8111-111111111111";
    const viewerId = "22222222-2222-4222-8222-222222222222";
    const strangerId = "33333333-3333-4333-8333-333333333333";
    await db.query(
      "insert into auth.users (id) values ($1), ($2), ($3)",
      [ownerId, viewerId, strangerId]
    );
    await db.exec(`
      grant usage on schema auth to authenticated;
      grant execute on function auth.uid() to authenticated;
      set role authenticated;
      select set_config(
        'request.jwt.claim.sub',
        '11111111-1111-4111-8111-111111111111',
        false
      );
    `);
    const workspace = await db.query<{ id: string }>(
      "select id from public.create_private_workspace($1,$2,$3)",
      ["ทดสอบ batch", "THB", "Asia/Bangkok"]
    );
    const workspaceId = workspace.rows[0]!.id;
    const account = await db.query<{
      result: { account: { id: string } };
    }>(
      "select public.create_account_with_opening_balance($1::jsonb) result",
      [JSON.stringify({
        workspaceId,
        name: "เงินสด",
        type: "cash",
        currency: "THB",
        openingBalance: "5000.00"
      })]
    );
    const accountId = account.rows[0]!.result.account.id;
    const category = await db.query<{ id: string }>(
      `select id from public.categories
       where workspace_id = $1 and slug = 'food'`,
      [workspaceId]
    );
    const categoryId = category.rows[0]!.id;

    await db.exec("reset role");
    await db.query(
      `insert into public.workspace_members (workspace_id, user_id, role)
       values ($1, $2, 'viewer')`,
      [workspaceId, viewerId]
    );
    await db.exec(`
      set role authenticated;
      select set_config(
        'request.jwt.claim.sub',
        '11111111-1111-4111-8111-111111111111',
        false
      );
    `);

    const first = {
      itemId: "10000000-0000-4000-8000-000000000001",
      imageSha256: "1".repeat(64),
      documentIdentitySha256: "a".repeat(64),
      documentKind: "bank_transfer",
      transaction: {
        workspaceId,
        accountId,
        categoryId,
        type: "expense",
        amount: "60.00",
        currency: "THB",
        financialDate: "2026-07-27",
        tagIds: [],
        clientMutationId: "20000000-0000-4000-8000-000000000001"
      }
    };
    const second = {
      itemId: "10000000-0000-4000-8000-000000000002",
      imageSha256: "2".repeat(64),
      documentIdentitySha256: "b".repeat(64),
      documentKind: "receipt",
      transaction: {
        ...first.transaction,
        amount: "1191.67",
        clientMutationId: "20000000-0000-4000-8000-000000000002"
      }
    };
    const command = {
      workspaceId,
      batchMutationId: "30000000-0000-4000-8000-000000000001",
      requestSha256: "f".repeat(64),
      items: [first, second]
    };

    const posted = await db.query<{
      result: {
        status: string;
        items: Array<{
          itemId: string;
          transaction: { transactionId: string };
        }>;
      };
    }>(
      "select public.confirm_financial_document_import_batch($1::jsonb) result",
      [JSON.stringify(command)]
    );
    expect(posted.rows[0]!.result.status).toBe("posted");
    expect(posted.rows[0]!.result.items.map((item) => item.itemId)).toEqual([
      first.itemId,
      second.itemId
    ]);
    const transactionIds = posted.rows[0]!.result.items.map(
      (item) => item.transaction.transactionId
    );
    expect(new Set(transactionIds).size).toBe(2);

    const replay = await db.query<{ result: typeof posted.rows[0]["result"] }>(
      "select public.confirm_financial_document_import_batch($1::jsonb) result",
      [JSON.stringify(command)]
    );
    expect(replay.rows[0]!.result).toEqual(posted.rows[0]!.result);

    const conflict = await db.query<{
      result: {
        status: string;
        issues: Array<{ itemId: string; code: string }>;
      };
    }>(
      "select public.confirm_financial_document_import_batch($1::jsonb) result",
      [JSON.stringify({ ...command, requestSha256: "e".repeat(64) })]
    );
    expect(conflict.rows[0]!.result).toEqual({
      status: "blocked",
      issues: [{ itemId: first.itemId, code: "mutation_conflict" }]
    });

    const duplicate = await db.query<{ result: typeof conflict.rows[0]["result"] }>(
      "select public.confirm_financial_document_import_batch($1::jsonb) result",
      [JSON.stringify({
        ...command,
        batchMutationId: "30000000-0000-4000-8000-000000000002",
        requestSha256: "d".repeat(64),
        items: [{
          ...first,
          transaction: {
            ...first.transaction,
            clientMutationId: "20000000-0000-4000-8000-000000000003"
          }
        }]
      })]
    );
    expect(duplicate.rows[0]!.result).toEqual({
      status: "blocked",
      issues: [{ itemId: first.itemId, code: "duplicate" }]
    });

    const invalidCategory = await db.query<{
      result: typeof conflict.rows[0]["result"];
    }>(
      "select public.confirm_financial_document_import_batch($1::jsonb) result",
      [JSON.stringify({
        ...command,
        batchMutationId: "30000000-0000-4000-8000-000000000003",
        requestSha256: "c".repeat(64),
        items: [{
          ...first,
          itemId: "10000000-0000-4000-8000-000000000003",
          imageSha256: "3".repeat(64),
          documentIdentitySha256: "c".repeat(64),
          transaction: {
            ...first.transaction,
            clientMutationId: "20000000-0000-4000-8000-000000000004"
          }
        }, {
          ...first,
          itemId: "10000000-0000-4000-8000-000000000004",
          imageSha256: "4".repeat(64),
          documentIdentitySha256: "d".repeat(64),
          transaction: {
            ...first.transaction,
            categoryId: "99999999-9999-4999-8999-999999999999",
            clientMutationId: "20000000-0000-4000-8000-000000000005"
          }
        }]
      })]
    );
    expect(invalidCategory.rows[0]!.result).toEqual({
      status: "blocked",
      issues: [{
        itemId: "10000000-0000-4000-8000-000000000004",
        code: "invalid_category"
      }]
    });

    await db.exec("reset role");
    const counts = await db.query<{
      transactionCount: number;
      importCount: number;
      batchCount: number;
    }>(`
      select
        (select count(*)::int from public.transactions
          where type = 'expense') "transactionCount",
        (select count(*)::int from public.financial_document_imports)
          "importCount",
        (select count(*)::int from public.financial_document_import_batches)
          "batchCount"
    `);
    expect(counts.rows[0]).toEqual({
      transactionCount: 2,
      importCount: 2,
      batchCount: 1
    });

    await db.exec(`
      set role authenticated;
      select set_config(
        'request.jwt.claim.sub',
        '22222222-2222-4222-8222-222222222222',
        false
      );
    `);
    await expect(
      db.query(
        "select public.confirm_financial_document_import_batch($1::jsonb)",
        [JSON.stringify({
          ...command,
          batchMutationId: "30000000-0000-4000-8000-000000000004",
          requestSha256: "b".repeat(64)
        })]
      )
    ).rejects.toThrow(/workspace access denied/i);

    await db.exec("reset role");
    await db.exec(`
      set role authenticated;
      select set_config(
        'request.jwt.claim.sub',
        '33333333-3333-4333-8333-333333333333',
        false
      );
    `);
    await expect(
      db.query(
        "select public.confirm_financial_document_import_batch($1::jsonb)",
        [JSON.stringify({
          ...command,
          batchMutationId: "30000000-0000-4000-8000-000000000005",
          requestSha256: "a".repeat(64)
        })]
      )
    ).rejects.toThrow(/workspace access denied/i);

    await db.close();
  });
});

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

function shiftMonth(period: string, delta: number): string {
  const [year, month] = period.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}

describe("local PostgreSQL recurring migration", () => {
  it("materializes, edits, posts, skips, and isolates recurring items atomically", async () => {
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
      "202607270011_recurring_items.sql"
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
      ["การเงินของฉัน", "THB", "Asia/Bangkok"]
    );
    const workspaceId = workspace.rows[0]!.id;
    const account = await database.query<{
      result: { account: { id: string } };
    }>(
      "select public.create_account_with_opening_balance($1::jsonb) as result",
      [
        JSON.stringify({
          workspaceId,
          name: "บัญชีเงินเดือน",
          type: "bank",
          currency: "THB",
          openingBalance: "1000.00"
        })
      ]
    );
    const accountId = account.rows[0]!.result.account.id;
    const categories = await database.query<{
      id: string;
      slug: string;
    }>(
      "select id, slug from public.categories where workspace_id = $1 and slug in ('salary', 'housing')",
      [workspaceId]
    );
    const salaryCategoryId = categories.rows.find(
      ({ slug }) => slug === "salary"
    )!.id;
    const housingCategoryId = categories.rows.find(
      ({ slug }) => slug === "housing"
    )!.id;
    const periodResult = await database.query<{ period: string }>(
      "select to_char(date_trunc('month', now() at time zone 'Asia/Bangkok'), 'YYYY-MM') as period"
    );
    const period = periodResult.rows[0]!.period;

    const createTemplate = async (
      values: Record<string, unknown>
    ) => {
      const result = await database.query<{
        result: { id: string; version: number };
      }>(
        "select public.create_recurring_template($1::jsonb) as result",
        [
          JSON.stringify({
            workspaceId,
            name: "เงินเดือน",
            kind: "income",
            amount: "35000.00",
            currency: "THB",
            accountId,
            categoryId: salaryCategoryId,
            dayOfMonth: 25,
            startMonth: period,
            ...values
          })
        ]
      );
      return result.rows[0]!.result;
    };
    const salary = await createTemplate({});
    const rent = await createTemplate({
      name: "ค่าเช่า",
      kind: "expense",
      amount: "8000.00",
      categoryId: housingCategoryId,
      dayOfMonth: 1
    });
    await createTemplate({
      name: "อนาคต",
      startMonth: shiftMonth(period, 1)
    });
    await createTemplate({
      name: "หมดอายุ",
      startMonth: shiftMonth(period, -2),
      endMonth: shiftMonth(period, -1)
    });

    const materialize = () =>
      database.query<{
        result: { createdCount: number; existingCount: number };
      }>(
        "select public.materialize_recurring_period($1::jsonb) as result",
        [JSON.stringify({ workspaceId, period })]
      );
    expect((await materialize()).rows[0]!.result).toEqual({
      createdCount: 2,
      existingCount: 0
    });
    expect((await materialize()).rows[0]!.result).toEqual({
      createdCount: 0,
      existingCount: 2
    });
    await expect(
      database.query(
        "select public.materialize_recurring_period($1::jsonb)",
        [
          JSON.stringify({
            workspaceId,
            period: shiftMonth(period, -1)
          })
        ]
      )
    ).rejects.toThrow(/current month/i);

    const readPeriod = () =>
      database.query<{
        result: {
          period: string;
          occurrences: Array<{
            id: string;
            templateId: string;
            amount: string;
            scheduledDate: string;
            status: string;
            version: number;
          }>;
        };
      }>(
        "select public.get_recurring_period($1, $2) as result",
        [workspaceId, period]
      );
    const firstPeriod = (await readPeriod()).rows[0]!.result;
    const salaryOccurrence = firstPeriod.occurrences.find(
      ({ templateId }) => templateId === salary.id
    )!;
    const rentOccurrence = firstPeriod.occurrences.find(
      ({ templateId }) => templateId === rent.id
    )!;

    const edited = await database.query<{
      result: { version: number; amount: string };
    }>(
      "select public.update_recurring_occurrence($1, $2::jsonb) as result",
      [
        salaryOccurrence.id,
        JSON.stringify({
          amount: "36000.00",
          scheduledDate: `${period}-26`,
          version: 1
        })
      ]
    );
    expect(edited.rows[0]!.result).toMatchObject({
      amount: "36000.00",
      version: 2
    });
    const templateEdit = await database.query<{
      result: { version: number };
    }>(
      "select public.update_recurring_template($1, $2::jsonb) as result",
      [
        salary.id,
        JSON.stringify({
          name: "เงินเดือนใหม่",
          kind: "income",
          amount: "35000.00",
          currency: "THB",
          accountId,
          categoryId: salaryCategoryId,
          dayOfMonth: 25,
          startMonth: period,
          version: 1
        })
      ]
    );
    expect(templateEdit.rows[0]!.result.version).toBe(2);
    expect(
      (await readPeriod()).rows[0]!.result.occurrences.find(
        ({ templateId }) => templateId === salary.id
      )
    ).toMatchObject({
      amount: "35000.00",
      scheduledDate: `${period}-25`,
      version: 3
    });

    const mutationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const postInput = {
      version: 3,
      clientMutationId: mutationId
    };
    const posted = await database.query<{
      result: {
        response: {
          occurrence: { status: string };
          transaction: {
            transactionId: string;
            accountBalances: Array<{ amount: string }>;
          };
        };
        replayed: boolean;
      };
    }>(
      "select public.post_recurring_occurrence($1, $2::jsonb) as result",
      [salaryOccurrence.id, JSON.stringify(postInput)]
    );
    const retried = await database.query<{
      result: typeof posted.rows[number]["result"];
    }>(
      "select public.post_recurring_occurrence($1, $2::jsonb) as result",
      [salaryOccurrence.id, JSON.stringify(postInput)]
    );
    expect(posted.rows[0]!.result).toMatchObject({
      replayed: false,
      response: {
        occurrence: { status: "posted" },
        transaction: { accountBalances: [{ amount: "36000.00" }] }
      }
    });
    expect(retried.rows[0]!.result).toEqual({
      ...posted.rows[0]!.result,
      replayed: true
    });

    await expect(
      database.query(
        "select public.post_recurring_occurrence($1, $2::jsonb)",
        [rentOccurrence.id, JSON.stringify(postInput)]
      )
    ).rejects.toThrow(/duplicate mutation/i);

    const skipped = await database.query<{
      result: { status: string };
    }>(
      "select public.skip_recurring_occurrence($1, $2) as result",
      [rentOccurrence.id, 1]
    );
    expect(skipped.rows[0]!.result.status).toBe("skipped");
    const transactionCount = await database.query<{ count: number }>(
      "select count(*)::int as count from public.transactions where type in ('income', 'expense')"
    );
    expect(transactionCount.rows[0]!.count).toBe(1);

    const bonus = await createTemplate({
      name: "โบนัสประจำ",
      amount: "1000.00"
    });
    const paused = await database.query<{
      result: { version: number };
    }>(
      "select public.set_recurring_template_status($1, $2, $3) as result",
      [bonus.id, 1, "paused"]
    );
    const resumed = await database.query<{
      result: { version: number };
    }>(
      "select public.set_recurring_template_status($1, $2, $3) as result",
      [bonus.id, paused.rows[0]!.result.version, "active"]
    );
    expect((await materialize()).rows[0]!.result.createdCount).toBe(1);
    const bonusOccurrence = (
      await readPeriod()
    ).rows[0]!.result.occurrences.find(
      ({ templateId }) => templateId === bonus.id
    )!;
    const cancelled = await database.query<{
      result: { version: number; status: string };
    }>(
      "select public.set_recurring_template_status($1, $2, $3) as result",
      [bonus.id, resumed.rows[0]!.result.version, "cancelled"]
    );
    expect(cancelled.rows[0]!.result.status).toBe("cancelled");
    await expect(
      database.query(
        "select public.set_recurring_template_status($1, $2, $3)",
        [bonus.id, cancelled.rows[0]!.result.version, "active"]
      )
    ).rejects.toThrow(/transition|stale/i);

    await database.query(
      "update public.accounts set archived_at = now() where id = $1",
      [accountId]
    );
    await expect(
      database.query(
        "select public.post_recurring_occurrence($1, $2::jsonb)",
        [
          bonusOccurrence.id,
          JSON.stringify({
            version: 1,
            clientMutationId:
              "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
          })
        ]
      )
    ).rejects.toThrow(/access denied|account/i);
    expect(
      (await readPeriod()).rows[0]!.result.occurrences.find(
        ({ templateId }) => templateId === bonus.id
      )
    ).toMatchObject({ status: "pending", version: 1 });
    expect(
      (
        await database.query<{ count: number }>(
          "select count(*)::int as count from public.transactions where type in ('income', 'expense')"
        )
      ).rows[0]!.count
    ).toBe(1);

    await database.query(
      "update public.accounts set archived_at = null where id = $1",
      [accountId]
    );
    const cancelledTemplatePost = await database.query<{
      result: { response: { occurrence: { status: string } } };
    }>(
      "select public.post_recurring_occurrence($1, $2::jsonb) as result",
      [
        bonusOccurrence.id,
        JSON.stringify({
          version: 1,
          clientMutationId:
            "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
        })
      ]
    );
    expect(
      cancelledTemplatePost.rows[0]!.result.response.occurrence.status
    ).toBe("posted");

    await database.query(
      "select set_config('request.jwt.claim.sub', $1, false)",
      [strangerId]
    );
    const hiddenTemplates = await database.query<{ count: number }>(
      "select count(*)::int as count from public.recurring_templates"
    );
    const hiddenOccurrences = await database.query<{ count: number }>(
      "select count(*)::int as count from public.recurring_occurrences"
    );
    expect(hiddenTemplates.rows[0]!.count).toBe(0);
    expect(hiddenOccurrences.rows[0]!.count).toBe(0);
    await expect(
      database.query(
        "select public.get_recurring_period($1, $2)",
        [workspaceId, period]
      )
    ).rejects.toThrow(/access denied/i);

    await database.close();
  });
});

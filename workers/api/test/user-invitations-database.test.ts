import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(
  new URL(
    "../../../supabase/migrations/202607270013_user_invitations.sql",
    import.meta.url
  )
);

const adminId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (
      id uuid primary key,
      email text unique,
      raw_app_meta_data jsonb not null default '{}'::jsonb
    );
  `);
  await database.exec(await readFile(migrationPath, "utf8"));
  await database.query(
    "insert into auth.users (id, email) values ($1, $2)",
    [adminId, "admin@example.test"]
  );
  return database;
}

describe("local PostgreSQL user invitation migration", () => {
  it("keeps rows and invitation RPCs private", async () => {
    const database = await createDatabase();

    for (const role of ["authenticated", "anon"]) {
      await database.exec(`set role ${role}`);
      await expect(
        database.query("select * from public.user_invitations")
      ).rejects.toThrow(/permission denied/i);
      await expect(
        database.query(
          "select public.claim_user_invitation($1)",
          ["a".repeat(64)]
        )
      ).rejects.toThrow(/permission denied/i);
      await database.exec("reset role");
    }

    await database.close();
  });

  it("reconciles an Auth user after a lost create response", async () => {
    const database = await createDatabase();
    await database.exec("set role service_role");

    const created = await database.query<{
      result: {
        id: string;
        email: string;
        status: string;
      };
    }>(
      "select public.create_user_invitation($1, $2, $3, $4) as result",
      [
        "person@example.test",
        "Person",
        "a".repeat(64),
        adminId
      ]
    );
    const claimed = await database.query<{
      result: {
        id: string;
        claimId: string;
        email: string;
      };
    }>(
      "select public.claim_user_invitation($1) as result",
      ["a".repeat(64)]
    );

    await database.exec("reset role");
    await database.query(
      `insert into auth.users (
        id,
        email,
        raw_app_meta_data
      ) values ($1, $2, $3)`,
      [
        userId,
        "person@example.test",
        JSON.stringify({
          baan_ngern_dee_invitation_id:
            claimed.rows[0]!.result.id,
          baan_ngern_dee_invitation_claim_id:
            claimed.rows[0]!.result.claimId
        })
      ]
    );
    await database.exec("set role service_role");

    await expect(
      database.query(
        "select public.reconcile_user_invitation($1) as result",
        ["a".repeat(64)]
      )
    ).resolves.toMatchObject({
      rows: [
        {
          result: {
            email: "person@example.test",
            displayName: "Person"
          }
        }
      ]
    });
    await expect(
      database.query(
        "select public.reconcile_user_invitation($1) as result",
        ["a".repeat(64)]
      )
    ).resolves.toMatchObject({
      rows: [
        {
          result: {
            email: "person@example.test",
            displayName: "Person"
          }
        }
      ]
    });

    const stored = await database.query<{
      status: string;
      redeemed_user_id: string;
      redeemed_claim_id: string;
      claim_id: string | null;
    }>(
      `select
        status,
        redeemed_user_id,
        redeemed_claim_id,
        claim_id
      from public.user_invitations`
    );
    expect(stored.rows).toEqual([
      {
        status: "redeemed",
        redeemed_user_id: userId,
        redeemed_claim_id:
          claimed.rows[0]!.result.claimId,
        claim_id: null
      }
    ]);
    expect(created.rows[0]!.result.status).toBe("pending");

    await database.close();
  });

  it("completes a claimed invitation with a fenced claim", async () => {
    const database = await createDatabase();
    await database.exec("set role service_role");
    const created = await database.query<{
      result: { id: string };
    }>(
      "select public.create_user_invitation($1, $2, $3, $4) as result",
      [
        "person@example.test",
        "Person",
        "b".repeat(64),
        adminId
      ]
    );
    const claimed = await database.query<{
      result: { claimId: string };
    }>(
      "select public.claim_user_invitation($1) as result",
      ["b".repeat(64)]
    );

    await database.exec("reset role");
    await database.query(
      `insert into auth.users (
        id,
        email,
        raw_app_meta_data
      ) values ($1, $2, $3)`,
      [
        userId,
        "person@example.test",
        JSON.stringify({
          baan_ngern_dee_invitation_id:
            created.rows[0]!.result.id,
          baan_ngern_dee_invitation_claim_id:
            claimed.rows[0]!.result.claimId
        })
      ]
    );
    await database.exec("set role service_role");
    await database.query(
      "select public.complete_user_invitation($1, $2, $3)",
      [
        created.rows[0]!.result.id,
        claimed.rows[0]!.result.claimId,
        userId
      ]
    );
    await expect(
      database.query(
        "select public.claim_user_invitation($1)",
        ["b".repeat(64)]
      )
    ).rejects.toThrow(/INVITATION_REDEEMED/);

    await database.close();
  });

  it("rejects an invitation for an existing auth email", async () => {
    const database = await createDatabase();
    await database.query(
      "insert into auth.users (id, email) values ($1, $2)",
      [userId, "person@example.test"]
    );
    await database.exec("set role service_role");

    await expect(
      database.query(
        "select public.create_user_invitation($1, $2, $3, $4)",
        [
          "PERSON@EXAMPLE.TEST",
          "Person",
          "c".repeat(64),
          adminId
        ]
      )
    ).rejects.toThrow(/EMAIL_ALREADY_REGISTERED/);

    await database.close();
  });

  it("shows expired claimed invitations and prevents orphan revocation", async () => {
    const database = await createDatabase();
    await database.exec("set role service_role");
    const created = await database.query<{
      result: { id: string };
    }>(
      "select public.create_user_invitation($1, $2, $3, $4) as result",
      [
        "person@example.test",
        "Person",
        "d".repeat(64),
        adminId
      ]
    );
    const claimed = await database.query<{
      result: { claimId: string };
    }>(
      "select public.claim_user_invitation($1) as result",
      ["d".repeat(64)]
    );
    await database.query(
      `update public.user_invitations
      set
        created_at = now() - interval '2 days',
        expires_at = now() - interval '1 day',
        claimed_at = now() - interval '10 minutes'
      where id = $1`,
      [created.rows[0]!.result.id]
    );
    const listed = await database.query<{
      result: Array<{ status: string }>;
    }>(
      "select public.list_user_invitations() as result"
    );
    expect(listed.rows[0]!.result[0]!.status).toBe("expired");

    await database.exec("reset role");
    await database.query(
      `insert into auth.users (
        id,
        email,
        raw_app_meta_data
      ) values ($1, $2, $3)`,
      [
        userId,
        "person@example.test",
        JSON.stringify({
          baan_ngern_dee_invitation_id:
            created.rows[0]!.result.id,
          baan_ngern_dee_invitation_claim_id:
            claimed.rows[0]!.result.claimId
        })
      ]
    );
    await database.exec("set role service_role");
    await expect(
      database.query(
        "select public.revoke_user_invitation($1, $2)",
        [created.rows[0]!.result.id, adminId]
      )
    ).rejects.toThrow(/INVITATION_BUSY/);

    await database.close();
  });

  it("enforces the hourly creation limit for one actor", async () => {
    const database = await createDatabase();
    await database.exec("set role service_role");

    for (let index = 0; index < 20; index += 1) {
      await database.query(
        "select public.create_user_invitation($1, $2, $3, $4)",
        [
          `person-${index}@example.test`,
          `Person ${index}`,
          index.toString(16).padStart(64, "0"),
          adminId
        ]
      );
    }
    await expect(
      database.query(
        "select public.create_user_invitation($1, $2, $3, $4)",
        [
          "over-limit@example.test",
          "Over Limit",
          "f".repeat(64),
          adminId
        ]
      )
    ).rejects.toThrow(/INVITATION_CREATE_FAILED/);

    await database.close();
  });
});

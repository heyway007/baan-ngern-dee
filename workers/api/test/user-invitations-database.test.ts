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

describe("local PostgreSQL user invitation migration", () => {
  it("keeps rows private and redeems one claimed invitation atomically", async () => {
    const database = new PGlite();
    await database.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin;
      create schema auth;
      create table auth.users (
        id uuid primary key,
        email text unique
      );
    `);
    await database.exec(await readFile(migrationPath, "utf8"));

    const adminId = "11111111-1111-4111-8111-111111111111";
    const userId = "22222222-2222-4222-8222-222222222222";
    await database.query(
      "insert into auth.users (id, email) values ($1, $2)",
      [adminId, "admin@example.test"]
    );

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
    expect(created.rows[0]?.result).toMatchObject({
      email: "person@example.test",
      status: "pending"
    });

    await database.exec("set role authenticated");
    await expect(
      database.query("select * from public.user_invitations")
    ).rejects.toThrow(/permission denied/i);
    await database.exec("reset role");

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
    expect(claimed.rows[0]?.result).toMatchObject({
      id: created.rows[0]?.result.id,
      email: "person@example.test"
    });
    expect(claimed.rows[0]?.result.claimId).toMatch(
      /^[0-9a-f-]{36}$/
    );

    await expect(
      database.query(
        "select public.claim_user_invitation($1)",
        ["a".repeat(64)]
      )
    ).rejects.toThrow(/INVITATION_BUSY/);

    await database.query(
      "insert into auth.users (id, email) values ($1, $2)",
      [userId, "person@example.test"]
    );
    await database.query(
      "select public.complete_user_invitation($1, $2, $3)",
      [
        claimed.rows[0]!.result.id,
        claimed.rows[0]!.result.claimId,
        userId
      ]
    );

    const stored = await database.query<{
      status: string;
      redeemed_user_id: string;
      token_hash: string;
    }>(
      "select status, redeemed_user_id, token_hash from public.user_invitations"
    );
    expect(stored.rows).toEqual([
      {
        status: "redeemed",
        redeemed_user_id: userId,
        token_hash: "a".repeat(64)
      }
    ]);
    await expect(
      database.query(
        "select public.claim_user_invitation($1)",
        ["a".repeat(64)]
      )
    ).rejects.toThrow(/INVITATION_REDEEMED/);

    await database.close();
  });

  it("rejects an invitation for an existing auth email", async () => {
    const database = new PGlite();
    await database.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin;
      create schema auth;
      create table auth.users (
        id uuid primary key,
        email text unique
      );
    `);
    await database.exec(await readFile(migrationPath, "utf8"));
    const adminId = "11111111-1111-4111-8111-111111111111";
    await database.query(
      "insert into auth.users (id, email) values ($1, $2), ($3, $4)",
      [
        adminId,
        "admin@example.test",
        "22222222-2222-4222-8222-222222222222",
        "person@example.test"
      ]
    );

    await expect(
      database.query(
        "select public.create_user_invitation($1, $2, $3, $4)",
        [
          "PERSON@EXAMPLE.TEST",
          "Person",
          "b".repeat(64),
          adminId
        ]
      )
    ).rejects.toThrow(/EMAIL_ALREADY_REGISTERED/);

    await database.close();
  });
});

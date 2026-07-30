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

describe("editable profile database migration", () => {
  it("creates a private avatar bucket and enforces owned, normalized profiles", async () => {
    const database = new PGlite();
    const ownerId = "11111111-1111-4111-8111-111111111111";
    const strangerId = "22222222-2222-4222-8222-222222222222";
    const longNameId = "33333333-3333-4333-8333-333333333333";
    const blankNameId = "44444444-4444-4444-8444-444444444444";

    try {
      await database.exec(`
        create role anon nologin;
        create role authenticated nologin;
        create schema auth;
        create table auth.users (
          id uuid primary key,
          email text
        );
        create function auth.uid()
        returns uuid
        language sql
        stable
        as $$
          select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
        $$;

        create schema storage;
        create table storage.buckets (
          id text primary key,
          name text not null,
          public boolean not null default false,
          file_size_limit bigint,
          allowed_mime_types text[]
        );
      `);
      await database.exec(
        await loadMigration("202607260001_identity_workspaces.sql")
      );
      await database.query(
        `insert into auth.users (id, email) values
          ($1, 'owner@example.test'),
          ($2, 'stranger@example.test'),
          ($3, 'long-name@example.test'),
          ($4, 'blank-name@example.test')`,
        [ownerId, strangerId, longNameId, blankNameId]
      );
      await database.query(
        "update public.profiles set display_name = ' Owner ' where id = $1",
        [ownerId]
      );
      await database.query(
        "update public.profiles set display_name = $1 where id = $2",
        [` ${"a".repeat(81)} `, longNameId]
      );
      await database.query(
        "update public.profiles set display_name = '   ' where id = $1",
        [blankNameId]
      );
      await database.query(
        `insert into storage.buckets (
          id,
          name,
          public,
          file_size_limit,
          allowed_mime_types
        ) values (
          'profile-avatars',
          'legacy-avatars',
          true,
          1,
          array['image/gif']
        )`
      );
      await database.exec(
        await loadMigration("202607300021_editable_profiles.sql")
      );

      const bucket = await database.query<{
        id: string;
        public: boolean;
        file_size_limit: number;
        allowed_mime_types: string[];
      }>(`
        select id, public, file_size_limit, allowed_mime_types
        from storage.buckets
        where id = 'profile-avatars'
      `);
      expect(bucket.rows).toEqual([{
        id: "profile-avatars",
        public: false,
        file_size_limit: 2_097_152,
        allowed_mime_types: [
          "image/jpeg",
          "image/png",
          "image/webp"
        ]
      }]);

      const normalized = await database.query<{ display_name: string }>(
        "select display_name from public.profiles where id = $1",
        [ownerId]
      );
      expect(normalized.rows).toEqual([{ display_name: "Owner" }]);

      const truncated = await database.query<{ display_name: string }>(
        "select display_name from public.profiles where id = $1",
        [longNameId]
      );
      expect(truncated.rows).toEqual([{ display_name: "a".repeat(80) }]);

      const blank = await database.query<{ display_name: string | null }>(
        "select display_name from public.profiles where id = $1",
        [blankNameId]
      );
      expect(blank.rows).toEqual([{ display_name: null }]);

      await database.exec(`
        grant usage on schema auth to authenticated;
        grant execute on function auth.uid() to authenticated;
        set role authenticated;
      `);
      await database.exec(
        `select set_config('request.jwt.claim.sub', '${ownerId}', false)`
      );

      await expect(
        database.query(
          "update public.profiles set display_name = $1 where id = $2",
          [" ", ownerId]
        )
      ).rejects.toThrow();

      await expect(
        database.query(
          "update public.profiles set display_name = $1 where id = $2",
          ["a".repeat(81), ownerId]
        )
      ).rejects.toThrow();

      await expect(
        database.query(
          "update public.profiles set avatar_path = $1 where id = $2",
          [`${strangerId}/avatar.png`, ownerId]
        )
      ).rejects.toThrow();

      const updated = await database.query<{ avatar_path: string }>(
        "update public.profiles set avatar_path = $1 where id = $2 returning avatar_path",
        [`${ownerId}/avatar.png`, ownerId]
      );
      expect(updated.rows).toEqual([{ avatar_path: `${ownerId}/avatar.png` }]);

      await database.exec(
        `select set_config('request.jwt.claim.sub', '${strangerId}', false)`
      );
      const hidden = await database.query<{ id: string }>(
        "select id from public.profiles where id = $1",
        [ownerId]
      );
      expect(hidden.rows).toEqual([]);
    } finally {
      await database.close();
    }
  });
});

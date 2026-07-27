import { describe, expect, it, vi } from "vitest";

import {
  createSupabaseAuthAdmin
} from "../src/services/supabase-auth-admin";
import {
  createSupabaseInvitationRepository
} from "../src/services/supabase-invitation-repository";

const config = {
  url: "https://project.supabase.co/",
  serviceRoleKey: "service-role-secret"
};

describe("Supabase invitation repository", () => {
  it("claims through the exact Service Role-only RPC payload", async () => {
    const requestFetch = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        id: "33333333-3333-4333-8333-333333333333",
        claimId: "44444444-4444-4444-8444-444444444444",
        email: "person@example.test",
        displayName: "Person"
      })
    );
    const repository = createSupabaseInvitationRepository({
      ...config,
      fetch: requestFetch
    });

    await expect(
      repository.claim("a".repeat(64))
    ).resolves.toMatchObject({
      email: "person@example.test",
      displayName: "Person"
    });
    const [url, init] = requestFetch.mock.calls[0]!;
    expect(url).toBe(
      "https://project.supabase.co/rest/v1/rpc/claim_user_invitation"
    );
    expect(init).toMatchObject({
      method: "POST",
      body: JSON.stringify({ p_token_hash: "a".repeat(64) })
    });
    const headers = new Headers(init?.headers);
    expect(headers.get("apikey")).toBe("service-role-secret");
    expect(headers.get("authorization")).toBe(
      "Bearer service-role-secret"
    );
  });

  it("maps every repository operation to its narrow RPC", async () => {
    const row = {
      id: "33333333-3333-4333-8333-333333333333",
      email: "person@example.test",
      displayName: "Person",
      status: "ready",
      createdAt: "2026-07-27T10:00:00.000Z",
      expiresAt: "2026-07-28T10:00:00.000Z"
    };
    const requestFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json([row]))
      .mockResolvedValueOnce(Response.json(row))
      .mockResolvedValueOnce(Response.json(row))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        Response.json({
          email: row.email,
          displayName: row.displayName
        })
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const repository = createSupabaseInvitationRepository({
      ...config,
      fetch: requestFetch
    });

    await repository.list();
    await repository.create({
      email: row.email,
      displayName: row.displayName,
      tokenHash: "a".repeat(64),
      createdBy: "11111111-1111-4111-8111-111111111111"
    });
    await repository.replace({
      invitationId: row.id,
      tokenHash: "b".repeat(64),
      actorUserId: "11111111-1111-4111-8111-111111111111"
    });
    await repository.revoke(
      row.id,
      "11111111-1111-4111-8111-111111111111"
    );
    await repository.inspect("c".repeat(64));
    await repository.complete(
      row.id,
      "44444444-4444-4444-8444-444444444444",
      "55555555-5555-4555-8555-555555555555"
    );
    await repository.release(
      row.id,
      "44444444-4444-4444-8444-444444444444"
    );

    expect(
      requestFetch.mock.calls.map(([url]) => url)
    ).toEqual([
      "https://project.supabase.co/rest/v1/rpc/list_user_invitations",
      "https://project.supabase.co/rest/v1/rpc/create_user_invitation",
      "https://project.supabase.co/rest/v1/rpc/replace_user_invitation",
      "https://project.supabase.co/rest/v1/rpc/revoke_user_invitation",
      "https://project.supabase.co/rest/v1/rpc/inspect_user_invitation",
      "https://project.supabase.co/rest/v1/rpc/complete_user_invitation",
      "https://project.supabase.co/rest/v1/rpc/release_user_invitation"
    ]);
  });

  it("maps database invitation conflicts without leaking the key", async () => {
    const requestFetch = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          code: "P0001",
          message:
            "ACTIVE_INVITATION_EXISTS service-role-secret"
        },
        { status: 400 }
      )
    );
    const repository = createSupabaseInvitationRepository({
      ...config,
      fetch: requestFetch
    });

    const error = await repository
      .create({
        email: "person@example.test",
        displayName: "Person",
        tokenHash: "a".repeat(64),
        createdBy:
          "11111111-1111-4111-8111-111111111111"
      })
      .catch((caught) => caught);

    expect(error).toMatchObject({
      code: "ACTIVE_INVITATION_EXISTS",
      status: 409
    });
    expect(String(error.message)).not.toContain(
      "service-role-secret"
    );
  });
});

describe("Supabase Auth Admin adapter", () => {
  it("creates a confirmed user with display name metadata", async () => {
    const requestFetch = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        id: "55555555-5555-4555-8555-555555555555"
      })
    );
    const authAdmin = createSupabaseAuthAdmin({
      ...config,
      fetch: requestFetch
    });

    await expect(
      authAdmin.createUser({
        email: "person@example.test",
        displayName: "Person",
        password: "strong-password"
      })
    ).resolves.toEqual({
      userId: "55555555-5555-4555-8555-555555555555"
    });

    const [url, init] = requestFetch.mock.calls[0]!;
    expect(url).toBe(
      "https://project.supabase.co/auth/v1/admin/users"
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      email: "person@example.test",
      password: "strong-password",
      email_confirm: true,
      user_metadata: { display_name: "Person" }
    });
    expect(
      new Headers(init?.headers).get("authorization")
    ).toBe("Bearer service-role-secret");
  });
});

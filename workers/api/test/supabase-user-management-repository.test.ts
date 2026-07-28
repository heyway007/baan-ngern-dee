import { describe, expect, it, vi } from "vitest";

import {
  createSupabaseUserManagementRepository
} from "../src/services/supabase-user-management-repository";

const config = {
  url: "https://project.supabase.co/",
  serviceRoleKey: "service-role-secret"
};
const adminId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const secondUserId =
  "33333333-3333-4333-8333-333333333333";
const mutationId = "44444444-4444-4444-8444-444444444444";

const rawUser = {
  user_id: userId,
  email: "friend@example.test",
  display_name: "Friend",
  status: "active",
  created_at: "2026-07-28T10:00:00.000Z",
  last_sign_in_at: null,
  email_confirmed_at: "2026-07-28T10:01:00.000Z",
  banned_until: null,
  private_workspace_count: 1,
  deletion_pending: false
};

describe("Supabase user management repository", () => {
  it("lists one page and derives the stable next cursor", async () => {
    const requestFetch = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json([
        rawUser,
        {
          ...rawUser,
          user_id: secondUserId,
          email: "second@example.test",
          created_at: "2026-07-28T09:00:00.000Z"
        }
      ])
    );
    const repository = createSupabaseUserManagementRepository({
      ...config,
      fetch: requestFetch
    });

    await expect(
      repository.list({
        search: "friend",
        limit: 1
      })
    ).resolves.toEqual({
      users: [
        {
          userId,
          email: "friend@example.test",
          displayName: "Friend",
          status: "active",
          createdAt: "2026-07-28T10:00:00.000Z",
          emailConfirmedAt: "2026-07-28T10:01:00.000Z",
          privateWorkspaceCount: 1,
          deletionPending: false
        }
      ],
      nextCursor: `2026-07-28T10:00:00.000Z|${userId}`
    });
    const [url, init] = requestFetch.mock.calls[0]!;
    expect(url).toBe(
      "https://project.supabase.co/rest/v1/rpc/list_admin_users"
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      p_search_text: "friend",
      p_page_limit: 2,
      p_cursor_created_at: null,
      p_cursor_user_id: null
    });
    const headers = new Headers(init?.headers);
    expect(headers.get("apikey")).toBe("service-role-secret");
    expect(headers.get("authorization")).toBe(
      "Bearer service-role-secret"
    );
  });

  it("maps all audit and deletion methods to narrow RPC payloads", async () => {
    const requestFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        Response.json([
          { purge_completed: true, completed: false }
        ])
      )
      .mockResolvedValueOnce(
        Response.json([{ private_workspaces_deleted: 1 }])
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const repository = createSupabaseUserManagementRepository({
      ...config,
      fetch: requestFetch
    });

    await repository.recordAction({
      actorUserId: adminId,
      targetUserId: userId,
      action: "suspended",
      details: {}
    });
    await expect(
      repository.getDeletionState({
        targetUserId: userId,
        clientMutationId: mutationId
      })
    ).resolves.toEqual({
      purgeCompleted: true,
      completed: false
    });
    await expect(
      repository.purgePrivateData({
        actorUserId: adminId,
        targetUserId: userId,
        clientMutationId: mutationId,
        normalizedEmail: "friend@example.test"
      })
    ).resolves.toEqual({ privateWorkspacesDeleted: 1 });
    await repository.completeDeletion({
      actorUserId: adminId,
      targetUserId: userId,
      clientMutationId: mutationId
    });

    expect(
      requestFetch.mock.calls.map(([url]) => url)
    ).toEqual([
      "https://project.supabase.co/rest/v1/rpc/record_user_admin_action",
      "https://project.supabase.co/rest/v1/rpc/get_user_deletion_state",
      "https://project.supabase.co/rest/v1/rpc/purge_private_user_data",
      "https://project.supabase.co/rest/v1/rpc/complete_user_deletion"
    ]);
    expect(
      JSON.parse(String(requestFetch.mock.calls[2]![1]?.body))
    ).toEqual({
      p_actor_user_id: adminId,
      p_target_user_id: userId,
      p_client_mutation_id: mutationId,
      p_normalized_email: "friend@example.test"
    });
  });

  it.each([
    ["USER_SHARED_DATA_CONFLICT", 409],
    ["USER_ADMIN_RATE_LIMITED", 429]
  ] as const)("maps database message %s without leaking secrets", async (
    message,
    status
  ) => {
    const requestFetch = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          code: "P0001",
          message: `${message} service-role-secret`
        },
        { status: 400 }
      )
    );
    const repository = createSupabaseUserManagementRepository({
      ...config,
      fetch: requestFetch
    });

    const error = await repository
      .recordAction({
        actorUserId: adminId,
        targetUserId: userId,
        action: "password_reset_requested",
        details: {}
      })
      .catch((caught) => caught);

    expect(error).toMatchObject({ code: message, status });
    expect(String(error.message)).not.toContain(
      "service-role-secret"
    );
  });

  it("rejects malformed RPC payloads as a controlled action failure", async () => {
    const requestFetch = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json([{ user_id: "not-a-uuid" }])
    );
    const repository = createSupabaseUserManagementRepository({
      ...config,
      fetch: requestFetch
    });

    await expect(
      repository.list({ search: "", limit: 25 })
    ).rejects.toMatchObject({
      code: "USER_ADMIN_ACTION_FAILED",
      status: 500
    });
  });
});

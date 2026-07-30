import type { CloudAuth, CloudSession } from "./cloud-auth";
import { describe, expect, it, vi } from "vitest";

import {
  createUserManagementApi,
  UserManagementApiFailure
} from "./user-management-api";

const adminId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const mutationId = "33333333-3333-4333-8333-333333333333";

const session: CloudSession = {
  userId: adminId,
  email: "admin@example.test",
  displayName: "Admin",
  accessToken: "access-token"
};

const user = {
  userId,
  email: "friend@example.test",
  displayName: "Friend",
  status: "active",
  createdAt: "2026-07-28T10:00:00.000Z",
  emailConfirmedAt: "2026-07-28T10:01:00.000Z",
  privateWorkspaceCount: 1,
  deletionPending: false
};

function createAuth(): CloudAuth {
  return {
    getSession: vi.fn().mockResolvedValue(session),
    refreshSession: vi.fn().mockResolvedValue({
      ...session,
      accessToken: "refreshed-token"
    }),
    subscribe: vi.fn(() => vi.fn()),
    signIn: vi.fn(),
    signUp: vi.fn(),
    requestPasswordReset: vi.fn(),
    startLineSignIn: vi.fn(),
    updatePassword: vi.fn(),
    signOut: vi.fn()
  };
}

describe("user management API", () => {
  it("parses a listed email-less LINE user", async () => {
    const lineUser = {
      ...user,
      email: undefined,
      emailConfirmedAt: undefined,
      displayName: "มิน LINE"
    };
    const requestFetch = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        users: [
          {
            userId: lineUser.userId,
            displayName: lineUser.displayName,
            status: lineUser.status,
            createdAt: lineUser.createdAt,
            privateWorkspaceCount:
              lineUser.privateWorkspaceCount,
            deletionPending: lineUser.deletionPending
          }
        ],
        nextCursor: null
      })
    );
    const api = createUserManagementApi({
      auth: createAuth(),
      fetch: requestFetch,
      onUnauthenticated: vi.fn()
    });

    await expect(
      api.list({ search: "มิน", limit: 25 })
    ).resolves.toEqual({
      users: [
        {
          userId: lineUser.userId,
          displayName: "มิน LINE",
          status: "active",
          createdAt: lineUser.createdAt,
          privateWorkspaceCount: 1,
          deletionPending: false
        }
      ],
      nextCursor: null
    });
  });

  it("encodes list filters and parses the response contract", async () => {
    const requestFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ users: [user], nextCursor: null })
      );
    const api = createUserManagementApi({
      auth: createAuth(),
      fetch: requestFetch,
      onUnauthenticated: vi.fn()
    });
    const cursor =
      `2026-07-28T10:00:00.000Z|${userId}`;

    await expect(
      api.list({
        search: "friend+tag@example.test",
        limit: 25,
        cursor
      })
    ).resolves.toEqual({ users: [user], nextCursor: null });

    expect(requestFetch.mock.calls[0]![0]).toBe(
      `/v1/admin/users?search=friend%2Btag%40example.test&limit=25&cursor=${encodeURIComponent(cursor)}`
    );
    expect(requestFetch.mock.calls[0]![1]?.method).toBe("GET");
  });

  it("maps all mutations to exact methods, paths, and bodies", async () => {
    const mutationResponse = Response.json({ user });
    const requestFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(mutationResponse)
      .mockResolvedValueOnce(Response.json({ user }))
      .mockResolvedValueOnce(Response.json({ user }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const api = createUserManagementApi({
      auth: createAuth(),
      fetch: requestFetch,
      onUnauthenticated: vi.fn()
    });

    await api.confirm(userId);
    await api.suspend(userId);
    await api.resume(userId);
    await api.sendPasswordReset(userId);
    await api.delete(userId, {
      confirmation: userId,
      clientMutationId: mutationId
    });

    expect(
      requestFetch.mock.calls.map(([url, init]) => [
        url,
        init?.method,
        init?.body
      ])
    ).toEqual([
      [`/v1/admin/users/${userId}/confirm`, "POST", undefined],
      [`/v1/admin/users/${userId}/suspend`, "POST", undefined],
      [`/v1/admin/users/${userId}/resume`, "POST", undefined],
      [
        `/v1/admin/users/${userId}/password-reset`,
        "POST",
        undefined
      ],
      [
        `/v1/admin/users/${userId}`,
        "DELETE",
        JSON.stringify({
          confirmation: userId,
          clientMutationId: mutationId
        })
      ]
    ]);
  });

  it("refreshes once after 401 and retries with the new token", async () => {
    const auth = createAuth();
    const requestFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json(
          {
            error: {
              code: "UNAUTHENTICATED",
              message: "expired",
              requestId: "request-1"
            }
          },
          { status: 401 }
        )
      )
      .mockResolvedValueOnce(
        Response.json({ users: [], nextCursor: null })
      );
    const api = createUserManagementApi({
      auth,
      fetch: requestFetch,
      onUnauthenticated: vi.fn()
    });

    await expect(
      api.list({ search: "", limit: 25 })
    ).resolves.toEqual({ users: [], nextCursor: null });
    expect(auth.refreshSession).toHaveBeenCalledOnce();
    expect(
      new Headers(
        requestFetch.mock.calls[0]![1]?.headers
      ).get("authorization")
    ).toBe("Bearer access-token");
    expect(
      new Headers(
        requestFetch.mock.calls[1]![1]?.headers
      ).get("authorization")
    ).toBe("Bearer refreshed-token");
  });

  it("maps a structured response to a safe typed failure", async () => {
    const requestFetch = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          error: {
            code: "USER_PROTECTED",
            message: "ไม่สามารถเปลี่ยนบัญชีนี้ได้",
            requestId: "request-safe"
          }
        },
        { status: 409 }
      )
    );
    const api = createUserManagementApi({
      auth: createAuth(),
      fetch: requestFetch,
      onUnauthenticated: vi.fn()
    });

    await expect(api.suspend(userId)).rejects.toEqual(
      new UserManagementApiFailure(
        "USER_PROTECTED",
        "ไม่สามารถเปลี่ยนบัญชีนี้ได้",
        "request-safe"
      )
    );
  });

  it("rejects malformed success data without exposing its contents", async () => {
    const secret = "service-role-secret";
    const requestFetch = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ users: [{ secret }], nextCursor: null })
    );
    const api = createUserManagementApi({
      auth: createAuth(),
      fetch: requestFetch,
      onUnauthenticated: vi.fn()
    });

    const error = await api
      .list({ search: "", limit: 25 })
      .catch((caught) => caught);
    expect(error).toMatchObject({
      code: "USER_ADMIN_ACTION_FAILED"
    });
    expect(String(error.message)).not.toContain(secret);
  });

  it("notifies the app when no authenticated session exists", async () => {
    const auth = createAuth();
    vi.mocked(auth.getSession).mockResolvedValue(null);
    const onUnauthenticated = vi.fn();
    const requestFetch = vi.fn<typeof fetch>();
    const api = createUserManagementApi({
      auth,
      fetch: requestFetch,
      onUnauthenticated
    });

    await expect(
      api.list({ search: "", limit: 25 })
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(onUnauthenticated).toHaveBeenCalledOnce();
    expect(requestFetch).not.toHaveBeenCalled();
  });
});

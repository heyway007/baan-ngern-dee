import type { CloudAuth, CloudSession } from "./cloud-auth";
import { describe, expect, it, vi } from "vitest";

import {
  createAdminInvitationApi,
  createPublicInvitationApi,
  RemoteInvitationError
} from "./invitation-api";

const session: CloudSession = {
  userId: "11111111-1111-4111-8111-111111111111",
  email: "admin@example.test",
  displayName: "Admin",
  accessToken: "access-token"
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

describe("public invitation API", () => {
  it("inspects and redeems without sending authorization", async () => {
    const requestFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          displayName: "Person",
          maskedEmail: "pe****@example.test",
          status: "ready"
        })
      )
      .mockResolvedValueOnce(
        Response.json({ email: "person@example.test" })
      );
    const api = createPublicInvitationApi({
      fetch: requestFetch
    });

    await api.inspect("a".repeat(43));
    await api.redeem({
      token: "a".repeat(43),
      password: "strong-password"
    });

    for (const [, init] of requestFetch.mock.calls) {
      expect(
        new Headers(init?.headers).has("authorization")
      ).toBe(false);
    }
  });

  it("returns a stable remote error for an expired invitation", async () => {
    const requestFetch = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          error: {
            code: "INVITATION_EXPIRED",
            message: "ลิงก์เชิญหมดอายุแล้ว",
            requestId: "request-1"
          }
        },
        { status: 409 }
      )
    );
    const api = createPublicInvitationApi({
      fetch: requestFetch
    });

    await expect(api.inspect("a".repeat(43))).rejects.toEqual(
      new RemoteInvitationError(
        "INVITATION_EXPIRED",
        409,
        "ลิงก์เชิญหมดอายุแล้ว",
        "request-1"
      )
    );
  });
});

describe("admin invitation API", () => {
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
        Response.json({ invitations: [] })
      );
    const api = createAdminInvitationApi({
      auth,
      fetch: requestFetch,
      onUnauthenticated: vi.fn()
    });

    await expect(api.list()).resolves.toEqual([]);
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

  it("maps create, replace, and revoke to exact paths", async () => {
    const row = {
      id: "33333333-3333-4333-8333-333333333333",
      email: "person@example.test",
      displayName: "Person",
      status: "ready",
      createdAt: "2026-07-27T10:00:00.000Z",
      expiresAt: "2026-07-28T10:00:00.000Z"
    };
    const response = {
      invitation: row,
      invitationUrl:
        `https://app.example/accept-invite#token=${"a".repeat(43)}`
    };
    const requestFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(response))
      .mockResolvedValueOnce(Response.json(response))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const api = createAdminInvitationApi({
      auth: createAuth(),
      fetch: requestFetch,
      onUnauthenticated: vi.fn()
    });

    await api.create({
      email: row.email,
      displayName: row.displayName
    });
    await api.replace(row.id);
    await api.revoke(row.id);

    expect(
      requestFetch.mock.calls.map(([url]) => url)
    ).toEqual([
      "/v1/admin/invitations",
      `/v1/admin/invitations/${row.id}/replace`,
      `/v1/admin/invitations/${row.id}`
    ]);
  });
});

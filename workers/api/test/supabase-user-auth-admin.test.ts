import { describe, expect, it, vi } from "vitest";

import {
  createSupabaseUserAuthAdmin
} from "../src/services/supabase-user-auth-admin";

const config = {
  url: "https://project.supabase.co/",
  serviceRoleKey: "service-role-secret"
};
const userId = "22222222-2222-4222-8222-222222222222";

const rawUser = {
  id: userId,
  email: "friend@example.test",
  user_metadata: { display_name: "Friend" },
  app_metadata: { provider: "email" },
  created_at: "2026-07-28T10:00:00.000Z",
  last_sign_in_at: null,
  email_confirmed_at: null,
  banned_until: null
};

describe("Supabase user Auth Admin adapter", () => {
  it("accepts a wrapped Admin Auth user response", async () => {
    const requestFetch = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ user: rawUser })
    );
    const authAdmin = createSupabaseUserAuthAdmin({
      ...config,
      fetch: requestFetch
    });

    await expect(authAdmin.getUser(userId)).resolves.toMatchObject({
      userId,
      email: "friend@example.test",
      displayName: "Friend"
    });
  });

  it("accepts an empty email from an email-less LINE identity", async () => {
    const requestFetch = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        id: userId,
        email: "",
        user_metadata: { name: "Min LINE" },
        app_metadata: { provider: "custom:line" },
        created_at: "2026-07-30T10:00:00.000Z"
      })
    );
    const authAdmin = createSupabaseUserAuthAdmin({
      ...config,
      fetch: requestFetch
    });

    await expect(authAdmin.getUser(userId)).resolves.toMatchObject({
      userId,
      displayName: "Min LINE",
      status: "active"
    });
  });

  it("labels a malformed Admin Auth user response as a parse failure", async () => {
    const requestFetch = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ user: { id: userId } })
    );
    const authAdmin = createSupabaseUserAuthAdmin({
      ...config,
      fetch: requestFetch
    });

    await expect(authAdmin.getUser(userId)).rejects.toMatchObject({
      code: "USER_ADMIN_ACTION_FAILED",
      logContext: {
        userAdminAuthCause: "parse"
      }
    });
  });

  it.each([
    [
      { display_name: `  ${"ก".repeat(90)}  ` },
      "ก".repeat(80)
    ],
    [
      { display_name: " ", name: "มิน LINE" },
      "มิน LINE"
    ],
    [
      { display_name: " ", name: "", full_name: "มินเต็ม" },
      "มินเต็ม"
    ],
    [
      {
        display_name: " ",
        name: "",
        full_name: " ",
        preferred_username: "min-line"
      },
      "min-line"
    ],
    [{}, "ผู้ใช้ LINE"]
  ])(
    "normalizes an email-less LINE display name using provider metadata",
    async (userMetadata, expectedDisplayName) => {
      const requestFetch = vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          id: userId,
          user_metadata: userMetadata,
          app_metadata: { provider: "custom:line" },
          created_at: "2026-07-30T10:00:00.000Z",
          last_sign_in_at: null,
          email_confirmed_at: null,
          banned_until: null
        })
      );
      const authAdmin = createSupabaseUserAuthAdmin({
        ...config,
        fetch: requestFetch
      });

      await expect(authAdmin.getUser(userId)).resolves.toEqual({
        userId,
        displayName: expectedDisplayName,
        status: "active",
        createdAt: "2026-07-30T10:00:00.000Z",
        privateWorkspaceCount: 0,
        deletionPending: false
      });
    }
  );

  it.each([
    [
      {
        banned_until: "2126-07-30T10:00:00.000Z",
        app_metadata: { provider: "custom:line" }
      },
      "suspended"
    ],
    [
      {
        banned_until: "2126-07-30T10:00:00.000Z",
        app_metadata: {
          provider: "custom:line",
          baan_ngern_dee_deletion_pending: true
        }
      },
      "deletion_pending"
    ]
  ] as const)(
    "normalizes an email-less LINE %s state as %s",
    async (overrides, expectedStatus) => {
      const requestFetch = vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          id: userId,
          user_metadata: { name: "มิน LINE" },
          created_at: "2026-07-30T10:00:00.000Z",
          last_sign_in_at: null,
          email_confirmed_at: null,
          ...overrides
        })
      );
      const authAdmin = createSupabaseUserAuthAdmin({
        ...config,
        fetch: requestFetch
      });

      await expect(authAdmin.getUser(userId)).resolves.toMatchObject({
        userId,
        status: expectedStatus
      });
    }
  );

  it("accepts Admin Auth users that omit optional timestamp fields", async () => {
    const requestFetch = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        id: userId,
        email: "friend@example.test",
        user_metadata: { display_name: "Friend" },
        app_metadata: { provider: "email" },
        created_at: "2026-07-28T10:00:00.000Z",
        email_confirmed_at: "2026-07-28T10:01:00.000Z"
      })
    );
    const authAdmin = createSupabaseUserAuthAdmin({
      ...config,
      fetch: requestFetch
    });

    await expect(authAdmin.getUser(userId)).resolves.toMatchObject({
      userId,
      status: "active",
      deletionPending: false
    });
  });

  it("gets and confirms a legacy unconfirmed user", async () => {
    const confirmed = {
      ...rawUser,
      email_confirmed_at: "2026-07-28T10:01:00.000Z"
    };
    const requestFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(rawUser))
      .mockResolvedValueOnce(Response.json(confirmed));
    const authAdmin = createSupabaseUserAuthAdmin({
      ...config,
      fetch: requestFetch
    });

    await expect(authAdmin.getUser(userId)).resolves.toMatchObject({
      userId,
      status: "unconfirmed"
    });
    await expect(
      authAdmin.confirmUser(userId)
    ).resolves.toMatchObject({
      userId,
      status: "active"
    });
    expect(
      JSON.parse(String(requestFetch.mock.calls[1]![1]?.body))
    ).toEqual({ email_confirm: true });
  });

  it("suspends, resumes, and hard deletes with exact Auth payloads", async () => {
    const requestFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          ...rawUser,
          banned_until: "2126-07-28T10:00:00.000Z"
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          ...rawUser,
          email_confirmed_at: "2026-07-28T10:01:00.000Z"
        })
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const authAdmin = createSupabaseUserAuthAdmin({
      ...config,
      fetch: requestFetch
    });

    await authAdmin.suspendUser(userId);
    await authAdmin.resumeUser(userId);
    await authAdmin.deleteUser(userId);

    expect(
      JSON.parse(String(requestFetch.mock.calls[0]![1]?.body))
    ).toEqual({ ban_duration: "876000h" });
    expect(
      JSON.parse(String(requestFetch.mock.calls[1]![1]?.body))
    ).toEqual({ ban_duration: "none" });
    expect(requestFetch.mock.calls[2]![0]).toBe(
      `https://project.supabase.co/auth/v1/admin/users/${userId}`
    );
    expect(requestFetch.mock.calls[2]![1]?.method).toBe("DELETE");
    expect(
      JSON.parse(String(requestFetch.mock.calls[2]![1]?.body))
    ).toEqual({ should_soft_delete: false });
  });

  it("preserves app metadata while marking deletion pending", async () => {
    const pending = {
      ...rawUser,
      app_metadata: {
        provider: "email",
        baan_ngern_dee_deletion_pending: true
      },
      banned_until: "2126-07-28T10:00:00.000Z"
    };
    const requestFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(rawUser))
      .mockResolvedValueOnce(Response.json(pending));
    const authAdmin = createSupabaseUserAuthAdmin({
      ...config,
      fetch: requestFetch
    });

    await expect(
      authAdmin.markDeletionPending(userId)
    ).resolves.toMatchObject({
      status: "deletion_pending",
      deletionPending: true
    });
    expect(
      JSON.parse(String(requestFetch.mock.calls[1]![1]?.body))
    ).toEqual({
      ban_duration: "876000h",
      app_metadata: {
        provider: "email",
        baan_ngern_dee_deletion_pending: true
      }
    });
  });

  it("sends only a normal Supabase recovery request", async () => {
    const requestFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 200 }));
    const authAdmin = createSupabaseUserAuthAdmin({
      ...config,
      fetch: requestFetch
    });

    await authAdmin.sendPasswordReset("friend@example.test");

    expect(requestFetch).toHaveBeenCalledWith(
      "https://project.supabase.co/auth/v1/recover",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ email: "friend@example.test" })
      })
    );
  });

  it.each([
    [404, "USER_NOT_FOUND", 404],
    [429, "USER_ADMIN_RATE_LIMITED", 429],
    [500, "USER_ADMIN_ACTION_FAILED", 500]
  ] as const)("maps Auth status %s to %s", async (
    upstreamStatus,
    code,
    status
  ) => {
    const requestFetch = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        { message: "service-role-secret upstream detail" },
        { status: upstreamStatus }
      )
    );
    const authAdmin = createSupabaseUserAuthAdmin({
      ...config,
      fetch: requestFetch
    });

    const error = await authAdmin
      .getUser(userId)
      .catch((caught) => caught);
    expect(error).toMatchObject({
      code,
      status,
      ...(upstreamStatus === 500
        ? {
            logContext: {
              userAdminAuthCause: "request"
            }
          }
        : {})
    });
    expect(String(error.message)).not.toContain(
      "service-role-secret"
    );
  });
});

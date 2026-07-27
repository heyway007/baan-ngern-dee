import type {
  AdminInvitation,
  CreateInvitationResponse
} from "@systems-credit/contracts";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../src/api-error";
import { createApp } from "../src/app";
import { createStaticAuthVerifier } from "../src/middleware/auth";
import type {
  InvitationService
} from "../src/services/invitation-service";

const adminId = "11111111-1111-4111-8111-111111111111";
const normalId = "22222222-2222-4222-8222-222222222222";
const invitationId = "33333333-3333-4333-8333-333333333333";
const token = "a".repeat(43);

const invitation: AdminInvitation = {
  id: invitationId,
  email: "person@example.test",
  displayName: "Person",
  status: "ready",
  createdAt: "2026-07-27T10:00:00.000Z",
  expiresAt: "2026-07-28T10:00:00.000Z"
};

function createInvitationRouteApp() {
  const created: CreateInvitationResponse = {
    invitation,
    invitationUrl:
      `https://app.example/accept-invite#token=${token}`
  };
  const invitationService: InvitationService = {
    capabilities: vi.fn((actor) => ({
      canManageInvitations: actor.userId === adminId
    })),
    list: vi.fn(async (actor) => {
      if (actor.userId !== adminId) {
        throw new ApiError(
          "SUPER_ADMIN_REQUIRED",
          403,
          "ไม่มีสิทธิ์จัดการคำเชิญ"
        );
      }
      return [invitation];
    }),
    create: vi.fn(async (actor) => {
      if (actor.userId !== adminId) {
        throw new ApiError(
          "SUPER_ADMIN_REQUIRED",
          403,
          "ไม่มีสิทธิ์จัดการคำเชิญ"
        );
      }
      return created;
    }),
    replace: vi.fn(async () => created),
    revoke: vi.fn(async () => undefined),
    inspect: vi.fn(async () => ({
      displayName: "Person",
      maskedEmail: "pe****@example.test",
      status: "ready" as const
    })),
    redeem: vi.fn(async () => ({
      email: "person@example.test"
    }))
  };
  const app = createApp({
    authVerifier: createStaticAuthVerifier({
      "admin-token": adminId,
      "normal-token": normalId
    }),
    invitationService,
    publicConfig: {
      supabaseUrl: "https://project.supabase.co",
      supabasePublishableKey: "sb_publishable_public"
    }
  });
  return { app, invitationService };
}

describe("invitation Worker routes", () => {
  it("inspects and redeems a valid invitation without authentication", async () => {
    const { app, invitationService } =
      createInvitationRouteApp();

    const inspectResponse = await app.request(
      "/v1/public/invitations/inspect",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token })
      }
    );
    expect(inspectResponse.status).toBe(200);
    await expect(inspectResponse.json()).resolves.toEqual({
      displayName: "Person",
      maskedEmail: "pe****@example.test",
      status: "ready"
    });

    const redeemResponse = await app.request(
      "/v1/public/invitations/redeem",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token,
          password: "strong-password"
        })
      }
    );
    expect(redeemResponse.status).toBe(200);
    await expect(redeemResponse.json()).resolves.toEqual({
      email: "person@example.test"
    });
    expect(invitationService.inspect).toHaveBeenCalledWith(token);
  });

  it("returns capability false to a normal authenticated user", async () => {
    const { app } = createInvitationRouteApp();

    const response = await app.request(
      "/v1/admin/capabilities",
      {
        headers: { authorization: "Bearer normal-token" }
      }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      canManageInvitations: false
    });
  });

  it("rejects invitation creation from a normal authenticated user", async () => {
    const { app } = createInvitationRouteApp();

    const response = await app.request(
      "/v1/admin/invitations",
      {
        method: "POST",
        headers: {
          authorization: "Bearer normal-token",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          email: "person@example.test",
          displayName: "Person"
        })
      }
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "SUPER_ADMIN_REQUIRED" }
    });
  });

  it("creates and lists sanitized invitations for the Super Admin", async () => {
    const { app } = createInvitationRouteApp();
    const headers = {
      authorization: "Bearer admin-token",
      "content-type": "application/json"
    };

    const created = await app.request(
      "/v1/admin/invitations",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          email: " PERSON@EXAMPLE.TEST ",
          displayName: " Person "
        })
      }
    );
    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toMatchObject({
      invitation,
      invitationUrl:
        `https://app.example/accept-invite#token=${token}`
    });

    const listed = await app.request(
      "/v1/admin/invitations",
      { headers }
    );
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toEqual({
      invitations: [invitation]
    });
  });

  it("rejects malformed public input before reaching the service", async () => {
    const { app, invitationService } =
      createInvitationRouteApp();

    const response = await app.request(
      "/v1/public/invitations/redeem",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: "invalid",
          password: "short"
        })
      }
    );

    expect(response.status).toBe(400);
    expect(invitationService.redeem).not.toHaveBeenCalled();
  });
});

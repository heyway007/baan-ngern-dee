import type { AdminUser } from "@systems-credit/contracts";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import { createStaticAuthVerifier } from "../src/middleware/auth";
import type { UserManagementService } from "../src/services/user-management-service";

const adminId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const mutationId = "33333333-3333-4333-8333-333333333333";

const user: AdminUser = {
  userId,
  email: "friend@example.test",
  displayName: "Friend",
  status: "active",
  createdAt: "2026-07-28T10:00:00.000Z",
  emailConfirmedAt: "2026-07-28T10:01:00.000Z",
  privateWorkspaceCount: 1,
  deletionPending: false
};

function createUserRouteApp() {
  const service: UserManagementService = {
    list: vi.fn(async () => ({
      users: [user],
      nextCursor: null
    })),
    confirm: vi.fn(async () => ({ user })),
    suspend: vi.fn(async () => ({
      user: { ...user, status: "suspended" as const }
    })),
    resume: vi.fn(async () => ({ user })),
    sendPasswordReset: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined)
  };
  const app = createApp({
    authVerifier: createStaticAuthVerifier({
      "admin-token": adminId
    }),
    userManagementService: service
  });
  return { app, service };
}

const adminHeaders = {
  authorization: "Bearer admin-token",
  "content-type": "application/json"
};

describe("user management Worker routes", () => {
  it("requires a valid bearer token", async () => {
    const { app, service } = createUserRouteApp();

    const response = await app.request("/v1/admin/users");

    expect(response.status).toBe(401);
    expect(service.list).not.toHaveBeenCalled();
  });

  it("validates, normalizes, and delegates the list query", async () => {
    const { app, service } = createUserRouteApp();

    const response = await app.request(
      "/v1/admin/users?search=%20Friend%40Example.TEST%20&limit=25",
      { headers: adminHeaders }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      users: [user],
      nextCursor: null
    });
    expect(service.list).toHaveBeenCalledWith(
      expect.objectContaining({ userId: adminId }),
      { search: "friend@example.test", limit: 25 }
    );
  });

  it("rejects unknown list query keys", async () => {
    const { app, service } = createUserRouteApp();

    const response = await app.request(
      "/v1/admin/users?search=friend&unexpected=true",
      { headers: adminHeaders }
    );

    expect(response.status).toBe(400);
    expect(service.list).not.toHaveBeenCalled();
  });

  it.each([
    ["confirm", "confirm", 200],
    ["suspend", "suspend", 200],
    ["resume", "resume", 200],
    ["password-reset", "sendPasswordReset", 204]
  ] as const)(
    "delegates %s without losing the service method binding",
    async (path, method, expectedStatus) => {
      const { app, service } = createUserRouteApp();

      const response = await app.request(
        `/v1/admin/users/${userId}/${path}`,
        { method: "POST", headers: adminHeaders }
      );

      expect(response.status).toBe(expectedStatus);
      expect(service[method]).toHaveBeenCalledWith(
        expect.objectContaining({ userId: adminId }),
        userId
      );
      if (expectedStatus === 200) {
        await expect(response.json()).resolves.toHaveProperty(
          "user.userId",
          userId
        );
      } else {
        expect(await response.text()).toBe("");
      }
    }
  );

  it("validates UUID path parameters before reaching the service", async () => {
    const { app, service } = createUserRouteApp();

    const response = await app.request(
      "/v1/admin/users/not-a-uuid/suspend",
      { method: "POST", headers: adminHeaders }
    );

    expect(response.status).toBe(400);
    expect(service.suspend).not.toHaveBeenCalled();
  });

  it("validates the delete body and delegates permanent deletion", async () => {
    const { app, service } = createUserRouteApp();

    const response = await app.request(
      `/v1/admin/users/${userId}`,
      {
        method: "DELETE",
        headers: adminHeaders,
        body: JSON.stringify({
          confirmation: userId,
          clientMutationId: mutationId
        })
      }
    );

    expect(response.status).toBe(204);
    expect(service.delete).toHaveBeenCalledWith(
      expect.objectContaining({ userId: adminId }),
      userId,
      {
        confirmation: userId,
        clientMutationId: mutationId
      }
    );
  });

  it("rejects unknown delete body keys", async () => {
    const { app, service } = createUserRouteApp();

    const response = await app.request(
      `/v1/admin/users/${userId}`,
      {
        method: "DELETE",
        headers: adminHeaders,
        body: JSON.stringify({
          confirmation: "friend@example.test",
          clientMutationId: mutationId,
          force: true
        })
      }
    );

    expect(response.status).toBe(400);
    expect(service.delete).not.toHaveBeenCalled();
  });
});

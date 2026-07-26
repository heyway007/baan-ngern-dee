import { describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { createStaticAuthVerifier } from "../src/middleware/auth";
import { createMemoryFinanceRepository } from "../src/services/finance-repository";

const ownerId = "11111111-1111-4111-8111-111111111111";
const outsiderId = "22222222-2222-4222-8222-222222222222";

async function setup() {
  const app = createApp({
    authVerifier: createStaticAuthVerifier({
      "owner-token": ownerId,
      "outsider-token": outsiderId
    }),
    financeRepository: createMemoryFinanceRepository()
  });
  const workspaceResponse = await app.request("/v1/workspaces/private", {
    method: "POST",
    headers: {
      authorization: "Bearer owner-token",
      "content-type": "application/json"
    },
    body: JSON.stringify({ name: "การเงินของฉัน" })
  });
  const result = await workspaceResponse.json<{
    workspace: { id: string };
  }>();
  return { app, workspaceId: result.workspace.id };
}

describe("POST /v1/accounts", () => {
  it("creates zero-balance account metadata for the owner", async () => {
    const { app, workspaceId } = await setup();
    const response = await app.request("/v1/accounts", {
      method: "POST",
      headers: {
        authorization: "Bearer owner-token",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        workspaceId,
        name: "บัญชีเงินเดือน",
        type: "bank",
        currency: "THB",
        institution: "ธนาคารตัวอย่าง"
      })
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      account: {
        workspaceId,
        name: "บัญชีเงินเดือน",
        type: "bank",
        currency: "THB",
        institution: "ธนาคารตัวอย่าง",
        version: 1
      }
    });
  });

  it("rejects creating an account in another user's workspace", async () => {
    const { app, workspaceId } = await setup();
    const response = await app.request("/v1/accounts", {
      method: "POST",
      headers: {
        authorization: "Bearer outsider-token",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        workspaceId,
        name: "Hidden account",
        type: "bank",
        currency: "THB"
      })
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "FORBIDDEN_WORKSPACE" }
    });
  });

  it("does not accept an opening balance during metadata creation", async () => {
    const { app, workspaceId } = await setup();
    const response = await app.request("/v1/accounts", {
      method: "POST",
      headers: {
        authorization: "Bearer owner-token",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        workspaceId,
        name: "เงินสด",
        type: "cash",
        currency: "THB",
        openingBalance: "5000.00"
      })
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "VALIDATION_FAILED" }
    });
  });
});

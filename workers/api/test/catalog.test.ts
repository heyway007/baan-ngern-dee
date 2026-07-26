import { describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { createStaticAuthVerifier } from "../src/middleware/auth";
import { createMemoryFinanceRepository } from "../src/services/finance-repository";

const ownerId = "11111111-1111-4111-8111-111111111111";
const strangerId = "22222222-2222-4222-8222-222222222222";

async function setup() {
  const financeRepository = createMemoryFinanceRepository();
  const app = createApp({
    authVerifier: createStaticAuthVerifier({
      "owner-token": ownerId,
      "stranger-token": strangerId
    }),
    financeRepository
  });
  const workspaceResponse = await app.request("/v1/workspaces/private", {
    method: "POST",
    headers: {
      authorization: "Bearer owner-token",
      "content-type": "application/json"
    },
    body: JSON.stringify({ name: "การเงินของฉัน" })
  });
  const body = await workspaceResponse.json<{ workspace: { id: string } }>();
  return { app, workspaceId: body.workspace.id };
}

describe("POST /v1/categories", () => {
  it("creates a custom category for a workspace owner", async () => {
    const { app, workspaceId } = await setup();
    const response = await app.request("/v1/categories", {
      method: "POST",
      headers: {
        authorization: "Bearer owner-token",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        workspaceId,
        name: "สัตว์เลี้ยง",
        kind: "expense"
      })
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      category: {
        workspaceId,
        name: "สัตว์เลี้ยง",
        kind: "expense",
        isDefault: false
      }
    });
  });

  it("denies a non-member without revealing workspace data", async () => {
    const { app, workspaceId } = await setup();
    const response = await app.request("/v1/categories", {
      method: "POST",
      headers: {
        authorization: "Bearer stranger-token",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        workspaceId,
        name: "ข้อมูลที่ไม่ควรเห็น",
        kind: "expense"
      })
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "FORBIDDEN_WORKSPACE" }
    });
  });

  it("rejects a duplicate active sibling name", async () => {
    const { app, workspaceId } = await setup();
    const request = () =>
      app.request("/v1/categories", {
        method: "POST",
        headers: {
          authorization: "Bearer owner-token",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          workspaceId,
          name: "สัตว์เลี้ยง",
          kind: "expense"
        })
      });

    expect((await request()).status).toBe(201);
    const duplicate = await request();

    expect(duplicate.status).toBe(409);
    await expect(duplicate.json()).resolves.toMatchObject({
      error: { code: "CATEGORY_NAME_EXISTS" }
    });
  });
});

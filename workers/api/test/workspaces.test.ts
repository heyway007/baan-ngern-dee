import { describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { createStaticAuthVerifier } from "../src/middleware/auth";
import { createMemoryFinanceRepository } from "../src/services/finance-repository";

const ownerId = "11111111-1111-4111-8111-111111111111";

function createTestApp() {
  return createApp({
    authVerifier: createStaticAuthVerifier({
      "owner-token": ownerId
    }),
    financeRepository: createMemoryFinanceRepository()
  });
}

describe("POST /v1/workspaces/private", () => {
  it("creates an owner-only THB workspace with the default catalog", async () => {
    const response = await createTestApp().request("/v1/workspaces/private", {
      method: "POST",
      headers: {
        authorization: "Bearer owner-token",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        name: "การเงินของฉัน",
        baseCurrency: "THB",
        timeZone: "Asia/Bangkok"
      })
    });

    expect(response.status).toBe(201);
    const body = await response.json<{
      workspace: {
        name: string;
        kind: string;
        baseCurrency: string;
        timeZone: string;
        role: string;
      };
      categories: Array<{ slug: string; kind: string }>;
    }>();

    expect(body.workspace).toMatchObject({
      name: "การเงินของฉัน",
      kind: "private",
      baseCurrency: "THB",
      timeZone: "Asia/Bangkok",
      role: "owner"
    });
    expect(body.categories).toHaveLength(18);
    expect(body.categories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slug: "salary", kind: "income" }),
        expect.objectContaining({ slug: "debt-interest", kind: "expense" })
      ])
    );
  });

  it("requires a valid bearer token", async () => {
    const response = await createTestApp().request("/v1/workspaces/private", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "การเงินของฉัน" })
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "UNAUTHENTICATED" }
    });
  });

  it("rejects a second active private workspace for the same owner", async () => {
    const app = createTestApp();
    const request = () =>
      app.request("/v1/workspaces/private", {
        method: "POST",
        headers: {
          authorization: "Bearer owner-token",
          "content-type": "application/json"
        },
        body: JSON.stringify({ name: "การเงินของฉัน" })
      });

    expect((await request()).status).toBe(201);
    const duplicate = await request();

    expect(duplicate.status).toBe(409);
    await expect(duplicate.json()).resolves.toMatchObject({
      error: { code: "PRIVATE_WORKSPACE_EXISTS" }
    });
  });

  it("rejects an invalid IANA timezone", async () => {
    const response = await createTestApp().request("/v1/workspaces/private", {
      method: "POST",
      headers: {
        authorization: "Bearer owner-token",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        name: "การเงินของฉัน",
        timeZone: "Bangkok/Nowhere"
      })
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "VALIDATION_FAILED" }
    });
  });
});

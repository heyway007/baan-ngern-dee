import { financeSnapshotSchema } from "@systems-credit/contracts";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { createStaticAuthVerifier } from "../src/middleware/auth";
import { createMemoryFinanceRepository } from "../src/services/finance-repository";

const authorization = { authorization: "Bearer owner-token" };

describe("GET /v1/snapshot", () => {
  it("returns the authenticated owner's deterministic finance read model", async () => {
    const app = createApp({
      authVerifier: createStaticAuthVerifier({
        "owner-token": "11111111-1111-4111-8111-111111111111"
      }),
      financeRepository: createMemoryFinanceRepository()
    });
    const workspaceResponse = await app.request(
      "/v1/workspaces/private",
      {
        method: "POST",
        headers: {
          ...authorization,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          name: "Owner workspace",
          baseCurrency: "THB",
          timeZone: "Asia/Bangkok"
        })
      }
    );
    const workspace = await workspaceResponse.json<{
      workspace: { id: string };
    }>();
    const accountResponse = await app.request("/v1/accounts", {
      method: "POST",
      headers: {
        ...authorization,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        workspaceId: workspace.workspace.id,
        name: "เงินสด",
        type: "cash",
        currency: "THB",
        openingBalance: "500.00"
      })
    });
    expect(accountResponse.status).toBe(201);

    const response = await app.request("/v1/snapshot", {
      headers: authorization
    });

    expect(response.status).toBe(200);
    expect(
      financeSnapshotSchema.parse(await response.json())
    ).toMatchObject({
      workspace: { id: workspace.workspace.id, role: "owner" },
      accounts: [{ name: "เงินสด" }]
    });
  });

  it("requires a bearer token", async () => {
    const response = await createApp().request("/v1/snapshot");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "UNAUTHENTICATED" }
    });
  });
});

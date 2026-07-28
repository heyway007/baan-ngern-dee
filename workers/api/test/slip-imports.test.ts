import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import { createStaticAuthVerifier } from "../src/middleware/auth";

const userId = "11111111-1111-4111-8111-111111111111";
const workspaceId = "22222222-2222-4222-8222-222222222222";
const imageSha256 =
  "6e568e1f67fba258184c78181539e5e8fdee447e49bb706fc0ea34fbf12336a5";
const accountId = "33333333-3333-4333-8333-333333333333";
const categoryId = "44444444-4444-4444-8444-444444444444";
const itemId = "55555555-5555-4555-8555-555555555555";
const batchMutationId = "66666666-6666-4666-8666-666666666666";

function batchInput() {
  return {
    workspaceId,
    batchMutationId,
    items: [{
      itemId,
      analysisToken: "a".repeat(40),
      transaction: {
        workspaceId,
        accountId,
        categoryId,
        type: "expense",
        amount: "60.00",
        currency: "THB",
        financialDate: "2026-07-27",
        tagIds: [],
        clientMutationId: "77777777-7777-4777-8777-777777777777"
      }
    }]
  };
}

describe("slip import routes", () => {
  it("accepts one authenticated multipart image", async () => {
    const analyze = vi.fn().mockResolvedValue({ status: "unsupported" });
    const form = new FormData();
    form.set("workspaceId", workspaceId);
    form.set("imageSha256", imageSha256);
    form.set("image", new File([
      new Uint8Array([0xff, 0xd8, 0xff])
    ], "slip.jpg", { type: "image/jpeg" }));
    const response = await createApp({
      authVerifier: createStaticAuthVerifier({ token: userId }),
      slipImportService: {
        analyze,
        confirm: vi.fn(),
        confirmBatch: vi.fn(),
        getQuota: vi.fn()
      },
      publicConfig: {
        supabaseUrl: "https://example.supabase.co",
        supabasePublishableKey: "sb_publishable_example_example",
        turnstileSiteKey: "test"
      }
    }).request("/v1/slip-imports/analyze", {
      method: "POST",
      headers: { authorization: "Bearer token" },
      body: form
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "unsupported" });
    expect(analyze).toHaveBeenCalledWith(
      expect.objectContaining({ userId }),
      expect.objectContaining({
        workspaceId,
        imageSha256,
        requestId: expect.any(String)
      })
    );
  });

  it("requires authentication", async () => {
    const response = await createApp({
      slipImportService: {
        analyze: vi.fn(),
        confirm: vi.fn(),
        confirmBatch: vi.fn(),
        getQuota: vi.fn()
      },
      publicConfig: {
        supabaseUrl: "https://example.supabase.co",
        supabasePublishableKey: "sb_publishable_example_example",
        turnstileSiteKey: "test"
      }
    }).request("/v1/slip-imports/analyze", { method: "POST" });
    expect(response.status).toBe(401);
  });

  it("returns quota state for an authenticated workspace", async () => {
    const getQuota = vi.fn().mockResolvedValue({ used: 7, limit: 30 });
    const response = await createApp({
      authVerifier: createStaticAuthVerifier({ token: userId }),
      slipImportService: {
        analyze: vi.fn(),
        confirm: vi.fn(),
        confirmBatch: vi.fn(),
        getQuota
      },
      publicConfig: {
        supabaseUrl: "https://example.supabase.co",
        supabasePublishableKey: "sb_publishable_example_example",
        turnstileSiteKey: "test"
      }
    }).request(
      `/v1/slip-imports/quota?workspaceId=${encodeURIComponent(workspaceId)}`,
      { headers: { authorization: "Bearer token" } }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ used: 7, limit: 30 });
    expect(getQuota).toHaveBeenCalledWith(
      expect.objectContaining({ userId }),
      workspaceId
    );
  });

  it("rejects unknown quota query keys", async () => {
    const response = await createApp({
      authVerifier: createStaticAuthVerifier({ token: userId }),
      slipImportService: {
        analyze: vi.fn(),
        confirm: vi.fn(),
        confirmBatch: vi.fn(),
        getQuota: vi.fn()
      },
      publicConfig: {
        supabaseUrl: "https://example.supabase.co",
        supabasePublishableKey: "sb_publishable_example_example",
        turnstileSiteKey: "test"
      }
    }).request(
      `/v1/slip-imports/quota?workspaceId=${workspaceId}&extra=true`,
      { headers: { authorization: "Bearer token" } }
    );

    expect(response.status).toBe(400);
  });

  it("confirms a strict authenticated batch", async () => {
    const posted = {
      status: "posted",
      items: [{
        itemId,
        transaction: {
          transactionId: "88888888-8888-4888-8888-888888888888",
          version: 1,
          state: "posted",
          accountBalances: [{
            accountId,
            amount: "-60.00",
            currency: "THB"
          }]
        }
      }]
    };
    const confirmBatch = vi.fn().mockResolvedValue(posted);
    const response = await createApp({
      authVerifier: createStaticAuthVerifier({ token: userId }),
      slipImportService: {
        analyze: vi.fn(),
        confirm: vi.fn(),
        confirmBatch,
        getQuota: vi.fn()
      },
      publicConfig: {
        supabaseUrl: "https://example.supabase.co",
        supabasePublishableKey: "sb_publishable_example_example",
        turnstileSiteKey: "test"
      }
    }).request("/v1/slip-imports/confirm-batch", {
      method: "POST",
      headers: {
        authorization: "Bearer token",
        "content-type": "application/json"
      },
      body: JSON.stringify(batchInput())
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(posted);
    expect(confirmBatch).toHaveBeenCalledWith(
      expect.objectContaining({ userId }),
      batchInput()
    );
  });

  it("returns a blocked batch without exposing tokens", async () => {
    const blocked = {
      status: "blocked",
      issues: [{ itemId, code: "expired_analysis" }]
    };
    const response = await createApp({
      authVerifier: createStaticAuthVerifier({ token: userId }),
      slipImportService: {
        analyze: vi.fn(),
        confirm: vi.fn(),
        confirmBatch: vi.fn().mockResolvedValue(blocked),
        getQuota: vi.fn()
      },
      publicConfig: {
        supabaseUrl: "https://example.supabase.co",
        supabasePublishableKey: "sb_publishable_example_example",
        turnstileSiteKey: "test"
      }
    }).request("/v1/slip-imports/confirm-batch", {
      method: "POST",
      headers: {
        authorization: "Bearer token",
        "content-type": "application/json"
      },
      body: JSON.stringify(batchInput())
    });

    expect(response.status).toBe(200);
    const body = JSON.stringify(await response.json());
    expect(JSON.parse(body)).toEqual(blocked);
    expect(body).not.toContain("a".repeat(40));
  });

  it("rejects malformed and unauthenticated batch confirmation", async () => {
    const authenticatedApp = createApp({
      authVerifier: createStaticAuthVerifier({ token: userId }),
      slipImportService: {
        analyze: vi.fn(),
        confirm: vi.fn(),
        confirmBatch: vi.fn(),
        getQuota: vi.fn()
      },
      publicConfig: {
        supabaseUrl: "https://example.supabase.co",
        supabasePublishableKey: "sb_publishable_example_example",
        turnstileSiteKey: "test"
      }
    });
    const valid = batchInput();
    const invalidBodies = [
      { ...valid, unexpected: true },
      { ...valid, items: [] },
      {
        ...valid,
        items: Array.from({ length: 11 }, (_, index) => ({
          ...valid.items[0],
          itemId:
            `55555555-5555-4555-8555-${String(index).padStart(12, "0")}`,
          transaction: {
            ...valid.items[0]!.transaction,
            clientMutationId:
              `77777777-7777-4777-8777-${String(index).padStart(12, "0")}`
          }
        }))
      },
      { ...valid, items: [valid.items[0], valid.items[0]] },
      {
        ...valid,
        items: [{
          ...valid.items[0],
          transaction: {
            ...valid.items[0]!.transaction,
            workspaceId: "99999999-9999-4999-8999-999999999999"
          }
        }]
      }
    ];
    for (const body of invalidBodies) {
      const response = await authenticatedApp.request(
        "/v1/slip-imports/confirm-batch",
        {
          method: "POST",
          headers: {
            authorization: "Bearer token",
            "content-type": "application/json"
          },
          body: JSON.stringify(body)
        }
      );
      expect(response.status).toBe(400);
    }

    const response = await createApp({
      slipImportService: {
        analyze: vi.fn(),
        confirm: vi.fn(),
        confirmBatch: vi.fn(),
        getQuota: vi.fn()
      },
      publicConfig: {
        supabaseUrl: "https://example.supabase.co",
        supabasePublishableKey: "sb_publishable_example_example",
        turnstileSiteKey: "test"
      }
    }).request("/v1/slip-imports/confirm-batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(valid)
    });
    expect(response.status).toBe(401);
  });
});

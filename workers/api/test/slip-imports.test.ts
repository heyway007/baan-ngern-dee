import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import { createStaticAuthVerifier } from "../src/middleware/auth";

const userId = "11111111-1111-4111-8111-111111111111";
const workspaceId = "22222222-2222-4222-8222-222222222222";
const imageSha256 =
  "6e568e1f67fba258184c78181539e5e8fdee447e49bb706fc0ea34fbf12336a5";

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
      expect.objectContaining({ workspaceId, imageSha256 })
    );
  });

  it("requires authentication", async () => {
    const response = await createApp({
      slipImportService: {
        analyze: vi.fn(),
        confirm: vi.fn(),
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
});

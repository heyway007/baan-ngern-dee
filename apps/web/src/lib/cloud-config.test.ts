import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { loadPublicAppConfig } from "./cloud-config";

describe("loadPublicAppConfig", () => {
  it("loads and validates the same-origin public configuration", async () => {
    const requestFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({
          supabaseUrl: "https://project.supabase.co",
          supabasePublishableKey: "sb_publishable_public",
          turnstileSiteKey: "1x00000000000000000000AA"
        })
      );

    await expect(
      loadPublicAppConfig(requestFetch)
    ).resolves.toEqual({
      supabaseUrl: "https://project.supabase.co",
      supabasePublishableKey: "sb_publishable_public",
      turnstileSiteKey: "1x00000000000000000000AA"
    });
    expect(requestFetch).toHaveBeenCalledWith("/config", {
      headers: { accept: "application/json" }
    });
  });

  it("rejects a malformed or elevated-key response", async () => {
    const requestFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({
          supabaseUrl: "https://project.supabase.co",
          supabasePublishableKey: "sb_secret_private",
          turnstileSiteKey: "1x00000000000000000000AA"
        })
      );

    await expect(
      loadPublicAppConfig(requestFetch)
    ).rejects.toBeInstanceOf(z.ZodError);
  });

  it("rejects configuration without a Turnstile site key", async () => {
    const requestFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({
          supabaseUrl: "https://project.supabase.co",
          supabasePublishableKey: "sb_publishable_public"
        })
      );

    await expect(
      loadPublicAppConfig(requestFetch)
    ).rejects.toBeInstanceOf(z.ZodError);
  });

  it("reports a non-successful configuration request", async () => {
    const requestFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 503 }));

    await expect(
      loadPublicAppConfig(requestFetch)
    ).rejects.toThrow("CONFIG_LOAD_FAILED");
  });
});

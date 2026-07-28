import { describe, expect, it } from "vitest";

import { createApp } from "../src/app";

describe("GET /config", () => {
  it("returns only the browser-safe Supabase configuration without auth", async () => {
    const app = createApp({
      publicConfig: {
        supabaseUrl: "https://project.supabase.co",
        supabasePublishableKey: "sb_publishable_public",
        turnstileSiteKey: "1x00000000000000000000AA"
      }
    });

    const response = await app.request("/config");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      supabaseUrl: "https://project.supabase.co",
      supabasePublishableKey: "sb_publishable_public",
      turnstileSiteKey: "1x00000000000000000000AA"
    });
  });

  it("fails closed instead of exposing an elevated Supabase key", async () => {
    const app = createApp({
      publicConfig: {
        supabaseUrl: "https://project.supabase.co",
        supabasePublishableKey: "sb_secret_private",
        turnstileSiteKey: "1x00000000000000000000AA"
      }
    });

    const response = await app.request("/config");

    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("sb_secret_private");
  });
});

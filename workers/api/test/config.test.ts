import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { createApp } from "../src/app";

describe("GET /config", () => {
  it("configures Workers AI and the analysis-token secret", async () => {
    const root = fileURLToPath(new URL("../../../", import.meta.url));
    const config = JSON.parse(
      await readFile(`${root}wrangler.jsonc`, "utf8")
    );
    const vars = await readFile(`${root}.dev.vars.example`, "utf8");
    expect(config.ai).toEqual({ binding: "AI" });
    expect(config.secrets.required).toContain(
      "SLIP_ANALYSIS_TOKEN_SECRET"
    );
    expect(vars).toContain("SLIP_ANALYSIS_TOKEN_SECRET=");
  });

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

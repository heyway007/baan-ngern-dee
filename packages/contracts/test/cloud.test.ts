import { describe, expect, it } from "vitest";
import { z } from "zod";

import { publicAppConfigSchema } from "../src";

describe("publicAppConfigSchema", () => {
  it("accepts only a browser-safe Supabase URL and publishable key", () => {
    expect(
      publicAppConfigSchema.parse({
        supabaseUrl: "https://project.supabase.co",
        supabasePublishableKey: "sb_publishable_public",
        turnstileSiteKey: "1x00000000000000000000AA"
      })
    ).toEqual({
      supabaseUrl: "https://project.supabase.co",
      supabasePublishableKey: "sb_publishable_public",
      turnstileSiteKey: "1x00000000000000000000AA"
    });

    expect(() =>
      publicAppConfigSchema.parse({
        supabaseUrl: "https://project.supabase.co",
        supabasePublishableKey: "sb_secret_private",
        turnstileSiteKey: "1x00000000000000000000AA"
      })
    ).toThrowError(z.ZodError);
    expect(() =>
      publicAppConfigSchema.parse({
        supabaseUrl: "https://project.supabase.co",
        supabasePublishableKey: "arbitrary-key",
        turnstileSiteKey: "1x00000000000000000000AA"
      })
    ).toThrowError(z.ZodError);
    expect(() =>
      publicAppConfigSchema.parse({
        supabaseUrl: "https://attacker.example",
        supabasePublishableKey: "sb_publishable_public",
        turnstileSiteKey: "1x00000000000000000000AA"
      })
    ).toThrowError(z.ZodError);
  });

  it("rejects undeclared public configuration fields", () => {
    expect(() =>
      publicAppConfigSchema.parse({
        supabaseUrl: "https://project.supabase.co",
        supabasePublishableKey: "sb_publishable_public",
        turnstileSiteKey: "1x00000000000000000000AA",
        databaseUrl: "postgresql://should-not-leak"
      })
    ).toThrowError(z.ZodError);
  });
});

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { publicAppConfigSchema } from "../src";

describe("publicAppConfigSchema", () => {
  it("accepts only a browser-safe Supabase URL and publishable key", () => {
    expect(
      publicAppConfigSchema.parse({
        supabaseUrl: "https://project.supabase.co",
        supabasePublishableKey: "sb_publishable_public"
      })
    ).toEqual({
      supabaseUrl: "https://project.supabase.co",
      supabasePublishableKey: "sb_publishable_public"
    });

    expect(() =>
      publicAppConfigSchema.parse({
        supabaseUrl: "https://project.supabase.co",
        supabasePublishableKey: "sb_secret_private"
      })
    ).toThrowError(z.ZodError);
    expect(() =>
      publicAppConfigSchema.parse({
        supabaseUrl: "https://project.supabase.co",
        supabasePublishableKey: "arbitrary-key"
      })
    ).toThrowError(z.ZodError);
    expect(() =>
      publicAppConfigSchema.parse({
        supabaseUrl: "https://attacker.example",
        supabasePublishableKey: "sb_publishable_public"
      })
    ).toThrowError(z.ZodError);
  });

  it("rejects undeclared public configuration fields", () => {
    expect(() =>
      publicAppConfigSchema.parse({
        supabaseUrl: "https://project.supabase.co",
        supabasePublishableKey: "sb_publishable_public",
        databaseUrl: "postgresql://should-not-leak"
      })
    ).toThrowError(z.ZodError);
  });
});

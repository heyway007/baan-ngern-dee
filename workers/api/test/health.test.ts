import { describe, expect, it } from "vitest";

import { createApp } from "../src/app";

describe("GET /health", () => {
  it("returns the stable health contract", async () => {
    const app = createApp();
    const response = await app.request("/health");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      service: "systems-credit-api"
    });
  });
});

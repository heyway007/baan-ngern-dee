import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";

describe("API error handling", () => {
  it("maps an unexpected failure to the stable JSON contract", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const app = createApp();
    app.get("/boom", () => {
      throw new Error("secret financial detail");
    });

    const response = await app.request("/boom", {
      headers: { "x-request-id": "request-123" }
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "เกิดข้อผิดพลาดภายในระบบ",
        requestId: "request-123"
      }
    });
    expect(errorLog).toHaveBeenCalledWith({
      code: "INTERNAL_ERROR",
      method: "GET",
      path: "/boom",
      requestId: "request-123",
      status: 500
    });
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("secret financial detail");
    errorLog.mockRestore();
  });
});

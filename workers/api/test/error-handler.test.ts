import { z } from "zod";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../src/api-error";
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
      errorType: "Error",
      method: "GET",
      path: "/boom",
      requestId: "request-123",
      status: 500
    });
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("secret financial detail");
    errorLog.mockRestore();
  });

  it("logs only bounded Zod issue metadata", async () => {
    const errorLog = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const app = createApp();
    const invalidSnapshot = {
      workspace: {
        version: "not-a-number",
        ownerEmail: "owner@example.com"
      },
      accessToken: "token-secret"
    };
    const diagnosticSchema = z.object({
      workspace: z.object({
        version: z.number()
      })
    });
    app.get("/invalid-snapshot", () => {
      diagnosticSchema.parse(invalidSnapshot);
      return new Response(null, { status: 204 });
    });

    const response = await app.request("/invalid-snapshot", {
      headers: { "x-request-id": "request-zod" }
    });

    expect(response.status).toBe(500);
    const responseBody = await response.json();
    expect(responseBody).toMatchObject({
      error: {
        code: "INTERNAL_ERROR",
        requestId: "request-zod"
      }
    });
    expect(responseBody).not.toHaveProperty("error.validationIssues");
    expect(errorLog).toHaveBeenCalledWith({
      code: "INTERNAL_ERROR",
      errorType: "ZodError",
      method: "GET",
      path: "/invalid-snapshot",
      requestId: "request-zod",
      status: 500,
      validationIssues: [
        {
          code: "invalid_type",
          path: ["workspace", "version"],
          expected: "number"
        }
      ]
    });
    const serializedLog = JSON.stringify(errorLog.mock.calls);
    expect(serializedLog).not.toContain("not-a-number");
    expect(serializedLog).not.toContain("owner@example.com");
    expect(serializedLog).not.toContain("token-secret");
    errorLog.mockRestore();
  });

  it("logs the TypeError class without its message", async () => {
    const errorLog = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const app = createApp();
    app.get("/type-error", () => {
      throw new TypeError("sensitive receiver detail");
    });

    const response = await app.request("/type-error", {
      headers: { "x-request-id": "request-type-error" }
    });

    expect(response.status).toBe(500);
    expect(errorLog).toHaveBeenCalledWith({
      code: "INTERNAL_ERROR",
      errorType: "TypeError",
      method: "GET",
      path: "/type-error",
      requestId: "request-type-error",
      status: 500
    });
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(
      "sensitive receiver detail"
    );
    const responseBody = await response.json();
    expect(responseBody).not.toHaveProperty("error.errorMessage");
    errorLog.mockRestore();
  });

  it("logs a bounded slip category without returning it publicly", async () => {
    const errorLog = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const app = createApp();
    app.get("/slip-error", () => {
      throw new ApiError(
        "AI_UNAVAILABLE",
        503,
        "ยังอ่านรูปไม่ได้ กรุณาลองใหม่หรือกรอกข้อมูลเอง",
        { slipVisionCategory: "invalid_json" }
      );
    });

    const response = await app.request("/slip-error", {
      headers: { "x-request-id": "request-slip" }
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "AI_UNAVAILABLE",
        message: "ยังอ่านรูปไม่ได้ กรุณาลองใหม่หรือกรอกข้อมูลเอง",
        requestId: "request-slip"
      }
    });
    expect(errorLog).toHaveBeenCalledWith({
      code: "AI_UNAVAILABLE",
      method: "GET",
      path: "/slip-error",
      requestId: "request-slip",
      slipVisionCategory: "invalid_json",
      status: 503
    });
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(
      "ยังอ่านรูปไม่ได้"
    );
    errorLog.mockRestore();
  });
});

import { describe, expect, it } from "vitest";

import { toFinancialDate } from "../src";

describe("financial dates", () => {
  it("uses the workspace timezone at a UTC date boundary", () => {
    expect(
      toFinancialDate("2026-07-26T18:00:00.000Z", "Asia/Bangkok")
    ).toBe("2026-07-27");
  });

  it("rejects an invalid instant", () => {
    expect(() => toFinancialDate("not-a-date", "Asia/Bangkok")).toThrow(
      "INVALID_INSTANT"
    );
  });

  it("rejects an invalid IANA timezone", () => {
    expect(() => toFinancialDate("2026-07-26T00:00:00.000Z", "Mars/Bangkok"))
      .toThrow("INVALID_TIMEZONE");
  });
});

import { describe, expect, it } from "vitest";

import {
  LINE_DESTINATION_KEY,
  clearLineDestination,
  lineWorkspaceName,
  readLineDestination,
  rememberLineDestination,
  resolveLineDestination
} from "./line-entry";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe("LINE entry helpers", () => {
  it.each([
    "/overview",
    "/transactions/new?type=income",
    "/transactions/new?type=expense",
    "/accounts",
    "/installments"
  ] as const)("accepts %s", (destination) => {
    expect(resolveLineDestination(destination)).toBe(destination);
  });

  it.each([
    null,
    "",
    "https://evil.example",
    "//evil.example",
    "/transactions/new?type=transfer",
    "/admin/users",
    "/overview#fragment"
  ])("falls back to overview for %s", (destination) => {
    expect(resolveLineDestination(destination)).toBe("/overview");
  });

  it("stores only a normalized destination", () => {
    const storage = new MemoryStorage();
    rememberLineDestination(
      storage,
      resolveLineDestination("https://evil.example")
    );

    expect(readLineDestination(storage)).toBe("/overview");
  });

  it("normalizes a manually tampered destination", () => {
    const storage = new MemoryStorage();
    storage.setItem(LINE_DESTINATION_KEY, "https://evil.example");

    expect(readLineDestination(storage)).toBe("/overview");
  });

  it("clears the remembered destination", () => {
    const storage = new MemoryStorage();
    rememberLineDestination(storage, "/accounts");
    clearLineDestination(storage);

    expect(readLineDestination(storage)).toBe("/overview");
  });

  it("builds bounded Thai workspace names", () => {
    expect(
      lineWorkspaceName(" \u00e0\u00b8\u00a1\u00e0\u00b8\u00b4\u00e0\u00b8\u2122 ")
    ).toBe(
      "\u00e0\u00b8\u0161\u00e0\u00b9\u2030\u00e0\u00b8\u00b2\u00e0\u00b8\u2122\u00e0\u00b9\u20ac\u00e0\u00b8\u2021\u00e0\u00b8\u00b4\u00e0\u00b8\u2122\u00e0\u00b8\u201a\u00e0\u00b8\u00ad\u00e0\u00b8\u2021 \u00e0\u00b8\u00a1\u00e0\u00b8\u00b4\u00e0\u00b8\u2122"
    );
    expect(lineWorkspaceName("")).toBe(
      "\u00e0\u00b8\u0081\u00e0\u00b8\u00b2\u00e0\u00b8\u00a3\u00e0\u00b9\u20ac\u00e0\u00b8\u2021\u00e0\u00b8\u00b4\u00e0\u00b8\u2122\u00e0\u00b8\u201a\u00e0\u00b8\u00ad\u00e0\u00b8\u2021\u00e0\u00b8\u2030\u00e0\u00b8\u00b1\u00e0\u00b8\u2122"
    );
    expect(
      lineWorkspaceName("\u00e0\u00b8\u0081".repeat(100))
    ).toHaveLength(80);
  });
});

import { describe, expect, it } from "vitest";

import { normalizeAccountKind } from "../src/accounts";

describe("normalizeAccountKind", () => {
  it("requires liability behavior for credit-card accounts", () => {
    expect(normalizeAccountKind("credit_card")).toEqual({
      normalBalance: "credit",
      liquid: false,
      liability: true
    });
  });

  it("treats cash-like accounts as liquid debit balances", () => {
    for (const type of ["cash", "bank", "ewallet"] as const) {
      expect(normalizeAccountKind(type)).toEqual({
        normalBalance: "debit",
        liquid: true,
        liability: false
      });
    }
  });

  it("treats loans as liabilities and assets as non-liquid debits", () => {
    expect(normalizeAccountKind("loan")).toEqual({
      normalBalance: "credit",
      liquid: false,
      liability: true
    });
    expect(normalizeAccountKind("asset")).toEqual({
      normalBalance: "debit",
      liquid: false,
      liability: false
    });
  });
});

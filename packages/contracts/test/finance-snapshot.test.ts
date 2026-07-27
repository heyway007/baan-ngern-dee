import { describe, expect, it } from "vitest";
import { z } from "zod";

import { financeSnapshotSchema } from "../src";

const emptySnapshot = {
  version: 1,
  workspace: null,
  categories: [],
  accounts: [],
  accountBalances: {},
  openingTransactions: [],
  transactions: [],
  installmentContracts: [],
  installmentSchedules: {},
  installmentPayments: [],
  installmentPayoffs: []
} as const;

describe("financeSnapshotSchema", () => {
  it("parses the deterministic empty cloud snapshot", () => {
    expect(financeSnapshotSchema.parse(emptySnapshot)).toEqual(emptySnapshot);
  });

  it("rejects incomplete and undeclared snapshot fields", () => {
    const { installmentPayoffs: _omitted, ...incomplete } = emptySnapshot;

    expect(() =>
      financeSnapshotSchema.parse(incomplete)
    ).toThrowError(z.ZodError);
    expect(() =>
      financeSnapshotSchema.parse({
        ...emptySnapshot,
        databasePassword: "should-not-leak"
      })
    ).toThrowError(z.ZodError);
  });

  it("validates nested financial values instead of accepting opaque JSON", () => {
    expect(() =>
      financeSnapshotSchema.parse({
        ...emptySnapshot,
        accountBalances: {
          "10000000-0000-4000-8000-000000000001": {
            accountId: "10000000-0000-4000-8000-000000000001",
            amount: "NaN",
            currency: "THB"
          }
        }
      })
    ).toThrowError(z.ZodError);
  });
});

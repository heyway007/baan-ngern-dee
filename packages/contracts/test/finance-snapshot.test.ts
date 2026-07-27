import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  financeInstallmentContractSchema,
  financeSnapshotSchema
} from "../src";

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

  it("accepts the incremented contract version returned after a payment", () => {
    expect(
      financeInstallmentContractSchema.parse({
        id: "10000000-0000-4000-8000-000000000001",
        workspaceId: "20000000-0000-4000-8000-000000000002",
        name: "Motorcycle",
        kind: "purchase",
        originalPrincipal: "12000.00",
        downPayment: "2000.00",
        financedPrincipal: "10000.00",
        financedFees: "0.00",
        currency: "THB",
        interestMethod: "flat",
        annualRate: "12.00",
        periods: 10,
        firstDueDate: "2026-08-01",
        status: "active",
        version: 2
      })
    ).toMatchObject({ version: 2 });
  });
});

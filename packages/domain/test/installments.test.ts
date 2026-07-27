import { describe, expect, it } from "vitest";

import {
  generateInstallmentSchedule,
  generateManualInstallmentSchedule,
  validateManualSchedule,
  type InstallmentScheduleRow
} from "../src/installments";
import { sumMoney } from "../src/money";

function sumRows(
  rows: InstallmentScheduleRow[],
  field: "principal" | "interest" | "fees" | "total"
) {
  return sumMoney(
    rows.map((row) => ({
      amount: row[field],
      currency: "THB"
    }))
  ).amount;
}

describe("installment schedules", () => {
  it("allocates a zero-interest principal residual to the final installment", () => {
    const rows = generateInstallmentSchedule({
      principal: "1000.00",
      financedFees: "0.00",
      currency: "THB",
      interestMethod: "zero",
      annualRate: "0",
      periods: 3,
      firstDueDate: "2026-08-31"
    });

    expect(rows.map((row) => row.principal)).toEqual([
      "333.33",
      "333.33",
      "333.34"
    ]);
    expect(rows.map((row) => row.dueDate)).toEqual([
      "2026-08-31",
      "2026-09-30",
      "2026-10-31"
    ]);
    expect(rows.at(-1)?.closingPrincipal).toBe("0.00");
  });

  it("calculates flat annual interest without counting principal as interest", () => {
    const rows = generateInstallmentSchedule({
      principal: "12000.00",
      financedFees: "120.00",
      currency: "THB",
      interestMethod: "flat",
      annualRate: "12",
      periods: 12,
      firstDueDate: "2026-08-01"
    });

    expect(sumRows(rows, "principal")).toBe("12000.00");
    expect(sumRows(rows, "interest")).toBe("1440.00");
    expect(sumRows(rows, "fees")).toBe("120.00");
    expect(sumRows(rows, "total")).toBe("13560.00");
  });

  it("ends a reducing-balance schedule at exactly zero principal", () => {
    const rows = generateInstallmentSchedule({
      principal: "100000.00",
      financedFees: "0.00",
      currency: "THB",
      interestMethod: "reducing",
      annualRate: "8",
      periods: 12,
      firstDueDate: "2026-08-15"
    });

    expect(rows[0]?.interest).toBe("666.67");
    expect(sumRows(rows, "principal")).toBe("100000.00");
    expect(rows.at(-1)?.closingPrincipal).toBe("0.00");
  });

  it("treats a zero reducing rate as a zero-interest schedule", () => {
    const rows = generateInstallmentSchedule({
      principal: "10.00",
      financedFees: "0.00",
      currency: "THB",
      interestMethod: "reducing",
      annualRate: "0",
      periods: 3,
      firstDueDate: "2026-08-01"
    });

    expect(rows.map((row) => row.interest)).toEqual([
      "0.00",
      "0.00",
      "0.00"
    ]);
    expect(rows.map((row) => row.principal)).toEqual([
      "3.33",
      "3.33",
      "3.34"
    ]);
  });

  it("rejects a manual schedule whose principal does not reconcile", () => {
    expect(() =>
      validateManualSchedule({
        principal: "1000.00",
        currency: "THB",
        rows: [
          {
            dueDate: "2026-08-01",
            principal: "400.00",
            interest: "0.00",
            fees: "0.00"
          },
          {
            dueDate: "2026-09-01",
            principal: "400.00",
            interest: "0.00",
            fees: "0.00"
          }
        ]
      })
    ).toThrow("INSTALLMENT_PRINCIPAL_MISMATCH");
  });

  it("materializes a reconciled manual schedule with exact balances", () => {
    const rows = generateManualInstallmentSchedule({
      principal: "1000.00",
      currency: "THB",
      rows: [
        {
          dueDate: "2026-08-15",
          principal: "400.00",
          interest: "25.00",
          fees: "5.00"
        },
        {
          dueDate: "2026-09-15",
          principal: "600.00",
          interest: "10.00",
          fees: "0.00"
        }
      ]
    });

    expect(rows).toEqual([
      {
        sequence: 1,
        dueDate: "2026-08-15",
        openingPrincipal: "1000.00",
        principal: "400.00",
        interest: "25.00",
        fees: "5.00",
        total: "430.00",
        closingPrincipal: "600.00"
      },
      {
        sequence: 2,
        dueDate: "2026-09-15",
        openingPrincipal: "600.00",
        principal: "600.00",
        interest: "10.00",
        fees: "0.00",
        total: "610.00",
        closingPrincipal: "0.00"
      }
    ]);
  });
});

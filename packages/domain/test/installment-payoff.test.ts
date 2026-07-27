import { describe, expect, it } from "vitest";

import {
  generateInstallmentSchedule,
  simulateInstallmentPayoff
} from "../src/index";

function unpaidRows(
  rows: ReturnType<typeof generateInstallmentSchedule>
) {
  return rows.map((row) => ({
    sequence: row.sequence,
    dueDate: row.dueDate,
    principal: row.principal,
    interest: row.interest,
    fees: row.fees,
    penalty: "0.00"
  }));
}

describe("installment payoff simulation", () => {
  it("recalculates reducing-balance interest after extra principal and ends at zero", () => {
    const schedule = generateInstallmentSchedule({
      principal: "100000.00",
      financedFees: "0.00",
      currency: "THB",
      interestMethod: "reducing",
      annualRate: "8",
      periods: 12,
      firstDueDate: "2026-08-15"
    });

    const result = simulateInstallmentPayoff({
      action: "extra_principal",
      strategy: "reduce_payment",
      currency: "THB",
      interestMethod: "reducing",
      annualRate: "8",
      paymentDate: "2026-07-27",
      remainingPrincipal: "100000.00",
      extraPrincipal: "10000.00",
      unpaidRows: unpaidRows(schedule)
    });

    expect(result.principalPayment).toBe("10000.00");
    expect(result.remainingPrincipal).toBe("90000.00");
    expect(result.totalCashRequired).toBe("10000.00");
    expect(result.regeneratedRows).toHaveLength(12);
    expect(result.regeneratedRows.at(-1)?.closingPrincipal).toBe(
      "0.00"
    );
    expect(result.interestSaved).toBe("438.61");
  });

  it("can shorten a reducing-balance term while preserving the planned payment", () => {
    const schedule = generateInstallmentSchedule({
      principal: "100000.00",
      financedFees: "0.00",
      currency: "THB",
      interestMethod: "reducing",
      annualRate: "8",
      periods: 12,
      firstDueDate: "2026-08-15"
    });

    const result = simulateInstallmentPayoff({
      action: "extra_principal",
      strategy: "shorten_term",
      currency: "THB",
      interestMethod: "reducing",
      annualRate: "8",
      paymentDate: "2026-07-27",
      remainingPrincipal: "100000.00",
      extraPrincipal: "30000.00",
      unpaidRows: unpaidRows(schedule)
    });

    expect(result.regeneratedRows.length).toBeLessThan(schedule.length);
    expect(result.regeneratedRows.at(-1)?.closingPrincipal).toBe(
      "0.00"
    );
    expect(result.interestSaved).not.toBe("0.00");
  });

  it("does not invent a flat-rate interest rebate without a creditor quote", () => {
    const schedule = generateInstallmentSchedule({
      principal: "12000.00",
      financedFees: "0.00",
      currency: "THB",
      interestMethod: "flat",
      annualRate: "12",
      periods: 12,
      firstDueDate: "2026-08-01"
    });

    const result = simulateInstallmentPayoff({
      action: "payoff",
      currency: "THB",
      interestMethod: "flat",
      annualRate: "12",
      paymentDate: "2026-07-27",
      remainingPrincipal: "12000.00",
      unpaidRows: unpaidRows(schedule)
    });

    expect(result.interestDue).toBe("1440.00");
    expect(result.interestSaved).toBe("0.00");
    expect(result.totalCashRequired).toBe("13440.00");
    expect(result.regeneratedRows).toEqual([]);
  });

  it("uses an explicit creditor quote as the only flat-rate rebate", () => {
    const schedule = generateInstallmentSchedule({
      principal: "12000.00",
      financedFees: "0.00",
      currency: "THB",
      interestMethod: "flat",
      annualRate: "12",
      periods: 12,
      firstDueDate: "2026-08-01"
    });

    const result = simulateInstallmentPayoff({
      action: "payoff",
      currency: "THB",
      interestMethod: "flat",
      annualRate: "12",
      paymentDate: "2026-07-27",
      remainingPrincipal: "12000.00",
      quotedInterest: "500.00",
      quotedFees: "100.00",
      unpaidRows: unpaidRows(schedule)
    });

    expect(result.interestDue).toBe("500.00");
    expect(result.feesDue).toBe("100.00");
    expect(result.interestSaved).toBe("940.00");
    expect(result.totalCashRequired).toBe("12600.00");
  });

  it("keeps a zero-interest payoff at principal only", () => {
    const schedule = generateInstallmentSchedule({
      principal: "1000.00",
      financedFees: "0.00",
      currency: "THB",
      interestMethod: "zero",
      annualRate: "0",
      periods: 4,
      firstDueDate: "2026-08-01"
    });

    const result = simulateInstallmentPayoff({
      action: "payoff",
      currency: "THB",
      interestMethod: "zero",
      annualRate: "0",
      paymentDate: "2026-07-27",
      remainingPrincipal: "1000.00",
      unpaidRows: unpaidRows(schedule)
    });

    expect(result.interestDue).toBe("0.00");
    expect(result.interestSaved).toBe("0.00");
    expect(result.totalCashRequired).toBe("1000.00");
  });
});

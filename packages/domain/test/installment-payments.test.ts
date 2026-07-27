import { describe, expect, it } from "vitest";

import { allocateInstallmentPayment } from "../src/installments";

const componentState = {
  scheduledPrincipal: "100.00",
  scheduledInterest: "30.00",
  scheduledFees: "20.00",
  scheduledPenalty: "10.00",
  paidPrincipal: "0.00",
  paidInterest: "0.00",
  paidFees: "0.00",
  paidPenalty: "0.00"
} as const;

describe("installment payment allocation", () => {
  it("allocates penalty, fees, interest, then principal", () => {
    const result = allocateInstallmentPayment({
      currency: "THB",
      amount: "90.00",
      ...componentState
    });

    expect(result.allocation).toEqual({
      penalty: "10.00",
      fees: "20.00",
      interest: "30.00",
      principal: "30.00",
      total: "90.00"
    });
    expect(result.remaining).toEqual({
      penalty: "0.00",
      fees: "0.00",
      interest: "0.00",
      principal: "70.00",
      total: "70.00"
    });
  });

  it("marks an underpayment as partially paid", () => {
    const result = allocateInstallmentPayment({
      currency: "THB",
      amount: "15.00",
      ...componentState
    });

    expect(result.status).toBe("partially_paid");
    expect(result.allocation).toEqual({
      penalty: "10.00",
      fees: "5.00",
      interest: "0.00",
      principal: "0.00",
      total: "15.00"
    });
  });

  it("marks a full payment paid and reports only non-principal expense", () => {
    const result = allocateInstallmentPayment({
      currency: "THB",
      amount: "130.00",
      scheduledPrincipal: "100.00",
      scheduledInterest: "20.00",
      scheduledFees: "5.00",
      scheduledPenalty: "5.00",
      paidPrincipal: "0.00",
      paidInterest: "0.00",
      paidFees: "0.00",
      paidPenalty: "0.00"
    });

    expect(result.status).toBe("paid");
    expect(result.allocation.principal).toBe("100.00");
    expect(result.reportableExpense).toBe("30.00");
    expect(result.remaining.total).toBe("0.00");
  });

  it("rejects paying more than the remaining scheduled amount", () => {
    expect(() =>
      allocateInstallmentPayment({
        currency: "THB",
        amount: "160.01",
        ...componentState
      })
    ).toThrow("INSTALLMENT_PAYMENT_EXCEEDS_REMAINING");
  });
});

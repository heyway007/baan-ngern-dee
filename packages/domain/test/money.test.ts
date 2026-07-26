import { describe, expect, it } from "vitest";

import { allocateMoney, roundMoney, sumMoney } from "../src";

describe("exact money", () => {
  it("sums decimal strings without binary-float drift", () => {
    expect(
      sumMoney([
        { amount: "0.10", currency: "THB" },
        { amount: "0.20", currency: "THB" }
      ])
    ).toEqual({ amount: "0.30", currency: "THB" });
  });

  it("rejects summing different currencies", () => {
    expect(() =>
      sumMoney([
        { amount: "1.00", currency: "THB" },
        { amount: "1.00", currency: "USD" }
      ])
    ).toThrow("CURRENCY_MISMATCH");
  });

  it("places allocation rounding residual on the final item", () => {
    expect(
      allocateMoney(
        { amount: "100.00", currency: "THB" },
        ["1", "1", "1"]
      )
    ).toEqual([
      { amount: "33.33", currency: "THB" },
      { amount: "33.33", currency: "THB" },
      { amount: "33.34", currency: "THB" }
    ]);
  });

  it("rounds ties away from zero", () => {
    expect(roundMoney("1.005", "THB")).toBe("1.01");
    expect(roundMoney("-1.005", "THB")).toBe("-1.01");
  });

  it("uses zero minor digits for JPY", () => {
    expect(roundMoney("100.5", "JPY")).toBe("101");
  });

  it("uses three minor digits for KWD", () => {
    expect(roundMoney("1.2345", "KWD")).toBe("1.235");
  });

  it("rejects non-finite money", () => {
    expect(() => roundMoney("Infinity", "THB")).toThrow(
      "INVALID_MONEY_AMOUNT"
    );
  });

  it("rejects empty or non-positive allocation weights", () => {
    expect(() =>
      allocateMoney({ amount: "10.00", currency: "THB" }, [])
    ).toThrow("ALLOCATION_WEIGHTS_REQUIRED");
    expect(() =>
      allocateMoney({ amount: "10.00", currency: "THB" }, ["1", "0"])
    ).toThrow("ALLOCATION_WEIGHT_INVALID");
  });
});

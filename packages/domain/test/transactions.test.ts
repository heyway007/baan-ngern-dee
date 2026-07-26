import { describe, expect, it } from "vitest";

import {
  postingEffect,
  validateSplits
} from "../src/transactions";

describe("transaction posting rules", () => {
  it("requires split totals to equal the transaction total", () => {
    expect(() =>
      validateSplits(
        { amount: "100.00", currency: "THB" },
        [{ amount: "60.00" }, { amount: "39.99" }]
      )
    ).toThrow("SPLIT_TOTAL_MISMATCH");
  });

  it("accepts an exact split total without binary-float drift", () => {
    expect(() =>
      validateSplits(
        { amount: "0.30", currency: "THB" },
        [{ amount: "0.10" }, { amount: "0.20" }]
      )
    ).not.toThrow();
  });

  it("classifies a credit-card purchase as expense plus liability", () => {
    expect(
      postingEffect("expense", "credit_card", {
        amount: "100.00",
        currency: "THB"
      })
    ).toEqual({
      expense: "100.00",
      cashFlow: "0.00",
      liabilityIncrease: "100.00"
    });
  });

  it("classifies a cash expense as expense plus cash outflow", () => {
    expect(
      postingEffect("expense", "cash", {
        amount: "100.00",
        currency: "THB"
      })
    ).toEqual({
      expense: "100.00",
      cashFlow: "-100.00",
      liabilityIncrease: "0.00"
    });
  });
});

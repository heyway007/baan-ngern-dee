import { describe, expect, it } from "vitest";

import { transferReportEffect } from "../src/transfers";

describe("transfer report effects", () => {
  it("excludes both transfer legs from income and expense", () => {
    expect(
      transferReportEffect({
        source: { amount: "1000.00", currency: "THB" },
        destination: { amount: "1000.00", currency: "THB" },
        fee: { amount: "0.00", currency: "THB" }
      })
    ).toEqual({
      income: "0.00",
      expense: "0.00",
      cashFlow: "0.00"
    });
  });

  it("reports only the fee as expense and cash outflow", () => {
    expect(
      transferReportEffect({
        source: { amount: "1000.00", currency: "THB" },
        destination: { amount: "28.00", currency: "USD" },
        fee: { amount: "10.00", currency: "THB" }
      })
    ).toEqual({
      income: "0.00",
      expense: "10.00",
      cashFlow: "-10.00"
    });
  });
});

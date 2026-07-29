import { describe, expect, it } from "vitest";

import {
  allocateSplitBaseAmount,
  calculateBudgetPlan,
  calculateSavingsProgress
} from "../src";

const foodId = "10000000-0000-4000-8000-000000000001";
const healthId = "20000000-0000-4000-8000-000000000002";

describe("financial planning calculations", () => {
  it("rolls surplus and overspending through later months", () => {
    const result = calculateBudgetPlan({
      selectedMonth: "2026-03",
      currency: "THB",
      categories: [{ id: foodId, name: "อาหาร" }],
      allocations: [
        { categoryId: foodId, month: "2026-01", amount: "1000.00" },
        { categoryId: foodId, month: "2026-02", amount: "1000.00" },
        { categoryId: foodId, month: "2026-03", amount: "1000.00" }
      ],
      expenses: [
        { categoryId: foodId, month: "2026-01", baseAmount: "700.00" },
        { categoryId: foodId, month: "2026-02", baseAmount: "1500.00" },
        { categoryId: foodId, month: "2026-03", baseAmount: "200.00" }
      ]
    });

    expect(result.categories[0]).toMatchObject({
      priorCarry: "-200.00",
      available: "800.00",
      spent: "200.00",
      remaining: "600.00"
    });
    expect(result.totals).toEqual({
      baseBudget: "1000.00",
      priorCarry: "-200.00",
      available: "800.00",
      spent: "200.00",
      remaining: "600.00"
    });
  });

  it("keeps selected-month unbudgeted spending visible", () => {
    const result = calculateBudgetPlan({
      selectedMonth: "2026-03",
      currency: "THB",
      categories: [{ id: healthId, name: "สุขภาพ" }],
      allocations: [],
      expenses: [
        {
          categoryId: healthId,
          month: "2026-03",
          baseAmount: "350.00"
        }
      ]
    });

    expect(result.categories[0]).toMatchObject({
      isBudgeted: false,
      baseBudget: "0.00",
      priorCarry: "0.00",
      spent: "350.00",
      remaining: "-350.00"
    });
  });

  it("allocates split base money without losing the rounding remainder", () => {
    expect(
      allocateSplitBaseAmount({
        transactionAmount: "100.00",
        baseAmount: "33.33",
        currency: "THB",
        splits: [
          { categoryId: foodId, amount: "50.00" },
          { categoryId: healthId, amount: "50.00" }
        ]
      })
    ).toEqual([
      { categoryId: foodId, baseAmount: "16.67" },
      { categoryId: healthId, baseAmount: "16.66" }
    ]);
  });

  it("caps percentage while retaining the real balance", () => {
    expect(
      calculateSavingsProgress({
        balance: "12000.00",
        targetAmount: "10000.00",
        currency: "THB"
      })
    ).toEqual({
      currentAmount: "12000.00",
      percent: 100,
      reached: true
    });

    expect(
      calculateSavingsProgress({
        balance: "-50.00",
        targetAmount: "10000.00",
        currency: "THB"
      })
    ).toEqual({
      currentAmount: "0.00",
      percent: 0,
      reached: false
    });
  });
});

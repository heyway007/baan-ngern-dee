import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  createSavingsGoalSchema,
  financialPlanSchema,
  savingsGoalSchema,
  setMonthlyBudgetSchema
} from "../src";

const workspaceId = "10000000-0000-4000-8000-000000000001";
const categoryId = "20000000-0000-4000-8000-000000000002";
const accountId = "30000000-0000-4000-8000-000000000003";

describe("financial planning contracts", () => {
  it("accepts a calculated plan with negative carry", () => {
    expect(
      financialPlanSchema.parse({
        workspaceId,
        month: "2026-08",
        currency: "THB",
        totals: {
          baseBudget: "10000.00",
          priorCarry: "-1000.00",
          available: "9000.00",
          spent: "2500.00",
          remaining: "6500.00"
        },
        categories: [
          {
            categoryId,
            categoryName: "อาหาร",
            allocationId: "40000000-0000-4000-8000-000000000004",
            allocationVersion: 2,
            isBudgeted: true,
            baseBudget: "10000.00",
            priorCarry: "-1000.00",
            available: "9000.00",
            spent: "2500.00",
            remaining: "6500.00"
          }
        ],
        goals: []
      })
    ).toMatchObject({
      totals: { priorCarry: "-1000.00" }
    });
  });

  it("rejects debt accounts and non-positive planning amounts", () => {
    expect(() =>
      savingsGoalSchema.parse({
        id: "50000000-0000-4000-8000-000000000005",
        workspaceId,
        name: "เงินฉุกเฉิน",
        targetAmount: "50000.00",
        currency: "THB",
        accountId,
        accountType: "loan",
        status: "active",
        version: 1
      })
    ).toThrowError(z.ZodError);

    expect(() =>
      setMonthlyBudgetSchema.parse({
        workspaceId,
        categoryId,
        month: "2026-08",
        amount: "0.00"
      })
    ).toThrowError(z.ZodError);

    expect(() =>
      createSavingsGoalSchema.parse({
        workspaceId,
        name: "เงินฉุกเฉิน",
        targetAmount: "-1.00",
        currency: "THB",
        accountId
      })
    ).toThrowError(z.ZodError);
  });

  it("rejects invalid calendar months and dates", () => {
    expect(() =>
      setMonthlyBudgetSchema.parse({
        workspaceId,
        categoryId,
        month: "2026-13",
        amount: "1000.00"
      })
    ).toThrowError(z.ZodError);

    expect(() =>
      createSavingsGoalSchema.parse({
        workspaceId,
        name: "เที่ยวญี่ปุ่น",
        targetAmount: "30000.00",
        currency: "THB",
        targetDate: "2026-02-30",
        accountId
      })
    ).toThrowError(z.ZodError);
  });
});

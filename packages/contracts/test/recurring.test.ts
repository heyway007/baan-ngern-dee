import { describe, expect, it } from "vitest";

import {
  createRecurringTemplateSchema,
  materializeRecurringPeriodSchema,
  postedTransactionResponseSchema,
  recurringOccurrenceSchema,
  updateRecurringOccurrenceSchema
} from "../src";

const ids = {
  workspaceId: "11111111-1111-4111-8111-111111111111",
  accountId: "22222222-2222-4222-8222-222222222222",
  categoryId: "33333333-3333-4333-8333-333333333333"
};

describe("recurring contracts", () => {
  it("accepts an exact monthly salary template", () => {
    expect(
      createRecurringTemplateSchema.parse({
        ...ids,
        name: "เงินเดือน",
        kind: "income",
        amount: "35000.50",
        currency: "THB",
        dayOfMonth: 25,
        startMonth: "2026-07"
      })
    ).toMatchObject({
      amount: "35000.50",
      dayOfMonth: 25,
      startMonth: "2026-07"
    });
  });

  it("rejects zero money, invalid days, and reversed month ranges", () => {
    expect(
      createRecurringTemplateSchema.safeParse({
        ...ids,
        name: "ค่าเช่า",
        kind: "expense",
        amount: "0",
        currency: "THB",
        dayOfMonth: 32,
        startMonth: "2026-08",
        endMonth: "2026-07"
      }).success
    ).toBe(false);
  });

  it("requires YYYY-MM materialization and real calendar dates", () => {
    expect(
      materializeRecurringPeriodSchema.safeParse({
        workspaceId: ids.workspaceId,
        period: "2026-7"
      }).success
    ).toBe(false);
    expect(
      updateRecurringOccurrenceSchema.safeParse({
        amount: "1200.00",
        scheduledDate: "2026-02-30",
        version: 1
      }).success
    ).toBe(false);
  });

  it("parses posted occurrences and the shared transaction response", () => {
    expect(
      recurringOccurrenceSchema.parse({
        id: "44444444-4444-4444-8444-444444444444",
        ...ids,
        templateId: "55555555-5555-4555-8555-555555555555",
        name: "เงินเดือน",
        kind: "income",
        period: "2026-07",
        scheduledDate: "2026-07-25",
        amount: "35000.50",
        currency: "THB",
        status: "posted",
        transactionId: "66666666-6666-4666-8666-666666666666",
        version: 2
      }).status
    ).toBe("posted");

    expect(
      postedTransactionResponseSchema.parse({
        transactionId: "66666666-6666-4666-8666-666666666666",
        version: 1,
        state: "posted",
        accountBalances: [
          {
            accountId: ids.accountId,
            amount: "35000.50",
            currency: "THB"
          }
        ]
      }).state
    ).toBe("posted");
  });
});

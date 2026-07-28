import { describe, expect, it } from "vitest";

import {
  analyzeSlipResponseSchema,
  confirmSlipBatchInputSchema,
  confirmSlipBatchResultSchema,
  confirmSlipInputSchema,
  slipQuotaStateSchema,
  slipAiExtractionSchema
} from "../src";

const token = "a".repeat(40);
const workspaceId = "11111111-1111-4111-8111-111111111111";
const itemId = "22222222-2222-4222-8222-222222222222";
const batchMutationId = "33333333-3333-4333-8333-333333333333";
const accountId = "44444444-4444-4444-8444-444444444444";
const categoryId = "55555555-5555-4555-8555-555555555555";
const clientMutationId = "66666666-6666-4666-8666-666666666666";

function batchItem(overrides: Record<string, unknown> = {}) {
  return {
    itemId,
    analysisToken: token,
    transaction: {
      workspaceId,
      accountId,
      categoryId,
      type: "expense",
      amount: "60.00",
      currency: "THB",
      financialDate: "2026-07-27",
      tagIds: [],
      clientMutationId
    },
    ...overrides
  };
}

describe("slip import contracts", () => {
  it("accepts success, duplicate, and unsupported outcomes", () => {
    expect(analyzeSlipResponseSchema.parse({
      status: "success",
      analysisToken: token,
      analysisExpiresAt: "2026-07-29T03:30:00.000Z",
      documentKind: "bank_transfer",
      draft: {
        type: "expense",
        amount: "1250.50",
        currency: "THB",
        financialDate: "2026-07-28",
        fieldsNeedingReview: []
      }
    }).status).toBe("success");
    expect(analyzeSlipResponseSchema.parse({
      status: "duplicate",
      existingTransaction: {
        id: "44444444-4444-4444-8444-444444444444",
        amount: "1250.50",
        financialDate: "2026-07-28"
      }
    }).status).toBe("duplicate");
    expect(analyzeSlipResponseSchema.parse({
      status: "unsupported"
    }).status).toBe("unsupported");
  });

  it("validates extracted fields and confirmation input strictly", () => {
    expect(() => slipAiExtractionSchema.parse({
      documentKind: "receipt",
      suggestedType: "expense",
      amount: "not-money",
      currency: "THB",
      financialDate: "28/07/2026",
      reference: null,
      merchant: null,
      sender: null,
      recipient: null,
      institution: null,
      confidence: {
        documentKind: 1,
        suggestedType: 1,
        amount: 2,
        financialDate: 1,
        reference: 0
      }
    })).toThrow();
    expect(() => confirmSlipInputSchema.parse({
      analysisToken: token,
      transaction: { amount: "1.00" }
    })).toThrow();
  });

  it("validates strict quota and batch confirmation contracts", () => {
    expect(slipQuotaStateSchema.parse({ used: 7, limit: 30 })).toEqual({
      used: 7,
      limit: 30
    });
    expect(confirmSlipBatchInputSchema.parse({
      workspaceId,
      batchMutationId,
      items: [batchItem()]
    })).toHaveProperty("items", expect.any(Array));
    expect(confirmSlipBatchResultSchema.parse({
      status: "posted",
      items: [{
        itemId,
        transaction: {
          transactionId: "77777777-7777-4777-8777-777777777777",
          version: 1,
          state: "posted",
          accountBalances: [{
            accountId,
            amount: "-60.00",
            currency: "THB"
          }]
        }
      }]
    })).toHaveProperty("status", "posted");
    expect(confirmSlipBatchResultSchema.parse({
      status: "blocked",
      issues: [{ itemId, code: "duplicate" }]
    })).toHaveProperty("status", "blocked");
  });

  it("rejects unsafe batch shapes", () => {
    const valid = {
      workspaceId,
      batchMutationId,
      items: [batchItem()]
    };
    expect(() => confirmSlipBatchInputSchema.parse({
      ...valid,
      items: []
    })).toThrow();
    expect(() => confirmSlipBatchInputSchema.parse({
      ...valid,
      items: Array.from({ length: 11 }, (_, index) => batchItem({
        itemId: `22222222-2222-4222-8222-${String(index).padStart(12, "0")}`,
        transaction: {
          ...batchItem().transaction,
          clientMutationId:
            `66666666-6666-4666-8666-${String(index).padStart(12, "0")}`
        }
      }))
    })).toThrow();
    expect(() => confirmSlipBatchInputSchema.parse({
      ...valid,
      items: [batchItem(), batchItem({
        transaction: {
          ...batchItem().transaction,
          clientMutationId: "88888888-8888-4888-8888-888888888888"
        }
      })]
    })).toThrow();
    expect(() => confirmSlipBatchInputSchema.parse({
      ...valid,
      items: [batchItem(), batchItem({
        itemId: "99999999-9999-4999-8999-999999999999"
      })]
    })).toThrow();
    expect(() => confirmSlipBatchInputSchema.parse({
      ...valid,
      items: [batchItem({
        transaction: {
          ...batchItem().transaction,
          workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        }
      })]
    })).toThrow();
    expect(() => confirmSlipBatchInputSchema.parse({
      ...valid,
      unexpected: true
    })).toThrow();
    expect(() => confirmSlipBatchResultSchema.parse({
      status: "blocked",
      issues: [{ itemId, code: "unexpected" }]
    })).toThrow();
  });
});

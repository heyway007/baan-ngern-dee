import { describe, expect, it } from "vitest";

import {
  analyzeSlipResponseSchema,
  confirmSlipInputSchema,
  slipAiExtractionSchema
} from "../src";

const token = "a".repeat(40);

describe("slip import contracts", () => {
  it("accepts success, duplicate, and unsupported outcomes", () => {
    expect(analyzeSlipResponseSchema.parse({
      status: "success",
      analysisToken: token,
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
});

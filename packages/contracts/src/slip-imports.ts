import { z } from "zod";

import { createTransactionSchema } from "./transactions";

const moneySchema = z
  .string()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/)
  .refine((value) => /[1-9]/.test(value));
const confidenceSchema = z.number().min(0).max(1);

export const slipDocumentKindSchema = z.enum([
  "bank_transfer",
  "receipt"
]);

export const slipAiExtractionSchema = z
  .object({
    documentKind: z.enum(["bank_transfer", "receipt", "unsupported"]),
    suggestedType: z.enum(["income", "expense"]).nullable(),
    amount: moneySchema.nullable(),
    currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
    financialDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    reference: z.string().trim().max(200).nullable(),
    merchant: z.string().trim().max(200).nullable(),
    sender: z.string().trim().max(200).nullable(),
    recipient: z.string().trim().max(200).nullable(),
    institution: z.string().trim().max(200).nullable(),
    confidence: z
      .object({
        documentKind: confidenceSchema,
        suggestedType: confidenceSchema,
        amount: confidenceSchema,
        financialDate: confidenceSchema,
        reference: confidenceSchema
      })
      .strict()
  })
  .strict();

export const slipReviewFieldSchema = z.enum([
  "type",
  "amount",
  "financialDate",
  "account",
  "category"
]);

export const slipTransactionDraftSchema = z
  .object({
    type: z.enum(["income", "expense"]),
    amount: moneySchema.optional(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    financialDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    accountId: z.string().uuid().optional(),
    categoryId: z.string().uuid().optional(),
    note: z.string().trim().max(500).optional(),
    reference: z.string().trim().max(200).optional(),
    fieldsNeedingReview: z.array(slipReviewFieldSchema)
  })
  .strict();

export const duplicateTransactionSchema = z
  .object({
    id: z.string().uuid(),
    amount: moneySchema,
    financialDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    note: z.string().max(500).optional()
  })
  .strict();

export const analyzeSlipResponseSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("success"),
      analysisToken: z.string().min(40).max(4096),
      documentKind: slipDocumentKindSchema,
      draft: slipTransactionDraftSchema
    })
    .strict(),
  z
    .object({
      status: z.literal("duplicate"),
      existingTransaction: duplicateTransactionSchema
    })
    .strict(),
  z.object({ status: z.literal("unsupported") }).strict()
]);

export const confirmSlipInputSchema = z
  .object({
    analysisToken: z.string().min(40).max(4096),
    transaction: createTransactionSchema
  })
  .strict();

export type SlipDocumentKind = z.infer<typeof slipDocumentKindSchema>;
export type SlipAiExtraction = z.infer<typeof slipAiExtractionSchema>;
export type SlipTransactionDraft = z.infer<
  typeof slipTransactionDraftSchema
>;
export type DuplicateTransaction = z.infer<
  typeof duplicateTransactionSchema
>;
export type SlipAnalysisResponse = z.infer<
  typeof analyzeSlipResponseSchema
>;
export type ConfirmSlipInput = z.infer<typeof confirmSlipInputSchema>;

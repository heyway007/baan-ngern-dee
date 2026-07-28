import { z } from "zod";

import {
  createTransactionSchema,
  postedTransactionResponseSchema
} from "./transactions";

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
      analysisExpiresAt: z.string().datetime(),
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

export const slipQuotaStateSchema = z
  .object({
    used: z.number().int().min(0).max(30),
    limit: z.literal(30)
  })
  .strict();

const confirmSlipBatchItemSchema = z
  .object({
    itemId: z.string().uuid(),
    analysisToken: z.string().min(40).max(4096),
    transaction: createTransactionSchema
  })
  .strict();

export const confirmSlipBatchInputSchema = z
  .object({
    workspaceId: z.string().uuid(),
    batchMutationId: z.string().uuid(),
    items: z.array(confirmSlipBatchItemSchema).min(1).max(10)
  })
  .strict()
  .superRefine((input, context) => {
    const itemIds = new Set<string>();
    const mutationIds = new Set<string>();
    input.items.forEach((item, index) => {
      if (item.transaction.workspaceId !== input.workspaceId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["items", index, "transaction", "workspaceId"],
          message: "BATCH_WORKSPACE_MISMATCH"
        });
      }
      if (itemIds.has(item.itemId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["items", index, "itemId"],
          message: "BATCH_ITEM_DUPLICATE"
        });
      }
      if (mutationIds.has(item.transaction.clientMutationId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["items", index, "transaction", "clientMutationId"],
          message: "BATCH_MUTATION_DUPLICATE"
        });
      }
      itemIds.add(item.itemId);
      mutationIds.add(item.transaction.clientMutationId);
    });
  });

export const confirmSlipBatchIssueCodeSchema = z.enum([
  "duplicate",
  "invalid_account",
  "invalid_category",
  "currency_mismatch",
  "expired_analysis",
  "invalid_analysis",
  "mutation_conflict"
]);

export const confirmSlipBatchResultSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("posted"),
      items: z.array(
        z
          .object({
            itemId: z.string().uuid(),
            transaction: postedTransactionResponseSchema
          })
          .strict()
      ).min(1).max(10)
    })
    .strict(),
  z
    .object({
      status: z.literal("blocked"),
      issues: z.array(
        z
          .object({
            itemId: z.string().uuid(),
            code: confirmSlipBatchIssueCodeSchema
          })
          .strict()
      ).min(1).max(10)
    })
    .strict()
]);

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
export type SlipQuotaState = z.infer<typeof slipQuotaStateSchema>;
export type ConfirmSlipBatchInput = z.infer<
  typeof confirmSlipBatchInputSchema
>;
export type ConfirmSlipBatchResult = z.infer<
  typeof confirmSlipBatchResultSchema
>;

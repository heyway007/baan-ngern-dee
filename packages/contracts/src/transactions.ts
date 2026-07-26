import { z } from "zod";

const positiveMoneyAmountSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/)
  .refine((value) => /[1-9]/.test(value), "Amount must be positive");

export const transactionTypeSchema = z.enum([
  "income",
  "expense",
  "balance_adjustment"
]);
export const transactionStateSchema = z.enum(["posted", "void"]);

export const transactionSplitSchema = z
  .object({
    categoryId: z.string().uuid(),
    amount: positiveMoneyAmountSchema,
    note: z.string().trim().max(200).optional()
  })
  .strict();

export const createTransactionSchema = z
  .object({
    workspaceId: z.string().uuid(),
    accountId: z.string().uuid(),
    type: z.enum(["income", "expense"]),
    amount: positiveMoneyAmountSchema,
    currency: z.string().regex(/^[A-Z]{3}$/),
    financialDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    categoryId: z.string().uuid().optional(),
    merchantId: z.string().uuid().optional(),
    note: z.string().trim().max(500).optional(),
    tagIds: z.array(z.string().uuid()).max(20).default([]),
    splits: z.array(transactionSplitSchema).min(1).max(50).optional(),
    clientMutationId: z.string().uuid()
  })
  .strict()
  .superRefine((input, context) => {
    const hasCategory = input.categoryId !== undefined;
    const hasSplits = input.splits !== undefined;
    if (hasCategory === hasSplits) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide either categoryId or splits"
      });
    }
  });

export const voidTransactionSchema = z
  .object({
    version: z.number().int().positive(),
    reason: z.string().trim().min(1).max(200)
  })
  .strict();

export type TransactionType = z.infer<typeof transactionTypeSchema>;
export type TransactionState = z.infer<typeof transactionStateSchema>;
export type TransactionSplitInput = z.infer<typeof transactionSplitSchema>;
export type CreateTransactionInput = z.infer<
  typeof createTransactionSchema
>;
export type VoidTransactionInput = z.infer<typeof voidTransactionSchema>;

export type PostedTransactionResponse = Readonly<{
  transactionId: string;
  version: number;
  state: TransactionState;
  accountBalances: Array<{
    accountId: string;
    amount: string;
    currency: string;
  }>;
}>;

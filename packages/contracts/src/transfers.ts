import { z } from "zod";

const positiveAmount = z
  .string()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/)
  .refine((value) => /[1-9]/.test(value), "Amount must be positive");
const nonNegativeAmount = z
  .string()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/);
const positiveExchangeRate = z
  .string()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,10})?$/)
  .refine((value) => /[1-9]/.test(value), "Rate must be positive");

export const createTransferSchema = z
  .object({
    workspaceId: z.string().uuid(),
    sourceAccountId: z.string().uuid(),
    destinationAccountId: z.string().uuid(),
    sourceAmount: positiveAmount,
    sourceCurrency: z.string().regex(/^[A-Z]{3}$/),
    destinationAmount: positiveAmount,
    destinationCurrency: z.string().regex(/^[A-Z]{3}$/),
    exchangeRate: positiveExchangeRate.optional(),
    feeAmount: nonNegativeAmount.default("0"),
    feeCategoryId: z.string().uuid().optional(),
    financialDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    note: z.string().trim().max(500).optional(),
    clientMutationId: z.string().uuid()
  })
  .strict()
  .superRefine((input, context) => {
    if (input.sourceAccountId === input.destinationAccountId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Accounts must differ"
      });
    }
    if (
      input.sourceCurrency !== input.destinationCurrency &&
      input.exchangeRate === undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Exchange rate is required"
      });
    }
    if (/[1-9]/.test(input.feeAmount) && !input.feeCategoryId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Fee category is required"
      });
    }
  });

export type CreateTransferInput = z.infer<
  typeof createTransferSchema
>;

export type PostedTransferResponse = Readonly<{
  transferId: string;
  state: "posted";
  accountBalances: Array<{
    accountId: string;
    amount: string;
    currency: string;
  }>;
  reportEffect: {
    income: string;
    expense: string;
    cashFlow: string;
  };
}>;

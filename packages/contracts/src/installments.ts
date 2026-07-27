import { z } from "zod";

const moneyAmountSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/);

const positiveMoneyAmountSchema = moneyAmountSchema.refine(
  (value) => /[1-9]/.test(value),
  "Amount must be positive"
);

export const installmentContractKindSchema = z.enum([
  "purchase",
  "debt"
]);

export const installmentInterestMethodSchema = z.enum([
  "zero",
  "flat",
  "reducing",
  "manual"
]);

export const installmentContractStatusSchema = z.enum([
  "draft",
  "active",
  "paid_off",
  "cancelled",
  "defaulted"
]);

export const manualInstallmentRowSchema = z
  .object({
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    principal: positiveMoneyAmountSchema,
    interest: moneyAmountSchema,
    fees: moneyAmountSchema
  })
  .strict();

export const createInstallmentContractSchema = z
  .object({
    workspaceId: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
    kind: installmentContractKindSchema,
    creditor: z.string().trim().min(1).max(120).optional(),
    originalPrincipal: positiveMoneyAmountSchema,
    downPayment: moneyAmountSchema.default("0"),
    financedFees: moneyAmountSchema.default("0"),
    currency: z.string().regex(/^[A-Z]{3}$/),
    interestMethod: installmentInterestMethodSchema,
    annualRate: moneyAmountSchema.default("0"),
    periods: z.number().int().min(1).max(600),
    firstDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    fundingAccountId: z.string().uuid().optional(),
    expenseCategoryId: z.string().uuid().optional(),
    interestCategoryId: z.string().uuid().optional(),
    manualRows: z.array(manualInstallmentRowSchema).min(1).max(600).optional()
  })
  .strict()
  .superRefine((input, context) => {
    if (input.interestMethod === "manual" && !input.manualRows) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Manual rows are required"
      });
    }
    if (input.interestMethod !== "manual" && input.manualRows) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Manual rows require manual interest method"
      });
    }
  });

export type InstallmentContractKind = z.infer<
  typeof installmentContractKindSchema
>;
export type InstallmentInterestMethod = z.infer<
  typeof installmentInterestMethodSchema
>;
export type InstallmentContractStatus = z.infer<
  typeof installmentContractStatusSchema
>;
export type ManualInstallmentRowInput = z.infer<
  typeof manualInstallmentRowSchema
>;
export type CreateInstallmentContractInput = z.infer<
  typeof createInstallmentContractSchema
>;

export type InstallmentScheduleRow = Readonly<{
  sequence: number;
  dueDate: string;
  openingPrincipal: string;
  principal: string;
  interest: string;
  fees: string;
  total: string;
  closingPrincipal: string;
}>;

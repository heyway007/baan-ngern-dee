import { z } from "zod";

const uuidSchema = z.string().uuid();
const currencySchema = z.string().regex(/^[A-Z]{3}$/);
const monthSchema = z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/);
const versionSchema = z.number().int().positive();
const timestampSchema = z.string().datetime({ offset: true });
const signedMoneySchema = z
  .string()
  .regex(/^-?(?:0|[1-9]\d*)(?:\.\d{1,4})?$/);
const unsignedMoneySchema = z
  .string()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/);
const positiveMoneySchema = unsignedMoneySchema.refine(
  (value) => /[1-9]/.test(value),
  "Amount must be positive"
);
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return (
      !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  }, "Date must be a real calendar date");

export const eligibleSavingsAccountTypeSchema = z.enum([
  "cash",
  "bank",
  "ewallet",
  "asset"
]);

export const monthlyBudgetAllocationSchema = z
  .object({
    id: uuidSchema,
    workspaceId: uuidSchema,
    categoryId: uuidSchema,
    month: monthSchema,
    amount: unsignedMoneySchema,
    removedAt: timestampSchema.optional(),
    version: versionSchema
  })
  .strict();

export const savingsGoalSchema = z
  .object({
    id: uuidSchema,
    workspaceId: uuidSchema,
    name: z.string().trim().min(1).max(100),
    targetAmount: positiveMoneySchema,
    currency: currencySchema,
    targetDate: dateSchema.optional(),
    accountId: uuidSchema,
    accountType: eligibleSavingsAccountTypeSchema,
    status: z.enum(["active", "archived"]),
    version: versionSchema
  })
  .strict();

export const budgetTotalsSchema = z
  .object({
    baseBudget: signedMoneySchema,
    priorCarry: signedMoneySchema,
    available: signedMoneySchema,
    spent: signedMoneySchema,
    remaining: signedMoneySchema
  })
  .strict();

export const budgetCategoryPlanSchema = z
  .object({
    categoryId: uuidSchema,
    categoryName: z.string().min(1),
    allocationId: uuidSchema.optional(),
    allocationVersion: versionSchema.optional(),
    isBudgeted: z.boolean(),
    baseBudget: signedMoneySchema,
    priorCarry: signedMoneySchema,
    available: signedMoneySchema,
    spent: signedMoneySchema,
    remaining: signedMoneySchema
  })
  .strict();

export const savingsGoalProgressSchema = z
  .object({
    id: uuidSchema,
    name: z.string().min(1),
    accountId: uuidSchema,
    accountName: z.string().min(1),
    currentAmount: unsignedMoneySchema,
    targetAmount: positiveMoneySchema,
    currency: currencySchema,
    targetDate: dateSchema.optional(),
    percent: z.number().min(0).max(100),
    reached: z.boolean(),
    accountArchived: z.boolean(),
    status: z.enum(["active", "archived"]),
    version: versionSchema
  })
  .strict();

export const financialPlanSchema = z
  .object({
    workspaceId: uuidSchema,
    month: monthSchema,
    currency: currencySchema,
    totals: budgetTotalsSchema,
    categories: z.array(budgetCategoryPlanSchema),
    goals: z.array(savingsGoalProgressSchema)
  })
  .strict();

export const initializeBudgetMonthSchema = z
  .object({
    workspaceId: uuidSchema,
    month: monthSchema
  })
  .strict();

export const initializeBudgetMonthResultSchema = z
  .object({
    createdCount: z.number().int().nonnegative()
  })
  .strict();

export const setMonthlyBudgetSchema = z
  .object({
    workspaceId: uuidSchema,
    categoryId: uuidSchema,
    month: monthSchema,
    amount: positiveMoneySchema,
    version: versionSchema.optional()
  })
  .strict();

export const removeMonthlyBudgetSchema = z
  .object({ version: versionSchema })
  .strict();

export const createSavingsGoalSchema = z
  .object({
    workspaceId: uuidSchema,
    name: z.string().trim().min(1).max(100),
    targetAmount: positiveMoneySchema,
    currency: currencySchema,
    targetDate: dateSchema.optional(),
    accountId: uuidSchema
  })
  .strict();

export const updateSavingsGoalSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    targetAmount: positiveMoneySchema,
    currency: currencySchema,
    targetDate: dateSchema.optional(),
    accountId: uuidSchema,
    version: versionSchema
  })
  .strict();

export const archiveSavingsGoalSchema = z
  .object({ version: versionSchema })
  .strict();

export type MonthlyBudgetAllocation = z.infer<
  typeof monthlyBudgetAllocationSchema
>;
export type SavingsGoal = z.infer<typeof savingsGoalSchema>;
export type BudgetTotals = z.infer<typeof budgetTotalsSchema>;
export type BudgetCategoryPlan = z.infer<typeof budgetCategoryPlanSchema>;
export type SavingsGoalProgress = z.infer<
  typeof savingsGoalProgressSchema
>;
export type FinancialPlan = z.infer<typeof financialPlanSchema>;
export type InitializeBudgetMonthInput = z.infer<
  typeof initializeBudgetMonthSchema
>;
export type InitializeBudgetMonthResult = z.infer<
  typeof initializeBudgetMonthResultSchema
>;
export type SetMonthlyBudgetInput = z.infer<
  typeof setMonthlyBudgetSchema
>;
export type RemoveMonthlyBudgetInput = z.infer<
  typeof removeMonthlyBudgetSchema
>;
export type CreateSavingsGoalInput = z.infer<
  typeof createSavingsGoalSchema
>;
export type UpdateSavingsGoalInput = z.infer<
  typeof updateSavingsGoalSchema
>;
export type ArchiveSavingsGoalInput = z.infer<
  typeof archiveSavingsGoalSchema
>;

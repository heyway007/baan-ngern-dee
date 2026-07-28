import { z } from "zod";

import { accountTypeSchema, type Account } from "./accounts";
import { categoryKindSchema, type Category } from "./catalog";
import {
  installmentContractKindSchema,
  installmentContractStatusSchema,
  installmentExtraPaymentStrategySchema,
  installmentInterestMethodSchema
} from "./installments";
import {
  recurringOccurrenceSchema,
  recurringTemplateSchema
} from "./recurring";
import {
  transactionSplitSchema,
  transactionStateSchema
} from "./transactions";
import type { Workspace } from "./workspaces";

const uuidSchema = z.string().uuid();
const currencySchema = z.string().regex(/^[A-Z]{3}$/);
const financialDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timestampSchema = z.string().datetime({ offset: true });
const moneySchema = z
  .string()
  .regex(/^-?(?:0|[1-9]\d*)(?:\.\d{1,4})?$/);
const unsignedMoneySchema = z
  .string()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/);
const versionSchema = z.number().int().positive();

const workspaceSchema: z.ZodType<Workspace> = z
  .object({
    id: uuidSchema,
    name: z.string().min(1),
    kind: z.enum(["private", "family"]),
    baseCurrency: currencySchema,
    timeZone: z.string().min(1),
    role: z.enum(["owner", "editor", "viewer"]),
    version: versionSchema
  })
  .strict();

const categorySchema: z.ZodType<Category> = z
  .object({
    id: uuidSchema,
    workspaceId: uuidSchema,
    parentId: uuidSchema.optional(),
    slug: z.string().min(1),
    name: z.string().min(1),
    kind: categoryKindSchema,
    isDefault: z.boolean(),
    version: versionSchema
  })
  .strict();

const accountSchema: z.ZodType<Account> = z
  .object({
    id: uuidSchema,
    workspaceId: uuidSchema,
    name: z.string().min(1),
    type: accountTypeSchema,
    currency: currencySchema,
    institution: z.string().min(1).optional(),
    version: versionSchema
  })
  .strict();

export const accountBalanceSchema = z
  .object({
    accountId: uuidSchema,
    amount: moneySchema,
    currency: currencySchema
  })
  .strict();

export type AccountBalance = z.infer<typeof accountBalanceSchema>;

export const openingTransactionSchema = z
  .object({
    id: uuidSchema,
    workspaceId: uuidSchema,
    accountId: uuidSchema,
    amount: moneySchema,
    currency: currencySchema,
    state: z.literal("posted"),
    version: z.literal(1)
  })
  .strict();

export type OpeningTransaction = z.infer<typeof openingTransactionSchema>;

export const financeTransactionSchema = z
  .object({
    id: uuidSchema,
    workspaceId: uuidSchema,
    accountId: uuidSchema,
    type: z.enum(["income", "expense"]),
    amount: unsignedMoneySchema,
    currency: currencySchema,
    financialDate: financialDateSchema,
    categoryId: uuidSchema.optional(),
    splits: z.array(transactionSplitSchema).optional(),
    note: z.string().optional(),
    tagIds: z.array(uuidSchema),
    state: transactionStateSchema,
    version: versionSchema,
    createdAt: timestampSchema,
    voidedAt: timestampSchema.optional(),
    voidReason: z.string().min(1).max(200).optional(),
    source: z
      .enum([
        "transfer_fee",
        "installment_payment",
        "installment_payoff",
        "recurring_occurrence"
      ])
      .optional(),
    sourceId: uuidSchema.optional()
  })
  .strict();

export type FinanceTransaction = z.infer<typeof financeTransactionSchema>;

export const financeInstallmentContractSchema = z
  .object({
    id: uuidSchema,
    workspaceId: uuidSchema,
    name: z.string().min(1),
    kind: installmentContractKindSchema,
    creditor: z.string().min(1).optional(),
    originalPrincipal: unsignedMoneySchema,
    downPayment: unsignedMoneySchema,
    financedPrincipal: unsignedMoneySchema,
    financedFees: unsignedMoneySchema,
    currency: currencySchema,
    interestMethod: installmentInterestMethodSchema,
    annualRate: unsignedMoneySchema,
    periods: z.number().int().positive(),
    firstDueDate: financialDateSchema,
    fundingAccountId: uuidSchema.optional(),
    expenseCategoryId: uuidSchema.optional(),
    interestCategoryId: uuidSchema.optional(),
    status: installmentContractStatusSchema,
    version: versionSchema
  })
  .strict();

export type FinanceInstallmentContract = z.infer<
  typeof financeInstallmentContractSchema
>;

export const financeInstallmentScheduleRowSchema = z
  .object({
    sequence: z.number().int().positive(),
    dueDate: financialDateSchema,
    openingPrincipal: unsignedMoneySchema,
    principal: unsignedMoneySchema,
    interest: unsignedMoneySchema,
    fees: unsignedMoneySchema,
    total: unsignedMoneySchema,
    closingPrincipal: unsignedMoneySchema,
    paidPrincipal: unsignedMoneySchema,
    paidInterest: unsignedMoneySchema,
    paidFees: unsignedMoneySchema,
    paidPenalty: unsignedMoneySchema,
    scheduledPenalty: unsignedMoneySchema,
    status: z.enum([
      "upcoming",
      "due",
      "partially_paid",
      "paid",
      "overdue",
      "waived",
      "cancelled"
    ])
  })
  .strict();

export type FinanceInstallmentScheduleRow = z.infer<
  typeof financeInstallmentScheduleRowSchema
>;

export const financeInstallmentPaymentSchema = z
  .object({
    id: uuidSchema,
    workspaceId: uuidSchema,
    contractId: uuidSchema,
    sequence: z.number().int().positive(),
    accountId: uuidSchema,
    amount: unsignedMoneySchema,
    currency: currencySchema,
    financialDate: financialDateSchema,
    penaltyAssessed: unsignedMoneySchema,
    allocatedPenalty: unsignedMoneySchema,
    allocatedFees: unsignedMoneySchema,
    allocatedInterest: unsignedMoneySchema,
    allocatedPrincipal: unsignedMoneySchema,
    reportableExpense: unsignedMoneySchema,
    expenseTransactionId: uuidSchema.optional(),
    note: z.string().optional(),
    clientMutationId: uuidSchema,
    createdAt: timestampSchema
  })
  .strict();

export type FinanceInstallmentPayment = z.infer<
  typeof financeInstallmentPaymentSchema
>;

export const financeInstallmentPayoffSchema = z
  .object({
    id: uuidSchema,
    workspaceId: uuidSchema,
    contractId: uuidSchema,
    accountId: uuidSchema,
    action: z.enum(["extra_principal", "payoff"]),
    strategy: installmentExtraPaymentStrategySchema.optional(),
    expectedRemainingPrincipal: unsignedMoneySchema,
    extraPrincipal: unsignedMoneySchema.optional(),
    quotedInterest: unsignedMoneySchema,
    quotedFees: unsignedMoneySchema,
    principalPayment: unsignedMoneySchema,
    interestDue: unsignedMoneySchema,
    feesDue: unsignedMoneySchema,
    totalCashRequired: unsignedMoneySchema,
    remainingPrincipal: unsignedMoneySchema,
    interestSaved: unsignedMoneySchema,
    currency: currencySchema,
    financialDate: financialDateSchema,
    priorRows: z.array(financeInstallmentScheduleRowSchema),
    regeneratedRows: z.array(financeInstallmentScheduleRowSchema),
    expenseTransactionId: uuidSchema.optional(),
    note: z.string().optional(),
    clientMutationId: uuidSchema,
    createdAt: timestampSchema
  })
  .strict();

export type FinanceInstallmentPayoff = z.infer<
  typeof financeInstallmentPayoffSchema
>;

export const financeSnapshotSchema = z
  .object({
    version: z.literal(1),
    workspace: workspaceSchema.nullable(),
    categories: z.array(categorySchema),
    accounts: z.array(accountSchema),
    accountBalances: z.record(uuidSchema, accountBalanceSchema),
    openingTransactions: z.array(openingTransactionSchema),
    transactions: z.array(financeTransactionSchema),
    installmentContracts: z.array(financeInstallmentContractSchema),
    installmentSchedules: z.record(
      uuidSchema,
      z.array(financeInstallmentScheduleRowSchema)
    ),
    installmentPayments: z.array(financeInstallmentPaymentSchema),
    installmentPayoffs: z.array(financeInstallmentPayoffSchema),
    recurringTemplates: z.array(recurringTemplateSchema),
    recurringOccurrences: z.array(recurringOccurrenceSchema)
  })
  .strict();

export type FinanceSnapshot = z.infer<typeof financeSnapshotSchema>;

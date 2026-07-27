import { z } from "zod";

import { categoryKindSchema } from "./catalog";
import { postedTransactionResponseSchema } from "./transactions";

const uuidSchema = z.string().uuid();
const currencySchema = z.string().regex(/^[A-Z]{3}$/);
const monthSchema = z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/);
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
const positiveMoneySchema = z
  .string()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/)
  .refine((value) => /[1-9]/.test(value), "Amount must be positive");
const versionSchema = z.number().int().positive();

export const recurringTemplateStatusSchema = z.enum([
  "active",
  "paused",
  "cancelled"
]);

export const recurringOccurrenceStatusSchema = z.enum([
  "pending",
  "posted",
  "skipped"
]);

const templateFields = {
  name: z.string().trim().min(1).max(100),
  kind: categoryKindSchema,
  amount: positiveMoneySchema,
  currency: currencySchema,
  accountId: uuidSchema,
  categoryId: uuidSchema,
  dayOfMonth: z.number().int().min(1).max(31),
  startMonth: monthSchema,
  endMonth: monthSchema.optional()
};

function validMonthRange(input: {
  startMonth: string;
  endMonth?: string;
}): boolean {
  return !input.endMonth || input.endMonth >= input.startMonth;
}

export const createRecurringTemplateSchema = z
  .object({
    workspaceId: uuidSchema,
    ...templateFields
  })
  .strict()
  .refine(validMonthRange, {
    path: ["endMonth"],
    message: "End month must not precede start month"
  });

export const updateRecurringTemplateSchema = z
  .object({
    ...templateFields,
    version: versionSchema
  })
  .strict()
  .refine(validMonthRange, {
    path: ["endMonth"],
    message: "End month must not precede start month"
  });

export const recurringVersionActionSchema = z
  .object({
    version: versionSchema
  })
  .strict();

export const materializeRecurringPeriodSchema = z
  .object({
    workspaceId: uuidSchema,
    period: monthSchema
  })
  .strict();

export const updateRecurringOccurrenceSchema = z
  .object({
    amount: positiveMoneySchema,
    scheduledDate: dateSchema,
    version: versionSchema
  })
  .strict();

export const postRecurringOccurrenceSchema = z
  .object({
    version: versionSchema,
    clientMutationId: uuidSchema
  })
  .strict();

export const recurringTemplateSchema = z
  .object({
    id: uuidSchema,
    workspaceId: uuidSchema,
    ...templateFields,
    status: recurringTemplateStatusSchema,
    version: versionSchema
  })
  .strict();

export const recurringOccurrenceSchema = z
  .object({
    id: uuidSchema,
    workspaceId: uuidSchema,
    templateId: uuidSchema,
    name: z.string().trim().min(1).max(100),
    kind: categoryKindSchema,
    period: monthSchema,
    scheduledDate: dateSchema,
    amount: positiveMoneySchema,
    currency: currencySchema,
    accountId: uuidSchema,
    categoryId: uuidSchema,
    status: recurringOccurrenceStatusSchema,
    transactionId: uuidSchema.optional(),
    version: versionSchema
  })
  .strict()
  .superRefine((occurrence, context) => {
    if (!occurrence.scheduledDate.startsWith(occurrence.period)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scheduledDate"],
        message: "Date must be inside period"
      });
    }
    if (
      occurrence.status === "posted" &&
      occurrence.transactionId === undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["transactionId"],
        message: "Posted occurrence requires a transaction"
      });
    }
    if (
      occurrence.status !== "posted" &&
      occurrence.transactionId !== undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["transactionId"],
        message: "Unposted occurrence cannot reference a transaction"
      });
    }
  });

export const materializeRecurringPeriodResultSchema = z
  .object({
    createdCount: z.number().int().nonnegative(),
    existingCount: z.number().int().nonnegative()
  })
  .strict();

export const recurringPeriodSchema = z
  .object({
    period: monthSchema,
    occurrences: z.array(recurringOccurrenceSchema)
  })
  .strict();

export const postRecurringOccurrenceResultSchema = z
  .object({
    occurrence: recurringOccurrenceSchema,
    transaction: postedTransactionResponseSchema
  })
  .strict();

export type CreateRecurringTemplateInput = z.infer<
  typeof createRecurringTemplateSchema
>;
export type UpdateRecurringTemplateInput = z.infer<
  typeof updateRecurringTemplateSchema
>;
export type RecurringVersionActionInput = z.infer<
  typeof recurringVersionActionSchema
>;
export type MaterializeRecurringPeriodInput = z.infer<
  typeof materializeRecurringPeriodSchema
>;
export type UpdateRecurringOccurrenceInput = z.infer<
  typeof updateRecurringOccurrenceSchema
>;
export type PostRecurringOccurrenceInput = z.infer<
  typeof postRecurringOccurrenceSchema
>;
export type RecurringTemplateStatus = z.infer<
  typeof recurringTemplateStatusSchema
>;
export type RecurringOccurrenceStatus = z.infer<
  typeof recurringOccurrenceStatusSchema
>;
export type RecurringTemplate = z.infer<typeof recurringTemplateSchema>;
export type RecurringOccurrence = z.infer<
  typeof recurringOccurrenceSchema
>;
export type MaterializeRecurringPeriodResult = z.infer<
  typeof materializeRecurringPeriodResultSchema
>;
export type RecurringPeriod = z.infer<typeof recurringPeriodSchema>;
export type PostRecurringOccurrenceResult = z.infer<
  typeof postRecurringOccurrenceResultSchema
>;

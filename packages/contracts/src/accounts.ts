import { z } from "zod";

export const accountTypeSchema = z.enum([
  "cash",
  "bank",
  "ewallet",
  "credit_card",
  "loan",
  "asset"
]);

export const createAccountSchema = z
  .object({
    workspaceId: z.string().uuid(),
    name: z.string().trim().min(1).max(80),
    type: accountTypeSchema,
    currency: z.string().regex(/^[A-Z]{3}$/),
    institution: z.string().trim().min(1).max(120).optional()
  })
  .strict();

export const createAccountWithOpeningBalanceSchema =
  createAccountSchema.extend({
    openingBalance: z
      .string()
      .regex(/^-?(?:0|[1-9]\d*)(?:\.\d{1,4})?$/)
      .default("0")
  });

export type AccountType = z.infer<typeof accountTypeSchema>;
export type CreateAccountInput = z.infer<typeof createAccountSchema>;
export type CreateAccountWithOpeningBalanceInput = z.infer<
  typeof createAccountWithOpeningBalanceSchema
>;

export type Account = Readonly<{
  id: string;
  workspaceId: string;
  name: string;
  type: AccountType;
  currency: string;
  institution?: string;
  version: number;
}>;

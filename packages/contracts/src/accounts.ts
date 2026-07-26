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

export type AccountType = z.infer<typeof accountTypeSchema>;
export type CreateAccountInput = z.infer<typeof createAccountSchema>;

export type Account = Readonly<{
  id: string;
  workspaceId: string;
  name: string;
  type: AccountType;
  currency: string;
  institution?: string;
  version: number;
}>;

import { z } from "zod";

const uuidSchema = z.string().uuid();
const timestampSchema = z.string().datetime({ offset: true });
const normalizedEmailSchema = z
  .string()
  .trim()
  .email()
  .transform((value) => value.toLowerCase());

const adminUserCursorSchema = z.string().superRefine(
  (value, context) => {
    const separator = value.lastIndexOf("|");
    const timestamp = value.slice(0, separator);
    const userId = value.slice(separator + 1);
    if (
      separator < 1 ||
      !timestampSchema.safeParse(timestamp).success ||
      !uuidSchema.safeParse(userId).success
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid admin user cursor"
      });
    }
  }
);

export const adminUserStatusSchema = z.enum([
  "unconfirmed",
  "active",
  "suspended",
  "deletion_pending"
]);
export type AdminUserStatus = z.infer<
  typeof adminUserStatusSchema
>;

export const adminUserSchema = z
  .object({
    userId: uuidSchema,
    email: normalizedEmailSchema,
    displayName: z.string().min(1).max(80),
    status: adminUserStatusSchema,
    createdAt: timestampSchema,
    lastSignInAt: timestampSchema.optional(),
    emailConfirmedAt: timestampSchema.optional(),
    bannedUntil: timestampSchema.optional(),
    privateWorkspaceCount: z.number().int().nonnegative(),
    deletionPending: z.boolean()
  })
  .strict();
export type AdminUser = z.infer<typeof adminUserSchema>;

export const listAdminUsersQuerySchema = z
  .object({
    search: z
      .string()
      .trim()
      .max(120)
      .transform((value) => value.toLowerCase())
      .default(""),
    limit: z.coerce.number().int().min(1).max(50).default(25),
    cursor: adminUserCursorSchema.optional()
  })
  .strict();
export type ListAdminUsersQuery = z.infer<
  typeof listAdminUsersQuerySchema
>;

export const adminUserListResponseSchema = z
  .object({
    users: z.array(adminUserSchema),
    nextCursor: adminUserCursorSchema.nullable()
  })
  .strict();
export type AdminUserListResponse = z.infer<
  typeof adminUserListResponseSchema
>;

export const adminUserMutationResponseSchema = z
  .object({
    user: adminUserSchema
  })
  .strict();
export type AdminUserMutationResponse = z.infer<
  typeof adminUserMutationResponseSchema
>;

export const deleteAdminUserSchema = z
  .object({
    email: normalizedEmailSchema,
    clientMutationId: uuidSchema
  })
  .strict();
export type DeleteAdminUserInput = z.infer<
  typeof deleteAdminUserSchema
>;

import { z } from "zod";

const uuidSchema = z.string().uuid();
const timestampSchema = z.string().datetime({ offset: true });
const normalizedEmailSchema = z
  .string()
  .trim()
  .email()
  .transform((value) => value.toLowerCase());
const invitationTokenSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/);

export const invitationStatusSchema = z.enum([
  "ready",
  "busy",
  "redeemed",
  "expired",
  "revoked"
]);
export type InvitationStatus = z.infer<
  typeof invitationStatusSchema
>;

export const createInvitationSchema = z
  .object({
    email: normalizedEmailSchema,
    displayName: z.string().trim().min(1).max(80)
  })
  .strict();
export type CreateInvitationInput = z.infer<
  typeof createInvitationSchema
>;

export const adminInvitationSchema = z
  .object({
    id: uuidSchema,
    email: normalizedEmailSchema,
    displayName: z.string().min(1).max(80),
    status: invitationStatusSchema,
    createdAt: timestampSchema,
    expiresAt: timestampSchema,
    redeemedAt: timestampSchema.optional(),
    revokedAt: timestampSchema.optional()
  })
  .strict();
export type AdminInvitation = z.infer<
  typeof adminInvitationSchema
>;

export const adminCapabilitiesSchema = z
  .object({
    canManageInvitations: z.boolean(),
    canManageUsers: z.boolean()
  })
  .strict();
export type AdminCapabilities = z.infer<
  typeof adminCapabilitiesSchema
>;

export const createInvitationResponseSchema = z
  .object({
    invitation: adminInvitationSchema,
    invitationUrl: z.string().url()
  })
  .strict();
export type CreateInvitationResponse = z.infer<
  typeof createInvitationResponseSchema
>;

export const inspectInvitationSchema = z
  .object({
    token: invitationTokenSchema
  })
  .strict();
export type InspectInvitationInput = z.infer<
  typeof inspectInvitationSchema
>;

export const inspectInvitationResponseSchema = z
  .object({
    displayName: z.string().min(1).max(80),
    maskedEmail: z.string().min(3),
    status: z.literal("ready")
  })
  .strict();
export type InspectInvitationResponse = z.infer<
  typeof inspectInvitationResponseSchema
>;

export const redeemInvitationSchema = z
  .object({
    token: invitationTokenSchema,
    password: z.string().min(8).max(128)
  })
  .strict();
export type RedeemInvitationInput = z.infer<
  typeof redeemInvitationSchema
>;

export const redeemInvitationResponseSchema = z
  .object({
    email: normalizedEmailSchema
  })
  .strict();
export type RedeemInvitationResponse = z.infer<
  typeof redeemInvitationResponseSchema
>;

export const adminInvitationListSchema = z
  .object({
    invitations: z.array(adminInvitationSchema)
  })
  .strict();
export type AdminInvitationList = z.infer<
  typeof adminInvitationListSchema
>;

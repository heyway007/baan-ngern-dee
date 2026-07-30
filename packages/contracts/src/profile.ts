import { z } from "zod";

export const PROFILE_AVATAR_MAX_BYTES = 2_097_152;

export const updateProfileSchema = z
  .object({
    displayName: z.string().trim().min(1).max(80)
  })
  .strict();
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

const profileAccountChannelSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("email"),
      label: z.string().email()
    })
    .strict(),
  z
    .object({
      kind: z.literal("line"),
      label: z.literal("LINE")
    })
    .strict()
]);
export type ProfileAccountChannel = z.infer<
  typeof profileAccountChannelSchema
>;

const profileAvatarSchema = z.discriminatedUnion("source", [
  z
    .object({
      source: z.enum(["custom", "line"]),
      url: z.string().url()
    })
    .strict(),
  z
    .object({
      source: z.literal("initial"),
      url: z.null()
    })
    .strict()
]);
export type ProfileAvatar = z.infer<typeof profileAvatarSchema>;

export const userProfileSchema = z
  .object({
    userId: z.string().uuid(),
    displayName: z.string().min(1).max(80),
    accountChannel: profileAccountChannelSchema,
    avatar: profileAvatarSchema
  })
  .strict();
export type UserProfile = z.infer<typeof userProfileSchema>;

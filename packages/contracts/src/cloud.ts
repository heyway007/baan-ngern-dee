import { z } from "zod";

export const publicAppConfigSchema = z
  .object({
    supabaseUrl: z
      .string()
      .url()
      .refine((value) => value.endsWith(".supabase.co")),
    supabasePublishableKey: z.string().startsWith("sb_publishable_")
  })
  .strict();

export type PublicAppConfig = z.infer<typeof publicAppConfigSchema>;

import { z } from "zod";

function isIanaTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export const createPrivateWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(80),
  baseCurrency: z.string().regex(/^[A-Z]{3}$/).default("THB"),
  timeZone: z
    .string()
    .default("Asia/Bangkok")
    .refine(isIanaTimeZone, "Invalid IANA timezone")
});

export type CreatePrivateWorkspaceInput = z.infer<
  typeof createPrivateWorkspaceSchema
>;

export type WorkspaceRole = "owner" | "editor" | "viewer";

export type Workspace = Readonly<{
  id: string;
  name: string;
  kind: "private" | "family";
  baseCurrency: string;
  timeZone: string;
  role: WorkspaceRole;
  version: number;
}>;

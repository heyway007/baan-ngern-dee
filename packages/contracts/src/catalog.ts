import { z } from "zod";

export const categoryKindSchema = z.enum(["income", "expense"]);

export const createCategorySchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  kind: categoryKindSchema,
  parentId: z.string().uuid().optional()
});

export type CategoryKind = z.infer<typeof categoryKindSchema>;
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

export type Category = Readonly<{
  id: string;
  workspaceId: string;
  parentId?: string;
  slug: string;
  name: string;
  kind: CategoryKind;
  isDefault: boolean;
  version: number;
}>;

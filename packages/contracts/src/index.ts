export type { ApiErrorCode, ApiErrorResponse } from "./errors";
export { apiErrorCodes } from "./errors";
export type {
  Category,
  CategoryKind,
  CreateCategoryInput
} from "./catalog";
export { categoryKindSchema, createCategorySchema } from "./catalog";
export type {
  CreatePrivateWorkspaceInput,
  Workspace,
  WorkspaceRole
} from "./workspaces";
export { createPrivateWorkspaceSchema } from "./workspaces";

export type HealthResponse = {
  ok: true;
  service: "systems-credit-api";
};

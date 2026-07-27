export type {
  Account,
  AccountType,
  CreateAccountInput,
  CreateAccountWithOpeningBalanceInput
} from "./accounts";
export {
  accountTypeSchema,
  createAccountSchema,
  createAccountWithOpeningBalanceSchema
} from "./accounts";
export type { ApiErrorCode, ApiErrorResponse } from "./errors";
export { apiErrorCodes } from "./errors";
export type {
  CreateInstallmentContractInput,
  InstallmentContractKind,
  InstallmentContractStatus,
  InstallmentInterestMethod,
  InstallmentScheduleRow,
  ManualInstallmentRowInput
} from "./installments";
export {
  createInstallmentContractSchema,
  installmentContractKindSchema,
  installmentContractStatusSchema,
  installmentInterestMethodSchema,
  manualInstallmentRowSchema
} from "./installments";
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
export type {
  CreateTransactionInput,
  PostedTransactionResponse,
  TransactionSplitInput,
  TransactionState,
  TransactionType,
  VoidTransactionInput
} from "./transactions";
export {
  createTransactionSchema,
  transactionSplitSchema,
  transactionStateSchema,
  transactionTypeSchema,
  voidTransactionSchema
} from "./transactions";
export type {
  CreateTransferInput,
  PostedTransferResponse
} from "./transfers";
export { createTransferSchema } from "./transfers";

export type HealthResponse = {
  ok: true;
  service: "systems-credit-api";
};

import type {
  Account,
  Category,
  CreateAccountWithOpeningBalanceInput,
  CreateCategoryInput,
  CreatePrivateWorkspaceInput,
  CreateTransactionInput,
  PostedTransactionResponse,
  Workspace
} from "@systems-credit/contracts";

export type WorkspaceCreationResult = Readonly<{
  workspace: Workspace;
  categories: Category[];
}>;

export type AccountCreationResult = Readonly<{
  account: Account;
  openingTransaction?: Readonly<{
    transactionId: string;
    state: "posted";
    version: 1;
  }>;
  accountBalance: Readonly<{
    accountId: string;
    amount: string;
    currency: string;
  }>;
}>;

export interface FinanceApi {
  createPrivateWorkspace(
    input: CreatePrivateWorkspaceInput
  ): Promise<WorkspaceCreationResult>;
  createAccount(
    input: CreateAccountWithOpeningBalanceInput
  ): Promise<AccountCreationResult>;
  createCategory(input: CreateCategoryInput): Promise<Category>;
  postTransaction(
    input: CreateTransactionInput
  ): Promise<PostedTransactionResponse>;
}

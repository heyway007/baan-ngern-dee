import type {
  Account,
  Category,
  CreateAccountWithOpeningBalanceInput,
  CreateCategoryInput,
  CreateInstallmentContractInput,
  CreatePrivateWorkspaceInput,
  CreateRecurringTemplateInput,
  CreateTransactionInput,
  MaterializeRecurringPeriodInput,
  MaterializeRecurringPeriodResult,
  PostInstallmentPayoffInput,
  PostInstallmentPaymentInput,
  PostRecurringOccurrenceInput,
  PostRecurringOccurrenceResult,
  PostedTransactionResponse,
  RecurringOccurrence,
  RecurringPeriod,
  RecurringTemplate,
  RecurringVersionActionInput,
  UpdateRecurringOccurrenceInput,
  UpdateRecurringTemplateInput,
  VoidTransactionInput,
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

export type InstallmentContractCreationResult = Readonly<{
  contract: Readonly<{
    id: string;
    workspaceId: string;
    name: string;
    kind: CreateInstallmentContractInput["kind"];
    creditor?: string;
    originalPrincipal: string;
    downPayment: string;
    financedPrincipal: string;
    financedFees: string;
    currency: string;
    interestMethod: CreateInstallmentContractInput["interestMethod"];
    annualRate: string;
    periods: number;
    firstDueDate: string;
    fundingAccountId?: string;
    expenseCategoryId?: string;
    interestCategoryId?: string;
    status: "active";
    version: 1;
  }>;
  schedule: Array<
    Readonly<{
      sequence: number;
      dueDate: string;
      openingPrincipal: string;
      principal: string;
      interest: string;
      fees: string;
      total: string;
      closingPrincipal: string;
    }>
  >;
}>;

export type InstallmentPaymentResult = Readonly<{
  paymentId: string;
  allocation: Readonly<{
    penalty: string;
    fees: string;
    interest: string;
    principal: string;
    total: string;
  }>;
  reportableExpense: string;
  scheduleStatus: "partially_paid" | "paid";
  contractStatus: "active" | "paid_off";
  accountBalance: Readonly<{
    accountId: string;
    amount: string;
    currency: string;
  }>;
  expenseTransactionId?: string;
}>;

export type InstallmentPayoffResult = Readonly<{
  payoffId: string;
  action: PostInstallmentPayoffInput["action"];
  strategy?: NonNullable<PostInstallmentPayoffInput["strategy"]>;
  principalPayment: string;
  interestDue: string;
  feesDue: string;
  totalCashRequired: string;
  remainingPrincipal: string;
  interestSaved: string;
  contractStatus: "active" | "paid_off";
  accountBalance: Readonly<{
    accountId: string;
    amount: string;
    currency: string;
  }>;
  expenseTransactionId?: string;
}>;

export interface FinanceApi {
  createPrivateWorkspace(
    input: CreatePrivateWorkspaceInput
  ): Promise<WorkspaceCreationResult>;
  createAccount(
    input: CreateAccountWithOpeningBalanceInput
  ): Promise<AccountCreationResult>;
  createCategory(input: CreateCategoryInput): Promise<Category>;
  createInstallmentContract(
    input: CreateInstallmentContractInput,
    clientMutationId?: string
  ): Promise<InstallmentContractCreationResult>;
  postInstallmentPayment(
    input: PostInstallmentPaymentInput
  ): Promise<InstallmentPaymentResult>;
  postInstallmentPayoff(
    input: PostInstallmentPayoffInput
  ): Promise<InstallmentPayoffResult>;
  postTransaction(
    input: CreateTransactionInput
  ): Promise<PostedTransactionResponse>;
  voidTransaction(
    transactionId: string,
    input: VoidTransactionInput
  ): Promise<PostedTransactionResponse>;
  createRecurringTemplate(
    input: CreateRecurringTemplateInput
  ): Promise<RecurringTemplate>;
  updateRecurringTemplate(
    templateId: string,
    input: UpdateRecurringTemplateInput
  ): Promise<RecurringTemplate>;
  pauseRecurringTemplate(
    templateId: string,
    input: RecurringVersionActionInput
  ): Promise<RecurringTemplate>;
  resumeRecurringTemplate(
    templateId: string,
    input: RecurringVersionActionInput
  ): Promise<RecurringTemplate>;
  cancelRecurringTemplate(
    templateId: string,
    input: RecurringVersionActionInput
  ): Promise<RecurringTemplate>;
  materializeRecurringPeriod(
    input: MaterializeRecurringPeriodInput
  ): Promise<MaterializeRecurringPeriodResult>;
  getRecurringPeriod(
    workspaceId: string,
    period: string
  ): Promise<RecurringPeriod>;
  updateRecurringOccurrence(
    occurrenceId: string,
    input: UpdateRecurringOccurrenceInput
  ): Promise<RecurringOccurrence>;
  skipRecurringOccurrence(
    occurrenceId: string,
    input: RecurringVersionActionInput
  ): Promise<RecurringOccurrence>;
  postRecurringOccurrence(
    occurrenceId: string,
    input: PostRecurringOccurrenceInput
  ): Promise<PostRecurringOccurrenceResult>;
}

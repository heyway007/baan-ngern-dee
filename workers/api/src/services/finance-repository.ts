import type {
  Account,
  Category,
  CategoryKind,
  CreateAccountWithOpeningBalanceInput,
  CreateCategoryInput,
  CreateInstallmentContractInput,
  CreatePrivateWorkspaceInput,
  CreateRecurringTemplateInput,
  CreateTransferInput,
  CreateTransactionInput,
  FinanceInstallmentPayment,
  FinanceInstallmentPayoff,
  FinanceSnapshot,
  MaterializeRecurringPeriodInput,
  MaterializeRecurringPeriodResult,
  PostedTransactionResponse,
  PostedTransferResponse,
  PostRecurringOccurrenceInput,
  PostRecurringOccurrenceResult,
  PostInstallmentPayoffInput,
  PostInstallmentPaymentInput,
  RecurringOccurrence,
  RecurringPeriod,
  RecurringTemplate,
  RecurringTemplateStatus,
  TransactionState,
  TransactionType,
  UpdateRecurringOccurrenceInput,
  UpdateRecurringTemplateInput,
  VoidTransactionInput,
  Workspace,
  WorkspaceRole
} from "@systems-credit/contracts";
import {
  allocateInstallmentPayment,
  generateInstallmentSchedule,
  generateManualInstallmentSchedule,
  normalizeAccountKind,
  parseMoney,
  roundMoney,
  resolveRecurringDate,
  simulateInstallmentPayoff,
  toFinancialDate,
  transferReportEffect,
  validateSplits
} from "@systems-credit/domain";

import { ApiError } from "../api-error";
import type { AuthSession } from "../middleware/auth";

export interface FinanceRepository {
  getSnapshot(actor: AuthSession): Promise<FinanceSnapshot>;
  createPrivateWorkspace(
    actor: AuthSession,
    input: CreatePrivateWorkspaceInput
  ): Promise<{ workspace: Workspace; categories: Category[] }>;
  createCategory(
    actor: AuthSession,
    input: CreateCategoryInput
  ): Promise<Category>;
  createAccount(
    actor: AuthSession,
    input: CreateAccountWithOpeningBalanceInput
  ): Promise<AccountCreationResult>;
  postTransaction(
    actor: AuthSession,
    input: CreateTransactionInput
  ): Promise<PostedTransactionResponse>;
  voidTransaction(
    actor: AuthSession,
    transactionId: string,
    input: VoidTransactionInput
  ): Promise<PostedTransactionResponse>;
  postTransfer(
    actor: AuthSession,
    input: CreateTransferInput
  ): Promise<TransferPostResult>;
  createInstallmentContract(
    actor: AuthSession,
    input: CreateInstallmentContractInput,
    clientMutationId: string
  ): Promise<InstallmentContractPostResult>;
  postInstallmentPayment(
    actor: AuthSession,
    input: InstallmentPaymentCommand
  ): Promise<InstallmentPaymentPostResult>;
  postInstallmentPayoff(
    actor: AuthSession,
    input: InstallmentPayoffCommand
  ): Promise<InstallmentPayoffPostResult>;
  createRecurringTemplate(
    actor: AuthSession,
    input: CreateRecurringTemplateInput
  ): Promise<RecurringTemplate>;
  updateRecurringTemplate(
    actor: AuthSession,
    templateId: string,
    input: UpdateRecurringTemplateInput
  ): Promise<RecurringTemplate>;
  setRecurringTemplateStatus(
    actor: AuthSession,
    templateId: string,
    status: RecurringTemplateStatus,
    version: number
  ): Promise<RecurringTemplate>;
  materializeRecurringPeriod(
    actor: AuthSession,
    input: MaterializeRecurringPeriodInput
  ): Promise<MaterializeRecurringPeriodResult>;
  getRecurringPeriod(
    actor: AuthSession,
    workspaceId: string,
    period: string
  ): Promise<RecurringPeriod>;
  updateRecurringOccurrence(
    actor: AuthSession,
    occurrenceId: string,
    input: UpdateRecurringOccurrenceInput
  ): Promise<RecurringOccurrence>;
  skipRecurringOccurrence(
    actor: AuthSession,
    occurrenceId: string,
    version: number
  ): Promise<RecurringOccurrence>;
  postRecurringOccurrence(
    actor: AuthSession,
    occurrenceId: string,
    input: PostRecurringOccurrenceInput
  ): Promise<{
    response: PostRecurringOccurrenceResult;
    replayed: boolean;
  }>;
}

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

export type TransferPostResult = Readonly<{
  response: PostedTransferResponse;
  replayed: boolean;
}>;

export type InstallmentContractResult = Readonly<{
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
    status: "active" | "paid_off";
    version: number;
  }>;
  schedule: StoredInstallmentScheduleRow[];
}>;

export type InstallmentContractPostResult = Readonly<{
  response: InstallmentContractResult;
  replayed: boolean;
}>;

export type InstallmentPaymentCommand =
  PostInstallmentPaymentInput &
    Readonly<{ expectedVersion: number }>;

export type InstallmentPaymentResponse = Readonly<{
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
  contractVersion: number;
  accountBalance: Readonly<{
    accountId: string;
    amount: string;
    currency: string;
  }>;
}>;

export type InstallmentPaymentPostResult = Readonly<{
  response: InstallmentPaymentResponse;
  replayed: boolean;
}>;

export type InstallmentPayoffCommand =
  PostInstallmentPayoffInput &
    Readonly<{ expectedVersion: number }>;

export type InstallmentPayoffResponse = Readonly<{
  payoffId: string;
  action: PostInstallmentPayoffInput["action"];
  strategy?: NonNullable<PostInstallmentPayoffInput["strategy"]>;
  principalPayment: string;
  interestDue: string;
  feesDue: string;
  reportableExpense: string;
  totalCashRequired: string;
  remainingPrincipal: string;
  interestSaved: string;
  contractStatus: "active" | "paid_off";
  contractVersion: number;
  accountBalance: Readonly<{
    accountId: string;
    amount: string;
    currency: string;
  }>;
}>;

export type InstallmentPayoffPostResult = Readonly<{
  response: InstallmentPayoffResponse;
  replayed: boolean;
}>;

type StoredWorkspace = Omit<Workspace, "role"> & {
  ownerUserId: string;
};

type StoredAccount = Account & {
  balance: string;
};

type StoredTransaction = {
  id: string;
  workspaceId: string;
  accountId: string;
  createdBy: string;
  type: TransactionType;
  amount: string;
  currency: string;
  state: TransactionState;
  version: number;
  balanceDelta: string;
  financialDate?: string;
  categoryId?: string;
  splits?: CreateTransactionInput["splits"];
  note?: string;
  tagIds?: string[];
  createdAt?: string;
};

type StoredInstallmentContract =
  InstallmentContractResult["contract"] & {
    createdBy: string;
  };

export type StoredInstallmentScheduleRow = Readonly<{
  sequence: number;
  dueDate: string;
  openingPrincipal: string;
  principal: string;
  interest: string;
  fees: string;
  total: string;
  closingPrincipal: string;
  scheduledPenalty: string;
  paidPrincipal: string;
  paidInterest: string;
  paidFees: string;
  paidPenalty: string;
  status:
    | "upcoming"
    | "partially_paid"
    | "paid"
    | "cancelled";
}>;

type DefaultCategory = Readonly<{
  slug: string;
  name: string;
  kind: CategoryKind;
}>;

export const defaultCategories: readonly DefaultCategory[] = [
  { slug: "salary", name: "เงินเดือน", kind: "income" },
  { slug: "bonus", name: "โบนัส", kind: "income" },
  { slug: "freelance", name: "งานเสริม", kind: "income" },
  { slug: "interest-income", name: "ดอกเบี้ยรับ", kind: "income" },
  { slug: "gift-income", name: "ของขวัญ", kind: "income" },
  { slug: "other-income", name: "รายรับอื่น", kind: "income" },
  { slug: "food", name: "อาหาร", kind: "expense" },
  { slug: "groceries", name: "ของใช้ในบ้าน", kind: "expense" },
  { slug: "housing", name: "ที่อยู่อาศัย", kind: "expense" },
  { slug: "utilities", name: "สาธารณูปโภค", kind: "expense" },
  { slug: "transport", name: "เดินทาง", kind: "expense" },
  { slug: "health", name: "สุขภาพ", kind: "expense" },
  { slug: "education", name: "การศึกษา", kind: "expense" },
  { slug: "shopping", name: "ช้อปปิ้ง", kind: "expense" },
  { slug: "entertainment", name: "บันเทิง", kind: "expense" },
  { slug: "debt-interest", name: "ดอกเบี้ยหนี้", kind: "expense" },
  { slug: "financial-fees", name: "ค่าธรรมเนียม", kind: "expense" },
  { slug: "other-expense", name: "รายจ่ายอื่น", kind: "expense" }
];

function normalizeCategoryName(name: string): string {
  return name.trim().toLocaleLowerCase("th-TH");
}

export function createMemoryFinanceRepository(): FinanceRepository {
  const workspaces = new Map<string, StoredWorkspace>();
  const memberships = new Map<string, Map<string, WorkspaceRole>>();
  const categories = new Map<string, Category>();
  const accounts = new Map<string, StoredAccount>();
  const transactions = new Map<string, StoredTransaction>();
  const mutationResults = new Map<string, PostedTransactionResponse>();
  const transferMutationResults = new Map<
    string,
    PostedTransferResponse
  >();
  const installmentContracts = new Map<
    string,
    StoredInstallmentContract
  >();
  const installmentSchedules = new Map<
    string,
    StoredInstallmentScheduleRow[]
  >();
  const installmentMutationResults = new Map<
    string,
    InstallmentContractResult
  >();
  const installmentPaymentMutationResults = new Map<
    string,
    InstallmentPaymentResponse
  >();
  const installmentPayoffMutationResults = new Map<
    string,
    InstallmentPayoffResponse
  >();
  const installmentPayments = new Map<
    string,
    FinanceInstallmentPayment
  >();
  const installmentPayoffs = new Map<
    string,
    FinanceInstallmentPayoff
  >();
  const recurringTemplates = new Map<string, RecurringTemplate>();
  const recurringOccurrences = new Map<string, RecurringOccurrence>();
  const recurringOccurrenceIndex = new Map<string, string>();
  const recurringPostResults = new Map<
    string,
    {
      occurrenceId: string;
      response: PostRecurringOccurrenceResult;
    }
  >();

  const repository: FinanceRepository = {
    async getSnapshot(actor) {
      const selectedWorkspace = [...workspaces.values()].find(
        (workspace) =>
          memberships.get(workspace.id)?.has(actor.userId)
      );
      if (!selectedWorkspace) {
        return {
          version: 1,
          workspace: null,
          categories: [],
          accounts: [],
          accountBalances: {},
          openingTransactions: [],
          transactions: [],
          installmentContracts: [],
          installmentSchedules: {},
          installmentPayments: [],
          installmentPayoffs: [],
          recurringTemplates: [],
          recurringOccurrences: []
        };
      }

      const workspaceId = selectedWorkspace.id;
      const role = memberships
        .get(workspaceId)!
        .get(actor.userId)!;
      const workspaceAccounts = [...accounts.values()].filter(
        (account) => account.workspaceId === workspaceId
      );
      const snapshot: FinanceSnapshot = {
        version: 1,
        workspace: {
          id: selectedWorkspace.id,
          name: selectedWorkspace.name,
          kind: selectedWorkspace.kind,
          baseCurrency: selectedWorkspace.baseCurrency,
          timeZone: selectedWorkspace.timeZone,
          role,
          version: selectedWorkspace.version
        },
        categories: [...categories.values()].filter(
          (category) => category.workspaceId === workspaceId
        ),
        accounts: workspaceAccounts.map(
          ({ balance: _balance, ...account }) => account
        ),
        accountBalances: Object.fromEntries(
          workspaceAccounts.map((account) => [
            account.id,
            {
              accountId: account.id,
              amount: account.balance,
              currency: account.currency
            }
          ])
        ),
        openingTransactions: [...transactions.values()]
          .filter(
            (transaction) =>
              transaction.workspaceId === workspaceId &&
              transaction.type === "balance_adjustment" &&
              transaction.state === "posted"
          )
          .map((transaction) => ({
            id: transaction.id,
            workspaceId: transaction.workspaceId,
            accountId: transaction.accountId,
            amount: transaction.amount,
            currency: transaction.currency,
            state: "posted" as const,
            version: 1 as const
          })),
        transactions: [...transactions.values()]
          .filter(
            (transaction) =>
              transaction.workspaceId === workspaceId &&
              transaction.type !== "balance_adjustment" &&
              transaction.state === "posted"
          )
          .map((transaction) => ({
            id: transaction.id,
            workspaceId: transaction.workspaceId,
            accountId: transaction.accountId,
            type: transaction.type as "income" | "expense",
            amount: transaction.amount,
            currency: transaction.currency,
            financialDate: transaction.financialDate!,
            ...(transaction.categoryId
              ? { categoryId: transaction.categoryId }
              : {}),
            ...(transaction.splits
              ? { splits: transaction.splits }
              : {}),
            ...(transaction.note ? { note: transaction.note } : {}),
            tagIds: transaction.tagIds ?? [],
            state: "posted" as const,
            version: 1 as const,
            createdAt: transaction.createdAt!
          })),
        installmentContracts: [...installmentContracts.values()]
          .filter((contract) => contract.workspaceId === workspaceId)
          .map(({ createdBy: _createdBy, ...contract }) => contract),
        installmentSchedules: Object.fromEntries(
          [...installmentSchedules.entries()].filter(([contractId]) =>
            installmentContracts.get(contractId)?.workspaceId ===
            workspaceId
          )
        ),
        installmentPayments: [...installmentPayments.values()].filter(
          (payment) => payment.workspaceId === workspaceId
        ),
        installmentPayoffs: [...installmentPayoffs.values()].filter(
          (payoff) => payoff.workspaceId === workspaceId
        ),
        recurringTemplates: [...recurringTemplates.values()].filter(
          (template) => template.workspaceId === workspaceId
        ),
        recurringOccurrences: [...recurringOccurrences.values()].filter(
          (occurrence) =>
            occurrence.workspaceId === workspaceId &&
            occurrence.period ===
              toFinancialDate(
                new Date().toISOString(),
                selectedWorkspace.timeZone
              ).slice(0, 7)
        )
      };
      return snapshot;
    },

    async createPrivateWorkspace(actor, input) {
      const { userId } = actor;
      const existing = [...workspaces.values()].some(
        (workspace) =>
          workspace.ownerUserId === userId && workspace.kind === "private"
      );
      if (existing) {
        throw new ApiError(
          "PRIVATE_WORKSPACE_EXISTS",
          409,
          "ผู้ใช้นี้มีพื้นที่ส่วนตัวอยู่แล้ว"
        );
      }

      const id = crypto.randomUUID();
      const stored: StoredWorkspace = {
        id,
        name: input.name,
        kind: "private",
        baseCurrency: input.baseCurrency,
        timeZone: input.timeZone,
        ownerUserId: userId,
        version: 1
      };
      workspaces.set(id, stored);
      memberships.set(id, new Map([[userId, "owner"]]));

      const seeded = defaultCategories.map<Category>((category) => {
        const result: Category = {
          id: crypto.randomUUID(),
          workspaceId: id,
          slug: category.slug,
          name: category.name,
          kind: category.kind,
          isDefault: true,
          version: 1
        };
        categories.set(result.id, result);
        return result;
      });

      return {
        workspace: {
          id: stored.id,
          name: stored.name,
          kind: stored.kind,
          baseCurrency: stored.baseCurrency,
          timeZone: stored.timeZone,
          role: "owner",
          version: stored.version
        },
        categories: seeded
      };
    },

    async createCategory(actor, input) {
      const { userId } = actor;
      const role = memberships.get(input.workspaceId)?.get(userId);
      if (role !== "owner" && role !== "editor") {
        throw new ApiError(
          "FORBIDDEN_WORKSPACE",
          403,
          "ไม่มีสิทธิ์เข้าถึงพื้นที่นี้"
        );
      }

      if (input.parentId) {
        const parent = categories.get(input.parentId);
        if (
          !parent ||
          parent.workspaceId !== input.workspaceId ||
          parent.kind !== input.kind
        ) {
          throw new ApiError(
            "VALIDATION_FAILED",
            400,
            "หมวดหมู่หลักไม่ถูกต้อง"
          );
        }
      }

      const normalizedName = normalizeCategoryName(input.name);
      const duplicate = [...categories.values()].some(
        (category) =>
          category.workspaceId === input.workspaceId &&
          category.kind === input.kind &&
          category.parentId === input.parentId &&
          normalizeCategoryName(category.name) === normalizedName
      );
      if (duplicate) {
        throw new ApiError(
          "CATEGORY_NAME_EXISTS",
          409,
          "มีชื่อหมวดหมู่นี้อยู่แล้ว"
        );
      }

      const id = crypto.randomUUID();
      const category: Category = {
        id,
        workspaceId: input.workspaceId,
        parentId: input.parentId,
        slug: `custom-${id}`,
        name: input.name,
        kind: input.kind,
        isDefault: false,
        version: 1
      };
      categories.set(id, category);
      return category;
    },

    async createAccount(actor, input) {
      const { userId } = actor;
      const role = memberships.get(input.workspaceId)?.get(userId);
      if (role !== "owner" && role !== "editor") {
        throw new ApiError(
          "FORBIDDEN_WORKSPACE",
          403,
          "ไม่มีสิทธิ์เข้าถึงพื้นที่นี้"
        );
      }

      const id = crypto.randomUUID();
      const openingBalance = roundMoney(
        input.openingBalance,
        input.currency
      );
      const account: Account = {
        id,
        workspaceId: input.workspaceId,
        name: input.name,
        type: input.type,
        currency: input.currency,
        institution: input.institution,
        version: 1
      };
      accounts.set(id, { ...account, balance: openingBalance });

      const result: AccountCreationResult = {
        account,
        accountBalance: {
          accountId: id,
          amount: openingBalance,
          currency: input.currency
        }
      };

      if (!parseMoney({
        amount: openingBalance,
        currency: input.currency
      }).isZero()) {
        const transactionId = crypto.randomUUID();
        transactions.set(transactionId, {
          id: transactionId,
          workspaceId: input.workspaceId,
          accountId: id,
          createdBy: userId,
          type: "balance_adjustment",
          amount: openingBalance,
          currency: input.currency,
          state: "posted",
          version: 1,
          balanceDelta: openingBalance
        });
        return {
          ...result,
          openingTransaction: {
            transactionId,
            state: "posted",
            version: 1
          }
        };
      }

      return result;
    },

    async postTransaction(actor, input) {
      const { userId } = actor;
      const mutationKey = `${userId}:${input.clientMutationId}`;
      const existing = mutationResults.get(mutationKey);
      if (existing) {
        return existing;
      }

      const role = memberships.get(input.workspaceId)?.get(userId);
      const account = accounts.get(input.accountId);
      if (
        (role !== "owner" && role !== "editor") ||
        !account ||
        account.workspaceId !== input.workspaceId
      ) {
        throw new ApiError(
          "FORBIDDEN_WORKSPACE",
          403,
          "ไม่มีสิทธิ์เข้าถึงพื้นที่นี้"
        );
      }
      if (account.currency !== input.currency) {
        throw new ApiError(
          "VALIDATION_FAILED",
          400,
          "สกุลเงินของรายการไม่ตรงกับบัญชี"
        );
      }

      try {
        validateSplits(
          { amount: input.amount, currency: input.currency },
          input.splits ?? []
        );
      } catch {
        throw new ApiError(
          "VALIDATION_FAILED",
          400,
          "ยอดรวมรายการย่อยไม่ตรงกับยอดรายการ"
        );
      }

      const categoryIds = input.splits
        ? input.splits.map((split) => split.categoryId)
        : [input.categoryId!];
      const categoriesAreValid = categoryIds.every((categoryId) => {
        const category = categories.get(categoryId);
        return (
          category?.workspaceId === input.workspaceId &&
          category.kind === input.type
        );
      });
      if (!categoriesAreValid) {
        throw new ApiError(
          "VALIDATION_FAILED",
          400,
          "หมวดหมู่ไม่ตรงกับประเภทรายการ"
        );
      }

      const amount = roundMoney(input.amount, input.currency);
      const value = parseMoney({
        amount,
        currency: input.currency
      });
      const liability =
        account.type === "credit_card" || account.type === "loan";
      const balanceDelta =
        input.type === "expense"
          ? liability
            ? value
            : value.negated()
          : liability
            ? value.negated()
            : value;
      const nextBalance = roundMoney(
        parseMoney({
          amount: account.balance,
          currency: account.currency
        }).plus(balanceDelta),
        account.currency
      );

      const transactionId = crypto.randomUUID();
      accounts.set(account.id, { ...account, balance: nextBalance });
      transactions.set(transactionId, {
        id: transactionId,
        workspaceId: input.workspaceId,
        accountId: input.accountId,
        createdBy: userId,
        type: input.type,
        amount,
        currency: input.currency,
        financialDate: input.financialDate,
        ...(input.categoryId
          ? { categoryId: input.categoryId }
          : {}),
        ...(input.splits ? { splits: input.splits } : {}),
        ...(input.note ? { note: input.note } : {}),
        tagIds: input.tagIds,
        createdAt: new Date().toISOString(),
        state: "posted",
        version: 1,
        balanceDelta: roundMoney(balanceDelta, input.currency)
      });

      const response: PostedTransactionResponse = {
        transactionId,
        version: 1,
        state: "posted",
        accountBalances: [
          {
            accountId: account.id,
            amount: nextBalance,
            currency: account.currency
          }
        ]
      };
      mutationResults.set(mutationKey, response);
      return response;
    },

    async voidTransaction(actor, transactionId, input) {
      const { userId } = actor;
      const transaction = transactions.get(transactionId);
      if (!transaction) {
        throw new ApiError(
          "FORBIDDEN_WORKSPACE",
          403,
          "ไม่มีสิทธิ์เข้าถึงรายการนี้"
        );
      }
      const role = memberships
        .get(transaction.workspaceId)
        ?.get(userId);
      if (role !== "owner" && role !== "editor") {
        throw new ApiError(
          "FORBIDDEN_WORKSPACE",
          403,
          "ไม่มีสิทธิ์เข้าถึงรายการนี้"
        );
      }
      if (
        transaction.version !== input.version ||
        transaction.state !== "posted"
      ) {
        throw new ApiError(
          "STALE_VERSION",
          409,
          "รายการถูกแก้ไขแล้ว กรุณาโหลดข้อมูลใหม่"
        );
      }

      const account = accounts.get(transaction.accountId);
      if (!account) {
        throw new ApiError(
          "INTERNAL_ERROR",
          500,
          "ไม่พบบัญชีของรายการ"
        );
      }
      const nextBalance = roundMoney(
        parseMoney({
          amount: account.balance,
          currency: account.currency
        }).minus(transaction.balanceDelta),
        account.currency
      );
      accounts.set(account.id, { ...account, balance: nextBalance });
      transactions.set(transaction.id, {
        ...transaction,
        state: "void",
        version: transaction.version + 1
      });

      return {
        transactionId,
        version: transaction.version + 1,
        state: "void",
        accountBalances: [
          {
            accountId: account.id,
            amount: nextBalance,
            currency: account.currency
          }
        ]
      };
    },

    async postTransfer(actor, input) {
      const { userId } = actor;
      const mutationKey = `${userId}:${input.clientMutationId}`;
      const existing = transferMutationResults.get(mutationKey);
      if (existing) {
        return { response: existing, replayed: true };
      }

      const role = memberships.get(input.workspaceId)?.get(userId);
      const source = accounts.get(input.sourceAccountId);
      const destination = accounts.get(input.destinationAccountId);
      if (
        (role !== "owner" && role !== "editor") ||
        !source ||
        !destination ||
        source.workspaceId !== input.workspaceId ||
        destination.workspaceId !== input.workspaceId
      ) {
        throw new ApiError(
          "FORBIDDEN_WORKSPACE",
          403,
          "ไม่มีสิทธิ์เข้าถึงบัญชีสำหรับการโอน"
        );
      }
      if (
        source.id === destination.id ||
        source.currency !== input.sourceCurrency ||
        destination.currency !== input.destinationCurrency
      ) {
        throw new ApiError(
          "VALIDATION_FAILED",
          400,
          "ข้อมูลบัญชีหรือสกุลเงินไม่ถูกต้อง"
        );
      }

      const sourceAmount = parseMoney({
        amount: input.sourceAmount,
        currency: input.sourceCurrency
      });
      const destinationAmount = parseMoney({
        amount: input.destinationAmount,
        currency: input.destinationCurrency
      });
      if (
        input.sourceCurrency === input.destinationCurrency &&
        !sourceAmount.equals(destinationAmount)
      ) {
        throw new ApiError(
          "VALIDATION_FAILED",
          400,
          "ยอดโอนสกุลเดียวกันต้องเท่ากัน"
        );
      }
      if (
        input.sourceCurrency !== input.destinationCurrency &&
        (!input.exchangeRate ||
          !parseMoney({
            amount: input.exchangeRate,
            currency: input.destinationCurrency
          }).greaterThan(0))
      ) {
        throw new ApiError(
          "VALIDATION_FAILED",
          400,
          "ต้องระบุอัตราแลกเปลี่ยนที่มากกว่าศูนย์"
        );
      }

      const feeAmount = parseMoney({
        amount: input.feeAmount,
        currency: input.sourceCurrency
      });
      if (feeAmount.isNegative()) {
        throw new ApiError(
          "VALIDATION_FAILED",
          400,
          "ค่าธรรมเนียมต้องไม่ติดลบ"
        );
      }
      if (!feeAmount.isZero()) {
        const feeCategory = input.feeCategoryId
          ? categories.get(input.feeCategoryId)
          : undefined;
        if (
          !feeCategory ||
          feeCategory.workspaceId !== input.workspaceId ||
          feeCategory.kind !== "expense"
        ) {
          throw new ApiError(
            "VALIDATION_FAILED",
            400,
            "หมวดหมู่ค่าธรรมเนียมไม่ถูกต้อง"
          );
        }
      }

      const sourceLiability =
        source.type === "credit_card" || source.type === "loan";
      const destinationLiability =
        destination.type === "credit_card" ||
        destination.type === "loan";
      const sourceDelta = sourceLiability
        ? sourceAmount.plus(feeAmount)
        : sourceAmount.plus(feeAmount).negated();
      const destinationDelta = destinationLiability
        ? destinationAmount.negated()
        : destinationAmount;
      const sourceBalance = roundMoney(
        parseMoney({
          amount: source.balance,
          currency: source.currency
        }).plus(sourceDelta),
        source.currency
      );
      const destinationBalance = roundMoney(
        parseMoney({
          amount: destination.balance,
          currency: destination.currency
        }).plus(destinationDelta),
        destination.currency
      );

      accounts.set(source.id, {
        ...source,
        balance: sourceBalance
      });
      accounts.set(destination.id, {
        ...destination,
        balance: destinationBalance
      });

      if (!feeAmount.isZero()) {
        const feeTransactionId = crypto.randomUUID();
        transactions.set(feeTransactionId, {
          id: feeTransactionId,
          workspaceId: input.workspaceId,
          accountId: source.id,
          createdBy: userId,
          type: "expense",
          amount: roundMoney(feeAmount, source.currency),
          currency: source.currency,
          financialDate: input.financialDate,
          ...(input.feeCategoryId
            ? { categoryId: input.feeCategoryId }
            : {}),
          ...(input.note ? { note: input.note } : {}),
          tagIds: [],
          createdAt: new Date().toISOString(),
          state: "posted",
          version: 1,
          balanceDelta: roundMoney(
            sourceLiability ? feeAmount : feeAmount.negated(),
            source.currency
          )
        });
      }

      const transferId = crypto.randomUUID();
      const reportEffect = transferReportEffect({
        source: {
          amount: input.sourceAmount,
          currency: input.sourceCurrency
        },
        destination: {
          amount: input.destinationAmount,
          currency: input.destinationCurrency
        },
        fee: {
          amount: input.feeAmount,
          currency: input.sourceCurrency
        }
      });
      const response: PostedTransferResponse = {
        transferId,
        state: "posted",
        reportEffect,
        accountBalances: [
          {
            accountId: source.id,
            amount: sourceBalance,
            currency: source.currency
          },
          {
            accountId: destination.id,
            amount: destinationBalance,
            currency: destination.currency
          }
        ]
      };
      transferMutationResults.set(mutationKey, response);
      return { response, replayed: false };
    },

    async createInstallmentContract(
      actor,
      input,
      clientMutationId
    ) {
      const { userId } = actor;
      const mutationKey = `${userId}:${clientMutationId}`;
      const existing = installmentMutationResults.get(mutationKey);
      if (existing) {
        return { response: existing, replayed: true };
      }

      const role = memberships.get(input.workspaceId)?.get(userId);
      if (role !== "owner" && role !== "editor") {
        throw new ApiError(
          "FORBIDDEN_WORKSPACE",
          403,
          "ไม่มีสิทธิ์เข้าถึงพื้นที่นี้"
        );
      }
      const duplicate = [...installmentContracts.values()].some(
        (contract) =>
          contract.workspaceId === input.workspaceId &&
          contract.status === "active" &&
          contract.name.trim().toLocaleLowerCase("th-TH") ===
            input.name.trim().toLocaleLowerCase("th-TH")
      );
      if (duplicate) {
        throw new ApiError(
          "VALIDATION_FAILED",
          409,
          "มีสัญญาที่ยังใช้งานชื่อนี้อยู่แล้ว"
        );
      }
      if (input.fundingAccountId) {
        const account = accounts.get(input.fundingAccountId);
        if (
          !account ||
          account.workspaceId !== input.workspaceId ||
          account.currency !== input.currency
        ) {
          throw new ApiError(
            "VALIDATION_FAILED",
            400,
            "บัญชีของสัญญาไม่ถูกต้อง"
          );
        }
      }
      for (const categoryId of [
        input.expenseCategoryId,
        input.interestCategoryId
      ]) {
        if (!categoryId) {
          continue;
        }
        const category = categories.get(categoryId);
        if (
          !category ||
          category.workspaceId !== input.workspaceId ||
          category.kind !== "expense"
        ) {
          throw new ApiError(
            "VALIDATION_FAILED",
            400,
            "หมวดหมู่ของสัญญาไม่ถูกต้อง"
          );
        }
      }

      const originalPrincipal = parseMoney({
        amount: input.originalPrincipal,
        currency: input.currency
      });
      const downPayment = parseMoney({
        amount: input.downPayment,
        currency: input.currency
      });
      if (downPayment.greaterThan(originalPrincipal)) {
        throw new ApiError(
          "VALIDATION_FAILED",
          400,
          "เงินดาวน์ต้องไม่เกินเงินต้นเดิม"
        );
      }
      const financedPrincipal = roundMoney(
        originalPrincipal.minus(downPayment),
        input.currency
      );
      if (
        !parseMoney({
          amount: financedPrincipal,
          currency: input.currency
        }).greaterThan(0)
      ) {
        throw new ApiError(
          "VALIDATION_FAILED",
          400,
          "เงินต้นที่นำไปผ่อนต้องมากกว่าศูนย์"
        );
      }

      const generated =
        input.interestMethod === "manual"
          ? generateManualInstallmentSchedule({
              principal: financedPrincipal,
              currency: input.currency,
              rows: input.manualRows ?? []
            })
          : generateInstallmentSchedule({
              principal: financedPrincipal,
              financedFees: input.financedFees,
              currency: input.currency,
              interestMethod: input.interestMethod,
              annualRate: input.annualRate,
              periods: input.periods,
              firstDueDate: input.firstDueDate
            });
      const schedule: StoredInstallmentScheduleRow[] =
        generated.map((row) => ({
          ...row,
          scheduledPenalty: roundMoney("0", input.currency),
          paidPrincipal: roundMoney("0", input.currency),
          paidInterest: roundMoney("0", input.currency),
          paidFees: roundMoney("0", input.currency),
          paidPenalty: roundMoney("0", input.currency),
          status: "upcoming"
        }));
      const id = crypto.randomUUID();
      const contract: StoredInstallmentContract = {
        id,
        workspaceId: input.workspaceId,
        name: input.name,
        kind: input.kind,
        ...(input.creditor ? { creditor: input.creditor } : {}),
        originalPrincipal: roundMoney(
          input.originalPrincipal,
          input.currency
        ),
        downPayment: roundMoney(
          input.downPayment,
          input.currency
        ),
        financedPrincipal,
        financedFees: roundMoney(
          input.financedFees,
          input.currency
        ),
        currency: input.currency,
        interestMethod: input.interestMethod,
        annualRate: input.annualRate,
        periods: input.periods,
        firstDueDate: input.firstDueDate,
        ...(input.fundingAccountId
          ? { fundingAccountId: input.fundingAccountId }
          : {}),
        ...(input.expenseCategoryId
          ? { expenseCategoryId: input.expenseCategoryId }
          : {}),
        ...(input.interestCategoryId
          ? { interestCategoryId: input.interestCategoryId }
          : {}),
        status: "active",
        version: 1,
        createdBy: userId
      };
      installmentContracts.set(id, contract);
      installmentSchedules.set(id, schedule);
      const response: InstallmentContractResult = {
        contract,
        schedule
      };
      installmentMutationResults.set(mutationKey, response);
      return { response, replayed: false };
    },

    async postInstallmentPayment(actor, input) {
      const { userId } = actor;
      const mutationKey = `${userId}:${input.clientMutationId}`;
      const existing =
        installmentPaymentMutationResults.get(mutationKey);
      if (existing) {
        return { response: existing, replayed: true };
      }
      const role = memberships.get(input.workspaceId)?.get(userId);
      const contract = installmentContracts.get(input.contractId);
      const account = accounts.get(input.accountId);
      if (
        (role !== "owner" && role !== "editor") ||
        !contract ||
        contract.workspaceId !== input.workspaceId ||
        contract.status !== "active" ||
        !account ||
        account.workspaceId !== input.workspaceId
      ) {
        throw new ApiError(
          "FORBIDDEN_WORKSPACE",
          403,
          "ไม่มีสิทธิ์ชำระสัญญานี้"
        );
      }
      if (contract.version !== input.expectedVersion) {
        throw new ApiError(
          "STALE_VERSION",
          409,
          "สัญญาถูกแก้ไขแล้ว กรุณาโหลดข้อมูลใหม่"
        );
      }
      if (
        account.currency !== input.currency ||
        contract.currency !== input.currency ||
        !normalizeAccountKind(account.type).liquid
      ) {
        throw new ApiError(
          "VALIDATION_FAILED",
          400,
          "บัญชีหรือสกุลเงินไม่ถูกต้อง"
        );
      }
      const schedule = installmentSchedules.get(contract.id) ?? [];
      const row = schedule.find(
        (candidate) => candidate.sequence === input.sequence
      );
      if (
        !row ||
        row.status === "paid" ||
        row.status === "cancelled"
      ) {
        throw new ApiError(
          "VALIDATION_FAILED",
          400,
          "งวดนี้ไม่สามารถชำระได้"
        );
      }
      const paymentAmount = parseMoney({
        amount: input.amount,
        currency: input.currency
      });
      const balance = parseMoney({
        amount: account.balance,
        currency: account.currency
      });
      if (balance.lessThan(paymentAmount)) {
        throw new ApiError(
          "INSUFFICIENT_BALANCE",
          409,
          "ยอดเงินในบัญชีไม่เพียงพอ"
        );
      }
      const scheduledPenalty = roundMoney(
        parseMoney({
          amount: row.scheduledPenalty,
          currency: input.currency
        }).plus(
          parseMoney({
            amount: input.penaltyAmount,
            currency: input.currency
          })
        ),
        input.currency
      );
      const allocation = allocateInstallmentPayment({
        currency: input.currency,
        amount: input.amount,
        scheduledPrincipal: row.principal,
        scheduledInterest: row.interest,
        scheduledFees: row.fees,
        scheduledPenalty,
        paidPrincipal: row.paidPrincipal,
        paidInterest: row.paidInterest,
        paidFees: row.paidFees,
        paidPenalty: row.paidPenalty
      });
      const add = (current: string, amount: string) =>
        roundMoney(
          parseMoney({
            amount: current,
            currency: input.currency
          }).plus(
            parseMoney({
              amount,
              currency: input.currency
            })
          ),
          input.currency
        );
      const updatedRow: StoredInstallmentScheduleRow = {
        ...row,
        scheduledPenalty,
        paidPrincipal: add(
          row.paidPrincipal,
          allocation.allocation.principal
        ),
        paidInterest: add(
          row.paidInterest,
          allocation.allocation.interest
        ),
        paidFees: add(
          row.paidFees,
          allocation.allocation.fees
        ),
        paidPenalty: add(
          row.paidPenalty,
          allocation.allocation.penalty
        ),
        status: allocation.status
      };
      const updatedSchedule = schedule.map((candidate) =>
        candidate.sequence === row.sequence
          ? updatedRow
          : candidate
      );
      const contractStatus = updatedSchedule.every(
        (candidate) =>
          candidate.status === "paid" ||
          candidate.status === "cancelled"
      )
        ? "paid_off"
        : "active";
      const contractVersion = contract.version + 1;
      const accountBalance = {
        accountId: account.id,
        amount: roundMoney(
          balance.minus(paymentAmount),
          account.currency
        ),
        currency: account.currency
      };
      const paymentId = crypto.randomUUID();
      const response: InstallmentPaymentResponse = {
        paymentId,
        allocation: allocation.allocation,
        reportableExpense: allocation.reportableExpense,
        scheduleStatus: allocation.status,
        contractStatus,
        contractVersion,
        accountBalance
      };
      accounts.set(account.id, {
        ...account,
        balance: accountBalance.amount
      });
      installmentContracts.set(contract.id, {
        ...contract,
        status: contractStatus,
        version: contractVersion
      });
      installmentSchedules.set(contract.id, updatedSchedule);
      installmentPaymentMutationResults.set(
        mutationKey,
        response
      );
      installmentPayments.set(paymentId, {
        id: paymentId,
        workspaceId: input.workspaceId,
        contractId: input.contractId,
        sequence: input.sequence,
        accountId: input.accountId,
        amount: roundMoney(input.amount, input.currency),
        currency: input.currency,
        financialDate: input.financialDate,
        penaltyAssessed: roundMoney(
          input.penaltyAmount,
          input.currency
        ),
        allocatedPenalty: allocation.allocation.penalty,
        allocatedFees: allocation.allocation.fees,
        allocatedInterest: allocation.allocation.interest,
        allocatedPrincipal: allocation.allocation.principal,
        reportableExpense: allocation.reportableExpense,
        ...(input.note ? { note: input.note } : {}),
        clientMutationId: input.clientMutationId,
        createdAt: new Date().toISOString()
      });
      return { response, replayed: false };
    },

    async postInstallmentPayoff(actor, input) {
      const { userId } = actor;
      const mutationKey = `${userId}:${input.clientMutationId}`;
      const existing =
        installmentPayoffMutationResults.get(mutationKey);
      if (existing) {
        return { response: existing, replayed: true };
      }
      const role = memberships.get(input.workspaceId)?.get(userId);
      const contract = installmentContracts.get(input.contractId);
      const account = accounts.get(input.accountId);
      if (
        (role !== "owner" && role !== "editor") ||
        !contract ||
        contract.workspaceId !== input.workspaceId ||
        contract.status !== "active" ||
        !account ||
        account.workspaceId !== input.workspaceId
      ) {
        throw new ApiError(
          "FORBIDDEN_WORKSPACE",
          403,
          "ไม่มีสิทธิ์ปิดยอดสัญญานี้"
        );
      }
      if (contract.version !== input.expectedVersion) {
        throw new ApiError(
          "STALE_VERSION",
          409,
          "สัญญาถูกแก้ไขแล้ว กรุณาโหลดข้อมูลใหม่"
        );
      }
      if (
        account.currency !== input.currency ||
        contract.currency !== input.currency ||
        !normalizeAccountKind(account.type).liquid
      ) {
        throw new ApiError(
          "VALIDATION_FAILED",
          400,
          "บัญชีหรือสกุลเงินไม่ถูกต้อง"
        );
      }
      const schedule = installmentSchedules.get(contract.id) ?? [];
      const payableRows = schedule.filter(
        (row) =>
          row.status !== "paid" && row.status !== "cancelled"
      );
      const remaining = (
        scheduled: string,
        paid: string
      ) =>
        roundMoney(
          parseMoney({
            amount: scheduled,
            currency: input.currency
          }).minus(
            parseMoney({
              amount: paid,
              currency: input.currency
            })
          ),
          input.currency
        );
      const unpaidRows = payableRows.map((row) => ({
        sequence: row.sequence,
        dueDate: row.dueDate,
        principal: remaining(row.principal, row.paidPrincipal),
        interest: remaining(row.interest, row.paidInterest),
        fees: remaining(row.fees, row.paidFees),
        penalty: remaining(
          row.scheduledPenalty,
          row.paidPenalty
        )
      }));
      const remainingPrincipal = roundMoney(
        unpaidRows.reduce(
          (total, row) =>
            total.plus(
              parseMoney({
                amount: row.principal,
                currency: input.currency
              })
            ),
          parseMoney({ amount: "0", currency: input.currency })
        ),
        input.currency
      );
      if (
        remainingPrincipal !==
        roundMoney(
          input.expectedRemainingPrincipal,
          input.currency
        )
      ) {
        throw new ApiError(
          "STALE_VERSION",
          409,
          "ยอดเงินต้นเปลี่ยนแล้ว กรุณาขอใบเสนอใหม่"
        );
      }
      const simulation = simulateInstallmentPayoff({
        action: input.action,
        ...(input.strategy ? { strategy: input.strategy } : {}),
        ...(input.extraPrincipal
          ? { extraPrincipal: input.extraPrincipal }
          : {}),
        currency: input.currency,
        interestMethod: contract.interestMethod,
        annualRate: contract.annualRate,
        paymentDate: input.financialDate,
        remainingPrincipal,
        quotedInterest: input.quotedInterest,
        quotedFees: input.quotedFees,
        unpaidRows
      });
      const cashRequired = parseMoney({
        amount: simulation.totalCashRequired,
        currency: input.currency
      });
      const balance = parseMoney({
        amount: account.balance,
        currency: account.currency
      });
      if (balance.lessThan(cashRequired)) {
        throw new ApiError(
          "INSUFFICIENT_BALANCE",
          409,
          "ยอดเงินในบัญชีไม่เพียงพอ"
        );
      }
      const regenerated: StoredInstallmentScheduleRow[] =
        simulation.regeneratedRows.map((row) => ({
          ...row,
          scheduledPenalty: roundMoney("0", input.currency),
          paidPrincipal: roundMoney("0", input.currency),
          paidInterest: roundMoney("0", input.currency),
          paidFees: roundMoney("0", input.currency),
          paidPenalty: roundMoney("0", input.currency),
          status: "upcoming"
        }));
      const updatedSchedule =
        input.action === "payoff"
          ? schedule.map((row) =>
              payableRows.some(
                (payable) => payable.sequence === row.sequence
              )
                ? { ...row, status: "cancelled" as const }
                : row
            )
          : [
              ...schedule.filter(
                (row) =>
                  !payableRows.some(
                    (payable) =>
                      payable.sequence === row.sequence
                  )
              ),
              ...regenerated
            ].sort((left, right) => left.sequence - right.sequence);
      const contractStatus =
        input.action === "payoff" ? "paid_off" : "active";
      const contractVersion = contract.version + 1;
      const accountBalance = {
        accountId: account.id,
        amount: roundMoney(
          balance.minus(cashRequired),
          account.currency
        ),
        currency: account.currency
      };
      const reportableExpense = roundMoney(
        parseMoney({
          amount: simulation.interestDue,
          currency: input.currency
        }).plus(
          parseMoney({
            amount: simulation.feesDue,
            currency: input.currency
          })
        ),
        input.currency
      );
      const payoffId = crypto.randomUUID();
      const response: InstallmentPayoffResponse = {
        payoffId,
        action: input.action,
        ...(input.strategy ? { strategy: input.strategy } : {}),
        principalPayment: simulation.principalPayment,
        interestDue: simulation.interestDue,
        feesDue: simulation.feesDue,
        reportableExpense,
        totalCashRequired: simulation.totalCashRequired,
        remainingPrincipal: simulation.remainingPrincipal,
        interestSaved: simulation.interestSaved,
        contractStatus,
        contractVersion,
        accountBalance
      };
      accounts.set(account.id, {
        ...account,
        balance: accountBalance.amount
      });
      installmentContracts.set(contract.id, {
        ...contract,
        status: contractStatus,
        version: contractVersion
      });
      installmentSchedules.set(contract.id, updatedSchedule);
      installmentPayoffMutationResults.set(mutationKey, response);
      installmentPayoffs.set(payoffId, {
        id: payoffId,
        workspaceId: input.workspaceId,
        contractId: input.contractId,
        accountId: input.accountId,
        action: input.action,
        ...(input.strategy ? { strategy: input.strategy } : {}),
        expectedRemainingPrincipal: roundMoney(
          input.expectedRemainingPrincipal,
          input.currency
        ),
        ...(input.extraPrincipal
          ? {
              extraPrincipal: roundMoney(
                input.extraPrincipal,
                input.currency
              )
            }
          : {}),
        quotedInterest: roundMoney(
          input.quotedInterest,
          input.currency
        ),
        quotedFees: roundMoney(input.quotedFees, input.currency),
        principalPayment: simulation.principalPayment,
        interestDue: simulation.interestDue,
        feesDue: simulation.feesDue,
        totalCashRequired: simulation.totalCashRequired,
        remainingPrincipal: simulation.remainingPrincipal,
        interestSaved: simulation.interestSaved,
        currency: input.currency,
        financialDate: input.financialDate,
        priorRows: payableRows,
        regeneratedRows: regenerated,
        ...(input.note ? { note: input.note } : {}),
        clientMutationId: input.clientMutationId,
        createdAt: new Date().toISOString()
      });
      return { response, replayed: false };
    },

    async createRecurringTemplate(actor, input) {
      const role = memberships.get(input.workspaceId)?.get(actor.userId);
      if (role !== "owner" && role !== "editor") {
        throw new ApiError(
          "FORBIDDEN_WORKSPACE",
          403,
          "ไม่มีสิทธิ์เข้าถึงพื้นที่นี้"
        );
      }
      validateRecurringDestination(input);

      const template: RecurringTemplate = {
        ...input,
        id: crypto.randomUUID(),
        amount: roundMoney(input.amount, input.currency),
        status: "active",
        version: 1
      };
      recurringTemplates.set(template.id, template);
      return template;
    },

    async updateRecurringTemplate(actor, templateId, input) {
      const template = requireRecurringTemplate(actor, templateId);
      if (
        template.version !== input.version ||
        template.status === "cancelled"
      ) {
        throw staleRecurring();
      }
      validateRecurringDestination({
        workspaceId: template.workspaceId,
        ...input
      });

      const { version: _version, ...values } = input;
      const updated: RecurringTemplate = {
        ...template,
        ...values,
        amount: roundMoney(input.amount, input.currency),
        version: template.version + 1
      };
      const workspace = workspaces.get(template.workspaceId)!;
      const period = currentWorkspacePeriod(workspace);
      const occurrenceId = recurringOccurrenceIndex.get(
        `${template.id}:${period}`
      );
      const occurrence = occurrenceId
        ? recurringOccurrences.get(occurrenceId)
        : undefined;
      if (occurrence?.status === "pending") {
        recurringOccurrences.set(occurrence.id, {
          ...occurrence,
          name: updated.name,
          kind: updated.kind,
          amount: updated.amount,
          currency: updated.currency,
          accountId: updated.accountId,
          categoryId: updated.categoryId,
          scheduledDate: resolveRecurringDate(
            period,
            updated.dayOfMonth
          ),
          version: occurrence.version + 1
        });
      }
      recurringTemplates.set(template.id, updated);
      return updated;
    },

    async setRecurringTemplateStatus(
      actor,
      templateId,
      status,
      version
    ) {
      const template = requireRecurringTemplate(actor, templateId);
      const allowed =
        (template.status === "active" && status === "paused") ||
        (template.status === "paused" && status === "active") ||
        ((template.status === "active" ||
          template.status === "paused") &&
          status === "cancelled");
      if (template.version !== version || !allowed) {
        throw staleRecurring();
      }

      const updated = {
        ...template,
        status,
        version: template.version + 1
      };
      recurringTemplates.set(template.id, updated);
      return updated;
    },

    async materializeRecurringPeriod(actor, input) {
      const role = memberships
        .get(input.workspaceId)
        ?.get(actor.userId);
      const workspace = workspaces.get(input.workspaceId);
      if (
        (role !== "owner" && role !== "editor") ||
        !workspace
      ) {
        throw new ApiError(
          "FORBIDDEN_WORKSPACE",
          403,
          "ไม่มีสิทธิ์เข้าถึงพื้นที่นี้"
        );
      }
      if (input.period !== currentWorkspacePeriod(workspace)) {
        throw new ApiError(
          "VALIDATION_FAILED",
          400,
          "สร้างรายการประจำได้เฉพาะเดือนปัจจุบัน"
        );
      }

      let createdCount = 0;
      let existingCount = 0;
      for (const template of recurringTemplates.values()) {
        if (
          template.workspaceId !== input.workspaceId ||
          template.status !== "active" ||
          template.startMonth > input.period ||
          (template.endMonth !== undefined &&
            template.endMonth < input.period)
        ) {
          continue;
        }
        const indexKey = `${template.id}:${input.period}`;
        if (recurringOccurrenceIndex.has(indexKey)) {
          existingCount += 1;
          continue;
        }

        const occurrence: RecurringOccurrence = {
          id: crypto.randomUUID(),
          workspaceId: template.workspaceId,
          templateId: template.id,
          name: template.name,
          kind: template.kind,
          period: input.period,
          scheduledDate: resolveRecurringDate(
            input.period,
            template.dayOfMonth
          ),
          amount: template.amount,
          currency: template.currency,
          accountId: template.accountId,
          categoryId: template.categoryId,
          status: "pending",
          version: 1
        };
        recurringOccurrences.set(occurrence.id, occurrence);
        recurringOccurrenceIndex.set(indexKey, occurrence.id);
        createdCount += 1;
      }
      return { createdCount, existingCount };
    },

    async getRecurringPeriod(actor, workspaceId, period) {
      if (!memberships.get(workspaceId)?.has(actor.userId)) {
        throw new ApiError(
          "FORBIDDEN_WORKSPACE",
          403,
          "ไม่มีสิทธิ์เข้าถึงพื้นที่นี้"
        );
      }
      return {
        period,
        occurrences: [...recurringOccurrences.values()]
          .filter(
            (occurrence) =>
              occurrence.workspaceId === workspaceId &&
              occurrence.period === period
          )
          .sort(
            (left, right) =>
              left.scheduledDate.localeCompare(right.scheduledDate) ||
              left.name.localeCompare(right.name, "th")
          )
      };
    },

    async updateRecurringOccurrence(actor, occurrenceId, input) {
      const occurrence = requireRecurringOccurrence(actor, occurrenceId);
      if (
        occurrence.version !== input.version ||
        occurrence.status !== "pending"
      ) {
        throw staleRecurring();
      }
      if (!input.scheduledDate.startsWith(`${occurrence.period}-`)) {
        throw new ApiError(
          "VALIDATION_FAILED",
          400,
          "วันที่ต้องอยู่ในเดือนของรายการ"
        );
      }

      const updated = {
        ...occurrence,
        amount: roundMoney(input.amount, occurrence.currency),
        scheduledDate: input.scheduledDate,
        version: occurrence.version + 1
      };
      recurringOccurrences.set(occurrence.id, updated);
      return updated;
    },

    async skipRecurringOccurrence(actor, occurrenceId, version) {
      const occurrence = requireRecurringOccurrence(actor, occurrenceId);
      if (
        occurrence.version !== version ||
        occurrence.status !== "pending"
      ) {
        throw staleRecurring();
      }

      const updated: RecurringOccurrence = {
        ...occurrence,
        status: "skipped",
        version: occurrence.version + 1
      };
      recurringOccurrences.set(occurrence.id, updated);
      return updated;
    },

    async postRecurringOccurrence(actor, occurrenceId, input) {
      const mutationKey = `${actor.userId}:${input.clientMutationId}`;
      const replay = recurringPostResults.get(mutationKey);
      if (replay) {
        if (replay.occurrenceId !== occurrenceId) {
          throw new ApiError(
            "DUPLICATE_MUTATION",
            409,
            "รหัสคำขอนี้ถูกใช้กับรายการอื่นแล้ว"
          );
        }
        return { response: replay.response, replayed: true };
      }

      const occurrence = requireRecurringOccurrence(actor, occurrenceId);
      if (
        occurrence.version !== input.version ||
        occurrence.status !== "pending"
      ) {
        throw staleRecurring();
      }
      const transaction = await repository.postTransaction(actor, {
        workspaceId: occurrence.workspaceId,
        accountId: occurrence.accountId,
        type: occurrence.kind,
        amount: occurrence.amount,
        currency: occurrence.currency,
        financialDate: occurrence.scheduledDate,
        categoryId: occurrence.categoryId,
        note: `รายการประจำ: ${occurrence.name}`,
        tagIds: [],
        clientMutationId: input.clientMutationId
      });
      const posted: RecurringOccurrence = {
        ...occurrence,
        status: "posted",
        transactionId: transaction.transactionId,
        version: occurrence.version + 1
      };
      recurringOccurrences.set(occurrence.id, posted);
      const response = { occurrence: posted, transaction };
      recurringPostResults.set(mutationKey, {
        occurrenceId,
        response
      });
      return { response, replayed: false };
    }
  };
  return repository;

  function currentWorkspacePeriod(workspace: StoredWorkspace): string {
    return toFinancialDate(
      new Date().toISOString(),
      workspace.timeZone
    ).slice(0, 7);
  }

  function staleRecurring(): ApiError {
    return new ApiError(
      "STALE_VERSION",
      409,
      "รายการถูกแก้ไขแล้ว กรุณาโหลดข้อมูลใหม่"
    );
  }

  function requireRecurringTemplate(
    actor: AuthSession,
    templateId: string
  ): RecurringTemplate {
    const template = recurringTemplates.get(templateId);
    const role = template
      ? memberships.get(template.workspaceId)?.get(actor.userId)
      : undefined;
    if (
      !template ||
      (role !== "owner" && role !== "editor")
    ) {
      throw new ApiError(
        "FORBIDDEN_WORKSPACE",
        403,
        "ไม่มีสิทธิ์เข้าถึงรายการนี้"
      );
    }
    return template;
  }

  function requireRecurringOccurrence(
    actor: AuthSession,
    occurrenceId: string
  ): RecurringOccurrence {
    const occurrence = recurringOccurrences.get(occurrenceId);
    const role = occurrence
      ? memberships.get(occurrence.workspaceId)?.get(actor.userId)
      : undefined;
    if (
      !occurrence ||
      (role !== "owner" && role !== "editor")
    ) {
      throw new ApiError(
        "FORBIDDEN_WORKSPACE",
        403,
        "ไม่มีสิทธิ์เข้าถึงรายการนี้"
      );
    }
    return occurrence;
  }

  function validateRecurringDestination(input: {
    workspaceId: string;
    kind: "income" | "expense";
    accountId: string;
    categoryId: string;
    currency: string;
  }): void {
    const account = accounts.get(input.accountId);
    const category = categories.get(input.categoryId);
    if (
      !account ||
      account.workspaceId !== input.workspaceId ||
      account.currency !== input.currency ||
      !category ||
      category.workspaceId !== input.workspaceId ||
      category.kind !== input.kind
    ) {
      throw new ApiError(
        "VALIDATION_FAILED",
        400,
        "บัญชี หมวดหมู่ หรือสกุลเงินไม่ถูกต้อง"
      );
    }
  }
}

import {
  createAccountWithOpeningBalanceSchema,
  createCategorySchema,
  createInstallmentContractSchema,
  createPrivateWorkspaceSchema,
  createTransactionSchema,
  postInstallmentPaymentSchema,
  type Account,
  type Category,
  type CreateTransactionInput,
  type InstallmentScheduleRow,
  type PostedTransactionResponse,
  type Workspace
} from "@systems-credit/contracts";
import {
  allocateInstallmentPayment,
  generateManualInstallmentSchedule,
  normalizeAccountKind,
  parseMoney,
  generateInstallmentSchedule,
  roundMoney,
  validateSplits,
  type CurrencyCode
} from "@systems-credit/domain";

import type {
  AccountCreationResult,
  FinanceApi,
  InstallmentContractCreationResult,
  InstallmentPaymentResult,
  WorkspaceCreationResult
} from "./finance-api";

const STORAGE_KEY = "systems-credit:finance:v1";

type LocalOpeningTransaction = Readonly<{
  id: string;
  workspaceId: string;
  accountId: string;
  amount: string;
  currency: string;
  state: "posted";
  version: 1;
}>;

export type LocalTransaction = Readonly<{
  id: string;
  workspaceId: string;
  accountId: string;
  type: CreateTransactionInput["type"];
  amount: string;
  currency: string;
  financialDate: string;
  categoryId?: string;
  splits?: CreateTransactionInput["splits"];
  note?: string;
  tagIds: string[];
  state: "posted";
  version: 1;
  createdAt: string;
  source?: "installment_payment";
  sourceId?: string;
}>;

export type LocalInstallmentContract =
  Omit<InstallmentContractCreationResult["contract"], "status"> &
    Readonly<{
      status:
        | "active"
        | "paid_off"
        | "cancelled"
        | "defaulted";
    }>;

export type LocalInstallmentScheduleRow =
  InstallmentScheduleRow &
    Readonly<{
      paidPrincipal: string;
      paidInterest: string;
      paidFees: string;
      paidPenalty: string;
      scheduledPenalty: string;
      status:
        | "upcoming"
        | "due"
        | "partially_paid"
        | "paid"
        | "overdue"
        | "waived"
        | "cancelled";
    }>;

export type LocalInstallmentPayment = Readonly<{
  id: string;
  workspaceId: string;
  contractId: string;
  sequence: number;
  accountId: string;
  amount: string;
  currency: string;
  financialDate: string;
  penaltyAssessed: string;
  allocatedPenalty: string;
  allocatedFees: string;
  allocatedInterest: string;
  allocatedPrincipal: string;
  reportableExpense: string;
  expenseTransactionId?: string;
  note?: string;
  clientMutationId: string;
  createdAt: string;
}>;

export type LocalFinanceSnapshot = Readonly<{
  version: 1;
  workspace: Workspace | null;
  categories: Category[];
  accounts: Account[];
  accountBalances: Record<
    string,
    Readonly<{
      accountId: string;
      amount: string;
      currency: string;
    }>
  >;
  openingTransactions: LocalOpeningTransaction[];
  transactions: LocalTransaction[];
  installmentContracts: LocalInstallmentContract[];
  installmentSchedules: Record<
    string,
    LocalInstallmentScheduleRow[]
  >;
  installmentPayments: LocalInstallmentPayment[];
}>;

export type LocalFinanceApi = FinanceApi &
  Readonly<{
    getSnapshot(): LocalFinanceSnapshot;
  }>;

const DEFAULT_CATEGORIES = [
  ["salary", "เงินเดือน", "income"],
  ["bonus", "โบนัส", "income"],
  ["freelance", "งานเสริม", "income"],
  ["interest-income", "ดอกเบี้ยรับ", "income"],
  ["gift-income", "ของขวัญ", "income"],
  ["other-income", "รายรับอื่น", "income"],
  ["food", "อาหาร", "expense"],
  ["groceries", "ของใช้ในบ้าน", "expense"],
  ["housing", "ที่อยู่อาศัย", "expense"],
  ["utilities", "สาธารณูปโภค", "expense"],
  ["transport", "เดินทาง", "expense"],
  ["health", "สุขภาพ", "expense"],
  ["education", "การศึกษา", "expense"],
  ["shopping", "ช้อปปิ้ง", "expense"],
  ["entertainment", "บันเทิง", "expense"],
  ["debt-interest", "ดอกเบี้ยหนี้", "expense"],
  ["financial-fees", "ค่าธรรมเนียม", "expense"],
  ["other-expense", "รายจ่ายอื่น", "expense"]
] as const;

function emptySnapshot(): LocalFinanceSnapshot {
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
    installmentPayments: []
  };
}

function isSnapshot(value: unknown): value is LocalFinanceSnapshot {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<LocalFinanceSnapshot>;
  return (
    candidate.version === 1 &&
    Array.isArray(candidate.categories) &&
    Array.isArray(candidate.accounts) &&
    Array.isArray(candidate.openingTransactions) &&
    Boolean(candidate.accountBalances) &&
    typeof candidate.accountBalances === "object"
  );
}

function readSnapshot(storage: Storage): LocalFinanceSnapshot {
  const stored = storage.getItem(STORAGE_KEY);
  if (!stored) {
    return emptySnapshot();
  }

  try {
    const parsed: unknown = JSON.parse(stored);
    return isSnapshot(parsed)
      ? {
          ...parsed,
          transactions: Array.isArray(
            (parsed as Partial<LocalFinanceSnapshot>).transactions
          )
            ? (parsed as LocalFinanceSnapshot).transactions
            : [],
          installmentContracts: Array.isArray(
            (parsed as Partial<LocalFinanceSnapshot>)
              .installmentContracts
          )
            ? (parsed as LocalFinanceSnapshot).installmentContracts
            : [],
          installmentSchedules:
            (parsed as Partial<LocalFinanceSnapshot>)
              .installmentSchedules &&
            typeof (parsed as Partial<LocalFinanceSnapshot>)
              .installmentSchedules === "object"
              ? Object.fromEntries(
                  Object.entries(
                    (parsed as LocalFinanceSnapshot)
                      .installmentSchedules
                  ).map(([contractId, rows]) => [
                    contractId,
                    rows.map((row) => ({
                      ...row,
                      scheduledPenalty:
                        row.scheduledPenalty ?? "0.00"
                    }))
                  ])
                )
              : {},
          installmentPayments: Array.isArray(
            (parsed as Partial<LocalFinanceSnapshot>)
              .installmentPayments
          )
            ? (parsed as LocalFinanceSnapshot).installmentPayments
            : []
        }
      : emptySnapshot();
  } catch {
    return emptySnapshot();
  }
}

export function createLocalFinanceApi(
  storage: Storage = window.localStorage
): LocalFinanceApi {
  let snapshot = readSnapshot(storage);

  function persist(next: LocalFinanceSnapshot) {
    snapshot = next;
    storage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  return {
    getSnapshot() {
      return snapshot;
    },

    async createPrivateWorkspace(input): Promise<WorkspaceCreationResult> {
      if (snapshot.workspace) {
        throw new Error("PRIVATE_WORKSPACE_EXISTS");
      }

      const parsed = createPrivateWorkspaceSchema.parse(input);
      const workspace: Workspace = {
        id: crypto.randomUUID(),
        name: parsed.name,
        kind: "private",
        baseCurrency: parsed.baseCurrency,
        timeZone: parsed.timeZone,
        role: "owner",
        version: 1
      };
      const categories = DEFAULT_CATEGORIES.map<Category>(
        ([slug, name, kind]) => ({
          id: crypto.randomUUID(),
          workspaceId: workspace.id,
          slug,
          name,
          kind,
          isDefault: true,
          version: 1
        })
      );

      persist({
        ...snapshot,
        workspace,
        categories
      });

      return { workspace, categories };
    },

    async createCategory(input): Promise<Category> {
      const parsed = createCategorySchema.parse(input);
      if (!snapshot.workspace || parsed.workspaceId !== snapshot.workspace.id) {
        throw new Error("WORKSPACE_NOT_FOUND");
      }
      if (parsed.parentId) {
        const parent = snapshot.categories.find(
          (category) => category.id === parsed.parentId
        );
        if (!parent || parent.kind !== parsed.kind) {
          throw new Error("CATEGORY_PARENT_INVALID");
        }
      }

      const normalizedName = parsed.name.trim().toLocaleLowerCase("th-TH");
      const duplicate = snapshot.categories.some(
        (category) =>
          category.kind === parsed.kind &&
          category.parentId === parsed.parentId &&
          category.name.trim().toLocaleLowerCase("th-TH") === normalizedName
      );
      if (duplicate) {
        throw new Error("CATEGORY_NAME_EXISTS");
      }

      const id = crypto.randomUUID();
      const category: Category = {
        id,
        workspaceId: parsed.workspaceId,
        ...(parsed.parentId ? { parentId: parsed.parentId } : {}),
        slug: `custom-${id}`,
        name: parsed.name,
        kind: parsed.kind,
        isDefault: false,
        version: 1
      };
      persist({
        ...snapshot,
        categories: [...snapshot.categories, category]
      });
      return category;
    },

    async createInstallmentContract(
      input
    ): Promise<InstallmentContractCreationResult> {
      const parsed = createInstallmentContractSchema.parse(input);
      if (!snapshot.workspace || parsed.workspaceId !== snapshot.workspace.id) {
        throw new Error("WORKSPACE_NOT_FOUND");
      }

      const originalPrincipal = parseMoney({
        amount: parsed.originalPrincipal,
        currency: parsed.currency
      });
      const downPayment = parseMoney({
        amount: parsed.downPayment,
        currency: parsed.currency
      });
      if (
        downPayment.isNegative() ||
        downPayment.greaterThanOrEqualTo(originalPrincipal)
      ) {
        throw new Error("INSTALLMENT_DOWN_PAYMENT_INVALID");
      }

      if (
        parsed.fundingAccountId &&
        !snapshot.accounts.some(
          (account) =>
            account.id === parsed.fundingAccountId &&
            account.workspaceId === parsed.workspaceId &&
            account.currency === parsed.currency
        )
      ) {
        throw new Error("INSTALLMENT_ACCOUNT_INVALID");
      }

      for (const categoryId of [
        parsed.expenseCategoryId,
        parsed.interestCategoryId
      ]) {
        if (
          categoryId &&
          !snapshot.categories.some(
            (category) =>
              category.id === categoryId &&
              category.workspaceId === parsed.workspaceId &&
              category.kind === "expense"
          )
        ) {
          throw new Error("INSTALLMENT_CATEGORY_INVALID");
        }
      }

      const duplicateName = snapshot.installmentContracts.some(
        (contract) =>
          contract.status === "active" &&
          contract.name.trim().toLocaleLowerCase("th-TH") ===
            parsed.name.trim().toLocaleLowerCase("th-TH")
      );
      if (duplicateName) {
        throw new Error("INSTALLMENT_NAME_EXISTS");
      }

      const financedPrincipal = roundMoney(
        originalPrincipal.minus(downPayment),
        parsed.currency
      );
      let generatedRows: InstallmentScheduleRow[];
      if (parsed.interestMethod === "manual") {
        generatedRows = generateManualInstallmentSchedule({
          principal: financedPrincipal,
          currency: parsed.currency,
          rows: parsed.manualRows!
        });
      } else {
        generatedRows = generateInstallmentSchedule({
          principal: financedPrincipal,
          financedFees: parsed.financedFees,
          currency: parsed.currency,
          interestMethod: parsed.interestMethod,
          annualRate: parsed.annualRate,
          periods: parsed.periods,
          firstDueDate: parsed.firstDueDate
        });
      }

      const contractId = crypto.randomUUID();
      const contract: InstallmentContractCreationResult["contract"] = {
        id: contractId,
        workspaceId: parsed.workspaceId,
        name: parsed.name,
        kind: parsed.kind,
        ...(parsed.creditor ? { creditor: parsed.creditor } : {}),
        originalPrincipal: roundMoney(
          parsed.originalPrincipal,
          parsed.currency
        ),
        downPayment: roundMoney(
          parsed.downPayment,
          parsed.currency
        ),
        financedPrincipal,
        financedFees: roundMoney(
          parsed.financedFees,
          parsed.currency
        ),
        currency: parsed.currency,
        interestMethod: parsed.interestMethod,
        annualRate: parsed.annualRate,
        periods: generatedRows.length,
        firstDueDate: parsed.firstDueDate,
        ...(parsed.fundingAccountId
          ? { fundingAccountId: parsed.fundingAccountId }
          : {}),
        ...(parsed.expenseCategoryId
          ? { expenseCategoryId: parsed.expenseCategoryId }
          : {}),
        ...(parsed.interestCategoryId
          ? { interestCategoryId: parsed.interestCategoryId }
          : {}),
        status: "active",
        version: 1
      };
      const zero = roundMoney("0", parsed.currency);
      const schedule = generatedRows.map<LocalInstallmentScheduleRow>(
        (row) => ({
          ...row,
          paidPrincipal: zero,
          paidInterest: zero,
          paidFees: zero,
          paidPenalty: zero,
          scheduledPenalty: zero,
          status: "upcoming"
        })
      );

      persist({
        ...snapshot,
        installmentContracts: [
          ...snapshot.installmentContracts,
          contract
        ],
        installmentSchedules: {
          ...snapshot.installmentSchedules,
          [contract.id]: schedule
        }
      });

      return { contract, schedule };
    },

    async postInstallmentPayment(
      input
    ): Promise<InstallmentPaymentResult> {
      const parsed = postInstallmentPaymentSchema.parse(input);
      if (!snapshot.workspace || parsed.workspaceId !== snapshot.workspace.id) {
        throw new Error("WORKSPACE_NOT_FOUND");
      }
      if (
        snapshot.installmentPayments.some(
          (payment) =>
            payment.clientMutationId === parsed.clientMutationId
        )
      ) {
        throw new Error("INSTALLMENT_PAYMENT_REPLAYED");
      }

      const contract = snapshot.installmentContracts.find(
        (candidate) =>
          candidate.id === parsed.contractId &&
          candidate.workspaceId === parsed.workspaceId
      );
      if (
        !contract ||
        contract.status !== "active" ||
        contract.currency !== parsed.currency
      ) {
        throw new Error("INSTALLMENT_CONTRACT_NOT_PAYABLE");
      }
      const schedule = snapshot.installmentSchedules[contract.id];
      const row = schedule?.find(
        (candidate) => candidate.sequence === parsed.sequence
      );
      if (
        !row ||
        row.status === "paid" ||
        row.status === "waived" ||
        row.status === "cancelled"
      ) {
        throw new Error("INSTALLMENT_ROW_NOT_PAYABLE");
      }

      const account = snapshot.accounts.find(
        (candidate) =>
          candidate.id === parsed.accountId &&
          candidate.workspaceId === parsed.workspaceId &&
          candidate.currency === parsed.currency
      );
      if (!account || !normalizeAccountKind(account.type).liquid) {
        throw new Error("INSTALLMENT_PAYMENT_ACCOUNT_INVALID");
      }
      const currentBalance =
        snapshot.accountBalances[account.id]?.amount ??
        roundMoney("0", account.currency);
      const paymentAmount = parseMoney({
        amount: parsed.amount,
        currency: parsed.currency
      });
      if (
        parseMoney({
          amount: currentBalance,
          currency: account.currency
        }).lessThan(paymentAmount)
      ) {
        throw new Error("INSTALLMENT_PAYMENT_INSUFFICIENT_BALANCE");
      }

      const scheduledPenalty = roundMoney(
        parseMoney({
          amount: row.scheduledPenalty,
          currency: parsed.currency
        }).plus(
          parseMoney({
            amount: parsed.penaltyAmount,
            currency: parsed.currency
          })
        ),
        parsed.currency
      );
      const allocation = allocateInstallmentPayment({
        currency: parsed.currency as CurrencyCode,
        amount: parsed.amount,
        scheduledPrincipal: row.principal,
        scheduledInterest: row.interest,
        scheduledFees: row.fees,
        scheduledPenalty,
        paidPrincipal: row.paidPrincipal,
        paidInterest: row.paidInterest,
        paidFees: row.paidFees,
        paidPenalty: row.paidPenalty
      });
      const addComponent = (current: string, value: string) =>
        roundMoney(
          parseMoney({
            amount: current,
            currency: parsed.currency
          }).plus(
            parseMoney({
              amount: value,
              currency: parsed.currency
            })
          ),
          parsed.currency
        );
      const updatedRow: LocalInstallmentScheduleRow = {
        ...row,
        scheduledPenalty,
        paidPenalty: addComponent(
          row.paidPenalty,
          allocation.allocation.penalty
        ),
        paidFees: addComponent(
          row.paidFees,
          allocation.allocation.fees
        ),
        paidInterest: addComponent(
          row.paidInterest,
          allocation.allocation.interest
        ),
        paidPrincipal: addComponent(
          row.paidPrincipal,
          allocation.allocation.principal
        ),
        status: allocation.status
      };
      const updatedSchedule = schedule!.map((candidate) =>
        candidate.sequence === row.sequence ? updatedRow : candidate
      );
      const contractStatus = updatedSchedule.every(
        (candidate) => candidate.status === "paid"
      )
        ? "paid_off"
        : "active";

      const nextBalance = roundMoney(
        parseMoney({
          amount: currentBalance,
          currency: account.currency
        }).minus(paymentAmount),
        account.currency
      );
      const accountBalance = {
        accountId: account.id,
        amount: nextBalance,
        currency: account.currency
      };

      const paymentId = crypto.randomUUID();
      const financialFeesCategory = snapshot.categories.find(
        (category) =>
          category.workspaceId === parsed.workspaceId &&
          category.slug === "financial-fees"
      );
      const debtInterestCategory = snapshot.categories.find(
        (category) =>
          category.workspaceId === parsed.workspaceId &&
          category.slug === "debt-interest"
      );
      const interestCategoryId =
        contract.interestCategoryId ??
        debtInterestCategory?.id ??
        contract.expenseCategoryId;
      const feesCategoryId =
        financialFeesCategory?.id ??
        contract.expenseCategoryId ??
        interestCategoryId;
      const interestExpense = allocation.allocation.interest;
      const feesExpense = roundMoney(
        parseMoney({
          amount: allocation.allocation.fees,
          currency: parsed.currency
        }).plus(
          parseMoney({
            amount: allocation.allocation.penalty,
            currency: parsed.currency
          })
        ),
        parsed.currency
      );
      const zero = roundMoney("0", parsed.currency);
      const expenseParts = new Map<string, string>();
      const addExpensePart = (
        categoryId: string | undefined,
        amount: string
      ) => {
        if (amount === zero) {
          return;
        }
        if (!categoryId) {
          throw new Error("INSTALLMENT_PAYMENT_CATEGORY_INVALID");
        }
        expenseParts.set(
          categoryId,
          addComponent(expenseParts.get(categoryId) ?? zero, amount)
        );
      };
      addExpensePart(interestCategoryId, interestExpense);
      addExpensePart(feesCategoryId, feesExpense);

      let expenseTransaction: LocalTransaction | undefined;
      if (allocation.reportableExpense !== zero) {
        const parts = [...expenseParts.entries()].map(
          ([categoryId, amount]) => ({ categoryId, amount })
        );
        expenseTransaction = {
          id: crypto.randomUUID(),
          workspaceId: parsed.workspaceId,
          accountId: account.id,
          type: "expense",
          amount: allocation.reportableExpense,
          currency: parsed.currency,
          financialDate: parsed.financialDate,
          ...(parts.length === 1
            ? { categoryId: parts[0]!.categoryId }
            : { splits: parts }),
          note:
            parsed.note ??
            `ดอกเบี้ยและค่าธรรมเนียม: ${contract.name}`,
          tagIds: [],
          state: "posted",
          version: 1,
          createdAt: new Date().toISOString(),
          source: "installment_payment",
          sourceId: paymentId
        };
      }

      const payment: LocalInstallmentPayment = {
        id: paymentId,
        workspaceId: parsed.workspaceId,
        contractId: contract.id,
        sequence: row.sequence,
        accountId: account.id,
        amount: roundMoney(parsed.amount, parsed.currency),
        currency: parsed.currency,
        financialDate: parsed.financialDate,
        penaltyAssessed: roundMoney(
          parsed.penaltyAmount,
          parsed.currency
        ),
        allocatedPenalty: allocation.allocation.penalty,
        allocatedFees: allocation.allocation.fees,
        allocatedInterest: allocation.allocation.interest,
        allocatedPrincipal: allocation.allocation.principal,
        reportableExpense: allocation.reportableExpense,
        ...(expenseTransaction
          ? { expenseTransactionId: expenseTransaction.id }
          : {}),
        ...(parsed.note ? { note: parsed.note } : {}),
        clientMutationId: parsed.clientMutationId,
        createdAt: new Date().toISOString()
      };

      persist({
        ...snapshot,
        accountBalances: {
          ...snapshot.accountBalances,
          [account.id]: accountBalance
        },
        installmentSchedules: {
          ...snapshot.installmentSchedules,
          [contract.id]: updatedSchedule
        },
        installmentContracts: snapshot.installmentContracts.map(
          (candidate) =>
            candidate.id === contract.id
              ? { ...candidate, status: contractStatus }
              : candidate
        ),
        installmentPayments: [
          ...snapshot.installmentPayments,
          payment
        ],
        transactions: expenseTransaction
          ? [...snapshot.transactions, expenseTransaction]
          : snapshot.transactions
      });

      return {
        paymentId,
        allocation: allocation.allocation,
        reportableExpense: allocation.reportableExpense,
        scheduleStatus: allocation.status,
        contractStatus,
        accountBalance,
        ...(expenseTransaction
          ? { expenseTransactionId: expenseTransaction.id }
          : {})
      };
    },

    async createAccount(input): Promise<AccountCreationResult> {
      const parsed = createAccountWithOpeningBalanceSchema.parse(input);
      if (!snapshot.workspace || parsed.workspaceId !== snapshot.workspace.id) {
        throw new Error("WORKSPACE_NOT_FOUND");
      }

      const account: Account = {
        id: crypto.randomUUID(),
        workspaceId: parsed.workspaceId,
        name: parsed.name,
        type: parsed.type,
        currency: parsed.currency,
        ...(parsed.institution
          ? { institution: parsed.institution }
          : {}),
        version: 1
      };
      const amount = roundMoney(
        parsed.openingBalance,
        parsed.currency as CurrencyCode
      );
      const accountBalance = {
        accountId: account.id,
        amount,
        currency: account.currency
      };
      const hasOpeningBalance = amount !== roundMoney(
        "0",
        parsed.currency as CurrencyCode
      );
      const openingTransaction: LocalOpeningTransaction | undefined =
        hasOpeningBalance
          ? {
              id: crypto.randomUUID(),
              workspaceId: account.workspaceId,
              accountId: account.id,
              amount,
              currency: account.currency,
              state: "posted",
              version: 1
            }
          : undefined;

      persist({
        ...snapshot,
        accounts: [...snapshot.accounts, account],
        accountBalances: {
          ...snapshot.accountBalances,
          [account.id]: accountBalance
        },
        openingTransactions: openingTransaction
          ? [...snapshot.openingTransactions, openingTransaction]
          : snapshot.openingTransactions
      });

      return {
        account,
        ...(openingTransaction
          ? {
              openingTransaction: {
                transactionId: openingTransaction.id,
                state: "posted",
                version: 1
              }
            }
          : {}),
        accountBalance
      };
    },

    async postTransaction(
      input
    ): Promise<PostedTransactionResponse> {
      const parsed = createTransactionSchema.parse(input);
      if (!snapshot.workspace || parsed.workspaceId !== snapshot.workspace.id) {
        throw new Error("WORKSPACE_NOT_FOUND");
      }

      const account = snapshot.accounts.find(
        (candidate) => candidate.id === parsed.accountId
      );
      if (!account || account.currency !== parsed.currency) {
        throw new Error("ACCOUNT_NOT_FOUND");
      }

      const categoryIds = parsed.splits
        ? parsed.splits.map((split) => split.categoryId)
        : [parsed.categoryId!];
      const categoriesAreValid = categoryIds.every((categoryId) =>
        snapshot.categories.some(
          (category) =>
            category.id === categoryId &&
            category.kind === parsed.type
        )
      );
      if (!categoriesAreValid) {
        throw new Error("CATEGORY_TYPE_MISMATCH");
      }
      validateSplits(
        {
          amount: parsed.amount,
          currency: parsed.currency
        },
        parsed.splits ?? []
      );

      const amount = roundMoney(
        parsed.amount,
        parsed.currency as CurrencyCode
      );
      const currentBalance =
        snapshot.accountBalances[account.id]?.amount ??
        roundMoney("0", account.currency);
      const value = parseMoney({
        amount,
        currency: parsed.currency
      });
      const liability =
        account.type === "credit_card" || account.type === "loan";
      const delta =
        parsed.type === "expense"
          ? liability
            ? value
            : value.negated()
          : liability
            ? value.negated()
            : value;
      const nextBalance = roundMoney(
        parseMoney({
          amount: currentBalance,
          currency: account.currency
        }).plus(delta),
        account.currency
      );
      const transaction: LocalTransaction = {
        id: crypto.randomUUID(),
        workspaceId: parsed.workspaceId,
        accountId: parsed.accountId,
        type: parsed.type,
        amount,
        currency: parsed.currency,
        financialDate: parsed.financialDate,
        ...(parsed.categoryId ? { categoryId: parsed.categoryId } : {}),
        ...(parsed.splits ? { splits: parsed.splits } : {}),
        ...(parsed.note ? { note: parsed.note } : {}),
        tagIds: parsed.tagIds,
        state: "posted",
        version: 1,
        createdAt: new Date().toISOString()
      };
      const accountBalance = {
        accountId: account.id,
        amount: nextBalance,
        currency: account.currency
      };

      persist({
        ...snapshot,
        transactions: [...snapshot.transactions, transaction],
        accountBalances: {
          ...snapshot.accountBalances,
          [account.id]: accountBalance
        }
      });

      return {
        transactionId: transaction.id,
        version: 1,
        state: "posted",
        accountBalances: [accountBalance]
      };
    }
  };
}

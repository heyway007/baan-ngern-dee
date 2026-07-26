import {
  createAccountWithOpeningBalanceSchema,
  createCategorySchema,
  createPrivateWorkspaceSchema,
  createTransactionSchema,
  type Account,
  type Category,
  type CreateTransactionInput,
  type PostedTransactionResponse,
  type Workspace
} from "@systems-credit/contracts";
import {
  parseMoney,
  roundMoney,
  validateSplits,
  type CurrencyCode
} from "@systems-credit/domain";

import type {
  AccountCreationResult,
  FinanceApi,
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
    transactions: []
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

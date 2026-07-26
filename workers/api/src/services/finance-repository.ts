import type {
  Account,
  Category,
  CategoryKind,
  CreateAccountWithOpeningBalanceInput,
  CreateCategoryInput,
  CreatePrivateWorkspaceInput,
  CreateTransactionInput,
  PostedTransactionResponse,
  TransactionState,
  TransactionType,
  VoidTransactionInput,
  Workspace,
  WorkspaceRole
} from "@systems-credit/contracts";
import {
  parseMoney,
  roundMoney,
  validateSplits
} from "@systems-credit/domain";

import { ApiError } from "../api-error";

export interface FinanceRepository {
  createPrivateWorkspace(
    userId: string,
    input: CreatePrivateWorkspaceInput
  ): Promise<{ workspace: Workspace; categories: Category[] }>;
  createCategory(
    userId: string,
    input: CreateCategoryInput
  ): Promise<Category>;
  createAccount(
    userId: string,
    input: CreateAccountWithOpeningBalanceInput
  ): Promise<AccountCreationResult>;
  postTransaction(
    userId: string,
    input: CreateTransactionInput
  ): Promise<PostedTransactionResponse>;
  voidTransaction(
    userId: string,
    transactionId: string,
    input: VoidTransactionInput
  ): Promise<PostedTransactionResponse>;
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
};

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

  return {
    async createPrivateWorkspace(userId, input) {
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

    async createCategory(userId, input) {
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

    async createAccount(userId, input) {
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

    async postTransaction(userId, input) {
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

    async voidTransaction(userId, transactionId, input) {
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
    }
  };
}

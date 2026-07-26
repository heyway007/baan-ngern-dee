import {
  createAccountWithOpeningBalanceSchema,
  createPrivateWorkspaceSchema,
  type Account,
  type Category,
  type Workspace
} from "@systems-credit/contracts";
import { roundMoney, type CurrencyCode } from "@systems-credit/domain";

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
    openingTransactions: []
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
    return isSnapshot(parsed) ? parsed : emptySnapshot();
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
    }
  };
}

import type {
  Account,
  Category,
  FinanceTransaction
} from "@systems-credit/contracts";

import { addExactMoney } from "../../lib/money-display";

export type MonthlyTransactionRow = Readonly<{
  id: string;
  financialDate: string;
  itemLabel: string;
  categoryLabel: string;
  accountLabel: string;
  income: string | null;
  expense: string | null;
  cumulativeNet: string;
  currency: "THB";
}>;

export type MonthlyTransactionModel = Readonly<{
  rows: readonly MonthlyTransactionRow[];
  income: string;
  expense: string;
  net: string;
}>;

type ModelInput = Readonly<{
  month: string;
  transactions: readonly FinanceTransaction[];
  accounts: readonly Account[];
  categories: readonly Category[];
}>;

export function buildMonthlyTransactionModel(
  input: ModelInput
): MonthlyTransactionModel {
  const accountNames = new Map(
    input.accounts.map((account) => [account.id, account.name])
  );
  const categoryNames = new Map(
    input.categories.map((category) => [category.id, category.name])
  );
  const transactions = [
    ...input.transactions.filter(
      (transaction) =>
        transaction.state === "posted" &&
        transaction.currency === "THB" &&
        transaction.financialDate.startsWith(`${input.month}-`)
    )
  ].sort((left, right) =>
      left.financialDate.localeCompare(right.financialDate) ||
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id)
  );

  let cumulativeNet = "0.00";
  const rows = transactions.map((transaction): MonthlyTransactionRow => {
    const categoryName = transaction.categoryId
      ? categoryNames.get(transaction.categoryId)
      : undefined;
    const hasSplits = transaction.splits !== undefined;
    cumulativeNet = addExactMoney([
      cumulativeNet,
      transaction.type === "expense"
        ? `-${transaction.amount}`
        : transaction.amount
    ]);

    return {
      id: transaction.id,
      financialDate: transaction.financialDate,
      itemLabel:
        transaction.note?.trim() ||
        categoryName ||
        (transaction.type === "income" ? "รายรับ" : "รายจ่าย"),
      categoryLabel: hasSplits
        ? "แบ่งหลายหมวดหมู่"
        : categoryName ??
          (transaction.categoryId
            ? "ไม่พบหมวดหมู่"
            : "—"),
      accountLabel:
        accountNames.get(transaction.accountId) ?? "ไม่พบบัญชี",
      income: transaction.type === "income" ? transaction.amount : null,
      expense: transaction.type === "expense" ? transaction.amount : null,
      cumulativeNet,
      currency: "THB"
    };
  });
  const income = addExactMoney(
    transactions
      .filter((transaction) => transaction.type === "income")
      .map((transaction) => transaction.amount)
  );
  const expense = addExactMoney(
    transactions
      .filter((transaction) => transaction.type === "expense")
      .map((transaction) => transaction.amount)
  );

  return {
    rows: [...rows].reverse(),
    income,
    expense,
    net: addExactMoney([income, `-${expense}`])
  };
}

export function shiftFinancialMonth(month: string, offset: -1 | 1): string {
  const [yearText, monthText] = month.split("-");
  const date = new Date(
    Date.UTC(Number(yearText), Number(monthText) - 1 + offset, 1)
  );
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

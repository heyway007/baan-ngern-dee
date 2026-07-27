import type { RecurringOccurrence } from "@systems-credit/contracts";

import { parseMoney, roundMoney, sumMoney } from "./money";

export type RecurringCurrencySummary = Readonly<{
  currency: string;
  income: string;
  expense: string;
  remaining: string;
  pendingIncome: string;
  pendingExpense: string;
  postedIncome: string;
  postedExpense: string;
  pendingCount: number;
}>;

export function resolveRecurringDate(
  period: string,
  dayOfMonth: number
): string {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period);
  if (!match) {
    throw new Error("INVALID_RECURRING_PERIOD");
  }
  if (
    !Number.isInteger(dayOfMonth) ||
    dayOfMonth < 1 ||
    dayOfMonth > 31
  ) {
    throw new Error("INVALID_RECURRING_DAY");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const resolvedDay = Math.min(dayOfMonth, lastDay);

  return `${period}-${String(resolvedDay).padStart(2, "0")}`;
}

function total(
  occurrences: readonly RecurringOccurrence[],
  currency: string,
  kind: "income" | "expense",
  status?: "pending" | "posted"
): string {
  const items = occurrences
    .filter(
      (occurrence) =>
        occurrence.currency === currency &&
        occurrence.kind === kind &&
        (status === undefined || occurrence.status === status)
    )
    .map((occurrence) => ({
      amount: occurrence.amount,
      currency
    }));

  return items.length === 0
    ? roundMoney(0, currency)
    : sumMoney(items).amount;
}

export function summarizeRecurringOccurrences(
  occurrences: readonly RecurringOccurrence[]
): RecurringCurrencySummary[] {
  const included = occurrences.filter(
    (occurrence) => occurrence.status !== "skipped"
  );
  const currencies = [...new Set(included.map(({ currency }) => currency))]
    .sort();

  return currencies.map((currency) => {
    const income = total(included, currency, "income");
    const expense = total(included, currency, "expense");

    return {
      currency,
      income,
      expense,
      remaining: roundMoney(
        parseMoney({ amount: income, currency }).minus(
          parseMoney({ amount: expense, currency })
        ),
        currency
      ),
      pendingIncome: total(included, currency, "income", "pending"),
      pendingExpense: total(included, currency, "expense", "pending"),
      postedIncome: total(included, currency, "income", "posted"),
      postedExpense: total(included, currency, "expense", "posted"),
      pendingCount: included.filter(
        (occurrence) =>
          occurrence.currency === currency &&
          occurrence.status === "pending"
      ).length
    };
  });
}

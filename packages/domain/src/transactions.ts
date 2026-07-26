import type { AccountType } from "./accounts";
import {
  parseMoney,
  roundMoney,
  sumMoney,
  type Money
} from "./money";

export type TransactionType =
  | "income"
  | "expense"
  | "balance_adjustment";

export type TransactionState = "posted" | "void";

export type PostingEffect =
  | Readonly<{
      expense: string;
      cashFlow: string;
      liabilityIncrease: string;
    }>
  | Readonly<{
      income: string;
      cashFlow: string;
      liabilityDecrease: string;
    }>
  | Readonly<{
      balanceAdjustment: string;
    }>;

export function validateSplits(
  total: Money,
  splits: readonly { amount: string }[]
): void {
  if (splits.length === 0) {
    return;
  }

  const splitMoney = splits.map((split) => ({
    amount: split.amount,
    currency: total.currency
  }));
  if (
    splitMoney.some(
      (split) => !parseMoney(split).greaterThan(0)
    )
  ) {
    throw new Error("SPLIT_AMOUNT_INVALID");
  }

  if (sumMoney(splitMoney).amount !== roundMoney(total.amount, total.currency)) {
    throw new Error("SPLIT_TOTAL_MISMATCH");
  }
}

export function postingEffect(
  type: TransactionType,
  accountType: AccountType,
  amount: Money
): PostingEffect {
  const rounded = roundMoney(amount.amount, amount.currency);
  const zero = roundMoney("0", amount.currency);
  const isLiability =
    accountType === "credit_card" || accountType === "loan";
  const isLiquid =
    accountType === "cash" ||
    accountType === "bank" ||
    accountType === "ewallet";

  if (type === "expense") {
    return {
      expense: rounded,
      cashFlow: isLiquid
        ? roundMoney(parseMoney(amount).negated(), amount.currency)
        : zero,
      liabilityIncrease: isLiability ? rounded : zero
    };
  }

  if (type === "income") {
    return {
      income: rounded,
      cashFlow: isLiquid ? rounded : zero,
      liabilityDecrease: isLiability ? rounded : zero
    };
  }

  return { balanceAdjustment: rounded };
}

import {
  ArrowDownLeft,
  ArrowUpRight,
  Scale
} from "lucide-react";

import type { FinanceTransaction } from "@systems-credit/contracts";
import { addExactMoney, formatMoney } from "../../lib/money-display";

type SummaryCardsProps = Readonly<{
  month: string;
  transactions: FinanceTransaction[];
}>;

function negate(amount: string) {
  return amount.startsWith("-") ? amount.slice(1) : `-${amount}`;
}

export function SummaryCards({
  month,
  transactions
}: SummaryCardsProps) {
  const monthly = transactions.filter(
    (transaction) =>
      transaction.state === "posted" &&
      transaction.currency === "THB" &&
      transaction.financialDate.startsWith(month)
  );
  const income = addExactMoney(
    monthly
      .filter((transaction) => transaction.type === "income")
      .map((transaction) => transaction.amount)
  );
  const expense = addExactMoney(
    monthly
      .filter((transaction) => transaction.type === "expense")
      .map((transaction) => transaction.amount)
  );
  const net = addExactMoney([income, negate(expense)]);

  return (
    <section className="summary-grid" aria-label="สรุปเดือนนี้">
      <article className="summary-card income" data-testid="monthly-income">
        <span className="summary-icon">
          <ArrowDownLeft size={20} aria-hidden="true" />
        </span>
        <span>
          <small>รายรับเดือนนี้</small>
          <strong>{formatMoney(income)}</strong>
        </span>
      </article>
      <article className="summary-card expense" data-testid="monthly-expense">
        <span className="summary-icon">
          <ArrowUpRight size={20} aria-hidden="true" />
        </span>
        <span>
          <small>รายจ่ายเดือนนี้</small>
          <strong>{formatMoney(expense)}</strong>
        </span>
      </article>
      <article className="summary-card net" data-testid="monthly-net">
        <span className="summary-icon">
          <Scale size={20} aria-hidden="true" />
        </span>
        <span>
          <small>สุทธิเดือนนี้</small>
          <strong>{formatMoney(net)}</strong>
        </span>
      </article>
    </section>
  );
}

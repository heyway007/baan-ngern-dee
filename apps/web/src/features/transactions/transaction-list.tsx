import {
  ArrowDownLeft,
  ArrowUpRight,
  ReceiptText
} from "lucide-react";

import type { Account, Category } from "@systems-credit/contracts";

import type { LocalTransaction } from "../../lib/local-finance-api";
import { formatMoney } from "../../lib/money-display";

type TransactionListProps = Readonly<{
  transactions: LocalTransaction[];
  accounts: Account[];
  categories: Category[];
}>;

export function TransactionList({
  transactions,
  accounts,
  categories
}: TransactionListProps) {
  if (!transactions.length) {
    return (
      <section className="empty-state">
        <ReceiptText size={40} aria-hidden="true" />
        <h2>ยังไม่มีรายการ</h2>
        <p>บันทึกรายรับหรือรายจ่ายแรก แล้วระบบจะสรุปให้บนหน้าภาพรวม</p>
      </section>
    );
  }

  const accountNames = new Map(
    accounts.map((account) => [account.id, account.name])
  );
  const categoryNames = new Map(
    categories.map((category) => [category.id, category.name])
  );
  const sorted = [...transactions].sort((left, right) =>
    `${right.financialDate}:${right.createdAt}`.localeCompare(
      `${left.financialDate}:${left.createdAt}`
    )
  );

  return (
    <section className="transaction-list" aria-label="ประวัติรายการ">
      <div className="transaction-list-head">
        <span>รายการ</span>
        <span>บัญชี</span>
        <span>จำนวนเงิน</span>
      </div>
      {sorted.map((transaction) => {
        const isIncome = transaction.type === "income";
        const categoryId =
          transaction.categoryId ?? transaction.splits?.[0]?.categoryId;
        return (
          <article className="transaction-row" key={transaction.id}>
            <span className={`transaction-icon ${transaction.type}`}>
              {isIncome ? (
                <ArrowDownLeft size={19} aria-hidden="true" />
              ) : (
                <ArrowUpRight size={19} aria-hidden="true" />
              )}
            </span>
            <div className="transaction-main">
              <strong>
                {transaction.note ||
                  (categoryId ? categoryNames.get(categoryId) : null) ||
                  (isIncome ? "รายรับ" : "รายจ่าย")}
              </strong>
              <small>
                <time dateTime={transaction.financialDate}>
                  {transaction.financialDate}
                </time>
                {" · "}
                {categoryId ? categoryNames.get(categoryId) : "แบ่งหมวดหมู่"}
              </small>
            </div>
            <span className="transaction-account">
              {accountNames.get(transaction.accountId) ?? "ไม่พบบัญชี"}
            </span>
            <strong className={`transaction-amount ${transaction.type}`}>
              {isIncome ? "+" : "−"}
              {formatMoney(transaction.amount, transaction.currency)}
            </strong>
          </article>
        );
      })}
    </section>
  );
}

import {
  ArrowDownLeft,
  ArrowUpRight,
  ReceiptText,
  Trash2
} from "lucide-react";

import type {
  Account,
  Category,
  FinanceTransaction
} from "@systems-credit/contracts";
import { formatMoney } from "../../lib/money-display";

export type TransactionListFilter = "current" | "deleted";

type TransactionListProps = Readonly<{
  transactions: FinanceTransaction[];
  accounts: Account[];
  categories: Category[];
  filter?: TransactionListFilter;
  onFilterChange?(filter: TransactionListFilter): void;
  onDeleteRequested?(transaction: FinanceTransaction): void;
}>;

export function TransactionList({
  transactions,
  accounts,
  categories,
  filter = "current",
  onFilterChange,
  onDeleteRequested
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
  const visibleTransactions = transactions.filter((transaction) =>
    filter === "current"
      ? transaction.state === "posted"
      : transaction.state === "void"
  );
  const sorted = [...visibleTransactions].sort((left, right) =>
    `${right.financialDate}:${right.createdAt}`.localeCompare(
      `${left.financialDate}:${left.createdAt}`
    )
  );

  return (
    <section className="transaction-list" aria-label="ประวัติรายการ">
      {onFilterChange ? (
        <div className="transaction-list-toolbar">
          <div
            className="transaction-filter"
            aria-label="กรองสถานะรายการ"
          >
            <button
              type="button"
              aria-pressed={filter === "current"}
              onClick={() => onFilterChange("current")}
            >
              รายการปัจจุบัน
            </button>
            <button
              type="button"
              aria-pressed={filter === "deleted"}
              onClick={() => onFilterChange("deleted")}
            >
              รายการที่ลบแล้ว
            </button>
          </div>
        </div>
      ) : null}
      <div className="transaction-list-head">
        <span>รายการ</span>
        <span>บัญชี</span>
        <span>จำนวนเงิน</span>
        <span aria-hidden="true">จัดการ</span>
      </div>
      {!sorted.length ? (
        <div className="transaction-list-empty">
          {filter === "current"
            ? "ยังไม่มีรายการปัจจุบัน"
            : "ยังไม่มีรายการที่ลบแล้ว"}
        </div>
      ) : null}
      {sorted.map((transaction) => {
        const isIncome = transaction.type === "income";
        const categoryId =
          transaction.categoryId ?? transaction.splits?.[0]?.categoryId;
        const displayName =
          transaction.note ||
          (categoryId ? categoryNames.get(categoryId) : null) ||
          (isIncome ? "รายรับ" : "รายจ่าย");
        const canDelete =
          transaction.state === "posted" &&
          transaction.source === undefined &&
          onDeleteRequested !== undefined;
        return (
          <article
            className={`transaction-row ${transaction.state}`}
            key={transaction.id}
          >
            <span className={`transaction-icon ${transaction.type}`}>
              {isIncome ? (
                <ArrowDownLeft size={19} aria-hidden="true" />
              ) : (
                <ArrowUpRight size={19} aria-hidden="true" />
              )}
            </span>
            <div className="transaction-main">
              <strong>{displayName}</strong>
              <small>
                <time dateTime={transaction.financialDate}>
                  {transaction.financialDate}
                </time>
                {" · "}
                {categoryId ? categoryNames.get(categoryId) : "แบ่งหมวดหมู่"}
              </small>
              {transaction.state === "void" ? (
                <small className="transaction-void-meta">
                  <span className="transaction-void-badge">
                    ลบแล้ว
                  </span>
                  <span>{transaction.voidReason}</span>
                  {transaction.voidedAt ? (
                    <time dateTime={transaction.voidedAt}>
                      {new Date(transaction.voidedAt).toLocaleString(
                        "th-TH"
                      )}
                    </time>
                  ) : null}
                </small>
              ) : null}
            </div>
            <span className="transaction-account">
              {accountNames.get(transaction.accountId) ?? "ไม่พบบัญชี"}
            </span>
            <strong className={`transaction-amount ${transaction.type}`}>
              {isIncome ? "+" : "−"}
              {formatMoney(transaction.amount, transaction.currency)}
            </strong>
            <span className="transaction-row-action">
              {canDelete ? (
                <button
                  type="button"
                  className="transaction-delete-button"
                  aria-label={`ลบรายการ ${displayName}`}
                  onClick={() => onDeleteRequested?.(transaction)}
                >
                  <Trash2 size={17} aria-hidden="true" />
                  <span>ลบ</span>
                </button>
              ) : transaction.state === "posted" &&
                transaction.source ? (
                <small className="transaction-source-note">
                  จัดการจากโมดูลต้นทาง
                </small>
              ) : null}
            </span>
          </article>
        );
      })}
    </section>
  );
}

import type {
  Account,
  Category,
  FinanceTransaction
} from "@systems-credit/contracts";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight
} from "lucide-react";
import { type JSX, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { formatMoney } from "../../lib/money-display";
import {
  buildMonthlyTransactionModel,
  shiftFinancialMonth
} from "./monthly-transaction-model";

const rowsPerPage = 10;
const visuallyHiddenStyle = {
  clip: "rect(0 0 0 0)",
  clipPath: "inset(50%)",
  height: "1px",
  overflow: "hidden",
  position: "absolute",
  whiteSpace: "nowrap",
  width: "1px"
} as const;

function formatFinancialDate(financialDate: string): string {
  return new Intl.DateTimeFormat("th-TH", {
    day: "numeric",
    month: "short"
  }).format(new Date(`${financialDate}T00:00:00`));
}

export function MonthlyTransactionTable(props: Readonly<{
  month: string;
  transactions: readonly FinanceTransaction[];
  accounts: readonly Account[];
  categories: readonly Category[];
  onMonthChange(month: string): void;
}>): JSX.Element {
  const { month, transactions, accounts, categories, onMonthChange } = props;
  const [page, setPage] = useState(0);
  const model = buildMonthlyTransactionModel({
    month,
    transactions,
    accounts,
    categories
  });
  const pageCount = Math.max(1, Math.ceil(model.rows.length / rowsPerPage));
  const visibleRows = model.rows.slice(
    page * rowsPerPage,
    (page + 1) * rowsPerPage
  );

  useEffect(() => {
    setPage(0);
  }, [month]);

  function selectMonth(value: string) {
    if (value) onMonthChange(value);
  }

  return (
    <section className="content-card monthly-transaction-table-card">
      <div className="section-title monthly-transaction-table-heading">
        <div>
          <span className="eyebrow">สรุปรายเดือน</span>
          <h2>รายการประจำเดือน</h2>
        </div>
        <div className="monthly-transaction-month-controls">
          <button
            type="button"
            className="icon-button"
            aria-label="เดือนก่อนหน้า"
            onClick={() => onMonthChange(shiftFinancialMonth(month, -1))}
          >
            <ChevronLeft aria-hidden="true" />
          </button>
          <label className="monthly-transaction-month-picker">
            <CalendarDays size={18} aria-hidden="true" />
            <input
              aria-label="เลือกเดือน"
              type="month"
              value={month}
              onChange={(event) => selectMonth(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="icon-button"
            aria-label="เดือนถัดไป"
            onClick={() => onMonthChange(shiftFinancialMonth(month, 1))}
          >
            <ChevronRight aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="monthly-transaction-table-wrap">
        <table className="monthly-transaction-table">
          <caption style={visuallyHiddenStyle}>
            รายการเงินประจำเดือนที่เลือก
          </caption>
          <thead>
            <tr>
              <th>วันที่</th>
              <th>รายการ</th>
              <th>หมวดหมู่</th>
              <th>บัญชี</th>
              <th>รายรับ</th>
              <th>รายจ่าย</th>
              <th>ยอดสุทธิสะสม</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length ? (
              visibleRows.map((row) => (
                <tr key={row.id}>
                  <td data-label="วันที่">
                    {formatFinancialDate(row.financialDate)}
                  </td>
                  <td data-label="รายการ">{row.itemLabel}</td>
                  <td data-label="หมวดหมู่">{row.categoryLabel}</td>
                  <td data-label="บัญชี">{row.accountLabel}</td>
                  <td data-label="รายรับ" className="income">
                    {row.income ? formatMoney(row.income, "THB") : "—"}
                  </td>
                  <td data-label="รายจ่าย" className="expense">
                    {row.expense ? formatMoney(row.expense, "THB") : "—"}
                  </td>
                  <td data-label="ยอดสุทธิสะสม" className="net">
                    {formatMoney(row.cumulativeNet, "THB")}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7} className="empty-copy">
                  ยังไม่มีรายการในเดือนนี้
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">รวม</th>
              <td colSpan={3} />
              <td className="income">{formatMoney(model.income, "THB")}</td>
              <td className="expense">{formatMoney(model.expense, "THB")}</td>
              <td className="net">{formatMoney(model.net, "THB")}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="monthly-transaction-pagination">
        <button
          type="button"
          className="ghost-button"
          aria-label="หน้าก่อน"
          disabled={page === 0}
          onClick={() => setPage((current) => current - 1)}
        >
          <ChevronLeft size={18} aria-hidden="true" />
          ก่อนหน้า
        </button>
        <span>หน้า {page + 1} / {pageCount}</span>
        <button
          type="button"
          className="ghost-button"
          aria-label="หน้าถัดไป"
          disabled={page === pageCount - 1}
          onClick={() => setPage((current) => current + 1)}
        >
          หน้าถัดไป
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </div>

      <Link className="text-link" to="/transactions">
        ดูรายการทั้งหมด
      </Link>
    </section>
  );
}

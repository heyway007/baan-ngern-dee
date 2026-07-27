import type { InstallmentScheduleRow } from "@systems-credit/contracts";
import { sumMoney } from "@systems-credit/domain";

import { formatMoney } from "../../lib/money-display";

type SchedulePreviewProps = Readonly<{
  rows: InstallmentScheduleRow[];
  currency: string;
  compact?: boolean;
}>;

function sumComponent(
  rows: InstallmentScheduleRow[],
  field: "principal" | "interest" | "fees" | "total",
  currency: string
) {
  if (!rows.length) {
    return "0.00";
  }
  return sumMoney(
    rows.map((row) => ({
      amount: row[field],
      currency
    }))
  ).amount;
}

export function SchedulePreview({
  rows,
  currency,
  compact = false
}: SchedulePreviewProps) {
  if (!rows.length) {
    return null;
  }

  return (
    <section className="schedule-preview" aria-labelledby="schedule-preview-title">
      <div className="schedule-preview-head">
        <div>
          <span className="eyebrow">ตัวอย่างตารางชำระ</span>
          <h3 id="schedule-preview-title">{rows.length} งวด</h3>
        </div>
        <div className="schedule-totals">
          <span>
            <small>เงินต้น</small>
            <strong>{formatMoney(sumComponent(rows, "principal", currency), currency)}</strong>
          </span>
          <span>
            <small>ดอกเบี้ย</small>
            <strong>{formatMoney(sumComponent(rows, "interest", currency), currency)}</strong>
          </span>
          <span>
            <small>รวมชำระ</small>
            <strong>{formatMoney(sumComponent(rows, "total", currency), currency)}</strong>
          </span>
        </div>
      </div>

      <div className={compact ? "schedule-table compact" : "schedule-table"}>
        <div className="schedule-row schedule-header" aria-hidden="true">
          <span>งวด</span>
          <span>ครบกำหนด</span>
          <span>เงินต้น</span>
          <span>ดอกเบี้ย</span>
          <span>ค่าธรรมเนียม</span>
          <span>รวม</span>
          <span>เงินต้นคงเหลือ</span>
        </div>
        {rows.map((row) => (
          <div className="schedule-row" key={row.sequence}>
            <strong>{row.sequence}</strong>
            <time dateTime={row.dueDate}>{row.dueDate}</time>
            <span>{formatMoney(row.principal, currency)}</span>
            <span>{formatMoney(row.interest, currency)}</span>
            <span>{formatMoney(row.fees, currency)}</span>
            <strong>{formatMoney(row.total, currency)}</strong>
            <span>{formatMoney(row.closingPrincipal, currency)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

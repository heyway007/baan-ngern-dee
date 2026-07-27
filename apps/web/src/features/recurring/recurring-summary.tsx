import type { RecurringOccurrence } from "@systems-credit/contracts";
import { summarizeRecurringOccurrences } from "@systems-credit/domain";

import { formatMoney } from "../../lib/money-display";

type RecurringSummaryProps = Readonly<{
  occurrences: readonly RecurringOccurrence[];
}>;

export function RecurringSummary({
  occurrences
}: RecurringSummaryProps) {
  const summaries = summarizeRecurringOccurrences(occurrences);

  if (!summaries.length) {
    return (
      <section className="content-card recurring-summary-empty">
        <p>เดือนนี้ยังไม่มีรายการประจำ</p>
      </section>
    );
  }

  return (
    <div className="recurring-summary-grid">
      {summaries.map((summary) => (
        <section
          className="content-card recurring-summary-card"
          aria-label={`สรุป ${summary.currency}`}
          key={summary.currency}
        >
          <div className="recurring-summary-heading">
            <div>
              <span className="eyebrow">ประมาณการประจำเดือน</span>
              <h2>{summary.currency}</h2>
            </div>
            <span className="status-pill">
              รอดำเนินการ {summary.pendingCount}
            </span>
          </div>
          <dl>
            <div>
              <dt>รายรับรวม</dt>
              <dd>
                {formatMoney(summary.income, summary.currency)}
              </dd>
            </div>
            <div>
              <dt>รายจ่ายรวม</dt>
              <dd>
                {formatMoney(summary.expense, summary.currency)}
              </dd>
            </div>
            <div className="remaining">
              <dt>คงเหลือหลังหัก</dt>
              <dd>
                {formatMoney(summary.remaining, summary.currency)}
              </dd>
            </div>
          </dl>
        </section>
      ))}
    </div>
  );
}

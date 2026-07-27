import { ArrowUpRight, Repeat2 } from "lucide-react";
import { Link } from "react-router-dom";

import type { RecurringOccurrence } from "@systems-credit/contracts";
import { summarizeRecurringOccurrences } from "@systems-credit/domain";

import { formatMoney } from "../../lib/money-display";

type RecurringOverviewCardProps = Readonly<{
  occurrences: readonly RecurringOccurrence[];
}>;

export function RecurringOverviewCard({
  occurrences
}: RecurringOverviewCardProps) {
  const summaries = summarizeRecurringOccurrences(occurrences);

  return (
    <section className="content-card recurring-overview-card">
      <div className="section-title">
        <div>
          <span className="eyebrow">หักรายการประจำล่วงหน้า</span>
          <h2>เงินเหลือหลังรายการประจำ</h2>
        </div>
        <span className="recurring-overview-icon">
          <Repeat2 size={20} aria-hidden="true" />
        </span>
      </div>

      {summaries.length ? (
        <div className="recurring-overview-currencies">
          {summaries.map((summary) => (
            <div
              className="recurring-overview-currency"
              aria-label={`ประมาณการ ${summary.currency}`}
              key={summary.currency}
            >
              <strong>{summary.currency}</strong>
              <span>
                <small>ยังรอจ่าย</small>
                <b>
                  {formatMoney(
                    summary.pendingExpense,
                    summary.currency
                  )}
                </b>
              </span>
              <span>
                <small>เหลือหลังหัก</small>
                <b>
                  {formatMoney(
                    summary.remaining,
                    summary.currency
                  )}
                </b>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="empty-copy">
          เพิ่มเงินเดือน ค่าเช่า ค่าบัตร หรือรายจ่ายที่เกิดทุกเดือน
          เพื่อดูเงินเหลือล่วงหน้า
        </p>
      )}

      <Link className="text-link" to="/recurring">
        จัดการรายการประจำ
        <ArrowUpRight size={17} aria-hidden="true" />
      </Link>
    </section>
  );
}

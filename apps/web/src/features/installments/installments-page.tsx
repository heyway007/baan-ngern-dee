import {
  BadgeDollarSign,
  CalendarClock,
  CircleDollarSign,
  CreditCard,
  Plus,
  X
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  parseMoney,
  roundMoney
} from "@systems-credit/domain";

import type { FinanceSnapshot } from "@systems-credit/contracts";

import type { FinanceApi } from "../../lib/finance-api";
import { formatMoney } from "../../lib/money-display";
import { InstallmentForm } from "./installment-form";
import { InstallmentPaymentForm } from "./installment-payment-form";
import { PayoffSimulator } from "./payoff-simulator";
import { SchedulePreview } from "./schedule-preview";

type InstallmentsPageProps = Readonly<{
  api: FinanceApi;
  snapshot: FinanceSnapshot;
  onChanged(): void;
  initiallyOpen?: boolean;
}>;

const interestLabels = {
  zero: "0%",
  flat: "Flat rate",
  reducing: "ลดต้นลดดอก",
  manual: "ตามตารางเจ้าหนี้"
} as const;

function remainingForRow(
  row: FinanceSnapshot["installmentSchedules"][string][number],
  currency: string
) {
  const scheduled = [
    row.principal,
    row.interest,
    row.fees,
    row.scheduledPenalty
  ].reduce(
    (total, amount) =>
      total.plus(parseMoney({ amount, currency })),
    parseMoney({ amount: "0", currency })
  );
  const paid = [
    row.paidPrincipal,
    row.paidInterest,
    row.paidFees,
    row.paidPenalty
  ].reduce(
    (total, amount) =>
      total.plus(parseMoney({ amount, currency })),
    parseMoney({ amount: "0", currency })
  );
  return roundMoney(scheduled.minus(paid), currency);
}

export function InstallmentsPage({
  api,
  snapshot,
  onChanged,
  initiallyOpen = false
}: InstallmentsPageProps) {
  const navigate = useNavigate();
  const [showForm, setShowForm] = useState(initiallyOpen);
  const [paymentTarget, setPaymentTarget] = useState<string | null>(
    null
  );
  const [payoffTarget, setPayoffTarget] = useState<string | null>(
    null
  );

  if (!snapshot.workspace) {
    return null;
  }

  return (
    <main className="page-content installments-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">เงินต้น ดอกเบี้ย และค่างวด</span>
          <h1>ผ่อนและหนี้</h1>
          <p>เห็นต้นทุนจริงและวันครบกำหนด โดยไม่บันทึกเงินต้นซ้ำเป็นรายจ่าย</p>
        </div>
        <button
          type="button"
          className="primary-button compact"
          onClick={() => setShowForm((value) => !value)}
        >
          {showForm ? <X size={18} aria-hidden="true" /> : <Plus size={18} aria-hidden="true" />}
          {showForm ? "ปิดแบบฟอร์ม" : "เพิ่มรายการผ่อน"}
        </button>
      </div>

      {showForm ? (
        <section className="content-card installment-form-card" aria-labelledby="new-installment-title">
          <div className="section-title">
            <div>
              <span className="eyebrow">สัญญาใหม่</span>
              <h2 id="new-installment-title">สร้างตารางผ่อนหรือหนี้</h2>
            </div>
          </div>
          <InstallmentForm
            api={api}
            workspaceId={snapshot.workspace.id}
            accounts={snapshot.accounts}
            categories={snapshot.categories}
            onCreated={() => {
              onChanged();
              setShowForm(false);
              navigate("/installments", { replace: true });
            }}
          />
        </section>
      ) : null}

      {snapshot.installmentContracts.length ? (
        <section className="installment-contracts" aria-label="สัญญาผ่อนและหนี้">
          {snapshot.installmentContracts.map((contract) => {
            const schedule =
              snapshot.installmentSchedules[contract.id] ?? [];
            const next = schedule.find((row) => row.status !== "paid");
            const paymentKey = next
              ? `${contract.id}:${next.sequence}`
              : null;
            const paymentCount = snapshot.installmentPayments.filter(
              (payment) => payment.contractId === contract.id
            ).length;
            const payoffCount = snapshot.installmentPayoffs.filter(
              (payoff) => payoff.contractId === contract.id
            ).length;
            return (
              <article
                className={
                  paymentTarget === paymentKey ||
                  payoffTarget === contract.id
                    ? "installment-card payment-open"
                    : "installment-card"
                }
                key={contract.id}
              >
                <div className="installment-card-top">
                  <span className="installment-card-icon">
                    <CreditCard size={22} aria-hidden="true" />
                  </span>
                  <span className="contract-status">
                    {contract.status === "paid_off"
                      ? "ชำระครบแล้ว"
                      : "กำลังผ่อน"}
                  </span>
                </div>
                <div>
                  <span className="interest-pill">
                    {interestLabels[contract.interestMethod]}
                  </span>
                  <h2>{contract.name}</h2>
                  <p>{contract.creditor ?? (contract.kind === "purchase" ? "รายการผ่อน" : "หนี้ส่วนตัว")}</p>
                </div>
                <div className="contract-principal">
                  <small>เงินต้นที่นำไปผ่อน</small>
                  <strong>{formatMoney(contract.financedPrincipal, contract.currency)}</strong>
                </div>
                {next ? (
                  <div className="next-installment">
                    <CalendarClock size={18} aria-hidden="true" />
                    <span>
                      <small>งวดถัดไป · {next.dueDate}</small>
                      <strong>
                        {formatMoney(
                          remainingForRow(next, contract.currency),
                          contract.currency
                        )}
                      </strong>
                    </span>
                  </div>
                ) : null}
                {next && contract.status === "active" ? (
                  <div className="installment-action-row">
                    <button
                      type="button"
                      className="secondary-button installment-pay-button"
                      aria-label={`ชำระงวดที่ ${next.sequence}`}
                      onClick={() => {
                        setPayoffTarget(null);
                        setPaymentTarget((current) =>
                          current === paymentKey ? null : paymentKey
                        );
                      }}
                    >
                      <CircleDollarSign size={18} aria-hidden="true" />
                      {paymentTarget === paymentKey
                        ? "ปิดฟอร์มชำระ"
                        : `ชำระงวดที่ ${next.sequence}`}
                    </button>
                    <button
                      type="button"
                      className="secondary-button installment-payoff-button"
                      aria-label="โปะหรือปิดยอด"
                      onClick={() => {
                        setPaymentTarget(null);
                        setPayoffTarget((current) =>
                          current === contract.id
                            ? null
                            : contract.id
                        );
                      }}
                    >
                      <BadgeDollarSign
                        size={18}
                        aria-hidden="true"
                      />
                      {payoffTarget === contract.id
                        ? "ปิดตัวจำลอง"
                        : "โปะ / ปิดยอด"}
                    </button>
                  </div>
                ) : null}
                {paymentCount > 0 || payoffCount > 0 ? (
                  <p className="installment-payment-count">
                    ชำระปกติ {paymentCount} ครั้ง
                    {payoffCount > 0
                      ? ` · โปะ/ปิดยอด ${payoffCount} ครั้ง`
                      : ""}
                  </p>
                ) : null}
                {next && paymentTarget === paymentKey ? (
                  <InstallmentPaymentForm
                    api={api}
                    contract={contract}
                    row={next}
                    accounts={snapshot.accounts}
                    onPosted={() => {
                      onChanged();
                      setPaymentTarget(null);
                    }}
                  />
                ) : null}
                {next && payoffTarget === contract.id ? (
                  <PayoffSimulator
                    api={api}
                    contract={contract}
                    schedule={schedule}
                    accounts={snapshot.accounts}
                    onPosted={() => {
                      onChanged();
                      setPayoffTarget(null);
                    }}
                  />
                ) : null}
                <details>
                  <summary>ดูตารางทั้งหมด</summary>
                  <SchedulePreview rows={schedule} currency={contract.currency} compact />
                </details>
              </article>
            );
          })}
        </section>
      ) : (
        <section className="empty-state">
          <CreditCard size={42} aria-hidden="true" />
          <h2>ยังไม่มีรายการผ่อนหรือหนี้</h2>
          <p>เพิ่มสัญญาแรกเพื่อดูเงินต้น ดอกเบี้ย ค่าธรรมเนียม และวันครบกำหนดแต่ละงวด</p>
        </section>
      )}
    </main>
  );
}

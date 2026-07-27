import {
  CalendarClock,
  CreditCard,
  Plus,
  X
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import type {
  LocalFinanceApi,
  LocalFinanceSnapshot
} from "../../lib/local-finance-api";
import { formatMoney } from "../../lib/money-display";
import { InstallmentForm } from "./installment-form";
import { SchedulePreview } from "./schedule-preview";

type InstallmentsPageProps = Readonly<{
  api: LocalFinanceApi;
  snapshot: LocalFinanceSnapshot;
  onChanged(): void;
  initiallyOpen?: boolean;
}>;

const interestLabels = {
  zero: "0%",
  flat: "Flat rate",
  reducing: "ลดต้นลดดอก",
  manual: "ตามตารางเจ้าหนี้"
} as const;

export function InstallmentsPage({
  api,
  snapshot,
  onChanged,
  initiallyOpen = false
}: InstallmentsPageProps) {
  const navigate = useNavigate();
  const [showForm, setShowForm] = useState(initiallyOpen);

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
            return (
              <article className="installment-card" key={contract.id}>
                <div className="installment-card-top">
                  <span className="installment-card-icon">
                    <CreditCard size={22} aria-hidden="true" />
                  </span>
                  <span className="contract-status">กำลังผ่อน</span>
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
                      <strong>{formatMoney(next.total, contract.currency)}</strong>
                    </span>
                  </div>
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

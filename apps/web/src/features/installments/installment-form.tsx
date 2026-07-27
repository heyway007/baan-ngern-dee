import {
  useMemo,
  useRef,
  useState,
  type FormEvent
} from "react";
import { Calculator, Save } from "lucide-react";

import type {
  Account,
  Category,
  CreateInstallmentContractInput,
  InstallmentInterestMethod,
  ManualInstallmentRowInput
} from "@systems-credit/contracts";
import {
  generateInstallmentSchedule,
  generateManualInstallmentSchedule,
  parseMoney,
  roundMoney,
  toFinancialDate
} from "@systems-credit/domain";

import type {
  FinanceApi,
  InstallmentContractCreationResult
} from "../../lib/finance-api";
import { formatMoney } from "../../lib/money-display";
import { ManualScheduleEditor } from "./manual-schedule-editor";
import { SchedulePreview } from "./schedule-preview";

type InstallmentFormProps = Readonly<{
  api: Pick<FinanceApi, "createInstallmentContract">;
  workspaceId: string;
  accounts: Account[];
  categories: Category[];
  onCreated(result: InstallmentContractCreationResult): void;
}>;

const moneyPattern =
  /^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/;

export function InstallmentForm({
  api,
  workspaceId,
  accounts,
  categories,
  onCreated
}: InstallmentFormProps) {
  const [kind, setKind] =
    useState<CreateInstallmentContractInput["kind"]>("purchase");
  const [name, setName] = useState("");
  const [creditor, setCreditor] = useState("");
  const [originalPrincipal, setOriginalPrincipal] = useState("0.00");
  const [downPayment, setDownPayment] = useState("0.00");
  const [financedFees, setFinancedFees] = useState("0.00");
  const [interestMethod, setInterestMethod] =
    useState<InstallmentInterestMethod>("zero");
  const [annualRate, setAnnualRate] = useState("0");
  const [periods, setPeriods] = useState("12");
  const [firstDueDate, setFirstDueDate] = useState(
    toFinancialDate(new Date().toISOString(), "Asia/Bangkok")
  );
  const [fundingAccountId, setFundingAccountId] = useState("");
  const [expenseCategoryId, setExpenseCategoryId] = useState("");
  const [interestCategoryId, setInterestCategoryId] = useState("");
  const [manualRows, setManualRows] = useState<
    ManualInstallmentRowInput[]
  >([]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const clientMutationId = useRef(crypto.randomUUID());

  const expenseCategories = categories.filter(
    (category) => category.kind === "expense"
  );
  const financedPrincipal = useMemo(() => {
    if (
      !moneyPattern.test(originalPrincipal) ||
      !moneyPattern.test(downPayment)
    ) {
      return null;
    }

    try {
      const original = parseMoney({
        amount: originalPrincipal,
        currency: "THB"
      });
      const down = parseMoney({
        amount: downPayment,
        currency: "THB"
      });
      const financedPrincipal = roundMoney(
        original.minus(down),
        "THB"
      );
      if (!parseMoney({
        amount: financedPrincipal,
        currency: "THB"
      }).greaterThan(0)) {
        return null;
      }
      return financedPrincipal;
    } catch {
      return null;
    }
  }, [downPayment, originalPrincipal]);

  const preview = useMemo(() => {
    if (!financedPrincipal) {
      return null;
    }

    try {
      if (interestMethod === "manual") {
        const rows = generateManualInstallmentSchedule({
          principal: financedPrincipal,
          currency: "THB",
          rows: manualRows
        });
        return { financedPrincipal, rows };
      }
      if (
        !moneyPattern.test(financedFees) ||
        !moneyPattern.test(annualRate)
      ) {
        return null;
      }
      const parsedPeriods = Number.parseInt(periods, 10);
      if (!Number.isInteger(parsedPeriods) || parsedPeriods < 1) {
        return null;
      }
      const rows = generateInstallmentSchedule({
        principal: financedPrincipal,
        financedFees,
        currency: "THB",
        interestMethod,
        annualRate,
        periods: parsedPeriods,
        firstDueDate
      });
      return { financedPrincipal, rows };
    } catch {
      return null;
    }
  }, [
    annualRate,
    financedFees,
    financedPrincipal,
    firstDueDate,
    interestMethod,
    manualRows,
    periods
  ]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedPeriods =
      interestMethod === "manual"
        ? manualRows.length
        : Number.parseInt(periods, 10);
    if (!name.trim()) {
      setError("กรุณากรอกชื่อรายการผ่อนหรือหนี้");
      return;
    }
    if (!preview || !Number.isInteger(parsedPeriods)) {
      setError("กรุณาตรวจเงินต้น เงินดาวน์ ดอกเบี้ย จำนวนงวด และวันครบกำหนด");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const result = await api.createInstallmentContract(
        {
          workspaceId,
          name: name.trim(),
          kind,
          ...(creditor.trim() ? { creditor: creditor.trim() } : {}),
          originalPrincipal,
          downPayment,
          financedFees,
          currency: "THB",
          interestMethod,
          annualRate: interestMethod === "manual" ? "0" : annualRate,
          periods: parsedPeriods,
          firstDueDate:
            interestMethod === "manual"
              ? manualRows[0]!.dueDate
              : firstDueDate,
          ...(interestMethod === "manual" ? { manualRows } : {}),
          ...(fundingAccountId ? { fundingAccountId } : {}),
          ...(expenseCategoryId ? { expenseCategoryId } : {}),
          ...(interestCategoryId ? { interestCategoryId } : {})
        },
        clientMutationId.current
      );
      clientMutationId.current = crypto.randomUUID();
      onCreated(result);
    } catch {
      setError("ยังสร้างตารางผ่อนไม่ได้ กรุณาตรวจข้อมูลแล้วลองอีกครั้ง");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="installment-form" onSubmit={handleSubmit} noValidate>
      <div className="contract-kind-switch full-field" aria-label="ประเภทสัญญา">
        <button
          type="button"
          className={kind === "purchase" ? "active" : ""}
          onClick={() => setKind("purchase")}
        >
          ผ่อนสินค้า/บริการ
        </button>
        <button
          type="button"
          className={kind === "debt" ? "active" : ""}
          onClick={() => setKind("debt")}
        >
          เงินกู้หรือหนี้
        </button>
      </div>

      <div className="field">
        <label htmlFor="installment-name">ชื่อรายการผ่อนหรือหนี้</label>
        <input
          id="installment-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="เช่น โทรศัพท์, สินเชื่อรถ"
          maxLength={120}
        />
      </div>
      <div className="field">
        <label htmlFor="installment-creditor">เจ้าหนี้/ร้านค้า (ไม่บังคับ)</label>
        <input
          id="installment-creditor"
          value={creditor}
          onChange={(event) => setCreditor(event.target.value)}
          maxLength={120}
        />
      </div>

      <div className="installment-money-grid full-field">
        <div className="field">
          <label htmlFor="original-principal">ราคาสินค้า/เงินต้นเดิม</label>
          <input
            id="original-principal"
            inputMode="decimal"
            value={originalPrincipal}
            onChange={(event) => setOriginalPrincipal(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="down-payment">เงินดาวน์</label>
          <input
            id="down-payment"
            inputMode="decimal"
            value={downPayment}
            onChange={(event) => setDownPayment(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="financed-fees">ค่าธรรมเนียมที่รวมผ่อน</label>
          <input
            id="financed-fees"
            inputMode="decimal"
            value={financedFees}
            onChange={(event) => setFinancedFees(event.target.value)}
          />
        </div>
      </div>

      {preview ? (
        <div className="financed-principal-callout full-field" role="status">
          <Calculator size={19} aria-hidden="true" />
          <span>
            เงินต้นที่นำไปผ่อน{" "}
            <strong>{formatMoney(preview.financedPrincipal)}</strong>
          </span>
        </div>
      ) : null}

      <div className="field">
        <label htmlFor="interest-method">วิธีคิดดอกเบี้ย</label>
        <select
          id="interest-method"
          value={interestMethod}
          onChange={(event) => {
            const method = event.target.value as InstallmentInterestMethod;
            setInterestMethod(method);
            if (
              method === "manual" &&
              manualRows.length === 0 &&
              financedPrincipal
            ) {
              setManualRows([
                {
                  dueDate: firstDueDate,
                  principal: financedPrincipal,
                  interest: "0.00",
                  fees: "0.00"
                }
              ]);
            }
          }}
        >
          <option value="zero">0% — ไม่มีดอกเบี้ย</option>
          <option value="flat">Flat rate — ดอกเบี้ยคงที่</option>
          <option value="reducing">Reducing — ลดต้นลดดอก</option>
          <option value="manual">กำหนดเอง — ตามตารางเจ้าหนี้</option>
        </select>
      </div>
      {interestMethod === "manual" ? (
        <ManualScheduleEditor rows={manualRows} onChange={setManualRows} />
      ) : (
        <>
          <div className="field">
            <label htmlFor="annual-rate">ดอกเบี้ยต่อปี (%)</label>
            <input
              id="annual-rate"
              inputMode="decimal"
              value={annualRate}
              onChange={(event) => setAnnualRate(event.target.value)}
              disabled={interestMethod === "zero"}
            />
          </div>
          <div className="field">
            <label htmlFor="installment-periods">จำนวนงวด</label>
            <input
              id="installment-periods"
              inputMode="numeric"
              value={periods}
              onChange={(event) => setPeriods(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="first-due-date">วันครบกำหนดงวดแรก</label>
            <input
              id="first-due-date"
              type="date"
              value={firstDueDate}
              onChange={(event) => setFirstDueDate(event.target.value)}
            />
          </div>
        </>
      )}

      <div className="field">
        <label htmlFor="funding-account">บัญชีหรือบัตรที่เกี่ยวข้อง (ไม่บังคับ)</label>
        <select
          id="funding-account"
          value={fundingAccountId}
          onChange={(event) => setFundingAccountId(event.target.value)}
        >
          <option value="">ยังไม่ผูกบัญชี</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name} ({account.currency})
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="expense-category">หมวดค่าใช้จ่าย (ไม่บังคับ)</label>
        <select
          id="expense-category"
          value={expenseCategoryId}
          onChange={(event) => setExpenseCategoryId(event.target.value)}
        >
          <option value="">เลือกภายหลัง</option>
          {expenseCategories.map((category) => (
            <option key={category.id} value={category.id}>{category.name}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="interest-category">หมวดดอกเบี้ย (ไม่บังคับ)</label>
        <select
          id="interest-category"
          value={interestCategoryId}
          onChange={(event) => setInterestCategoryId(event.target.value)}
        >
          <option value="">เลือกภายหลัง</option>
          {expenseCategories.map((category) => (
            <option key={category.id} value={category.id}>{category.name}</option>
          ))}
        </select>
      </div>

      {preview ? (
        <div className="full-field">
          <SchedulePreview rows={preview.rows} currency="THB" compact />
        </div>
      ) : null}

      {error ? <p className="form-error full-field" role="alert">{error}</p> : null}

      <div className="form-actions full-field">
        <button type="submit" className="primary-button" disabled={submitting}>
          <Save size={18} aria-hidden="true" />
          {submitting ? "กำลังสร้าง…" : "สร้างตารางผ่อน"}
        </button>
      </div>
    </form>
  );
}

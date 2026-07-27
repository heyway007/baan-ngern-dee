import {
  useMemo,
  useState,
  type FormEvent
} from "react";
import { CheckCircle2, WalletCards } from "lucide-react";

import type { Account } from "@systems-credit/contracts";
import {
  allocateInstallmentPayment,
  normalizeAccountKind,
  parseMoney,
  roundMoney,
  toFinancialDate
} from "@systems-credit/domain";

import type {
  FinanceApi,
  InstallmentPaymentResult
} from "../../lib/finance-api";
import type {
  LocalInstallmentContract,
  LocalInstallmentScheduleRow
} from "../../lib/local-finance-api";
import { formatMoney } from "../../lib/money-display";

type InstallmentPaymentFormProps = Readonly<{
  api: Pick<FinanceApi, "postInstallmentPayment">;
  contract: LocalInstallmentContract;
  row: LocalInstallmentScheduleRow;
  accounts: Account[];
  onPosted(result: InstallmentPaymentResult): void;
}>;

const moneyPattern = /^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/;

function remainingScheduledAmount(
  row: LocalInstallmentScheduleRow,
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

export function InstallmentPaymentForm({
  api,
  contract,
  row,
  accounts,
  onPosted
}: InstallmentPaymentFormProps) {
  const eligibleAccounts = accounts.filter(
    (account) =>
      account.workspaceId === contract.workspaceId &&
      account.currency === contract.currency &&
      normalizeAccountKind(account.type).liquid
  );
  const preferredAccount = eligibleAccounts.find(
    (account) => account.id === contract.fundingAccountId
  );
  const [accountId, setAccountId] = useState(
    preferredAccount?.id ?? eligibleAccounts[0]?.id ?? ""
  );
  const [amount, setAmount] = useState(
    remainingScheduledAmount(row, contract.currency)
  );
  const [penaltyAmount, setPenaltyAmount] = useState("0.00");
  const [financialDate, setFinancialDate] = useState(
    toFinancialDate(new Date().toISOString(), "Asia/Bangkok")
  );
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const preview = useMemo(() => {
    if (
      !moneyPattern.test(amount) ||
      !moneyPattern.test(penaltyAmount)
    ) {
      return null;
    }
    try {
      const scheduledPenalty = roundMoney(
        parseMoney({
          amount: row.scheduledPenalty,
          currency: contract.currency
        }).plus(
          parseMoney({
            amount: penaltyAmount,
            currency: contract.currency
          })
        ),
        contract.currency
      );
      return allocateInstallmentPayment({
        currency: contract.currency,
        amount,
        scheduledPrincipal: row.principal,
        scheduledInterest: row.interest,
        scheduledFees: row.fees,
        scheduledPenalty,
        paidPrincipal: row.paidPrincipal,
        paidInterest: row.paidInterest,
        paidFees: row.paidFees,
        paidPenalty: row.paidPenalty
      });
    } catch {
      return null;
    }
  }, [amount, contract.currency, penaltyAmount, row]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accountId) {
      setError("กรุณาเลือกบัญชีเงินสด ธนาคาร หรือกระเป๋าเงินที่ใช้ชำระ");
      return;
    }
    if (!preview) {
      setError("ยอดชำระต้องมากกว่า 0 และไม่เกินยอดคงค้างของงวด");
      return;
    }
    if (!confirmed) {
      setError("กรุณายืนยันว่าชำระเงินจริงแล้ว");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const result = await api.postInstallmentPayment({
        workspaceId: contract.workspaceId,
        contractId: contract.id,
        sequence: row.sequence,
        accountId,
        amount,
        penaltyAmount,
        currency: contract.currency,
        financialDate,
        ...(note.trim() ? { note: note.trim() } : {}),
        clientMutationId: crypto.randomUUID()
      });
      onPosted(result);
    } catch {
      setError(
        "ยังบันทึกการชำระไม่ได้ กรุณาตรวจยอดคงเหลือของบัญชีและลองอีกครั้ง"
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="installment-payment-form" onSubmit={handleSubmit} noValidate>
      <div className="payment-form-heading">
        <span className="payment-form-icon">
          <WalletCards size={20} aria-hidden="true" />
        </span>
        <div>
          <span className="eyebrow">งวดที่ {row.sequence}</span>
          <h3>บันทึกการชำระ</h3>
          <p>ครบกำหนด {row.dueDate}</p>
        </div>
      </div>

      <div className="installment-payment-grid">
        <div className="field">
          <label htmlFor={`payment-account-${contract.id}-${row.sequence}`}>
            บัญชีที่ใช้ชำระ
          </label>
          <select
            id={`payment-account-${contract.id}-${row.sequence}`}
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
          >
            <option value="">เลือกบัญชี</option>
            {eligibleAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`payment-amount-${contract.id}-${row.sequence}`}>
            จำนวนเงินที่ชำระ
          </label>
          <input
            id={`payment-amount-${contract.id}-${row.sequence}`}
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={`payment-penalty-${contract.id}-${row.sequence}`}>
            ค่าปรับเพิ่ม
          </label>
          <input
            id={`payment-penalty-${contract.id}-${row.sequence}`}
            inputMode="decimal"
            value={penaltyAmount}
            onChange={(event) => setPenaltyAmount(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={`payment-date-${contract.id}-${row.sequence}`}>
            วันที่ชำระ
          </label>
          <input
            id={`payment-date-${contract.id}-${row.sequence}`}
            type="date"
            value={financialDate}
            onChange={(event) => setFinancialDate(event.target.value)}
          />
        </div>
        <div className="field full-field">
          <label htmlFor={`payment-note-${contract.id}-${row.sequence}`}>
            หมายเหตุ (ไม่บังคับ)
          </label>
          <input
            id={`payment-note-${contract.id}-${row.sequence}`}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={500}
          />
        </div>
      </div>

      {preview ? (
        <section
          className="payment-allocation-preview"
          role="status"
          aria-label="การจัดสรรยอดชำระ"
        >
          <span>
            <small>ค่าปรับ</small>
            <strong>{formatMoney(preview.allocation.penalty)}</strong>
          </span>
          <span>
            <small>ค่าธรรมเนียม</small>
            <strong>{formatMoney(preview.allocation.fees)}</strong>
          </span>
          <span>
            <small>ดอกเบี้ย</small>
            <strong>{formatMoney(preview.allocation.interest)}</strong>
          </span>
          <span>
            <small>เงินต้น</small>
            <strong>{formatMoney(preview.allocation.principal)}</strong>
          </span>
          <span className="payment-remaining">
            <small>คงเหลืองวดนี้</small>
            <strong>{formatMoney(preview.remaining.total)}</strong>
          </span>
        </section>
      ) : (
        <p className="payment-preview-error">
          ยอดชำระต้องไม่เกินยอดคงค้างรวมค่าปรับ
        </p>
      )}

      <label className="payment-confirmation">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        <CheckCircle2 size={18} aria-hidden="true" />
        ยืนยันว่าชำระเงินจริงแล้ว
      </label>

      {error ? <p className="form-error" role="alert">{error}</p> : null}

      <button type="submit" className="primary-button" disabled={submitting}>
        {submitting ? "กำลังบันทึก…" : "บันทึกการชำระ"}
      </button>
    </form>
  );
}

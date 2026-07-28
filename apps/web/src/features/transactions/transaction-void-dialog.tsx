import type { FinanceTransaction } from "@systems-credit/contracts";
import { AlertTriangle } from "lucide-react";
import { FormEvent, useId, useState } from "react";

import { formatMoney } from "../../lib/money-display";

export type TransactionVoidDialogProps = Readonly<{
  transaction: FinanceTransaction;
  accountName: string;
  categoryName: string;
  onCancel(): void;
  onConfirm(reason: string): Promise<void>;
}>;

export function TransactionVoidDialog(
  {
    transaction,
    accountName,
    categoryName,
    onCancel,
    onConfirm
  }: TransactionVoidDialogProps
) {
  const titleId = useId();
  const reasonId = useId();
  const [reason, setReason] = useState("บันทึกรายการผิด");
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) {
      return;
    }

    const normalizedReason = reason.trim();
    if (
      normalizedReason.length < 1 ||
      normalizedReason.length > 200
    ) {
      setError("กรุณาระบุเหตุผล 1–200 ตัวอักษร");
      return;
    }

    setError(null);
    setIsPending(true);
    try {
      await onConfirm(normalizedReason);
    } catch {
      setError("ยังลบรายการไม่ได้ กรุณาลองอีกครั้ง");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div
      className="transaction-void-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <form className="dialog-card" onSubmit={handleSubmit}>
        <div className="transaction-void-dialog-heading">
          <span className="transaction-void-warning">
            <AlertTriangle size={21} aria-hidden="true" />
          </span>
          <div>
            <span className="eyebrow">แก้รายการที่บันทึกผิด</span>
            <h2 id={titleId}>ลบรายการ</h2>
          </div>
        </div>

        <p>
          ระบบจะย้อนยอดบัญชีและเก็บรายการนี้ไว้ในประวัติ
          โดยไม่ลบข้อมูลการเงินจริง
        </p>

        <dl className="transaction-void-details">
          <div>
            <dt>รายการ</dt>
            <dd>
              {transaction.note ||
                categoryName ||
                (transaction.type === "income"
                  ? "รายรับ"
                  : "รายจ่าย")}
            </dd>
          </div>
          <div>
            <dt>จำนวนเงิน</dt>
            <dd>
              {formatMoney(transaction.amount, transaction.currency)}
            </dd>
          </div>
          <div>
            <dt>บัญชี</dt>
            <dd>{accountName}</dd>
          </div>
          <div>
            <dt>วันที่</dt>
            <dd>
              <time dateTime={transaction.financialDate}>
                {transaction.financialDate}
              </time>
            </dd>
          </div>
        </dl>

        <label className="field-group" htmlFor={reasonId}>
          <span>เหตุผลที่ลบ</span>
          <textarea
            id={reasonId}
            aria-label="เหตุผลที่ลบ"
            rows={3}
            value={reason}
            disabled={isPending}
            onChange={(event) => {
              setReason(event.target.value);
              setError(null);
            }}
          />
          <small>{reason.trim().length}/200 ตัวอักษร</small>
        </label>

        {error ? <p role="alert">{error}</p> : null}

        <div className="dialog-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={isPending}
            onClick={onCancel}
          >
            กลับ
          </button>
          <button
            type="submit"
            className="danger-button"
            disabled={isPending}
          >
            {isPending ? "กำลังลบ..." : "ลบและย้อนยอด"}
          </button>
        </div>
      </form>
    </div>
  );
}

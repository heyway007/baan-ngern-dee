import {
  useMemo,
  useRef,
  useState,
  type FormEvent
} from "react";
import {
  BadgeDollarSign,
  CheckCircle2,
  Gauge,
  TimerReset
} from "lucide-react";

import type { Account } from "@systems-credit/contracts";
import {
  normalizeAccountKind,
  parseMoney,
  roundMoney,
  simulateInstallmentPayoff,
  toFinancialDate,
  type InstallmentExtraPaymentStrategy,
  type InstallmentPayoffAction
} from "@systems-credit/domain";

import type {
  FinanceApi,
  InstallmentPayoffResult
} from "../../lib/finance-api";
import type {
  LocalInstallmentContract,
  LocalInstallmentScheduleRow
} from "../../lib/local-finance-api";
import { formatMoney } from "../../lib/money-display";
import { SchedulePreview } from "./schedule-preview";

type PayoffSimulatorProps = Readonly<{
  api: Pick<FinanceApi, "postInstallmentPayoff">;
  contract: LocalInstallmentContract;
  schedule: LocalInstallmentScheduleRow[];
  accounts: Account[];
  onPosted(result: InstallmentPayoffResult): void;
}>;

const moneyPattern = /^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/;

function remainingComponent(
  scheduled: string,
  paid: string,
  currency: string
) {
  return roundMoney(
    parseMoney({ amount: scheduled, currency }).minus(
      parseMoney({ amount: paid, currency })
    ),
    currency
  );
}

function sumAmounts(amounts: string[], currency: string) {
  return roundMoney(
    amounts.reduce(
      (total, amount) =>
        total.plus(parseMoney({ amount, currency })),
      parseMoney({ amount: "0", currency })
    ),
    currency
  );
}

export function PayoffSimulator({
  api,
  contract,
  schedule,
  accounts,
  onPosted
}: PayoffSimulatorProps) {
  const unpaidRows = useMemo(
    () =>
      schedule
        .filter(
          (row) =>
            row.status !== "paid" &&
            row.status !== "waived" &&
            row.status !== "cancelled"
        )
        .map((row) => ({
          sequence: row.sequence,
          dueDate: row.dueDate,
          principal: remainingComponent(
            row.principal,
            row.paidPrincipal,
            contract.currency
          ),
          interest: remainingComponent(
            row.interest,
            row.paidInterest,
            contract.currency
          ),
          fees: remainingComponent(
            row.fees,
            row.paidFees,
            contract.currency
          ),
          penalty: remainingComponent(
            row.scheduledPenalty,
            row.paidPenalty,
            contract.currency
          )
        })),
    [contract.currency, schedule]
  );
  const remainingPrincipal = useMemo(
    () =>
      sumAmounts(
        unpaidRows.map((row) => row.principal),
        contract.currency
      ),
    [contract.currency, unpaidRows]
  );
  const scheduledInterest = useMemo(
    () =>
      sumAmounts(
        unpaidRows.map((row) => row.interest),
        contract.currency
      ),
    [contract.currency, unpaidRows]
  );
  const scheduledFees = useMemo(
    () =>
      sumAmounts(
        unpaidRows.flatMap((row) => [
          row.fees,
          row.penalty
        ]),
        contract.currency
      ),
    [contract.currency, unpaidRows]
  );
  const reducingInterestQuote =
    unpaidRows[0]?.interest ??
    roundMoney("0", contract.currency);

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
  const [action, setAction] =
    useState<InstallmentPayoffAction>("extra_principal");
  const [strategy, setStrategy] =
    useState<InstallmentExtraPaymentStrategy>("reduce_payment");
  const [extraPrincipal, setExtraPrincipal] = useState(
    unpaidRows[0]?.principal ?? ""
  );
  const [quotedInterest, setQuotedInterest] = useState(
    contract.interestMethod === "reducing"
      ? reducingInterestQuote
      : scheduledInterest
  );
  const [quotedFees, setQuotedFees] = useState(scheduledFees);
  const [financialDate, setFinancialDate] = useState(
    toFinancialDate(new Date().toISOString(), "Asia/Bangkok")
  );
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const clientMutationId = useRef(crypto.randomUUID());

  const preview = useMemo(() => {
    if (
      unpaidRows.length === 0 ||
      !moneyPattern.test(remainingPrincipal)
    ) {
      return null;
    }
    if (
      action === "extra_principal" &&
      !moneyPattern.test(extraPrincipal)
    ) {
      return null;
    }
    if (
      action === "payoff" &&
      (!moneyPattern.test(quotedInterest) ||
        !moneyPattern.test(quotedFees))
    ) {
      return null;
    }
    try {
      return simulateInstallmentPayoff({
        action,
        ...(action === "extra_principal"
          ? {
              strategy,
              extraPrincipal
            }
          : {
              quotedInterest,
              quotedFees
            }),
        currency: contract.currency,
        interestMethod: contract.interestMethod,
        annualRate: contract.annualRate,
        paymentDate: financialDate,
        remainingPrincipal,
        unpaidRows
      });
    } catch {
      return null;
    }
  }, [
    action,
    contract.annualRate,
    contract.currency,
    contract.interestMethod,
    extraPrincipal,
    financialDate,
    quotedFees,
    quotedInterest,
    remainingPrincipal,
    strategy,
    unpaidRows
  ]);

  function chooseAction(nextAction: InstallmentPayoffAction) {
    setAction(nextAction);
    setConfirmed(false);
    setError("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accountId) {
      setError("กรุณาเลือกบัญชีที่ใช้ชำระ");
      return;
    }
    if (!preview) {
      setError("กรุณาตรวจสอบยอดเงินและใบเสนออีกครั้ง");
      return;
    }
    if (!confirmed) {
      setError("กรุณายืนยันยอดก่อนบันทึก");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const result = await api.postInstallmentPayoff({
        workspaceId: contract.workspaceId,
        contractId: contract.id,
        accountId,
        action,
        ...(action === "extra_principal"
          ? {
              strategy,
              extraPrincipal
            }
          : {}),
        expectedRemainingPrincipal: remainingPrincipal,
        quotedInterest:
          action === "payoff" ? quotedInterest : "0.00",
        quotedFees: action === "payoff" ? quotedFees : "0.00",
        currency: contract.currency,
        financialDate,
        ...(note.trim() ? { note: note.trim() } : {}),
        clientMutationId: clientMutationId.current
      });
      clientMutationId.current = crypto.randomUUID();
      onPosted(result);
    } catch {
      setError(
        "ยังบันทึกรายการไม่ได้ โปรดตรวจสอบยอดบัญชีและขอใบเสนอใหม่หากยอดเปลี่ยน"
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      className="payoff-simulator"
      onSubmit={handleSubmit}
      noValidate
    >
      <div className="payoff-heading">
        <span className="payment-form-icon">
          <BadgeDollarSign size={21} aria-hidden="true" />
        </span>
        <div>
          <span className="eyebrow">จำลองก่อนตัดเงินจริง</span>
          <h3>โปะเงินต้นหรือปิดยอด</h3>
          <p>
            เงินต้นคงเหลือ{" "}
            <strong>
              {formatMoney(
                remainingPrincipal,
                contract.currency
              )}
            </strong>
          </p>
        </div>
      </div>

      <div className="payoff-action-switch" role="group" aria-label="รูปแบบการชำระ">
        <button
          type="button"
          className={
            action === "extra_principal" ? "active" : ""
          }
          onClick={() => chooseAction("extra_principal")}
        >
          <Gauge size={18} aria-hidden="true" />
          โปะเงินต้น
        </button>
        <button
          type="button"
          className={action === "payoff" ? "active" : ""}
          onClick={() => chooseAction("payoff")}
        >
          <TimerReset size={18} aria-hidden="true" />
          ปิดยอดทั้งหมด
        </button>
      </div>

      <div className="installment-payment-grid payoff-fields">
        <div className="field">
          <label htmlFor={`payoff-account-${contract.id}`}>
            บัญชีที่ใช้ชำระ
          </label>
          <select
            id={`payoff-account-${contract.id}`}
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
          <label htmlFor={`payoff-date-${contract.id}`}>
            วันที่ชำระ
          </label>
          <input
            id={`payoff-date-${contract.id}`}
            type="date"
            value={financialDate}
            onChange={(event) => setFinancialDate(event.target.value)}
          />
        </div>

        {action === "extra_principal" ? (
          <>
            <div className="field">
              <label htmlFor={`extra-principal-${contract.id}`}>
                เงินต้นที่ต้องการโปะ
              </label>
              <input
                id={`extra-principal-${contract.id}`}
                inputMode="decimal"
                value={extraPrincipal}
                onChange={(event) =>
                  setExtraPrincipal(event.target.value)
                }
              />
            </div>
            <div className="field">
              <label htmlFor={`extra-strategy-${contract.id}`}>
                หลังโปะแล้ว
              </label>
              <select
                id={`extra-strategy-${contract.id}`}
                value={strategy}
                onChange={(event) =>
                  setStrategy(
                    event.target
                      .value as InstallmentExtraPaymentStrategy
                  )
                }
              >
                <option value="reduce_payment">
                  ลดค่างวด ระยะเวลาเท่าเดิม
                </option>
                <option value="shorten_term">
                  ค่างวดใกล้เดิม ลดจำนวนงวด
                </option>
              </select>
            </div>
          </>
        ) : (
          <>
            <div className="field">
              <label htmlFor={`quoted-interest-${contract.id}`}>
                ดอกเบี้ยตามใบเสนอ
              </label>
              <input
                id={`quoted-interest-${contract.id}`}
                inputMode="decimal"
                value={quotedInterest}
                onChange={(event) =>
                  setQuotedInterest(event.target.value)
                }
              />
            </div>
            <div className="field">
              <label htmlFor={`quoted-fees-${contract.id}`}>
                ค่าธรรมเนียมตามใบเสนอ
              </label>
              <input
                id={`quoted-fees-${contract.id}`}
                inputMode="decimal"
                value={quotedFees}
                onChange={(event) =>
                  setQuotedFees(event.target.value)
                }
              />
            </div>
          </>
        )}

        <div className="field full-field">
          <label htmlFor={`payoff-note-${contract.id}`}>
            หมายเหตุหรือเลขที่ใบเสนอ (ไม่บังคับ)
          </label>
          <input
            id={`payoff-note-${contract.id}`}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={500}
          />
        </div>
      </div>

      {preview ? (
        <>
          <section
            className="payoff-summary"
            aria-label="สรุปยอดจำลอง"
          >
            <span>
              <small>เงินต้น</small>
              <strong>
                {formatMoney(
                  preview.principalPayment,
                  contract.currency
                )}
              </strong>
            </span>
            <span>
              <small>ดอกเบี้ย</small>
              <strong>
                {formatMoney(
                  preview.interestDue,
                  contract.currency
                )}
              </strong>
            </span>
            <span>
              <small>ค่าธรรมเนียม</small>
              <strong>
                {formatMoney(
                  preview.feesDue,
                  contract.currency
                )}
              </strong>
            </span>
            <span className="payoff-total">
              <small>ยอดตัดจากบัญชี</small>
              <strong>
                {formatMoney(
                  preview.totalCashRequired,
                  contract.currency
                )}
              </strong>
            </span>
            <span className="payoff-saving">
              <small>ดอกเบี้ยที่ประหยัดได้</small>
              <strong>
                {formatMoney(
                  preview.interestSaved,
                  contract.currency
                )}
              </strong>
            </span>
          </section>

          {preview.regeneratedRows.length > 0 ? (
            <details className="payoff-new-schedule">
              <summary>
                ดูตารางใหม่ {preview.regeneratedRows.length} งวด
              </summary>
              <SchedulePreview
                rows={preview.regeneratedRows}
                currency={contract.currency}
                compact
              />
            </details>
          ) : null}
        </>
      ) : (
        <p className="payment-preview-error">
          ยอดโปะต้องมากกว่า 0 และน้อยกว่าเงินต้นคงเหลือ
        </p>
      )}

      <label className="payment-confirmation">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        <CheckCircle2 size={18} aria-hidden="true" />
        ยืนยันใบเสนอและยอดที่จะชำระ
      </label>

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        className="primary-button"
        disabled={submitting || !preview}
      >
        {submitting
          ? "กำลังบันทึก…"
          : `${
              action === "payoff"
                ? "ยืนยันปิดยอด"
                : "ยืนยันโปะเงินต้น"
            } ${
              preview
                ? formatMoney(
                    preview.totalCashRequired,
                    contract.currency
                  )
                : ""
            }`}
      </button>
    </form>
  );
}

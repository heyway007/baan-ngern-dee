import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent
} from "react";
import { ArrowDownLeft, ArrowUpRight, Layers3, Save } from "lucide-react";

import type {
  Account,
  Category,
  CreateTransactionInput,
  TransactionSplitInput,
  SlipTransactionDraft
} from "@systems-credit/contracts";
import { toFinancialDate, validateSplits } from "@systems-credit/domain";

import type { FinanceApi } from "../../lib/finance-api";
import { SplitEditor } from "./split-editor";

type TransactionFormProps = Readonly<{
  api: Pick<FinanceApi, "postTransaction"> &
    Partial<Pick<FinanceApi, "confirmSlip">>;
  workspaceId: string;
  accounts: Account[];
  categories: Category[];
  initialType?: CreateTransactionInput["type"];
  initialDraft?: SlipTransactionDraft;
  analysisToken?: string;
  onPosted(): void;
}>;

const positiveMoneyPattern =
  /^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/;

export function TransactionForm({
  api,
  workspaceId,
  accounts,
  categories,
  initialType = "expense",
  initialDraft,
  analysisToken,
  onPosted
}: TransactionFormProps) {
  const [type, setType] =
    useState<CreateTransactionInput["type"]>(
      initialDraft?.type ?? initialType
    );
  const [amount, setAmount] = useState(initialDraft?.amount ?? "");
  const [accountId, setAccountId] = useState(
    initialDraft?.accountId ?? accounts[0]?.id ?? ""
  );
  const [categoryId, setCategoryId] = useState(
    initialDraft?.categoryId ?? ""
  );
  const [financialDate, setFinancialDate] = useState(
    initialDraft?.financialDate ??
      toFinancialDate(new Date().toISOString(), "Asia/Bangkok")
  );
  const [note, setNote] = useState(initialDraft?.note ?? "");
  const [splits, setSplits] =
    useState<TransactionSplitInput[] | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const clientMutationId = useRef(crypto.randomUUID());

  const visibleCategories = useMemo(
    () => categories.filter((category) => category.kind === type),
    [categories, type]
  );
  const selectedAccount = accounts.find(
    (account) => account.id === accountId
  );
  const needsReview = (
    field: SlipTransactionDraft["fieldsNeedingReview"][number]
  ) => initialDraft?.fieldsNeedingReview.includes(field) ?? false;
  const reviewWarning = (
    field: SlipTransactionDraft["fieldsNeedingReview"][number]
  ) => needsReview(field) ? (
    <span className="slip-review-warning">โปรดตรวจสอบ</span>
  ) : null;

  useEffect(() => {
    if (!visibleCategories.some((category) => category.id === categoryId)) {
      setCategoryId(visibleCategories[0]?.id ?? "");
    }
  }, [categoryId, visibleCategories]);

  function changeType(nextType: CreateTransactionInput["type"]) {
    setType(nextType);
    setSplits(null);
    setError("");
  }

  function startSplitting() {
    setSplits([
      {
        categoryId: visibleCategories[0]?.id ?? "",
        amount: ""
      },
      {
        categoryId:
          visibleCategories[1]?.id ??
          visibleCategories[0]?.id ??
          "",
        amount: ""
      }
    ]);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !amount ||
      !positiveMoneyPattern.test(amount) ||
      !/[1-9]/.test(amount)
    ) {
      setError("กรุณากรอกจำนวนเงินที่มากกว่า 0 เช่น 1250.50");
      return;
    }
    if (!selectedAccount || (!categoryId && !splits)) {
      setError("กรุณาเลือกบัญชีและหมวดหมู่");
      return;
    }
    if (splits) {
      try {
        validateSplits(
          { amount, currency: selectedAccount.currency },
          splits
        );
      } catch {
        setError("ยอดรวมของรายการย่อยต้องเท่ากับจำนวนเงินทั้งหมด");
        return;
      }
    }

    setSubmitting(true);
    setError("");
    try {
      const transaction: CreateTransactionInput = {
        workspaceId,
        accountId: selectedAccount.id,
        type,
        amount,
        currency: selectedAccount.currency,
        financialDate,
        ...(splits ? { splits } : { categoryId }),
        ...(note.trim() ? { note: note.trim() } : {}),
        tagIds: [],
        clientMutationId: clientMutationId.current
      };
      if (analysisToken) {
        if (!api.confirmSlip) {
          throw new Error("SLIP_CONFIRM_UNAVAILABLE");
        }
        await api.confirmSlip({ analysisToken, transaction });
      } else {
        await api.postTransaction(transaction);
      }
      clientMutationId.current = crypto.randomUUID();
      setAmount("");
      setNote("");
      setSplits(null);
      onPosted();
    } catch {
      setError("ยังบันทึกรายการไม่ได้ กรุณาตรวจข้อมูลแล้วลองอีกครั้ง");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="transaction-form" onSubmit={handleSubmit} noValidate>
      <div className="transaction-type-switch" aria-label="ประเภทรายการ">
        <button
          type="button"
          className={type === "expense" ? "active expense" : ""}
          aria-pressed={type === "expense"}
          onClick={() => changeType("expense")}
        >
          <ArrowUpRight size={18} aria-hidden="true" />
          รายจ่าย
        </button>
        <button
          type="button"
          className={type === "income" ? "active income" : ""}
          aria-pressed={type === "income"}
          onClick={() => changeType("income")}
        >
          <ArrowDownLeft size={18} aria-hidden="true" />
          รายรับ
        </button>
      </div>
      {reviewWarning("type")}

      <div className="amount-field full-field">
        <label htmlFor="transaction-amount">
          จำนวนเงิน {reviewWarning("amount")}
        </label>
        <div className="amount-input">
          <span aria-hidden="true">
            {selectedAccount?.currency === "THB"
              ? "฿"
              : selectedAccount?.currency ?? "THB"}
          </span>
          <input
            id="transaction-amount"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="0.00"
            autoFocus
          />
        </div>
      </div>

      <div className="field">
        <label htmlFor="transaction-account">
          บัญชี {reviewWarning("account")}
        </label>
        <select
          id="transaction-account"
          value={accountId}
          onChange={(event) => setAccountId(event.target.value)}
          disabled={!accounts.length}
        >
          {!accounts.length ? <option value="">ยังไม่มีบัญชี</option> : null}
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name} ({account.currency})
            </option>
          ))}
        </select>
      </div>

      {splits ? (
        <SplitEditor
          categories={visibleCategories}
          value={splits}
          onChange={setSplits}
          onCancel={() => setSplits(null)}
        />
      ) : (
        <div className="field category-field">
          <label htmlFor="transaction-category">
            หมวดหมู่ {reviewWarning("category")}
          </label>
          <select
            id="transaction-category"
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
          >
            {visibleCategories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="split-trigger"
            onClick={startSplitting}
          >
            <Layers3 size={15} aria-hidden="true" />
            แบ่งหลายหมวดหมู่
          </button>
        </div>
      )}

      <div className="field">
        <label htmlFor="transaction-date">
          วันที่รายการ {reviewWarning("financialDate")}
        </label>
        <input
          id="transaction-date"
          type="date"
          value={financialDate}
          onChange={(event) => setFinancialDate(event.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="transaction-note">ร้านค้า/หมายเหตุ (ไม่บังคับ)</label>
        <input
          id="transaction-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={500}
          placeholder="เช่น มื้อกลางวัน"
        />
      </div>

      {error ? (
        <p className="form-error full-field" role="alert">{error}</p>
      ) : null}

      <div className="form-actions full-field">
        <button
          type="submit"
          className={`primary-button ${type}`}
          disabled={submitting || !accounts.length}
        >
          <Save size={18} aria-hidden="true" />
          {submitting
            ? "กำลังบันทึก…"
            : type === "expense"
              ? "บันทึกรายจ่าย"
              : "บันทึกรายรับ"}
        </button>
      </div>
    </form>
  );
}

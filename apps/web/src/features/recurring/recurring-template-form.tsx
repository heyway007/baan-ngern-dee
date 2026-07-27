import {
  useMemo,
  useState,
  type FormEvent
} from "react";

import type {
  Account,
  Category,
  CategoryKind,
  CreateRecurringTemplateInput,
  RecurringOccurrence,
  RecurringTemplate,
  UpdateRecurringTemplateInput
} from "@systems-credit/contracts";

import type { FinanceApi } from "../../lib/finance-api";

type RecurringTemplateFormProps = Readonly<{
  api: Pick<
    FinanceApi,
    "createRecurringTemplate" | "updateRecurringTemplate"
  >;
  workspaceId: string;
  currentPeriod: string;
  accounts: Account[];
  categories: Category[];
  template?: RecurringTemplate;
  currentOccurrence?: RecurringOccurrence;
  onChanged(): void;
}>;

const positiveMoneyPattern =
  /^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/;
const monthPattern = /^\d{4}-(?:0[1-9]|1[0-2])$/;

export function RecurringTemplateForm({
  api,
  workspaceId,
  currentPeriod,
  accounts,
  categories,
  template,
  currentOccurrence,
  onChanged
}: RecurringTemplateFormProps) {
  const [name, setName] = useState(template?.name ?? "");
  const [kind, setKind] = useState<CategoryKind>(
    template?.kind ?? "expense"
  );
  const [amount, setAmount] = useState(template?.amount ?? "0.00");
  const [accountId, setAccountId] = useState(
    template?.accountId ?? accounts[0]?.id ?? ""
  );
  const initialCategories = categories.filter(
    (category) => category.kind === (template?.kind ?? "expense")
  );
  const [categoryId, setCategoryId] = useState(
    template?.categoryId ?? initialCategories[0]?.id ?? ""
  );
  const [dayOfMonth, setDayOfMonth] = useState(
    String(template?.dayOfMonth ?? 1)
  );
  const [startMonth, setStartMonth] = useState(
    template?.startMonth ?? currentPeriod
  );
  const [endMonth, setEndMonth] = useState(
    template?.endMonth ?? ""
  );
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [pendingUpdate, setPendingUpdate] =
    useState<UpdateRecurringTemplateInput | null>(null);

  const visibleCategories = useMemo(
    () => categories.filter((category) => category.kind === kind),
    [categories, kind]
  );
  const currency =
    accounts.find((account) => account.id === accountId)?.currency ??
    "";

  function changeKind(nextKind: CategoryKind) {
    setKind(nextKind);
    const currentCategory = categories.find(
      (category) =>
        category.id === categoryId && category.kind === nextKind
    );
    if (!currentCategory) {
      setCategoryId(
        categories.find((category) => category.kind === nextKind)?.id ??
          ""
      );
    }
  }

  function formValues():
    | CreateRecurringTemplateInput
    | UpdateRecurringTemplateInput
    | null {
    const parsedDay = Number.parseInt(dayOfMonth, 10);
    if (!name.trim()) {
      setError("กรุณากรอกชื่อรายการประจำ");
      return null;
    }
    if (
      !positiveMoneyPattern.test(amount) ||
      !/[1-9]/.test(amount)
    ) {
      setError("จำนวนเงินต้องมากกว่า 0 และใช้ทศนิยมไม่เกิน 4 ตำแหน่ง");
      return null;
    }
    if (!accountId || !currency) {
      setError("กรุณาเลือกบัญชี");
      return null;
    }
    if (!categoryId) {
      setError("กรุณาเลือกหมวดหมู่");
      return null;
    }
    if (
      !Number.isInteger(parsedDay) ||
      parsedDay < 1 ||
      parsedDay > 31
    ) {
      setError("วันที่ของเดือนต้องอยู่ระหว่าง 1 ถึง 31");
      return null;
    }
    if (
      !monthPattern.test(startMonth) ||
      (endMonth && !monthPattern.test(endMonth)) ||
      (endMonth && endMonth < startMonth)
    ) {
      setError("กรุณาตรวจสอบเดือนเริ่มต้นและเดือนสิ้นสุด");
      return null;
    }

    const common = {
      name: name.trim(),
      kind,
      amount,
      currency,
      accountId,
      categoryId,
      dayOfMonth: parsedDay,
      startMonth,
      ...(endMonth ? { endMonth } : {})
    };
    return template
      ? { ...common, version: template.version }
      : { workspaceId, ...common };
  }

  async function saveUpdate(input: UpdateRecurringTemplateInput) {
    if (!template) return;
    setSubmitting(true);
    setError("");
    try {
      await api.updateRecurringTemplate(template.id, input);
      setPendingUpdate(null);
      onChanged();
    } catch {
      setError(
        "ยังบันทึกรายการประจำไม่ได้ กรุณาตรวจสอบข้อมูลแล้วลองอีกครั้ง"
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = formValues();
    if (!input) return;

    if (template) {
      const updateInput = input as UpdateRecurringTemplateInput;
      if (
        currentOccurrence?.status === "pending" &&
        currentOccurrence.period === currentPeriod
      ) {
        setPendingUpdate(updateInput);
        return;
      }
      await saveUpdate(updateInput);
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      await api.createRecurringTemplate(
        input as CreateRecurringTemplateInput
      );
      onChanged();
    } catch {
      setError(
        "ยังบันทึกรายการประจำไม่ได้ กรุณาตรวจสอบข้อมูลแล้วลองอีกครั้ง"
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <form
        className="recurring-template-grid"
        onSubmit={handleSubmit}
        noValidate
      >
        <div className="field">
          <label htmlFor="recurring-name">ชื่อรายการประจำ</label>
          <input
            id="recurring-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={100}
          />
        </div>

        <div className="field">
          <label htmlFor="recurring-kind">ประเภทรายการประจำ</label>
          <select
            id="recurring-kind"
            value={kind}
            onChange={(event) =>
              changeKind(event.target.value as CategoryKind)
            }
          >
            <option value="expense">รายจ่าย</option>
            <option value="income">รายรับ</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="recurring-account">บัญชี</label>
          <select
            id="recurring-account"
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
          >
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} ({account.currency})
              </option>
            ))}
          </select>
          <small>สกุลเงิน {currency || "-"}</small>
        </div>

        <div className="field">
          <label htmlFor="recurring-category">หมวดหมู่</label>
          <select
            id="recurring-category"
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
          >
            {visibleCategories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="recurring-amount">จำนวนเงิน</label>
          <input
            id="recurring-amount"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="recurring-day">วันที่ของเดือน</label>
          <input
            id="recurring-day"
            type="number"
            min="1"
            max="31"
            value={dayOfMonth}
            onChange={(event) => setDayOfMonth(event.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="recurring-start-month">เริ่มเดือน</label>
          <input
            id="recurring-start-month"
            type="month"
            value={startMonth}
            onChange={(event) => setStartMonth(event.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="recurring-end-month">
            สิ้นสุดเดือน (ไม่บังคับ)
          </label>
          <input
            id="recurring-end-month"
            type="month"
            min={startMonth}
            value={endMonth}
            onChange={(event) => setEndMonth(event.target.value)}
          />
        </div>

        <div className="recurring-action-row full-field">
          <button
            type="submit"
            className="primary-button"
            disabled={submitting}
          >
            {submitting
              ? "กำลังบันทึก…"
              : template
                ? "บันทึกการแก้ไข"
                : "เพิ่มรายการประจำ"}
          </button>
        </div>
        {error ? (
          <p className="form-error full-field" role="alert">
            {error}
          </p>
        ) : null}
      </form>

      {pendingUpdate ? (
        <div
          className="recurring-confirm-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="overwrite-recurring-title"
        >
          <div className="dialog-card">
            <h2 id="overwrite-recurring-title">
              รายการรอของเดือนนี้จะถูกแทนที่
            </h2>
            <p>
              การบันทึกจะแทนที่ประเภท จำนวนเงิน บัญชี หมวดหมู่
              สกุลเงิน และวันที่ที่ปรับไว้ในเดือนนี้
            </p>
            <div className="recurring-action-row">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setPendingUpdate(null)}
                disabled={submitting}
              >
                กลับ
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => void saveUpdate(pendingUpdate)}
                disabled={submitting}
              >
                ยืนยันและบันทึก
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

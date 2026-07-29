import type {
  Category,
  FinancialPlan
} from "@systems-credit/contracts";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import type { FinanceApi } from "../../lib/finance-api";
import { formatMoney } from "../../lib/money-display";

type BudgetPanelProps = Readonly<{
  api: FinanceApi;
  plan: FinancialPlan;
  categories: Category[];
  canEdit: boolean;
  onChanged(): void | Promise<void>;
}>;

function moneyClass(amount: string) {
  return amount.startsWith("-") ? "money-value negative" : "money-value";
}

function normalizeInputMoney(amount: string) {
  const [whole = "0", fraction = ""] = amount.split(".");
  return `${whole || "0"}.${fraction.padEnd(2, "0").slice(0, 2)}`;
}

function BudgetRow({
  api,
  plan,
  category,
  canEdit,
  onChanged
}: Readonly<{
  api: FinanceApi;
  plan: FinancialPlan;
  category: FinancialPlan["categories"][number];
  canEdit: boolean;
  onChanged(): void | Promise<void>;
}>) {
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(category.baseBudget);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const spent = Number(category.spent);
  const available = Number(category.available);
  const progress =
    available > 0 ? Math.min(100, Math.max(0, (spent / available) * 100)) : 0;

  async function save() {
    setBusy(true);
    setError("");
    try {
      await api.setMonthlyBudget({
        workspaceId: plan.workspaceId,
        categoryId: category.categoryId,
        month: plan.month,
        amount: normalizeInputMoney(amount),
        ...(category.allocationVersion
          ? { version: category.allocationVersion }
          : {})
      });
      setEditing(false);
      await onChanged();
    } catch {
      setError("ยังบันทึกงบไม่ได้ กรุณาลองอีกครั้ง");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (
      !category.allocationId ||
      !category.allocationVersion ||
      !window.confirm(`ลบงบ ${category.categoryName} ของเดือนนี้หรือไม่`)
    ) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.removeMonthlyBudget(category.allocationId, {
        version: category.allocationVersion
      });
      await onChanged();
    } catch {
      setError("ยังลบงบไม่ได้ กรุณาลองอีกครั้ง");
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr data-testid={`budget-row-${category.categoryId}`}>
      <th scope="row">
        <strong>{category.categoryName}</strong>
        {error ? <span className="inline-error">{error}</span> : null}
      </th>
      <td data-label="งบเดือนนี้">
        {editing ? (
          <input
            aria-label={`งบของ${category.categoryName}`}
            type="number"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        ) : (
          formatMoney(category.baseBudget, plan.currency)
        )}
      </td>
      <td data-label="ยอดยกมา">
        <span
          className={moneyClass(category.priorCarry)}
          aria-label={`ยอดยกมา ${category.priorCarry}`}
        >
          {formatMoney(category.priorCarry, plan.currency)}
        </span>
      </td>
      <td data-label="ใช้ได้">
        {formatMoney(category.available, plan.currency)}
      </td>
      <td data-label="ใช้ไป">
        {formatMoney(category.spent, plan.currency)}
        <span className="budget-progress" aria-hidden="true">
          <span style={{ width: `${progress}%` }} />
        </span>
      </td>
      <td data-label="เหลือ">
        <span
          className={moneyClass(category.remaining)}
          aria-label={`คงเหลือ ${category.remaining}`}
        >
          {formatMoney(category.remaining, plan.currency)}
        </span>
      </td>
      {canEdit ? (
        <td data-label="จัดการ">
          <div className="table-actions">
            {editing ? (
              <>
                <button
                  type="button"
                  className="small-button"
                  disabled={busy || !amount || Number(amount) <= 0}
                  onClick={() => void save()}
                >
                  บันทึก
                </button>
                <button
                  type="button"
                  className="small-button ghost"
                  disabled={busy}
                  onClick={() => {
                    setAmount(category.baseBudget);
                    setEditing(false);
                  }}
                >
                  ยกเลิก
                </button>
              </>
            ) : (
              <button
                type="button"
                className="icon-text-button"
                aria-label={`แก้ไข ${category.categoryName}`}
                onClick={() => setEditing(true)}
              >
                <Pencil size={16} aria-hidden="true" />
                แก้ไข
              </button>
            )}
            <button
              type="button"
              className="icon-text-button danger"
              aria-label={`ลบงบ ${category.categoryName}`}
              disabled={busy}
              onClick={() => void remove()}
            >
              <Trash2 size={16} aria-hidden="true" />
              ลบ
            </button>
          </div>
        </td>
      ) : null}
    </tr>
  );
}

export function BudgetPanel({
  api,
  plan,
  categories,
  canEdit,
  onChanged
}: BudgetPanelProps) {
  const [newCategoryId, setNewCategoryId] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const budgeted = plan.categories.filter((item) => item.isBudgeted);
  const unbudgeted = plan.categories.filter(
    (item) => !item.isBudgeted && Number(item.spent) !== 0
  );
  const availableCategories = useMemo(() => {
    const used = new Set(
      plan.categories
        .filter((item) => item.isBudgeted)
        .map((item) => item.categoryId)
    );
    return categories.filter(
      (category) => category.kind === "expense" && !used.has(category.id)
    );
  }, [categories, plan.categories]);

  async function addBudget() {
    setBusy(true);
    setError("");
    try {
      await api.setMonthlyBudget({
        workspaceId: plan.workspaceId,
        categoryId: newCategoryId,
        month: plan.month,
        amount: normalizeInputMoney(newAmount)
      });
      setNewCategoryId("");
      setNewAmount("");
      await onChanged();
    } catch {
      setError("ยังเพิ่มงบไม่ได้ กรุณาตรวจสอบข้อมูลแล้วลองอีกครั้ง");
    } finally {
      setBusy(false);
    }
  }

  const summary = [
    ["งบเดือนนี้", plan.totals.baseBudget],
    ["ยอดยกมาจากเดือนก่อน", plan.totals.priorCarry],
    ["ใช้ได้ทั้งหมด", plan.totals.available],
    ["ใช้ไป", plan.totals.spent],
    ["เหลือใช้จริง", plan.totals.remaining]
  ] as const;

  return (
    <section className="planning-budget-section">
      <div className="budget-summary-grid">
        {summary.map(([label, value]) => (
          <article className="content-card budget-summary-card" key={label}>
            <span>{label}</span>
            <strong
              className={moneyClass(value)}
              aria-label={`${label} ${value}`}
            >
              {formatMoney(value, plan.currency)}
            </strong>
            {label === "ยอดยกมาจากเดือนก่อน" ? (
              <small>เงินเหลือหรือใช้เกินสะสมจากเดือนก่อน ๆ</small>
            ) : null}
          </article>
        ))}
      </div>

      {canEdit && availableCategories.length > 0 ? (
        <section className="content-card budget-create-card">
          <div>
            <span className="eyebrow">กำหนดวงเงิน</span>
            <h2>เพิ่มงบรายหมวด</h2>
          </div>
          <div className="budget-create-fields">
            <label>
              <span>หมวดรายจ่าย</span>
              <select
                aria-label="หมวดรายจ่ายสำหรับงบ"
                value={newCategoryId}
                onChange={(event) => setNewCategoryId(event.target.value)}
              >
                <option value="">เลือกหมวด</option>
                {availableCategories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>งบเดือนนี้</span>
              <input
                aria-label="จำนวนงบใหม่"
                type="number"
                min="0.01"
                step="0.01"
                value={newAmount}
                onChange={(event) => setNewAmount(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="primary-button compact"
              disabled={
                busy ||
                !newCategoryId ||
                !newAmount ||
                Number(newAmount) <= 0
              }
              onClick={() => void addBudget()}
            >
              <Plus size={18} aria-hidden="true" />
              เพิ่มงบ
            </button>
          </div>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
        </section>
      ) : null}

      <section className="content-card budget-table-card">
        <div className="section-heading">
          <div>
            <span className="eyebrow">วงเงินรายหมวด</span>
            <h2>งบที่ตั้งไว้</h2>
          </div>
        </div>
        {budgeted.length > 0 ? (
          <div className="table-scroll">
            <table className="budget-category-table">
              <thead>
                <tr>
                  <th>หมวดหมู่</th>
                  <th>งบเดือนนี้</th>
                  <th>ยอดยกมา</th>
                  <th>ใช้ได้</th>
                  <th>ใช้ไป</th>
                  <th>เหลือ</th>
                  {canEdit ? <th>จัดการ</th> : null}
                </tr>
              </thead>
              <tbody>
                {budgeted.map((category) => (
                  <BudgetRow
                    key={category.categoryId}
                    api={api}
                    plan={plan}
                    category={category}
                    canEdit={canEdit}
                    onChanged={onChanged}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty-copy">เดือนนี้ยังไม่ได้ตั้งงบรายหมวด</p>
        )}
      </section>

      {unbudgeted.length > 0 ? (
        <section className="content-card unbudgeted-card">
          <div className="section-heading">
            <div>
              <span className="eyebrow">รายจ่ายนอกแผน</span>
              <h2>ไม่ได้ตั้งงบ</h2>
            </div>
          </div>
          <ul className="unbudgeted-list">
            {unbudgeted.map((category) => (
              <li key={category.categoryId}>
                <span>{category.categoryName}</span>
                <strong className="negative">
                  ใช้ไป {formatMoney(category.spent, plan.currency)}
                </strong>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}

import type {
  Account,
  FinancialPlan,
  SavingsGoalProgress
} from "@systems-credit/contracts";
import {
  Archive,
  CheckCircle2,
  Pencil,
  Plus,
  Target,
  X
} from "lucide-react";
import { useMemo, useState } from "react";

import type { FinanceApi } from "../../lib/finance-api";
import { formatMoney } from "../../lib/money-display";

type SavingsGoalsPanelProps = Readonly<{
  api: FinanceApi;
  plan: FinancialPlan;
  accounts: Account[];
  canEdit: boolean;
  onChanged(): void | Promise<void>;
}>;

function normalizeInputMoney(amount: string) {
  const [whole = "0", fraction = ""] = amount.split(".");
  return `${whole || "0"}.${fraction.padEnd(2, "0").slice(0, 2)}`;
}

export function SavingsGoalsPanel({
  api,
  plan,
  accounts,
  canEdit,
  onChanged
}: SavingsGoalsPanelProps) {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<SavingsGoalProgress | null>(null);
  const [name, setName] = useState("");
  const [targetAmount, setTargetAmount] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [accountId, setAccountId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const activeGoalAccountIds = useMemo(
    () =>
      new Set(
        plan.goals
          .filter((goal) => goal.status === "active")
          .map((goal) => goal.accountId)
      ),
    [plan.goals]
  );
  const accountOptions = accounts.filter(
    (account) =>
      ["cash", "bank", "ewallet", "asset"].includes(account.type) &&
      account.currency === plan.currency
  );

  function openCreate() {
    setEditing(null);
    setName("");
    setTargetAmount("");
    setTargetDate("");
    setAccountId("");
    setError("");
    setFormOpen(true);
  }

  function openEdit(goal: SavingsGoalProgress) {
    setEditing(goal);
    setName(goal.name);
    setTargetAmount(goal.targetAmount);
    setTargetDate(goal.targetDate ?? "");
    setAccountId(goal.accountId);
    setError("");
    setFormOpen(true);
  }

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const common = {
        name,
        targetAmount: normalizeInputMoney(targetAmount),
        currency: plan.currency,
        ...(targetDate ? { targetDate } : {}),
        accountId
      };
      if (editing) {
        await api.updateSavingsGoal(editing.id, {
          ...common,
          version: editing.version
        });
      } else {
        await api.createSavingsGoal({
          workspaceId: plan.workspaceId,
          ...common
        });
      }
      setFormOpen(false);
      setEditing(null);
      await onChanged();
    } catch {
      setError("ยังบันทึกเป้าหมายไม่ได้ กรุณาตรวจสอบข้อมูลแล้วลองอีกครั้ง");
    } finally {
      setBusy(false);
    }
  }

  async function archive(goal: SavingsGoalProgress) {
    if (!window.confirm(`เก็บเป้าหมาย ${goal.name} ออกจากรายการหรือไม่`)) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.archiveSavingsGoal(goal.id, { version: goal.version });
      if (editing?.id === goal.id) {
        setEditing(null);
        setFormOpen(false);
      }
      await onChanged();
    } catch {
      setError("ยังเก็บเป้าหมายไม่ได้ กรุณาลองอีกครั้ง");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="planning-savings-section">
      <div className="section-heading planning-savings-heading">
        <div>
          <span className="eyebrow">ผูกกับยอดจริงในบัญชี</span>
          <h2>เป้าหมายเงินออม</h2>
          <p>ยอดจะเพิ่มหรือลดตามเงินคงเหลือจริงในบัญชีที่เลือก</p>
        </div>
        {canEdit ? (
          <button
            type="button"
            className="primary-button compact"
            onClick={formOpen ? () => setFormOpen(false) : openCreate}
          >
            {formOpen ? (
              <X size={18} aria-hidden="true" />
            ) : (
              <Plus size={18} aria-hidden="true" />
            )}
            {formOpen ? "ปิดแบบฟอร์ม" : "เพิ่มเป้าหมาย"}
          </button>
        ) : null}
      </div>

      {formOpen && canEdit ? (
        <section className="content-card planning-dialog">
          <div>
            <span className="eyebrow">
              {editing ? "แก้ไขเป้าหมาย" : "เป้าหมายใหม่"}
            </span>
            <h3>{editing ? editing.name : "สร้างเป้าหมายเงินออม"}</h3>
          </div>
          <div className="planning-dialog-grid">
            <label>
              <span>ชื่อเป้าหมาย</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label>
              <span>ยอดเป้าหมาย</span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={targetAmount}
                onChange={(event) => setTargetAmount(event.target.value)}
              />
            </label>
            <label>
              <span>บัญชีเงินออม</span>
              <select
                value={accountId}
                onChange={(event) => setAccountId(event.target.value)}
              >
                <option value="">เลือกบัญชี</option>
                {accountOptions.map((account) => {
                  const alreadyUsed =
                    activeGoalAccountIds.has(account.id) &&
                    account.id !== editing?.accountId;
                  return (
                    <option
                      key={account.id}
                      value={account.id}
                      disabled={alreadyUsed}
                    >
                      {account.name}
                      {alreadyUsed ? " — มีเป้าหมายแล้ว" : ""}
                    </option>
                  );
                })}
              </select>
            </label>
            <label>
              <span>วันที่ต้องการถึงเป้า (ไม่บังคับ)</span>
              <input
                type="date"
                value={targetDate}
                onChange={(event) => setTargetDate(event.target.value)}
              />
            </label>
          </div>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <div className="planning-dialog-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => setFormOpen(false)}
            >
              ยกเลิก
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={
                busy ||
                !name.trim() ||
                !targetAmount ||
                Number(targetAmount) <= 0 ||
                !accountId
              }
              onClick={() => void submit()}
            >
              {editing ? "บันทึกการแก้ไข" : "สร้างเป้าหมาย"}
            </button>
          </div>
        </section>
      ) : null}

      {error && !formOpen ? (
        <p className="form-error" role="alert">{error}</p>
      ) : null}

      {plan.goals.length > 0 ? (
        <div className="savings-goal-grid">
          {plan.goals.map((goal) => (
            <article className="content-card savings-goal-card" key={goal.id}>
              <div className="goal-card-heading">
                <span className="goal-icon" aria-hidden="true">
                  <Target size={21} />
                </span>
                <div>
                  <h3>{goal.name}</h3>
                  <p>{goal.accountName}</p>
                </div>
              </div>
              <p className="goal-amount">
                {formatMoney(goal.currentAmount, goal.currency)} จาก{" "}
                {formatMoney(goal.targetAmount, goal.currency)}
              </p>
              <div
                className="goal-progress"
                role="progressbar"
                aria-label={`ความคืบหน้า ${goal.name}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={goal.percent}
              >
                <span style={{ width: `${goal.percent}%` }} />
              </div>
              <div className="goal-meta">
                <strong>{goal.percent}%</strong>
                {goal.targetDate ? (
                  <span>เป้าหมาย {goal.targetDate}</span>
                ) : (
                  <span>ไม่กำหนดวัน</span>
                )}
              </div>
              {goal.reached ? (
                <p className="goal-success">
                  <CheckCircle2 size={17} aria-hidden="true" />
                  ถึงเป้าแล้ว
                </p>
              ) : null}
              {goal.accountArchived ? (
                <p className="goal-warning">บัญชีนี้ถูกเก็บถาวรแล้ว</p>
              ) : null}
              {canEdit && goal.status === "active" ? (
                <div className="goal-actions">
                  <button
                    type="button"
                    className="icon-text-button"
                    aria-label={`แก้ไขเป้าหมาย ${goal.name}`}
                    onClick={() => openEdit(goal)}
                  >
                    <Pencil size={16} aria-hidden="true" />
                    แก้ไข
                  </button>
                  <button
                    type="button"
                    className="icon-text-button danger"
                    aria-label={`เก็บเป้าหมาย ${goal.name}`}
                    disabled={busy}
                    onClick={() => void archive(goal)}
                  >
                    <Archive size={16} aria-hidden="true" />
                    เก็บถาวร
                  </button>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <section className="content-card planning-empty">
          ยังไม่มีเป้าหมายเงินออม
        </section>
      )}
    </section>
  );
}

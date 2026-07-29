import type {
  FinanceSnapshot,
  FinancialPlan
} from "@systems-credit/contracts";
import { toFinancialDate } from "@systems-credit/domain";
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { FinanceApi } from "../../lib/finance-api";
import { BudgetPanel } from "./budget-panel";
import { SavingsGoalsPanel } from "./savings-goals-panel";

type PlanningPageProps = Readonly<{
  api: FinanceApi;
  snapshot: FinanceSnapshot;
  onChanged(): void | Promise<void>;
}>;

export function PlanningPage({
  api,
  snapshot,
  onChanged
}: PlanningPageProps) {
  const workspace = snapshot.workspace;
  const currentWorkspaceMonth = workspace
    ? toFinancialDate(
        new Date().toISOString(),
        workspace.timeZone
      ).slice(0, 7)
    : "";
  const [selectedMonth, setSelectedMonth] = useState(currentWorkspaceMonth);
  const [plan, setPlan] = useState<FinancialPlan | null>(null);
  const [loadState, setLoadState] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const canEdit =
    workspace?.role === "owner" || workspace?.role === "editor";

  const loadPlan = useCallback(async () => {
    if (!workspace || !selectedMonth) return;
    setLoadState("loading");
    try {
      if (canEdit && selectedMonth >= currentWorkspaceMonth) {
        await api.initializeBudgetMonth({
          workspaceId: workspace.id,
          month: selectedMonth
        });
      }
      const nextPlan = await api.getFinancialPlan(
        workspace.id,
        selectedMonth
      );
      setPlan(nextPlan);
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }, [
    api,
    canEdit,
    currentWorkspaceMonth,
    selectedMonth,
    workspace
  ]);

  useEffect(() => {
    void loadPlan();
  }, [loadPlan]);

  if (!workspace) return null;

  async function planningChanged() {
    await loadPlan();
    await onChanged();
  }

  return (
    <main className="page-content planning-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">วางแผนก่อนใช้เงินจริง</span>
          <h1>แผนการเงิน</h1>
          <p>
            กำหนดงบรายหมวด เห็นยอดยกมาจากเดือนก่อน
            และติดตามเงินออมจากยอดจริงในบัญชี
          </p>
        </div>
        <label className="month-selector">
          <span>เดือนที่แสดง</span>
          <input
            aria-label="เลือกเดือนแผน"
            type="month"
            value={selectedMonth}
            onChange={(event) => setSelectedMonth(event.target.value)}
          />
        </label>
      </div>

      {loadState === "loading" ? (
        <section className="content-card planning-status" role="status">
          <RefreshCw className="spin" size={20} aria-hidden="true" />
          กำลังโหลดแผนการเงิน…
        </section>
      ) : null}

      {loadState === "error" ? (
        <section className="content-card planning-status form-error" role="alert">
          <p>ยังโหลดแผนการเงินไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง</p>
          <button
            type="button"
            className="secondary-button"
            onClick={() => void loadPlan()}
          >
            ลองอีกครั้ง
          </button>
        </section>
      ) : null}

      {loadState === "ready" && plan ? (
        <>
          <BudgetPanel
            api={api}
            plan={plan}
            categories={snapshot.categories}
            canEdit={canEdit}
            onChanged={planningChanged}
          />
          <SavingsGoalsPanel
            api={api}
            plan={plan}
            accounts={snapshot.accounts}
            canEdit={canEdit}
            onChanged={planningChanged}
          />
        </>
      ) : null}
    </main>
  );
}

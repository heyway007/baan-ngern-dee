import {
  useEffect,
  useState
} from "react";
import { Plus, X } from "lucide-react";

import type {
  FinanceSnapshot,
  RecurringOccurrence,
  RecurringTemplate
} from "@systems-credit/contracts";
import { toFinancialDate } from "@systems-credit/domain";

import type { FinanceApi } from "../../lib/finance-api";
import { RecurringOccurrenceList } from "./recurring-occurrence-list";
import { RecurringSummary } from "./recurring-summary";
import { RecurringTemplateForm } from "./recurring-template-form";
import { RecurringTemplateManager } from "./recurring-template-manager";

type RecurringPageProps = Readonly<{
  api: FinanceApi;
  snapshot: FinanceSnapshot;
  onChanged(): void | Promise<void>;
}>;

export function RecurringPage({
  api,
  snapshot,
  onChanged
}: RecurringPageProps) {
  const workspace = snapshot.workspace;
  const currentPeriod = workspace
    ? toFinancialDate(
        new Date().toISOString(),
        workspace.timeZone
      ).slice(0, 7)
    : "";
  const [selectedPeriod, setSelectedPeriod] =
    useState(currentPeriod);
  const [historyOccurrences, setHistoryOccurrences] = useState<
    RecurringOccurrence[]
  >([]);
  const [historyState, setHistoryState] = useState<
    "idle" | "loading" | "error"
  >("idle");
  const [showTemplateForm, setShowTemplateForm] = useState(false);
  const [editingTemplate, setEditingTemplate] =
    useState<RecurringTemplate | undefined>();

  useEffect(() => {
    if (
      !workspace ||
      !selectedPeriod ||
      selectedPeriod === currentPeriod
    ) {
      setHistoryState("idle");
      setHistoryOccurrences([]);
      return;
    }
    let active = true;
    setHistoryState("loading");
    void api
      .getRecurringPeriod(workspace.id, selectedPeriod)
      .then((result) => {
        if (!active) return;
        setHistoryOccurrences(result.occurrences);
        setHistoryState("idle");
      })
      .catch(() => {
        if (active) setHistoryState("error");
      });
    return () => {
      active = false;
    };
  }, [api, currentPeriod, selectedPeriod, workspace]);

  if (!workspace) return null;
  const resolvedWorkspaceId = workspace.id;

  const isCurrent = selectedPeriod === currentPeriod;
  const occurrences = isCurrent
    ? snapshot.recurringOccurrences
    : historyOccurrences;
  const currentPendingOccurrence = editingTemplate
    ? snapshot.recurringOccurrences.find(
        (occurrence) =>
          occurrence.templateId === editingTemplate.id &&
          occurrence.status === "pending"
      )
    : undefined;

  async function templateChanged() {
    await api.materializeRecurringPeriod({
      workspaceId: resolvedWorkspaceId,
      period: currentPeriod
    });
    await onChanged();
    setShowTemplateForm(false);
    setEditingTemplate(undefined);
  }

  return (
    <main className="page-content recurring-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">รายรับและรายจ่ายที่เกิดซ้ำ</span>
          <h1>รายการประจำ</h1>
          <p>
            วางเงินเดือนและค่าใช้จ่ายประจำไว้ล่วงหน้า
            แล้วเลือกจ่าย ข้าม หรือปรับเฉพาะเดือนนี้ได้
          </p>
        </div>
        <div className="page-actions">
          <label className="month-selector">
            <span>เดือนที่แสดง</span>
            <input
              type="month"
              value={selectedPeriod}
              max={currentPeriod}
              onChange={(event) =>
                setSelectedPeriod(event.target.value)
              }
            />
          </label>
          {isCurrent ? (
            <button
              type="button"
              className="primary-button compact"
              onClick={() => {
                setEditingTemplate(undefined);
                setShowTemplateForm((value) => !value);
              }}
            >
              {showTemplateForm ? (
                <X size={18} aria-hidden="true" />
              ) : (
                <Plus size={18} aria-hidden="true" />
              )}
              {showTemplateForm
                ? "ปิดแบบฟอร์ม"
                : "เพิ่มรายการประจำ"}
            </button>
          ) : null}
        </div>
      </div>

      {showTemplateForm && isCurrent ? (
        <section className="content-card form-card">
          <div className="section-heading">
            <div>
              <span className="eyebrow">
                {editingTemplate ? "แก้ไขแม่แบบ" : "แม่แบบใหม่"}
              </span>
              <h2>
                {editingTemplate
                  ? `แก้ไข ${editingTemplate.name}`
                  : "เพิ่มรายการประจำ"}
              </h2>
            </div>
          </div>
          <RecurringTemplateForm
            key={editingTemplate?.id ?? "new-template"}
            api={api}
            workspaceId={resolvedWorkspaceId}
            currentPeriod={currentPeriod}
            accounts={snapshot.accounts}
            categories={snapshot.categories}
            template={editingTemplate}
            currentOccurrence={currentPendingOccurrence}
            onChanged={templateChanged}
          />
        </section>
      ) : null}

      <RecurringSummary occurrences={occurrences} />

      {!isCurrent && historyState === "loading" ? (
        <section className="content-card" role="status">
          กำลังโหลดประวัติรายการ…
        </section>
      ) : null}
      {!isCurrent && historyState === "error" ? (
        <section className="content-card form-error" role="alert">
          ยังโหลดประวัติรายการไม่ได้ กรุณาลองเลือกเดือนอีกครั้ง
        </section>
      ) : null}
      {isCurrent || historyState === "idle" ? (
        <RecurringOccurrenceList
          api={api}
          occurrences={occurrences}
          readOnly={!isCurrent}
          onChanged={onChanged}
        />
      ) : null}

      {isCurrent ? (
        <section className="content-card recurring-history">
          <RecurringTemplateManager
            api={api}
            templates={snapshot.recurringTemplates}
            onChanged={templateChanged}
            onEdit={(template) => {
              setEditingTemplate(template);
              setShowTemplateForm(true);
            }}
          />
        </section>
      ) : null}
    </main>
  );
}

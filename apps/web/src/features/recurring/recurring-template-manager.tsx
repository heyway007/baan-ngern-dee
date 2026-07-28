import { useState } from "react";

import type { RecurringTemplate } from "@systems-credit/contracts";

import type { FinanceApi } from "../../lib/finance-api";

type RecurringTemplateManagerProps = Readonly<{
  api: Pick<
    FinanceApi,
    | "pauseRecurringTemplate"
    | "resumeRecurringTemplate"
    | "cancelRecurringTemplate"
  >;
  templates: RecurringTemplate[];
  onChanged(): void | Promise<void>;
  onEdit?(template: RecurringTemplate): void;
}>;

const statusLabels: Record<RecurringTemplate["status"], string> = {
  active: "ใช้งานอยู่",
  paused: "พักไว้",
  cancelled: "ยกเลิกแล้ว"
};

const recurringMonthFormatter = new Intl.DateTimeFormat(
  "th-TH-u-ca-gregory-nu-latn",
  {
    month: "short",
    year: "numeric",
    timeZone: "UTC"
  }
);

function formatRecurringMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return recurringMonthFormatter.format(
    new Date(Date.UTC(year!, monthNumber! - 1, 1))
  );
}

export function RecurringTemplateManager({
  api,
  templates,
  onChanged,
  onEdit
}: RecurringTemplateManagerProps) {
  const [busyId, setBusyId] = useState("");
  const [cancelTarget, setCancelTarget] =
    useState<RecurringTemplate | null>(null);
  const [error, setError] = useState("");

  async function changeStatus(
    template: RecurringTemplate,
    action: "pause" | "resume" | "cancel"
  ) {
    setBusyId(template.id);
    setError("");
    try {
      if (action === "pause") {
        await api.pauseRecurringTemplate(template.id, {
          version: template.version
        });
      } else if (action === "resume") {
        await api.resumeRecurringTemplate(template.id, {
          version: template.version
        });
      } else {
        await api.cancelRecurringTemplate(template.id, {
          version: template.version
        });
      }
      setCancelTarget(null);
      await onChanged();
    } catch {
      setError(
        "ยังเปลี่ยนสถานะรายการไม่ได้ กรุณาลองอีกครั้ง"
      );
    } finally {
      setBusyId("");
    }
  }

  return (
    <section
      className="recurring-template-manager"
      aria-labelledby="recurring-template-manager-title"
    >
      <div className="section-heading">
        <div>
          <h2 id="recurring-template-manager-title">
            รายการประจำทั้งหมด
          </h2>
          <p>พักชั่วคราว เปิดใช้งานต่อ หรือยกเลิกได้จากที่นี่</p>
        </div>
      </div>

      {templates.length ? (
        <div className="recurring-template-list">
          {templates.map((template) => (
            <article
              className={`recurring-template-card ${template.status}`}
              key={template.id}
            >
              <div>
                <h3>{template.name}</h3>
                <p>
                  {template.amount} {template.currency} · วันที่{" "}
                  {template.dayOfMonth}
                </p>
                <p className="recurring-template-period">
                  เริ่ม {formatRecurringMonth(template.startMonth)}{" · "}
                  {template.endMonth
                    ? `สิ้นสุด ${formatRecurringMonth(template.endMonth)}`
                    : "ไม่มีกำหนดสิ้นสุด"}
                </p>
                <span className="status-pill">
                  {statusLabels[template.status]}
                </span>
              </div>
              {template.status !== "cancelled" ? (
                <div className="recurring-action-row">
                  {onEdit ? (
                    <button
                      type="button"
                      className="secondary-button compact"
                      onClick={() => onEdit(template)}
                      disabled={busyId === template.id}
                      aria-label={`แก้ไข ${template.name}`}
                    >
                      แก้ไข
                    </button>
                  ) : null}
                  {template.status === "active" ? (
                    <button
                      type="button"
                      className="secondary-button compact"
                      onClick={() =>
                        void changeStatus(template, "pause")
                      }
                      disabled={busyId === template.id}
                      aria-label={`พัก ${template.name}`}
                    >
                      พัก
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="secondary-button compact"
                      onClick={() =>
                        void changeStatus(template, "resume")
                      }
                      disabled={busyId === template.id}
                      aria-label={`ใช้งานต่อ ${template.name}`}
                    >
                      ใช้งานต่อ
                    </button>
                  )}
                  <button
                    type="button"
                    className="danger-button compact"
                    onClick={() => setCancelTarget(template)}
                    disabled={busyId === template.id}
                    aria-label={`ยกเลิก ${template.name}`}
                  >
                    ยกเลิก
                  </button>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <p className="empty-copy">ยังไม่มีรายการประจำ</p>
      )}

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      {cancelTarget ? (
        <div
          className="recurring-confirm-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cancel-recurring-title"
        >
          <div className="dialog-card">
            <h2 id="cancel-recurring-title">
              ยกเลิกรายการประจำถาวร
            </h2>
            <p>
              “{cancelTarget.name}” จะไม่สร้างรายการในเดือนถัดไป
              และไม่สามารถเปิดกลับมาใช้งานได้
            </p>
            <div className="recurring-action-row">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setCancelTarget(null)}
                disabled={busyId === cancelTarget.id}
              >
                กลับ
              </button>
              <button
                type="button"
                className="danger-button"
                onClick={() =>
                  void changeStatus(cancelTarget, "cancel")
                }
                disabled={busyId === cancelTarget.id}
              >
                ยกเลิกรายการถาวร
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

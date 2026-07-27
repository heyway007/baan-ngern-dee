import { Plus, Trash2 } from "lucide-react";

import type { ManualInstallmentRowInput } from "@systems-credit/contracts";

type ManualScheduleEditorProps = Readonly<{
  rows: ManualInstallmentRowInput[];
  onChange(rows: ManualInstallmentRowInput[]): void;
}>;

function nextMonthlyDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return value;
  }
  const year = Number.parseInt(match[1]!, 10);
  const month = Number.parseInt(match[2]!, 10);
  const day = Number.parseInt(match[3]!, 10);
  const nextMonthIndex = month;
  const nextYear = year + Math.floor(nextMonthIndex / 12);
  const normalizedMonth = nextMonthIndex % 12;
  const lastDay = new Date(
    Date.UTC(nextYear, normalizedMonth + 1, 0)
  ).getUTCDate();
  return [
    nextYear.toString().padStart(4, "0"),
    (normalizedMonth + 1).toString().padStart(2, "0"),
    Math.min(day, lastDay).toString().padStart(2, "0")
  ].join("-");
}

export function ManualScheduleEditor({
  rows,
  onChange
}: ManualScheduleEditorProps) {
  function updateRow(
    index: number,
    field: keyof ManualInstallmentRowInput,
    value: string
  ) {
    onChange(
      rows.map((row, rowIndex) =>
        rowIndex === index ? { ...row, [field]: value } : row
      )
    );
  }

  function addRow() {
    const previousDate = rows.at(-1)?.dueDate ?? "";
    onChange([
      ...rows,
      {
        dueDate: nextMonthlyDate(previousDate),
        principal: "0.00",
        interest: "0.00",
        fees: "0.00"
      }
    ]);
  }

  return (
    <section className="manual-schedule-editor full-field" aria-labelledby="manual-schedule-title">
      <div className="manual-schedule-heading">
        <div>
          <span className="eyebrow">ตามใบแจ้งหนี้จริง</span>
          <h3 id="manual-schedule-title">กำหนดแต่ละงวดเอง</h3>
        </div>
        <button type="button" className="secondary-button compact" onClick={addRow}>
          <Plus size={17} aria-hidden="true" />
          เพิ่มงวด
        </button>
      </div>

      <div className="manual-schedule-rows">
        {rows.map((row, index) => {
          const sequence = index + 1;
          return (
            <fieldset className="manual-schedule-row" key={sequence}>
              <legend>งวดที่ {sequence}</legend>
              <div className="field">
                <label htmlFor={`manual-date-${sequence}`}>
                  วันครบกำหนดงวดที่ {sequence}
                </label>
                <input
                  id={`manual-date-${sequence}`}
                  type="date"
                  value={row.dueDate}
                  onChange={(event) =>
                    updateRow(index, "dueDate", event.target.value)
                  }
                />
              </div>
              <div className="field">
                <label htmlFor={`manual-principal-${sequence}`}>
                  เงินต้นงวดที่ {sequence}
                </label>
                <input
                  id={`manual-principal-${sequence}`}
                  inputMode="decimal"
                  value={row.principal}
                  onChange={(event) =>
                    updateRow(index, "principal", event.target.value)
                  }
                />
              </div>
              <div className="field">
                <label htmlFor={`manual-interest-${sequence}`}>
                  ดอกเบี้ยงวดที่ {sequence}
                </label>
                <input
                  id={`manual-interest-${sequence}`}
                  inputMode="decimal"
                  value={row.interest}
                  onChange={(event) =>
                    updateRow(index, "interest", event.target.value)
                  }
                />
              </div>
              <div className="field">
                <label htmlFor={`manual-fees-${sequence}`}>
                  ค่าธรรมเนียมงวดที่ {sequence}
                </label>
                <input
                  id={`manual-fees-${sequence}`}
                  inputMode="decimal"
                  value={row.fees}
                  onChange={(event) =>
                    updateRow(index, "fees", event.target.value)
                  }
                />
              </div>
              {rows.length > 1 ? (
                <button
                  type="button"
                  className="icon-button danger"
                  aria-label={`ลบงวดที่ ${sequence}`}
                  onClick={() =>
                    onChange(rows.filter((_, rowIndex) => rowIndex !== index))
                  }
                >
                  <Trash2 size={17} aria-hidden="true" />
                </button>
              ) : null}
            </fieldset>
          );
        })}
      </div>
      <p className="field-help">
        เงินต้นทุกงวดต้องรวมเท่ากับเงินต้นที่นำไปผ่อน ระบบจะแยกดอกเบี้ยและค่าธรรมเนียมไม่ให้ถูกนับเป็นเงินต้น
      </p>
    </section>
  );
}

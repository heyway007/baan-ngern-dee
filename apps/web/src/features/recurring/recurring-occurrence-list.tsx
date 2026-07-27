import {
  useRef,
  useState
} from "react";

import type { RecurringOccurrence } from "@systems-credit/contracts";
import { resolveRecurringDate } from "@systems-credit/domain";

import type { FinanceApi } from "../../lib/finance-api";
import { formatMoney } from "../../lib/money-display";

type RecurringOccurrenceListProps = Readonly<{
  api: Pick<
    FinanceApi,
    | "updateRecurringOccurrence"
    | "skipRecurringOccurrence"
    | "postRecurringOccurrence"
  >;
  occurrences: readonly RecurringOccurrence[];
  readOnly?: boolean;
  onChanged(): void | Promise<void>;
}>;

type EditableOccurrenceProps = Readonly<{
  api: RecurringOccurrenceListProps["api"];
  occurrence: RecurringOccurrence;
  readOnly: boolean;
  mutationIds: React.MutableRefObject<Map<string, string>>;
  onChanged(): void | Promise<void>;
}>;

const positiveMoneyPattern =
  /^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/;

function EditableOccurrence({
  api,
  occurrence,
  readOnly,
  mutationIds,
  onChanged
}: EditableOccurrenceProps) {
  const [amount, setAmount] = useState(occurrence.amount);
  const [scheduledDate, setScheduledDate] = useState(
    occurrence.scheduledDate
  );
  const [busyAction, setBusyAction] = useState("");
  const [error, setError] = useState("");

  async function update() {
    if (
      !positiveMoneyPattern.test(amount) ||
      !/[1-9]/.test(amount) ||
      !scheduledDate.startsWith(`${occurrence.period}-`)
    ) {
      setError(
        "กรุณาตรวจสอบจำนวนเงินและวันที่ซึ่งต้องอยู่ในเดือนที่เลือก"
      );
      return;
    }
    setBusyAction("update");
    setError("");
    try {
      await api.updateRecurringOccurrence(occurrence.id, {
        amount,
        scheduledDate,
        version: occurrence.version
      });
      await onChanged();
    } catch {
      setError("ยังบันทึกการแก้ไขไม่ได้ กรุณาลองอีกครั้ง");
    } finally {
      setBusyAction("");
    }
  }

  async function skip() {
    setBusyAction("skip");
    setError("");
    try {
      await api.skipRecurringOccurrence(occurrence.id, {
        version: occurrence.version
      });
      await onChanged();
    } catch {
      setError("ยังข้ามรายการเดือนนี้ไม่ได้ กรุณาลองอีกครั้ง");
    } finally {
      setBusyAction("");
    }
  }

  async function post() {
    let clientMutationId = mutationIds.current.get(occurrence.id);
    if (!clientMutationId) {
      clientMutationId = crypto.randomUUID();
      mutationIds.current.set(occurrence.id, clientMutationId);
    }
    setBusyAction("post");
    setError("");
    try {
      await api.postRecurringOccurrence(occurrence.id, {
        version: occurrence.version,
        clientMutationId
      });
      await onChanged();
    } catch {
      setError("ยังบันทึกรายการไม่ได้ กรุณาลองอีกครั้ง");
    } finally {
      setBusyAction("");
    }
  }

  const busy = Boolean(busyAction);
  return (
    <article
      className={`recurring-occurrence-card ${occurrence.status}`}
    >
      <div className="recurring-occurrence-heading">
        <div>
          <h3>{occurrence.name}</h3>
          <p>
            {occurrence.scheduledDate} ·{" "}
            {formatMoney(occurrence.amount, occurrence.currency)}
          </p>
        </div>
        <span className="status-pill">
          {occurrence.status === "pending"
            ? "รอดำเนินการ"
            : occurrence.status === "posted"
              ? "บันทึกแล้ว"
              : "ข้ามแล้ว"}
        </span>
      </div>

      {!readOnly && occurrence.status === "pending" ? (
        <>
          <div className="recurring-occurrence-edit">
            <div className="field">
              <label htmlFor={`recurring-amount-${occurrence.id}`}>
                ยอดของ {occurrence.name}
              </label>
              <input
                id={`recurring-amount-${occurrence.id}`}
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor={`recurring-date-${occurrence.id}`}>
                วันที่ของ {occurrence.name}
              </label>
              <input
                id={`recurring-date-${occurrence.id}`}
                type="date"
                min={`${occurrence.period}-01`}
                max={resolveRecurringDate(occurrence.period, 31)}
                value={scheduledDate}
                onChange={(event) =>
                  setScheduledDate(event.target.value)
                }
              />
            </div>
          </div>
          <div className="recurring-action-row">
            <button
              type="button"
              className="secondary-button compact"
              onClick={() => void update()}
              disabled={busy}
              aria-label={`บันทึกการแก้ไข ${occurrence.name}`}
            >
              บันทึกการแก้ไข
            </button>
            <button
              type="button"
              className="secondary-button compact"
              onClick={() => void skip()}
              disabled={busy}
              aria-label={`ข้ามเดือนนี้ ${occurrence.name}`}
            >
              ข้ามเดือนนี้
            </button>
            <button
              type="button"
              className="primary-button compact"
              onClick={() => void post()}
              disabled={busy}
              aria-label={`จ่ายแล้ว ${occurrence.name}`}
            >
              {busyAction === "post" ? "กำลังบันทึก…" : "จ่ายแล้ว"}
            </button>
          </div>
        </>
      ) : null}

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </article>
  );
}

function sorted(items: readonly RecurringOccurrence[]) {
  return [...items].sort(
    (left, right) =>
      left.scheduledDate.localeCompare(right.scheduledDate) ||
      left.name.localeCompare(right.name, "th")
  );
}

export function RecurringOccurrenceList({
  api,
  occurrences,
  readOnly = false,
  onChanged
}: RecurringOccurrenceListProps) {
  const mutationIds = useRef(new Map<string, string>());
  const pendingIncome = sorted(
    occurrences.filter(
      (item) => item.status === "pending" && item.kind === "income"
    )
  );
  const pendingExpense = sorted(
    occurrences.filter(
      (item) => item.status === "pending" && item.kind === "expense"
    )
  );
  const completed = sorted(
    occurrences.filter((item) => item.status !== "pending")
  );

  const groups = readOnly
    ? [{ title: "ประวัติรายการ", items: sorted(occurrences) }]
    : [
        { title: "รอรับ", items: pendingIncome },
        { title: "รอจ่าย", items: pendingExpense },
        { title: "ดำเนินการแล้ว", items: completed }
      ];

  return (
    <div className="recurring-occurrence-list">
      {groups.map((group) => (
        <section
          className="content-card recurring-occurrence-group"
          key={group.title}
        >
          <div className="section-heading">
            <h2>{group.title}</h2>
            <span>{group.items.length} รายการ</span>
          </div>
          {group.items.length ? (
            <div className="recurring-occurrence-items">
              {group.items.map((item) => (
                <EditableOccurrence
                  api={api}
                  occurrence={item}
                  readOnly={readOnly}
                  mutationIds={mutationIds}
                  onChanged={onChanged}
                  key={item.id}
                />
              ))}
            </div>
          ) : (
            <p className="empty-copy">ไม่มีรายการ</p>
          )}
        </section>
      ))}
    </div>
  );
}

import { useEffect, useRef } from "react";
import { Pencil, RefreshCw, Save, Trash2, Upload } from "lucide-react";

import type { Account, Category } from "@systems-credit/contracts";

import {
  batchTotals,
  canConfirmBatch,
  type SlipBatchRow,
  type SlipBatchStatus
} from "./slip-batch-queue";

const statusText: Record<SlipBatchStatus, string> = {
  preparing: "กำลังเตรียมรูป",
  queued: "รออ่านข้อมูล",
  analyzing: "กำลังอ่านข้อมูล",
  ready: "พร้อมบันทึก",
  needs_review: "ต้องตรวจสอบ",
  duplicate: "รายการซ้ำ",
  unsupported: "ไม่รองรับเอกสาร",
  failed: "อ่านไม่สำเร็จ",
  quota_blocked: "โควตาวันนี้เต็ม"
};

type Props = Readonly<{
  rows: readonly SlipBatchRow[];
  accounts?: readonly Account[];
  categories?: readonly Category[];
  blockedItemId?: string;
  confirming?: boolean;
  onEdit(itemId: string): void;
  onRetry(itemId: string): void;
  onReplace(itemId: string, file: File): void;
  onRemove(itemId: string): void;
  onConfirm(): void;
}>;

function typeLabel(row: SlipBatchRow) {
  const type = row.transaction?.type ?? row.draft?.type;
  return type === "income" ? "รายรับ" : type === "expense" ? "รายจ่าย" : "—";
}

export function SlipBatchTable({
  rows,
  accounts = [],
  categories = [],
  blockedItemId,
  confirming = false,
  onEdit,
  onRetry,
  onReplace,
  onRemove,
  onConfirm
}: Props) {
  const rowElements = useRef(new Map<string, HTMLTableRowElement>());
  const totals = batchTotals(rows);
  const readyCount = rows.filter((row) => row.status === "ready").length;
  const accountNames = new Map(
    accounts.map((account) => [account.id, account.name])
  );
  const categoryNames = new Map(
    categories.map((category) => [category.id, category.name])
  );

  useEffect(() => {
    if (blockedItemId) rowElements.current.get(blockedItemId)?.focus();
  }, [blockedItemId]);

  return (
    <div className="slip-batch-review">
      <div className="slip-batch-table-wrap">
        <table className="slip-batch-table">
          <thead>
            <tr>
              <th>ไฟล์</th>
              <th>สถานะ</th>
              <th>ประเภท</th>
              <th>จำนวนเงิน</th>
              <th>วันที่</th>
              <th>บัญชี / หมวดหมู่</th>
              <th>จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const transaction = row.transaction;
              const draft = row.draft;
              const accountId = transaction?.accountId ?? draft?.accountId;
              const categoryId =
                transaction?.categoryId ?? draft?.categoryId;
              const amount = transaction?.amount ?? draft?.amount;
              const currency =
                transaction?.currency ?? draft?.currency;
              const financialDate =
                transaction?.financialDate ?? draft?.financialDate;
              const editable =
                row.status === "ready" || row.status === "needs_review";
              const retryable =
                row.status === "failed" ||
                row.status === "quota_blocked";
              return (
                <tr
                  key={row.itemId}
                  ref={(element) => {
                    if (element) {
                      rowElements.current.set(row.itemId, element);
                    } else {
                      rowElements.current.delete(row.itemId);
                    }
                  }}
                  tabIndex={-1}
                  aria-label={`รายการ ${row.fileName}`}
                  data-item-id={row.itemId}
                  data-status={row.status}
                >
                  <td data-label="ไฟล์">
                    <strong>{row.fileName}</strong>
                  </td>
                  <td data-label="สถานะ">
                    <span className={`slip-batch-status ${row.status}`}>
                      {statusText[row.status]}
                    </span>
                    {row.error ? <small>{row.error}</small> : null}
                  </td>
                  <td data-label="ประเภท">{typeLabel(row)}</td>
                  <td data-label="จำนวนเงิน">
                    {amount ? `${currency ?? ""} ${amount}` : "—"}
                  </td>
                  <td data-label="วันที่">{financialDate ?? "—"}</td>
                  <td data-label="บัญชี / หมวดหมู่">
                    <span>
                      {accountId
                        ? accountNames.get(accountId) ?? accountId
                        : "—"}
                    </span>
                    <small>
                      {categoryId
                        ? categoryNames.get(categoryId) ?? categoryId
                        : "—"}
                    </small>
                  </td>
                  <td data-label="จัดการ">
                    <div className="slip-batch-row-actions">
                      {editable ? (
                        <button
                          type="button"
                          disabled={confirming}
                          onClick={() => onEdit(row.itemId)}
                          aria-label={`แก้ไข ${row.fileName}`}
                        >
                          <Pencil size={15} aria-hidden="true" />
                          แก้ไข
                        </button>
                      ) : null}
                      {retryable ? (
                        <button
                          type="button"
                          disabled={confirming}
                          onClick={() => onRetry(row.itemId)}
                          aria-label={`ลองใหม่ ${row.fileName}`}
                        >
                          <RefreshCw size={15} aria-hidden="true" />
                          ลองใหม่
                        </button>
                      ) : null}
                      <label>
                        <Upload size={15} aria-hidden="true" />
                        เปลี่ยนรูป
                        <input
                          type="file"
                          disabled={confirming}
                          accept="image/jpeg,image/png,image/webp"
                          aria-label={`เปลี่ยนรูป ${row.fileName}`}
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) onReplace(row.itemId, file);
                            event.target.value = "";
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        disabled={confirming}
                        onClick={() => onRemove(row.itemId)}
                        aria-label={`ลบ ${row.fileName}`}
                      >
                        <Trash2 size={15} aria-hidden="true" />
                        ลบ
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="slip-batch-summary" aria-label="สรุปยอดรายการ">
        <div>
          <strong>รายรับ</strong>
          {Object.entries(totals.income).length > 0
            ? Object.entries(totals.income).map(([currency, amount]) => (
                <span key={currency}>
                  {`รายรับ ${currency} ${amount}`}
                </span>
              ))
            : <span>ยังไม่มี</span>}
        </div>
        <div>
          <strong>รายจ่าย</strong>
          {Object.entries(totals.expense).length > 0
            ? Object.entries(totals.expense).map(([currency, amount]) => (
                <span key={currency}>
                  {`รายจ่าย ${currency} ${amount}`}
                </span>
              ))
            : <span>ยังไม่มี</span>}
        </div>
        <button
          type="button"
          className="primary-button"
          disabled={confirming || !canConfirmBatch(rows)}
          onClick={onConfirm}
        >
          <Save size={18} aria-hidden="true" />
          {confirming
            ? "กำลังบันทึกทั้งชุด…"
            : `บันทึก ${readyCount} รายการ`}
        </button>
      </div>
    </div>
  );
}

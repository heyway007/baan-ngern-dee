import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent
} from "react";
import { Camera, Images, X } from "lucide-react";

import type {
  Account,
  Category,
  CreateTransactionInput,
  SlipTransactionDraft
} from "@systems-credit/contracts";

import type { FinanceApi } from "../../lib/finance-api";
import { RemoteFinanceError } from "../../lib/remote-finance-api";
import {
  createConcurrencyLimiter,
  createSlipBatchRow,
  disposeSlipBatchRows,
  reduceSlipBatchRows,
  runBounded,
  type SlipBatchAction,
  type SlipBatchRow
} from "./slip-batch-queue";
import { SlipBatchTable } from "./slip-batch-table";
import {
  prepareSlipImage,
  type PreparedSlipImage
} from "./slip-image";
import { TransactionForm } from "./transaction-form";

const MAX_FILES = 10;
const ACCEPTED_IMAGES = "image/jpeg,image/png,image/webp";

type Props = Readonly<{
  api: FinanceApi;
  workspaceId: string;
  accounts: Account[];
  categories: Category[];
  onClose(): void;
  onPosted(): void;
  onManual(): void;
}>;

function completeTransaction(
  workspaceId: string,
  itemId: string,
  draft: SlipTransactionDraft
): CreateTransactionInput | undefined {
  if (
    draft.fieldsNeedingReview.length > 0 ||
    !draft.amount ||
    !draft.financialDate ||
    !draft.accountId ||
    !draft.categoryId
  ) {
    return undefined;
  }
  return {
    workspaceId,
    accountId: draft.accountId,
    categoryId: draft.categoryId,
    type: draft.type,
    amount: draft.amount,
    currency: draft.currency,
    financialDate: draft.financialDate,
    ...(draft.note ? { note: draft.note } : {}),
    tagIds: [],
    clientMutationId: itemId
  };
}

function analysisError(reason: unknown) {
  if (reason instanceof RemoteFinanceError) {
    return reason.code === "RATE_LIMITED"
      ? "ใช้โควตาอ่านสลิปครบ 30 รูปของวันนี้แล้ว"
      : "ยังอ่านรูปไม่ได้ กรุณาลองใหม่หรือเปลี่ยนรูป";
  }
  return "ยังอ่านรูปไม่ได้ กรุณาลองใหม่หรือเปลี่ยนรูป";
}

export function SlipImportDialog({
  api,
  workspaceId,
  accounts,
  categories,
  onClose,
  onPosted,
  onManual
}: Props) {
  const [rows, setRows] = useState<SlipBatchRow[]>([]);
  const rowsRef = useRef<SlipBatchRow[]>([]);
  const [error, setError] = useState("");
  const [quota, setQuota] = useState({ used: 0, limit: 30 as const });
  const [editingItemId, setEditingItemId] = useState<string>();
  const [blockedItemId, setBlockedItemId] = useState<string>();
  const [confirming, setConfirming] = useState(false);
  const confirmInFlight = useRef(false);
  const batchMutationId = useRef(crypto.randomUUID());
  const mounted = useRef(true);
  const quotaReached = useRef(false);
  const limitAnalysis = useRef(createConcurrencyLimiter(2)).current;

  function dispatch(action: SlipBatchAction) {
    const next = reduceSlipBatchRows(rowsRef.current, action);
    rowsRef.current = next;
    if (mounted.current) setRows(next);
    return next;
  }

  useEffect(() => {
    mounted.current = true;
    void api.getSlipQuota(workspaceId)
      .then((nextQuota) => {
        if (!mounted.current) return;
        setQuota((current) => ({
          used: Math.max(current.used, nextQuota.used),
          limit: 30
        }));
        quotaReached.current = nextQuota.used >= nextQuota.limit;
      })
      .catch(() => undefined);
    return () => {
      mounted.current = false;
      disposeSlipBatchRows(rowsRef.current);
      rowsRef.current = [];
    };
  }, [api, workspaceId]);

  async function analyzeRow(row: SlipBatchRow) {
    const current = rowsRef.current.find(
      (candidate) =>
        candidate.itemId === row.itemId &&
        candidate.revision === row.revision &&
        candidate.status === "queued"
    );
    if (!mounted.current || !current) return;
    if (!row.image || quotaReached.current) {
      dispatch({ type: "quota_blocked" });
      return;
    }
    const { itemId, revision, image } = row;
    dispatch({ type: "analysis_started", itemId, revision });
    try {
      const response = await api.analyzeSlip({
        workspaceId,
        clientMutationId: itemId,
        imageSha256: image.sha256,
        image: image.blob
      });
      setQuota((current) => ({
        used: Math.min(current.limit, current.used + 1),
        limit: 30
      }));
      if (response.status === "success") {
        dispatch({
          type: "analysis_success",
          itemId,
          revision,
          analysisToken: response.analysisToken,
          analysisExpiresAt: response.analysisExpiresAt,
          draft: response.draft,
          transaction: completeTransaction(
            workspaceId,
            itemId,
            response.draft
          )
        });
        return;
      }
      if (response.status === "duplicate") {
        dispatch({
          type: "analysis_duplicate",
          itemId,
          revision,
          duplicate: response.existingTransaction
        });
        return;
      }
      dispatch({ type: "analysis_unsupported", itemId, revision });
    } catch (reason) {
      if (
        reason instanceof RemoteFinanceError &&
        reason.code === "RATE_LIMITED"
      ) {
        quotaReached.current = true;
        setQuota({ used: 30, limit: 30 });
        dispatch({ type: "quota_blocked" });
        return;
      }
      dispatch({
        type: "analysis_failed",
        itemId,
        revision,
        error: analysisError(reason)
      });
    }
  }

  async function prepareAndAnalyze(
    entries: readonly Readonly<{
      itemId: string;
      revision: number;
      file: File;
    }>[]
  ) {
    for (const entry of entries) {
      try {
        const image = await prepareSlipImage(entry.file);
        dispatch({
          type: "prepared",
          itemId: entry.itemId,
          revision: entry.revision,
          image
        });
      } catch (reason) {
        dispatch({
          type: "analysis_failed",
          itemId: entry.itemId,
          revision: entry.revision,
          error: reason instanceof Error
            ? reason.message
            : "เตรียมรูปไม่สำเร็จ"
        });
      }
    }
    const ids = new Set(entries.map((entry) => entry.itemId));
    const queued = rowsRef.current.filter(
      (row) => ids.has(row.itemId) && row.status === "queued"
    );
    await runBounded(
      queued,
      2,
      (row) => limitAnalysis(() => analyzeRow(row))
    );
  }

  async function addFiles(files: readonly File[]) {
    if (confirmInFlight.current) return;
    setError("");
    if (files.length === 0) return;
    if (
      files.length > MAX_FILES ||
      rowsRef.current.length + files.length > MAX_FILES
    ) {
      setError("เลือกได้ไม่เกิน 10 รูป");
      return;
    }
    const entries = files.map((file) => {
      const itemId = crypto.randomUUID();
      const row = createSlipBatchRow(itemId, file.name);
      rowsRef.current = [...rowsRef.current, row];
      return { itemId, revision: row.revision, file };
    });
    setRows([...rowsRef.current]);
    await prepareAndAnalyze(entries);
  }

  function readFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    void addFiles(files);
  }

  function close() {
    if (confirmInFlight.current) return;
    if (
      rowsRef.current.length > 0 &&
      !window.confirm("ยังมีรายการที่ยังไม่ได้บันทึก ต้องการปิดหรือไม่")
    ) {
      return;
    }
    disposeSlipBatchRows(rowsRef.current);
    rowsRef.current = [];
    setRows([]);
    onClose();
  }

  function manual() {
    if (confirmInFlight.current) return;
    disposeSlipBatchRows(rowsRef.current);
    rowsRef.current = [];
    setRows([]);
    onManual();
  }

  function retry(itemId: string) {
    if (confirmInFlight.current) return;
    const next = dispatch({ type: "retry", itemId });
    const row = next.find((candidate) => candidate.itemId === itemId);
    if (row?.status === "queued") {
      void limitAnalysis(() => analyzeRow(row));
    }
  }

  function replace(itemId: string, file: File) {
    if (confirmInFlight.current) return;
    const next = dispatch({ type: "replace", itemId, fileName: file.name });
    const row = next.find((candidate) => candidate.itemId === itemId);
    if (row) {
      void prepareAndAnalyze([{
        itemId,
        revision: row.revision,
        file
      }]);
    }
  }

  async function confirmBatch() {
    const readyRows = rowsRef.current.filter(
      (row) =>
        row.status === "ready" &&
        row.analysisToken &&
        row.transaction
    );
    if (readyRows.length === 0 || confirmInFlight.current) return;
    confirmInFlight.current = true;
    setConfirming(true);
    setError("");
    setBlockedItemId(undefined);
    try {
      const result = await api.confirmSlipBatch({
        workspaceId,
        batchMutationId: batchMutationId.current,
        items: readyRows.map((row) => ({
          itemId: row.itemId,
          analysisToken: row.analysisToken!,
          transaction: row.transaction!
        }))
      });
      if (result.status === "posted") {
        disposeSlipBatchRows(rowsRef.current);
        rowsRef.current = [];
        setRows([]);
        batchMutationId.current = crypto.randomUUID();
        onPosted();
        return;
      }
      result.issues.forEach((issue) => {
        dispatch({
          type: "confirmation_issue",
          itemId: issue.itemId,
          code: issue.code
        });
      });
      setBlockedItemId(result.issues[0]?.itemId);
      setError("ยังบันทึกไม่ได้ กรุณาตรวจสอบรายการที่ระบบระบุ");
    } catch {
      setError(
        "ยังบันทึกรายการทั้งชุดไม่ได้ กรุณาลองอีกครั้ง โดยระบบจะไม่บันทึกซ้ำ"
      );
    } finally {
      confirmInFlight.current = false;
      if (mounted.current) setConfirming(false);
    }
  }

  const editingRow = editingItemId
    ? rows.find((row) => row.itemId === editingItemId)
    : undefined;

  return (
    <div className="slip-dialog-backdrop" role="presentation">
      <section
        className="slip-dialog slip-batch-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="slip-dialog-title"
      >
        <div className="slip-dialog-heading">
          <div>
            <span className="eyebrow">เพิ่มรายการจากรูปหลายใบ</span>
            <h2 id="slip-dialog-title">อ่านสลิปหรือใบเสร็จ</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="ปิดหน้าต่างอ่านสลิป"
            onClick={close}
            disabled={confirming}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <div className="slip-batch-notice">
          <p>
            เลือกได้ครั้งละไม่เกิน 10 รูป ระบบอ่านพร้อมกันสูงสุด 2 รูป
            โดยส่งให้ Cloudflare AI และไม่เก็บไฟล์ภาพหลังประมวลผล
          </p>
          <strong>วันนี้ใช้ {quota.used}/{quota.limit} รูป</strong>
        </div>

        {!editingRow ? (
          <>
            <div className="slip-file-picker-options">
              <label className="slip-file-picker">
                <Images size={24} aria-hidden="true" />
                <strong>เลือกจากคลังภาพ</strong>
                <span>เลือกสลิปหรือใบเสร็จได้หลายรูป</span>
                <input
                  type="file"
                  accept={ACCEPTED_IMAGES}
                  aria-label="เลือกจากคลังภาพ"
                  multiple
                  disabled={confirming}
                  onChange={readFiles}
                />
              </label>
              <label className="slip-file-picker">
                <Camera size={24} aria-hidden="true" />
                <strong>ถ่ายรูปใหม่</strong>
                <span>เปิดกล้องหลังเพื่อถ่ายครั้งละหนึ่งรูป</span>
                <input
                  type="file"
                  accept={ACCEPTED_IMAGES}
                  capture="environment"
                  disabled={confirming}
                  aria-label="ถ่ายรูปใหม่"
                  onChange={readFiles}
                />
              </label>
            </div>
            <p className="slip-file-help">
              รองรับ JPG, PNG, WebP รูปละไม่เกิน 5 MB
            </p>
            {error ? (
              <p className="form-error" role="alert">{error}</p>
            ) : null}

            {rows.length > 0 ? (
              <SlipBatchTable
                rows={rows}
                accounts={accounts}
                categories={categories}
                blockedItemId={blockedItemId}
                confirming={confirming}
                onEdit={(itemId) => {
                  if (!confirmInFlight.current) setEditingItemId(itemId);
                }}
                onRetry={retry}
                onReplace={replace}
                onRemove={(itemId) => {
                  if (!confirmInFlight.current) {
                    dispatch({ type: "remove", itemId });
                  }
                }}
                onConfirm={() => void confirmBatch()}
              />
            ) : (
              <div className="slip-batch-empty">
                เลือกรูปแล้วระบบจะเริ่มอ่านข้อมูลให้อัตโนมัติ
              </div>
            )}

            <div className="slip-dialog-actions slip-batch-footer">
              <button
                type="button"
                className="secondary-button"
                onClick={manual}
                disabled={confirming}
              >
                กรอกเอง
              </button>
            </div>
          </>
        ) : (
          <div className="slip-review">
            <div className="slip-review-heading">
              <strong>ตรวจสอบ {editingRow.fileName}</strong>
              <span>แก้ข้อมูลให้ครบก่อนนำกลับไปบันทึกทั้งชุด</span>
            </div>
            <TransactionForm
              mode="review"
              workspaceId={workspaceId}
              accounts={accounts}
              categories={categories}
              initialDraft={editingRow.draft!}
              initialTransaction={editingRow.transaction}
              clientMutationId={editingRow.itemId}
              onReviewed={(transaction) => {
                dispatch({
                  type: "reviewed",
                  itemId: editingRow.itemId,
                  revision: editingRow.revision,
                  transaction
                });
                setEditingItemId(undefined);
              }}
              onCancel={() => setEditingItemId(undefined)}
            />
          </div>
        )}
      </section>
    </div>
  );
}

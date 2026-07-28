import type {
  ConfirmSlipBatchResult,
  CreateTransactionInput,
  DuplicateTransaction,
  SlipTransactionDraft
} from "@systems-credit/contracts";
import { sumMoney } from "@systems-credit/domain";

import type { PreparedSlipImage } from "./slip-image";

export type SlipBatchStatus =
  | "preparing"
  | "queued"
  | "analyzing"
  | "ready"
  | "needs_review"
  | "duplicate"
  | "unsupported"
  | "failed"
  | "quota_blocked";

export type SlipBatchRow = Readonly<{
  itemId: string;
  fileName: string;
  revision: number;
  status: SlipBatchStatus;
  image?: PreparedSlipImage;
  analysisToken?: string;
  analysisExpiresAt?: string;
  draft?: SlipTransactionDraft;
  transaction?: CreateTransactionInput;
  duplicate?: DuplicateTransaction;
  error?: string;
}>;

export type SlipBatchAction =
  | Readonly<{
      type: "prepared";
      itemId: string;
      revision: number;
      image: PreparedSlipImage;
    }>
  | Readonly<{
      type: "analysis_started";
      itemId: string;
      revision: number;
    }>
  | Readonly<{
      type: "analysis_success";
      itemId: string;
      revision: number;
      analysisToken: string;
      analysisExpiresAt: string;
      draft: SlipTransactionDraft;
      transaction?: CreateTransactionInput;
    }>
  | Readonly<{
      type: "analysis_duplicate";
      itemId: string;
      revision: number;
      duplicate: DuplicateTransaction;
    }>
  | Readonly<{
      type: "analysis_unsupported";
      itemId: string;
      revision: number;
    }>
  | Readonly<{
      type: "analysis_failed";
      itemId: string;
      revision: number;
      error: string;
    }>
  | Readonly<{
      type: "reviewed";
      itemId: string;
      revision: number;
      transaction: CreateTransactionInput;
    }>
  | Readonly<{ type: "retry"; itemId: string }>
  | Readonly<{
      type: "replace";
      itemId: string;
      fileName: string;
    }>
  | Readonly<{ type: "remove"; itemId: string }>
  | Readonly<{ type: "quota_blocked" }>
  | Readonly<{
      type: "confirmation_issue";
      itemId: string;
      code: Extract<
        ConfirmSlipBatchResult,
        { status: "blocked" }
      >["issues"][number]["code"];
    }>;

export function createSlipBatchRow(
  itemId: string,
  fileName: string
): SlipBatchRow {
  return {
    itemId,
    fileName,
    revision: 0,
    status: "preparing"
  };
}

function updateRevision(
  rows: readonly SlipBatchRow[],
  itemId: string,
  revision: number,
  update: (row: SlipBatchRow) => SlipBatchRow
): SlipBatchRow[] {
  return rows.map((row) =>
    row.itemId === itemId && row.revision === revision
      ? update(row)
      : row
  );
}

export function reduceSlipBatchRows(
  rows: readonly SlipBatchRow[],
  action: SlipBatchAction
): SlipBatchRow[] {
  if (action.type === "remove") {
    const removed = rows.find((row) => row.itemId === action.itemId);
    removed?.image?.dispose();
    return rows.filter((row) => row.itemId !== action.itemId);
  }
  if (action.type === "replace") {
    return rows.map((row) => {
      if (row.itemId !== action.itemId) return row;
      row.image?.dispose();
      return {
        itemId: row.itemId,
        fileName: action.fileName,
        revision: row.revision + 1,
        status: "preparing"
      };
    });
  }
  if (action.type === "quota_blocked") {
    return rows.map((row) =>
      row.status === "queued" || row.status === "analyzing"
        ? { ...row, status: "quota_blocked" }
        : row
    );
  }
  if (action.type === "confirmation_issue") {
    return rows.map((row) => {
      if (row.itemId !== action.itemId) return row;
      if (action.code === "duplicate") {
        return {
          ...row,
          status: "duplicate",
          transaction: undefined,
          error: "รายการนี้ถูกบันทึกไว้แล้ว"
        };
      }
      if (
        action.code === "invalid_account" ||
        action.code === "invalid_category" ||
        action.code === "currency_mismatch"
      ) {
        return {
          ...row,
          status: "needs_review",
          error: action.code === "invalid_account"
            ? "กรุณาเลือกบัญชีใหม่"
            : action.code === "invalid_category"
              ? "กรุณาเลือกหมวดหมู่ใหม่"
              : "สกุลเงินของบัญชีไม่ตรงกับรายการ"
        };
      }
      return {
        ...row,
        status: "failed",
        transaction: undefined,
        error: action.code === "expired_analysis"
          ? "ผลอ่านหมดอายุ กรุณาลองอ่านรูปใหม่"
          : "ยืนยันรายการไม่สำเร็จ กรุณาลองอ่านรูปใหม่"
      };
    });
  }
  if (action.type === "retry") {
    return rows.map((row) => {
      if (row.itemId !== action.itemId || !row.image) return row;
      return {
        itemId: row.itemId,
        fileName: row.fileName,
        revision: row.revision + 1,
        status: "queued",
        image: row.image
      };
    });
  }
  if (action.type === "prepared") {
    const current = rows.find(
      (row) =>
        row.itemId === action.itemId &&
        row.revision === action.revision
    );
    if (!current) {
      action.image.dispose();
      return [...rows];
    }
    const localDuplicate = rows.some(
      (row) =>
        row.itemId !== action.itemId &&
        row.image?.sha256 === action.image.sha256
    );
    return updateRevision(
      rows,
      action.itemId,
      action.revision,
      (row) => ({
        ...row,
        image: action.image,
        status: localDuplicate ? "duplicate" : "queued",
        ...(localDuplicate
          ? { error: "เลือกรูปนี้ซ้ำในชุดเดียวกัน" }
          : {})
      })
    );
  }
  if (action.type === "analysis_started") {
    return updateRevision(
      rows,
      action.itemId,
      action.revision,
      (row) => ({ ...row, status: "analyzing", error: undefined })
    );
  }
  if (action.type === "analysis_success") {
    return updateRevision(
      rows,
      action.itemId,
      action.revision,
      (row) => ({
        ...row,
        status: action.transaction ? "ready" : "needs_review",
        analysisToken: action.analysisToken,
        analysisExpiresAt: action.analysisExpiresAt,
        draft: action.draft,
        ...(action.transaction ? { transaction: action.transaction } : {}),
        error: undefined
      })
    );
  }
  if (action.type === "analysis_duplicate") {
    return updateRevision(
      rows,
      action.itemId,
      action.revision,
      (row) => ({
        ...row,
        status: "duplicate",
        duplicate: action.duplicate,
        error: undefined
      })
    );
  }
  if (action.type === "analysis_unsupported") {
    return updateRevision(
      rows,
      action.itemId,
      action.revision,
      (row) => ({
        ...row,
        status: "unsupported",
        error: undefined
      })
    );
  }
  if (action.type === "analysis_failed") {
    return updateRevision(
      rows,
      action.itemId,
      action.revision,
      (row) => ({
        ...row,
        status: "failed",
        error: action.error
      })
    );
  }
  if (action.type === "reviewed") {
    return updateRevision(
      rows,
      action.itemId,
      action.revision,
      (row) => ({
        ...row,
        status: "ready",
        transaction: action.transaction,
        error: undefined
      })
    );
  }
  return [...rows];
}

export function disposeSlipBatchRows(
  rows: readonly SlipBatchRow[]
): void {
  rows.forEach((row) => row.image?.dispose());
}

export async function runBounded<T>(
  inputs: readonly T[],
  concurrency: 2,
  worker: (input: T) => Promise<void>
): Promise<void> {
  let nextIndex = 0;
  async function run() {
    while (nextIndex < inputs.length) {
      const index = nextIndex;
      nextIndex += 1;
      await worker(inputs[index]!);
    }
  }
  const runners = Array.from(
    { length: Math.min(concurrency, inputs.length) },
    () => run()
  );
  await Promise.all(runners);
}

export function createConcurrencyLimiter(limit: number) {
  let active = 0;
  const waiters: Array<() => void> = [];

  return async function limitTask<T>(task: () => Promise<T>): Promise<T> {
    if (active >= limit) {
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
    active += 1;
    try {
      return await task();
    } finally {
      active -= 1;
      waiters.shift()?.();
    }
  };
}

export function batchTotals(
  rows: readonly SlipBatchRow[]
): Readonly<{
  income: Record<string, string>;
  expense: Record<string, string>;
}> {
  const result = {
    income: {} as Record<string, string>,
    expense: {} as Record<string, string>
  };
  for (const type of ["income", "expense"] as const) {
    const currencies = new Set(
      rows
        .filter(
          (row) =>
            row.status === "ready" &&
            row.transaction?.type === type
        )
        .map((row) => row.transaction!.currency)
    );
    for (const currency of currencies) {
      const items = rows
        .filter(
          (row) =>
            row.status === "ready" &&
            row.transaction?.type === type &&
            row.transaction.currency === currency
        )
        .map((row) => ({
          amount: row.transaction!.amount,
          currency
        }));
      result[type][currency] = sumMoney(items).amount;
    }
  }
  return result;
}

export function canConfirmBatch(
  rows: readonly SlipBatchRow[]
): boolean {
  return rows.some((row) => row.status === "ready") &&
    rows.every((row) =>
      row.status === "ready" ||
      row.status === "duplicate" ||
      row.status === "unsupported"
    );
}

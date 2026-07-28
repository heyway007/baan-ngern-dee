import { describe, expect, it, vi } from "vitest";

import type { PreparedSlipImage } from "./slip-image";
import {
  batchTotals,
  canConfirmBatch,
  createSlipBatchRow,
  disposeSlipBatchRows,
  reduceSlipBatchRows,
  runBounded
} from "./slip-batch-queue";

function image(sha256: string) {
  return {
    blob: new Blob(["image"], { type: "image/jpeg" }),
    mime: "image/jpeg",
    sha256,
    previewUrl: `blob:${sha256}`,
    dispose: vi.fn()
  } satisfies PreparedSlipImage;
}

const workspaceId = "11111111-1111-4111-8111-111111111111";
const accountId = "22222222-2222-4222-8222-222222222222";
const categoryId = "33333333-3333-4333-8333-333333333333";

function transaction(
  type: "income" | "expense",
  amount: string,
  currency: string,
  clientMutationId: string
) {
  return {
    workspaceId,
    accountId,
    categoryId,
    type,
    amount,
    currency,
    financialDate: "2026-07-27",
    tagIds: [],
    clientMutationId
  };
}

describe("slip batch queue", () => {
  it("keeps source order and ignores stale asynchronous results", () => {
    const first = createSlipBatchRow(
      "44444444-4444-4444-8444-444444444444",
      "first.jpg"
    );
    const second = createSlipBatchRow(
      "55555555-5555-4555-8555-555555555555",
      "second.jpg"
    );
    let rows = [first, second];
    rows = reduceSlipBatchRows(rows, {
      type: "prepared",
      itemId: second.itemId,
      revision: 0,
      image: image("2".repeat(64))
    });
    rows = reduceSlipBatchRows(rows, {
      type: "prepared",
      itemId: first.itemId,
      revision: 0,
      image: image("1".repeat(64))
    });
    expect(rows.map((row) => row.fileName)).toEqual([
      "first.jpg",
      "second.jpg"
    ]);

    rows = reduceSlipBatchRows(rows, {
      type: "replace",
      itemId: first.itemId,
      fileName: "replacement.jpg"
    });
    rows = reduceSlipBatchRows(rows, {
      type: "analysis_failed",
      itemId: first.itemId,
      revision: 0,
      error: "ผลเก่า"
    });
    expect(rows[0]).toMatchObject({
      fileName: "replacement.jpg",
      revision: 1,
      status: "preparing"
    });
  });

  it("detects a local duplicate before analysis", () => {
    const first = createSlipBatchRow(
      "44444444-4444-4444-8444-444444444444",
      "first.jpg"
    );
    const second = createSlipBatchRow(
      "55555555-5555-4555-8555-555555555555",
      "copy.jpg"
    );
    const firstImage = image("1".repeat(64));
    const copyImage = image("1".repeat(64));
    let rows = reduceSlipBatchRows([first, second], {
      type: "prepared",
      itemId: first.itemId,
      revision: 0,
      image: firstImage
    });
    rows = reduceSlipBatchRows(rows, {
      type: "prepared",
      itemId: second.itemId,
      revision: 0,
      image: copyImage
    });

    expect(rows[0]!.status).toBe("queued");
    expect(rows[1]).toMatchObject({
      status: "duplicate",
      error: "เลือกรูปนี้ซ้ำในชุดเดียวกัน"
    });
  });

  it("disposes retained images on replace, remove, and close", () => {
    const first = createSlipBatchRow(
      "44444444-4444-4444-8444-444444444444",
      "first.jpg"
    );
    const second = createSlipBatchRow(
      "55555555-5555-4555-8555-555555555555",
      "second.jpg"
    );
    const firstImage = image("1".repeat(64));
    const secondImage = image("2".repeat(64));
    let rows = reduceSlipBatchRows([first, second], {
      type: "prepared",
      itemId: first.itemId,
      revision: 0,
      image: firstImage
    });
    rows = reduceSlipBatchRows(rows, {
      type: "prepared",
      itemId: second.itemId,
      revision: 0,
      image: secondImage
    });
    rows = reduceSlipBatchRows(rows, {
      type: "replace",
      itemId: first.itemId,
      fileName: "new.jpg"
    });
    expect(firstImage.dispose).toHaveBeenCalledTimes(1);
    rows = reduceSlipBatchRows(rows, {
      type: "remove",
      itemId: second.itemId
    });
    expect(secondImage.dispose).toHaveBeenCalledTimes(1);

    const closingImage = image("3".repeat(64));
    rows = reduceSlipBatchRows(rows, {
      type: "prepared",
      itemId: first.itemId,
      revision: 1,
      image: closingImage
    });
    disposeSlipBatchRows(rows);
    expect(closingImage.dispose).toHaveBeenCalledTimes(1);
  });

  it("keeps completed rows and blocks untouched queued rows at quota", () => {
    const first = createSlipBatchRow(
      "44444444-4444-4444-8444-444444444444",
      "first.jpg"
    );
    const second = createSlipBatchRow(
      "55555555-5555-4555-8555-555555555555",
      "second.jpg"
    );
    let rows = [first, second];
    for (const [row, hash] of [[first, "1"], [second, "2"]] as const) {
      rows = reduceSlipBatchRows(rows, {
        type: "prepared",
        itemId: row.itemId,
        revision: 0,
        image: image(hash.repeat(64))
      });
    }
    rows = reduceSlipBatchRows(rows, {
      type: "analysis_success",
      itemId: first.itemId,
      revision: 0,
      analysisToken: "a".repeat(40),
      analysisExpiresAt: "2026-07-29T03:30:00.000Z",
      draft: {
        type: "expense",
        amount: "60.00",
        currency: "THB",
        financialDate: "2026-07-27",
        accountId,
        categoryId,
        fieldsNeedingReview: []
      },
      transaction: transaction(
        "expense",
        "60.00",
        "THB",
        "66666666-6666-4666-8666-666666666666"
      )
    });
    rows = reduceSlipBatchRows(rows, { type: "quota_blocked" });

    expect(rows.map((row) => row.status)).toEqual([
      "ready",
      "quota_blocked"
    ]);
  });

  it("runs no more than two analyses concurrently", async () => {
    let active = 0;
    let maximumActive = 0;
    const releases: Array<() => void> = [];
    const started: number[] = [];
    const work = Array.from({ length: 6 }, (_, index) => index);

    const running = runBounded(work, 2, async (index) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      started.push(index);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
    });
    await vi.waitFor(() => expect(started).toHaveLength(2));
    while (releases.length > 0 || started.length < work.length) {
      releases.shift()?.();
      await Promise.resolve();
    }
    await running;

    expect(maximumActive).toBe(2);
    expect(started).toEqual(work);
  });

  it("requires resolved rows and totals exact money by type and currency", () => {
    const amounts = [
      ["expense", "1191.67", "THB"],
      ["expense", "60.00", "THB"],
      ["income", "0.10", "THB"],
      ["income", "1.25", "USD"]
    ] as const;
    const rows = amounts.map(([type, amount, currency], index) => ({
      ...createSlipBatchRow(
        `77777777-7777-4777-8777-${String(index).padStart(12, "0")}`,
        `${index}.jpg`
      ),
      status: "ready" as const,
      transaction: transaction(
        type,
        amount,
        currency,
        `88888888-8888-4888-8888-${String(index).padStart(12, "0")}`
      )
    }));

    expect(batchTotals(rows)).toEqual({
      income: { THB: "0.10", USD: "1.25" },
      expense: { THB: "1251.67" }
    });
    expect(canConfirmBatch(rows)).toBe(true);
    expect(canConfirmBatch([])).toBe(false);
    expect(canConfirmBatch([
      ...rows,
      { ...createSlipBatchRow(
        "99999999-9999-4999-8999-999999999999",
        "failed.jpg"
      ), status: "failed", error: "อ่านไม่ได้" }
    ])).toBe(false);
    expect(canConfirmBatch([
      rows[0]!,
      { ...createSlipBatchRow(
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "duplicate.jpg"
      ), status: "duplicate" }
    ])).toBe(true);
  });
});

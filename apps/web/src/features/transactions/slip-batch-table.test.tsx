import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { SlipBatchRow } from "./slip-batch-queue";
import { SlipBatchTable } from "./slip-batch-table";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const accountId = "22222222-2222-4222-8222-222222222222";
const categoryId = "33333333-3333-4333-8333-333333333333";

function row(
  itemId: string,
  fileName: string,
  status: SlipBatchRow["status"]
): SlipBatchRow {
  return { itemId, fileName, revision: 0, status };
}

const ready: SlipBatchRow = {
  ...row(
    "44444444-4444-4444-8444-444444444444",
    "ready.jpg",
    "ready"
  ),
  analysisToken: "a".repeat(40),
  analysisExpiresAt: "2026-07-29T03:30:00.000Z",
  transaction: {
    workspaceId,
    accountId,
    categoryId,
    type: "expense",
    amount: "60.00",
    currency: "THB",
    financialDate: "2026-07-27",
    tagIds: [],
    clientMutationId: "55555555-5555-4555-8555-555555555555"
  }
};

const needsReview: SlipBatchRow = {
  ...row(
    "66666666-6666-4666-8666-666666666666",
    "review.jpg",
    "needs_review"
  ),
  draft: {
    type: "income",
    amount: "0.10",
    currency: "THB",
    financialDate: "2026-07-27",
    accountId,
    categoryId,
    fieldsNeedingReview: ["type"]
  }
};

const duplicate: SlipBatchRow = {
  ...row(
    "77777777-7777-4777-8777-777777777777",
    "duplicate.jpg",
    "duplicate"
  ),
  duplicate: {
    id: "88888888-8888-4888-8888-888888888888",
    amount: "60.00",
    financialDate: "2026-07-27"
  }
};

const failed: SlipBatchRow = {
  ...row(
    "99999999-9999-4999-8999-999999999999",
    "failed.jpg",
    "failed"
  ),
  error: "ยังอ่านรูปไม่ได้"
};

function props(rows: readonly SlipBatchRow[]) {
  return {
    rows,
    onEdit: vi.fn(),
    onRetry: vi.fn(),
    onReplace: vi.fn(),
    onRemove: vi.fn(),
    onConfirm: vi.fn()
  };
}

describe("SlipBatchTable", () => {
  it("shows statuses, exact totals, and row-specific actions", async () => {
    const user = userEvent.setup();
    const handlers = props([ready, needsReview, duplicate, failed]);
    render(<SlipBatchTable {...handlers} />);

    expect(screen.getByText("พร้อมบันทึก")).toBeInTheDocument();
    expect(screen.getByText("ต้องตรวจสอบ")).toBeInTheDocument();
    expect(screen.getByText("รายการซ้ำ")).toBeInTheDocument();
    expect(screen.getByText("อ่านไม่สำเร็จ")).toBeInTheDocument();
    expect(screen.getByText("รายจ่าย THB 60.00")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "แก้ไข duplicate.jpg" })
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "แก้ไข review.jpg" })
    );
    expect(handlers.onEdit).toHaveBeenCalledWith(needsReview.itemId);
    await user.click(
      screen.getByRole("button", { name: "ลองใหม่ failed.jpg" })
    );
    expect(handlers.onRetry).toHaveBeenCalledWith(failed.itemId);
    const replacement = new File(["image"], "new.jpg", {
      type: "image/jpeg"
    });
    await user.upload(
      screen.getByLabelText("เปลี่ยนรูป failed.jpg"),
      replacement
    );
    expect(handlers.onReplace).toHaveBeenCalledWith(
      failed.itemId,
      replacement
    );
    await user.click(
      screen.getByRole("button", { name: "ลบ duplicate.jpg" })
    );
    expect(handlers.onRemove).toHaveBeenCalledWith(duplicate.itemId);
    expect(
      screen.getByRole("button", { name: "บันทึก 1 รายการ" })
    ).toBeDisabled();
  });

  it("enables atomic confirmation after every included row is ready", async () => {
    const user = userEvent.setup();
    const handlers = props([ready, duplicate]);
    render(<SlipBatchTable {...handlers} />);

    const button = screen.getByRole("button", {
      name: "บันทึก 1 รายการ"
    });
    expect(button).toBeEnabled();
    await user.click(button);
    expect(handlers.onConfirm).toHaveBeenCalledOnce();
  });

  it("focuses the row returned as blocked", async () => {
    const handlers = props([ready, failed]);
    const { rerender } = render(<SlipBatchTable {...handlers} />);

    rerender(
      <SlipBatchTable {...handlers} blockedItemId={failed.itemId} />
    );
    await waitFor(() => {
      expect(screen.getByLabelText("รายการ failed.jpg")).toHaveFocus();
    });
  });

  it("locks every mutating control while confirming", () => {
    const handlers = props([ready]);
    render(<SlipBatchTable {...handlers} confirming />);

    expect(screen.getByRole("button", {
      name: "กำลังบันทึกทั้งชุด…"
    })).toBeDisabled();
    expect(screen.getByRole("button", {
      name: "แก้ไข ready.jpg"
    })).toBeDisabled();
    expect(screen.getByRole("button", {
      name: "ลบ ready.jpg"
    })).toBeDisabled();
    expect(screen.getByLabelText(
      "เปลี่ยนรูป ready.jpg"
    )).toBeDisabled();
  });
});

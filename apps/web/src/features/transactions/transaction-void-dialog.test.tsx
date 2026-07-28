import type { FinanceTransaction } from "@systems-credit/contracts";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TransactionVoidDialog } from "./transaction-void-dialog";

const transaction: FinanceTransaction = {
  id: "10000000-0000-4000-8000-000000000001",
  workspaceId: "20000000-0000-4000-8000-000000000002",
  accountId: "30000000-0000-4000-8000-000000000003",
  type: "expense",
  amount: "125.50",
  currency: "THB",
  financialDate: "2026-07-28",
  categoryId: "40000000-0000-4000-8000-000000000004",
  note: "อาหารกลางวัน",
  tagIds: [],
  state: "posted",
  version: 1,
  createdAt: "2026-07-28T04:00:00.000Z"
};

function renderDialog(options: {
  onConfirm?: (reason: string) => Promise<void>;
  onCancel?: () => void;
} = {}) {
  const onConfirm =
    options.onConfirm ?? vi.fn().mockResolvedValue(undefined);
  const onCancel = options.onCancel ?? vi.fn();
  render(
    <TransactionVoidDialog
      transaction={transaction}
      accountName="บัญชีหลัก"
      categoryName="อาหาร"
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
  return { onConfirm, onCancel };
}

describe("TransactionVoidDialog", () => {
  it("shows transaction details and submits a trimmed reason", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderDialog();

    expect(
      screen.getByRole("heading", { name: "ลบรายการ" })
    ).toBeInTheDocument();
    expect(screen.getByText("อาหารกลางวัน")).toBeInTheDocument();
    expect(screen.getByText("บัญชีหลัก")).toBeInTheDocument();
    expect(screen.getByText("2026-07-28")).toBeInTheDocument();
    expect(screen.getByText(/125\.50/)).toBeInTheDocument();
    expect(screen.getByLabelText("เหตุผลที่ลบ")).toHaveValue(
      "บันทึกรายการผิด"
    );

    await user.clear(screen.getByLabelText("เหตุผลที่ลบ"));
    await user.type(
      screen.getByLabelText("เหตุผลที่ลบ"),
      "  ใส่ยอดผิด  "
    );
    await user.click(
      screen.getByRole("button", { name: "ลบและย้อนยอด" })
    );

    expect(onConfirm).toHaveBeenCalledWith("ใส่ยอดผิด");
  });

  it("rejects an empty reason before calling the mutation", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderDialog();

    await user.clear(screen.getByLabelText("เหตุผลที่ลบ"));
    await user.click(
      screen.getByRole("button", { name: "ลบและย้อนยอด" })
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "กรุณาระบุเหตุผล 1–200 ตัวอักษร"
    );
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("rejects a reason longer than 200 characters", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderDialog();

    await user.clear(screen.getByLabelText("เหตุผลที่ลบ"));
    await user.type(screen.getByLabelText("เหตุผลที่ลบ"), "ก".repeat(201));
    await user.click(
      screen.getByRole("button", { name: "ลบและย้อนยอด" })
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "กรุณาระบุเหตุผล 1–200 ตัวอักษร"
    );
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("keeps the dialog and reason after the mutation fails", async () => {
    const user = userEvent.setup();
    renderDialog({
      onConfirm: vi.fn().mockRejectedValue(new Error("offline"))
    });

    await user.click(
      screen.getByRole("button", { name: "ลบและย้อนยอด" })
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "ยังลบรายการไม่ได้ กรุณาลองอีกครั้ง"
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("เหตุผลที่ลบ")).toHaveValue(
      "บันทึกรายการผิด"
    );
  });

  it("disables dialog actions while one mutation is pending", async () => {
    const user = userEvent.setup();
    let resolveMutation: (() => void) | undefined;
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveMutation = resolve;
        })
    );
    renderDialog({ onConfirm });

    await user.click(
      screen.getByRole("button", { name: "ลบและย้อนยอด" })
    );

    expect(
      screen.getByRole("button", { name: "กำลังลบ..." })
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "กลับ" })
    ).toBeDisabled();
    expect(onConfirm).toHaveBeenCalledOnce();

    resolveMutation?.();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "ลบและย้อนยอด" })
      ).toBeEnabled()
    );
  });
});

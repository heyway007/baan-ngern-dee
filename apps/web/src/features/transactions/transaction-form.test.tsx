import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Account, Category } from "@systems-credit/contracts";

import { TransactionForm } from "./transaction-form";

const account: Account = {
  id: "9f10925e-c445-4afd-b387-0fa81be4c02d",
  workspaceId: "1c5439df-cb48-4b7b-a614-74546183ce28",
  name: "เงินสด",
  type: "cash",
  currency: "THB",
  version: 1
};

const food: Category = {
  id: "18a7d3b1-d9ca-446d-8578-e517c74c0e3b",
  workspaceId: account.workspaceId,
  slug: "food",
  name: "อาหาร",
  kind: "expense",
  isDefault: true,
  version: 1
};

describe("TransactionForm", () => {
  it("reviews a slip draft and confirms it instead of posting manually", async () => {
    const user = userEvent.setup();
    const confirmSlip = vi.fn().mockResolvedValue({
      transactionId: crypto.randomUUID(),
      version: 1,
      state: "posted",
      accountBalances: []
    });
    const postTransaction = vi.fn();
    render(
      <TransactionForm
        api={{ postTransaction, confirmSlip }}
        workspaceId={account.workspaceId}
        accounts={[account]}
        categories={[food]}
        initialDraft={{
          type: "expense",
          amount: "1250.50",
          currency: "THB",
          financialDate: "2026-07-28",
          accountId: account.id,
          categoryId: food.id,
          note: "ร้านค้า: ร้านทดสอบ",
          fieldsNeedingReview: ["category"]
        }}
        analysisToken={"a".repeat(40)}
        onPosted={vi.fn()}
      />
    );
    expect(screen.getByLabelText(/จำนวนเงิน/)).toHaveValue("1250.50");
    expect(screen.getByText("โปรดตรวจสอบ")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "บันทึกรายจ่าย" })
    );
    await waitFor(() => expect(confirmSlip).toHaveBeenCalledOnce());
    expect(confirmSlip).toHaveBeenCalledWith({
      analysisToken: "a".repeat(40),
      transaction: expect.objectContaining({
        amount: "1250.50",
        financialDate: "2026-07-28",
        accountId: account.id,
        categoryId: food.id
      })
    });
    expect(postTransaction).not.toHaveBeenCalled();
  });

  it("submits the original decimal string and never a JavaScript float", async () => {
    const user = userEvent.setup();
    const postTransaction = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue({
        transactionId: crypto.randomUUID(),
        version: 1,
        state: "posted",
        accountBalances: []
      });
    render(
      <TransactionForm
        api={{ postTransaction }}
        workspaceId={account.workspaceId}
        accounts={[account]}
        categories={[food]}
        initialType="expense"
        onPosted={vi.fn()}
      />
    );

    await user.clear(screen.getByLabelText("จำนวนเงิน"));
    await user.type(screen.getByLabelText("จำนวนเงิน"), "1250.50");
    await user.selectOptions(screen.getByLabelText("บัญชี"), account.id);
    await user.selectOptions(screen.getByLabelText("หมวดหมู่"), food.id);
    await user.click(
      screen.getByRole("button", { name: "บันทึกรายจ่าย" })
    );
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    const firstMutationId =
      postTransaction.mock.calls[0]![0].clientMutationId;
    await user.click(
      screen.getByRole("button", { name: "บันทึกรายจ่าย" })
    );
    await waitFor(() =>
      expect(postTransaction).toHaveBeenCalledTimes(2)
    );
    expect(
      postTransaction.mock.calls[1]![0].clientMutationId
    ).toBe(firstMutationId);
    await waitFor(() =>
      expect(screen.getByLabelText("จำนวนเงิน")).toHaveValue("")
    );
    await user.type(screen.getByLabelText("จำนวนเงิน"), "1.00");
    await user.click(
      screen.getByRole("button", { name: "บันทึกรายจ่าย" })
    );
    await waitFor(() =>
      expect(postTransaction).toHaveBeenCalledTimes(3)
    );
    expect(
      postTransaction.mock.calls[2]![0].clientMutationId
    ).not.toBe(firstMutationId);

    expect(postTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: "1250.50",
        currency: "THB",
        type: "expense"
      })
    );
  });

  it("filters categories when switching transaction type", async () => {
    const user = userEvent.setup();
    const salary: Category = {
      ...food,
      id: "fe8cc53f-16db-47c2-a1b8-419778e4305f",
      slug: "salary",
      name: "เงินเดือน",
      kind: "income"
    };
    render(
      <TransactionForm
        api={{ postTransaction: vi.fn() }}
        workspaceId={account.workspaceId}
        accounts={[account]}
        categories={[food, salary]}
        initialType="expense"
        onPosted={vi.fn()}
      />
    );

    expect(
      screen.getByRole("option", { name: "อาหาร" })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "เงินเดือน" })
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "รายรับ" }));
    expect(
      screen.getByRole("option", { name: "เงินเดือน" })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "อาหาร" })
    ).not.toBeInTheDocument();
  });

  it("submits exact split strings when one expense uses multiple categories", async () => {
    const user = userEvent.setup();
    const transport: Category = {
      ...food,
      id: "bb11b1d4-b346-4dcb-9f90-28edb19e43cd",
      slug: "transport",
      name: "เดินทาง"
    };
    const postTransaction = vi.fn().mockResolvedValue({
      transactionId: crypto.randomUUID(),
      version: 1,
      state: "posted",
      accountBalances: []
    });
    render(
      <TransactionForm
        api={{ postTransaction }}
        workspaceId={account.workspaceId}
        accounts={[account]}
        categories={[food, transport]}
        initialType="expense"
        onPosted={vi.fn()}
      />
    );

    await user.type(screen.getByLabelText("จำนวนเงิน"), "100.00");
    await user.click(
      screen.getByRole("button", { name: "แบ่งหลายหมวดหมู่" })
    );
    await user.clear(screen.getByLabelText("จำนวนเงินส่วนที่ 1"));
    await user.type(screen.getByLabelText("จำนวนเงินส่วนที่ 1"), "60.00");
    await user.clear(screen.getByLabelText("จำนวนเงินส่วนที่ 2"));
    await user.type(screen.getByLabelText("จำนวนเงินส่วนที่ 2"), "40.00");
    await user.click(
      screen.getByRole("button", { name: "บันทึกรายจ่าย" })
    );

    expect(postTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: "100.00",
        splits: [
          expect.objectContaining({ amount: "60.00" }),
          expect.objectContaining({ amount: "40.00" })
        ]
      })
    );
  });
});

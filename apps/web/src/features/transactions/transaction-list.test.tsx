import type {
  Account,
  Category,
  FinanceTransaction
} from "@systems-credit/contracts";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  TransactionList,
  type TransactionListFilter
} from "./transaction-list";

const workspaceId = "10000000-0000-4000-8000-000000000001";
const accountId = "20000000-0000-4000-8000-000000000002";
const categoryId = "30000000-0000-4000-8000-000000000003";

const account: Account = {
  id: accountId,
  workspaceId,
  name: "บัญชีหลัก",
  type: "bank",
  currency: "THB",
  version: 1
};

const category: Category = {
  id: categoryId,
  workspaceId,
  slug: "food",
  name: "อาหาร",
  kind: "expense",
  isDefault: true,
  version: 1
};

const postedManual: FinanceTransaction = {
  id: "40000000-0000-4000-8000-000000000004",
  workspaceId,
  accountId,
  type: "expense",
  amount: "125.50",
  currency: "THB",
  financialDate: "2026-07-28",
  categoryId,
  note: "อาหารกลางวัน",
  tagIds: [],
  state: "posted",
  version: 1,
  createdAt: "2026-07-28T04:00:00.000Z"
};

const voidedManual: FinanceTransaction = {
  ...postedManual,
  id: "50000000-0000-4000-8000-000000000005",
  note: "รายการผิด",
  state: "void",
  version: 2,
  voidedAt: "2026-07-28T05:00:00.000Z",
  voidReason: "บันทึกรายการผิด"
};

function renderList(
  transactions: FinanceTransaction[],
  onDeleteRequested = vi.fn()
) {
  function Harness() {
    const [filter, setFilter] =
      useState<TransactionListFilter>("current");
    return (
      <TransactionList
        transactions={transactions}
        accounts={[account]}
        categories={[category]}
        filter={filter}
        onFilterChange={setFilter}
        onDeleteRequested={onDeleteRequested}
      />
    );
  }

  render(<Harness />);
  return { onDeleteRequested };
}

describe("TransactionList", () => {
  it("shows only current transactions by default", () => {
    renderList([postedManual, voidedManual]);

    expect(screen.getByText("อาหารกลางวัน")).toBeInTheDocument();
    expect(screen.queryByText("รายการผิด")).not.toBeInTheDocument();
  });

  it("shows void metadata without a second delete action", async () => {
    const user = userEvent.setup();
    renderList([postedManual, voidedManual]);

    await user.click(
      screen.getByRole("button", { name: "รายการที่ลบแล้ว" })
    );

    expect(screen.getByText("รายการผิด")).toBeInTheDocument();
    expect(screen.getByText("ลบแล้ว")).toBeInTheDocument();
    expect(screen.getByText("บันทึกรายการผิด")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "ลบรายการ รายการผิด"
      })
    ).not.toBeInTheDocument();
  });

  it("offers deletion only for a posted manual transaction", () => {
    const sources: NonNullable<FinanceTransaction["source"]>[] = [
      "transfer_fee",
      "installment_payment",
      "installment_payoff",
      "recurring_occurrence"
    ];
    const sourceTransactions = sources.map(
      (source, index): FinanceTransaction => ({
        ...postedManual,
        id: `${index + 6}0000000-0000-4000-8000-00000000000${index + 6}`,
        note: `รายการระบบ ${index + 1}`,
        source,
        sourceId: `${index + 1}0000000-0000-4000-8000-00000000000${index + 1}`
      })
    );

    renderList([postedManual, ...sourceTransactions]);

    expect(
      screen.getAllByRole("button", { name: /ลบรายการ/ })
    ).toHaveLength(1);
    expect(
      screen.getAllByText("จัดการจากโมดูลต้นทาง")
    ).toHaveLength(4);
  });
});

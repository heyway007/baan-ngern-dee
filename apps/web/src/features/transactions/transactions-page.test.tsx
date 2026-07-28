import type { FinanceSnapshot } from "@systems-credit/contracts";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import type { FinanceApi } from "../../lib/finance-api";
import { TransactionsPage } from "./transactions-page";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const accountId = "22222222-2222-4222-8222-222222222222";
const categoryId = "33333333-3333-4333-8333-333333333333";
const transactionId = "44444444-4444-4444-8444-444444444444";

const snapshot: FinanceSnapshot = {
  version: 1,
  workspace: {
    id: workspaceId,
    name: "บ้านของมิน",
    kind: "private",
    baseCurrency: "THB",
    timeZone: "Asia/Bangkok",
    role: "owner",
    version: 1
  },
  categories: [
    {
      id: categoryId,
      workspaceId,
      slug: "food",
      name: "อาหาร",
      kind: "expense",
      isDefault: true,
      version: 1
    }
  ],
  accounts: [
    {
      id: accountId,
      workspaceId,
      name: "บัญชีหลัก",
      type: "bank",
      currency: "THB",
      version: 1
    }
  ],
  accountBalances: {
    [accountId]: {
      accountId,
      amount: "874.50",
      currency: "THB"
    }
  },
  openingTransactions: [],
  transactions: [
    {
      id: transactionId,
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
      version: 3,
      createdAt: "2026-07-28T04:00:00.000Z"
    }
  ],
  installmentContracts: [],
  installmentSchedules: {},
  installmentPayments: [],
  installmentPayoffs: [],
  recurringTemplates: [],
  recurringOccurrences: []
};

function createApi(
  voidTransaction = vi.fn().mockResolvedValue({
    transactionId,
    state: "void",
    version: 4
  })
) {
  return {
    voidTransaction
  } as unknown as FinanceApi;
}

function renderPage(
  api: FinanceApi,
  onChanged = vi.fn()
) {
  render(
    <MemoryRouter>
      <TransactionsPage
        api={api}
        snapshot={snapshot}
        onChanged={onChanged}
      />
    </MemoryRouter>
  );
  return { onChanged };
}

describe("TransactionsPage", () => {
  it("voids a mistaken manual transaction and refreshes the snapshot", async () => {
    const user = userEvent.setup();
    const voidTransaction = vi.fn().mockResolvedValue({
      transactionId,
      state: "void",
      version: 4
    });
    const api = createApi(voidTransaction);
    const { onChanged } = renderPage(api);

    await user.click(
      screen.getByRole("button", {
        name: "ลบรายการ อาหารกลางวัน"
      })
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "อาหารกลางวัน"
    );
    expect(screen.getByRole("dialog")).toHaveTextContent("125.50");

    await user.click(
      screen.getByRole("button", { name: "ลบและย้อนยอด" })
    );

    await waitFor(() => {
      expect(voidTransaction).toHaveBeenCalledWith(transactionId, {
        version: 3,
        reason: "บันทึกรายการผิด"
      });
    });
    expect(onChanged).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the confirmation open when voiding fails", async () => {
    const user = userEvent.setup();
    const voidTransaction = vi
      .fn()
      .mockRejectedValue(new Error("offline"));
    const api = createApi(voidTransaction);
    const { onChanged } = renderPage(api);

    await user.click(
      screen.getByRole("button", {
        name: "ลบรายการ อาหารกลางวัน"
      })
    );
    await user.click(
      screen.getByRole("button", { name: "ลบและย้อนยอด" })
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "ยังลบรายการไม่ได้ กรุณาลองอีกครั้ง"
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });
});

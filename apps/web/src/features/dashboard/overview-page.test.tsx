import type { FinanceSnapshot } from "@systems-credit/contracts";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OverviewPage } from "./overview-page";

const workspaceId = "10000000-0000-4000-8000-000000000001";
const accountId = "20000000-0000-4000-8000-000000000002";
const categoryId = "30000000-0000-4000-8000-000000000003";

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
      slug: "income",
      name: "รายรับ",
      kind: "income",
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
      amount: "3500.00",
      currency: "THB"
    }
  },
  openingTransactions: [],
  transactions: [
    {
      id: "50000000-0000-4000-8000-000000000005",
      workspaceId,
      accountId,
      type: "income",
      amount: "1500.00",
      currency: "THB",
      financialDate: "2026-06-30",
      categoryId,
      note: "โบนัสเดือนมิถุนายน",
      tagIds: [],
      state: "posted",
      version: 1,
      createdAt: "2026-06-30T04:00:00.000Z"
    },
    {
      id: "60000000-0000-4000-8000-000000000006",
      workspaceId,
      accountId,
      type: "income",
      amount: "2000.00",
      currency: "THB",
      financialDate: "2026-07-01",
      categoryId,
      note: "เงินเดือนกรกฎาคม",
      tagIds: [],
      state: "posted",
      version: 1,
      createdAt: "2026-07-01T04:00:00.000Z"
    },
    {
      id: "70000000-0000-4000-8000-000000000007",
      workspaceId,
      accountId,
      type: "expense",
      amount: "500.00",
      currency: "THB",
      financialDate: "2026-07-02",
      categoryId,
      note: "ค่าใช้จ่ายกรกฎาคม",
      tagIds: [],
      state: "posted",
      version: 1,
      createdAt: "2026-07-02T04:00:00.000Z"
    }
  ],
  installmentContracts: [],
  installmentSchedules: {},
  installmentPayments: [],
  installmentPayoffs: [],
  recurringTemplates: [],
  recurringOccurrences: [],
  budgetAllocations: [],
  savingsGoals: []
};

afterEach(() => {
  vi.useRealTimers();
});

describe("OverviewPage", () => {
  it("updates the summary cards and transactions for the selected month", () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-06-30T18:00:00.000Z");

    render(
      <MemoryRouter>
        <OverviewPage displayName="มินใหม่" snapshot={snapshot} />
      </MemoryRouter>
    );

    expect(
      screen.getByRole("heading", { name: "สวัสดี มินใหม่" })
    ).toBeInTheDocument();
    expect(screen.getByText("บ้านเงินของ มินใหม่")).toBeInTheDocument();

    const monthInput = screen.getByLabelText("เลือกเดือน");
    expect(monthInput).toHaveValue("2026-07");
    expect(
      within(screen.getByTestId("monthly-income")).getByText("฿2,000.00")
    ).toBeInTheDocument();
    expect(screen.getByText("เงินเดือนกรกฎาคม")).toBeInTheDocument();

    fireEvent.change(monthInput, { target: { value: "2026-06" } });

    expect(
      within(screen.getByTestId("monthly-income")).getByText("฿1,500.00")
    ).toBeInTheDocument();
    expect(screen.getByText("โบนัสเดือนมิถุนายน")).toBeInTheDocument();
    expect(screen.queryByText("เงินเดือนกรกฎาคม")).not.toBeInTheDocument();
  });
});

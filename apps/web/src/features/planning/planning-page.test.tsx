import type { FinanceSnapshot, FinancialPlan } from "@systems-credit/contracts";
import { toFinancialDate } from "@systems-credit/domain";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FinanceApi } from "../../lib/finance-api";
import { PlanningPage } from "./planning-page";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const currentMonth = toFinancialDate(
  new Date().toISOString(),
  "Asia/Bangkok"
).slice(0, 7);

function makeSnapshot(role: "owner" | "editor" | "viewer"): FinanceSnapshot {
  return {
    version: 1,
    workspace: {
      id: workspaceId,
      name: "บ้านของมิน",
      kind: "private",
      baseCurrency: "THB",
      timeZone: "Asia/Bangkok",
      role,
      version: 1
    },
    categories: [],
    accounts: [],
    accountBalances: {},
    openingTransactions: [],
    transactions: [],
    installmentContracts: [],
    installmentSchedules: {},
    installmentPayments: [],
    installmentPayoffs: [],
    recurringTemplates: [],
    recurringOccurrences: [],
    budgetAllocations: [],
    savingsGoals: []
  };
}

function makePlan(month = currentMonth): FinancialPlan {
  return {
    workspaceId,
    month,
    currency: "THB",
    totals: {
      baseBudget: "0.00",
      priorCarry: "0.00",
      available: "0.00",
      spent: "0.00",
      remaining: "0.00"
    },
    categories: [],
    goals: []
  };
}

function createApi(overrides: Partial<FinanceApi> = {}) {
  return {
    initializeBudgetMonth: vi.fn().mockResolvedValue({ createdCount: 0 }),
    getFinancialPlan: vi.fn().mockImplementation(
      (_workspaceId: string, month: string) => Promise.resolve(makePlan(month))
    ),
    ...overrides
  } as unknown as FinanceApi;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PlanningPage", () => {
  it("initializes a current editable month before loading its plan", async () => {
    const calls: string[] = [];
    const api = createApi({
      initializeBudgetMonth: vi.fn().mockImplementation(async () => {
        calls.push("initialize");
        return { createdCount: 0 };
      }),
      getFinancialPlan: vi.fn().mockImplementation(async () => {
        calls.push("get");
        return makePlan();
      })
    });

    render(
      <PlanningPage
        api={api}
        snapshot={makeSnapshot("editor")}
        onChanged={vi.fn()}
      />
    );

    expect(await screen.findByRole("heading", { name: "แผนการเงิน" })).toBeVisible();
    await waitFor(() => expect(calls).toEqual(["initialize", "get"]));
    expect(api.initializeBudgetMonth).toHaveBeenCalledWith({
      workspaceId,
      month: currentMonth
    });
  });

  it("loads history without mutating it and viewers never initialize a month", async () => {
    const api = createApi();
    render(
      <PlanningPage
        api={api}
        snapshot={makeSnapshot("viewer")}
        onChanged={vi.fn()}
      />
    );
    await screen.findByText("งบเดือนนี้");

    fireEvent.change(screen.getByLabelText("เลือกเดือนแผน"), {
      target: { value: "2025-01" }
    });
    await waitFor(() =>
      expect(api.getFinancialPlan).toHaveBeenLastCalledWith(
        workspaceId,
        "2025-01"
      )
    );
    expect(api.initializeBudgetMonth).not.toHaveBeenCalled();
  });

  it("keeps the selected month and retries the same load after an error", async () => {
    const user = userEvent.setup();
    const getFinancialPlan = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(makePlan());
    const api = createApi({ getFinancialPlan });
    render(
      <PlanningPage
        api={api}
        snapshot={makeSnapshot("viewer")}
        onChanged={vi.fn()}
      />
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "ยังโหลดแผนการเงินไม่ได้"
    );
    expect(screen.getByLabelText("เลือกเดือนแผน")).toHaveValue(currentMonth);
    await user.click(screen.getByRole("button", { name: "ลองอีกครั้ง" }));
    expect(await screen.findByText("งบเดือนนี้")).toBeVisible();
    expect(getFinancialPlan).toHaveBeenCalledTimes(2);
  });
});

import type { FinancialPlan } from "@systems-credit/contracts";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { FinanceApi } from "../../lib/finance-api";
import { BudgetPanel } from "./budget-panel";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const foodId = "22222222-2222-4222-8222-222222222222";
const healthId = "33333333-3333-4333-8333-333333333333";
const allocationId = "44444444-4444-4444-8444-444444444444";

const plan: FinancialPlan = {
  workspaceId,
  month: "2026-07",
  currency: "THB",
  totals: {
    baseBudget: "5000.00",
    priorCarry: "-1000.00",
    available: "4000.00",
    spent: "2500.00",
    remaining: "1500.00"
  },
  categories: [
    {
      categoryId: foodId,
      categoryName: "อาหาร",
      allocationId,
      allocationVersion: 2,
      isBudgeted: true,
      baseBudget: "5000.00",
      priorCarry: "-1000.00",
      available: "4000.00",
      spent: "2000.00",
      remaining: "2000.00"
    },
    {
      categoryId: healthId,
      categoryName: "สุขภาพ",
      isBudgeted: false,
      baseBudget: "0.00",
      priorCarry: "0.00",
      available: "0.00",
      spent: "500.00",
      remaining: "-500.00"
    }
  ],
  goals: []
};

const expenseCategories = [
  {
    id: foodId,
    workspaceId,
    slug: "food",
    name: "อาหาร",
    kind: "expense" as const,
    isDefault: true,
    version: 1
  },
  {
    id: healthId,
    workspaceId,
    slug: "health",
    name: "สุขภาพ",
    kind: "expense" as const,
    isDefault: true,
    version: 1
  }
];

function createApi() {
  return {
    setMonthlyBudget: vi.fn().mockResolvedValue({
      id: allocationId,
      workspaceId,
      categoryId: foodId,
      month: "2026-07",
      amount: "6000.00",
      version: 3
    }),
    removeMonthlyBudget: vi.fn().mockResolvedValue({
      id: allocationId,
      workspaceId,
      categoryId: foodId,
      month: "2026-07",
      amount: "5000.00",
      removedAt: "2026-07-29T10:00:00Z",
      version: 3
    })
  } as unknown as FinanceApi;
}

describe("BudgetPanel", () => {
  it("separates this month's budget from signed prior carry and unbudgeted spending", () => {
    render(
      <BudgetPanel
        api={createApi()}
        plan={plan}
        categories={expenseCategories}
        canEdit={false}
        onChanged={vi.fn()}
      />
    );

    expect(screen.getAllByText("งบเดือนนี้")[0]).toBeVisible();
    expect(screen.getByText("ยอดยกมาจากเดือนก่อน")).toBeVisible();
    expect(
      screen.getByText("เงินเหลือหรือใช้เกินสะสมจากเดือนก่อน ๆ")
    ).toBeVisible();
    expect(screen.getAllByText("−฿1,000.00")[0]).toHaveClass("negative");
    expect(
      screen.getByRole("heading", { name: "ไม่ได้ตั้งงบ" })
    ).toBeVisible();
    expect(screen.getByText("สุขภาพ")).toBeVisible();
    expect(screen.queryByRole("button", { name: "แก้ไข อาหาร" })).toBeNull();
  });

  it("updates and removes an allocation with optimistic locking", async () => {
    const user = userEvent.setup();
    const api = createApi();
    const onChanged = vi.fn().mockResolvedValue(undefined);
    render(
      <BudgetPanel
        api={api}
        plan={plan}
        categories={expenseCategories}
        canEdit
        onChanged={onChanged}
      />
    );

    await user.click(screen.getByRole("button", { name: "แก้ไข อาหาร" }));
    const row = screen.getByTestId(`budget-row-${foodId}`);
    const amount = within(row).getByLabelText("งบของอาหาร");
    await user.clear(amount);
    await user.type(amount, "6000.00");
    await user.click(within(row).getByRole("button", { name: "บันทึก" }));

    expect(api.setMonthlyBudget).toHaveBeenCalledWith({
      workspaceId,
      categoryId: foodId,
      month: "2026-07",
      amount: "6000.00",
      version: 2
    });
    expect(onChanged).toHaveBeenCalledOnce();

    vi.spyOn(window, "confirm").mockReturnValue(true);
    await user.click(screen.getByRole("button", { name: "ลบงบ อาหาร" }));
    expect(api.removeMonthlyBudget).toHaveBeenCalledWith(allocationId, {
      version: 2
    });
    expect(onChanged).toHaveBeenCalledTimes(2);
  });
});

import type {
  Account,
  FinancialPlan
} from "@systems-credit/contracts";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { FinanceApi } from "../../lib/finance-api";
import { SavingsGoalsPanel } from "./savings-goals-panel";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const bankId = "22222222-2222-4222-8222-222222222222";
const cashId = "33333333-3333-4333-8333-333333333333";
const cardId = "44444444-4444-4444-8444-444444444444";
const loanId = "55555555-5555-4555-8555-555555555555";
const archivedAccountId = "66666666-6666-4666-8666-666666666666";
const goalId = "77777777-7777-4777-8777-777777777777";

const accounts: Account[] = [
  { id: bankId, workspaceId, name: "เงินออม", type: "bank", currency: "THB", version: 1 },
  { id: cashId, workspaceId, name: "เงินสดฉุกเฉิน", type: "cash", currency: "THB", version: 1 },
  { id: cardId, workspaceId, name: "บัตรเครดิต", type: "credit_card", currency: "THB", version: 1 },
  { id: loanId, workspaceId, name: "เงินกู้", type: "loan", currency: "THB", version: 1 }
];

const plan: FinancialPlan = {
  workspaceId,
  month: "2026-07",
  currency: "THB",
  totals: {
    baseBudget: "0.00",
    priorCarry: "0.00",
    available: "0.00",
    spent: "0.00",
    remaining: "0.00"
  },
  categories: [],
  goals: [
    {
      id: goalId,
      name: "เงินสำรอง",
      accountId: bankId,
      accountName: "เงินออม",
      currentAmount: "12000.00",
      targetAmount: "50000.00",
      currency: "THB",
      percent: 24,
      reached: false,
      accountArchived: false,
      status: "active",
      version: 3
    },
    {
      id: "88888888-8888-4888-8888-888888888888",
      name: "ทริปครอบครัว",
      accountId: archivedAccountId,
      accountName: "บัญชีท่องเที่ยว",
      currentAmount: "25000.00",
      targetAmount: "20000.00",
      currency: "THB",
      percent: 100,
      reached: true,
      accountArchived: true,
      status: "active",
      version: 1
    }
  ]
};

function createApi() {
  return {
    createSavingsGoal: vi.fn(),
    updateSavingsGoal: vi.fn(),
    archiveSavingsGoal: vi.fn().mockResolvedValue({
      id: goalId,
      workspaceId,
      name: "เงินสำรอง",
      targetAmount: "50000.00",
      currency: "THB",
      accountId: bankId,
      accountType: "bank",
      status: "archived",
      version: 4
    })
  } as unknown as FinanceApi;
}

describe("SavingsGoalsPanel", () => {
  it("shows actual account progress, completion, and archived-account warnings", () => {
    render(
      <SavingsGoalsPanel
        api={createApi()}
        plan={plan}
        accounts={accounts}
        canEdit={false}
        onChanged={vi.fn()}
      />
    );

    expect(screen.getByText("฿12,000.00 จาก ฿50,000.00")).toBeVisible();
    expect(screen.getAllByRole("progressbar")[0]).toHaveAttribute(
      "aria-valuenow",
      "24"
    );
    expect(screen.getByText("ถึงเป้าแล้ว")).toBeVisible();
    expect(screen.getByText("บัญชีนี้ถูกเก็บถาวรแล้ว")).toBeVisible();
    expect(screen.queryByRole("button", { name: "เพิ่มเป้าหมาย" })).toBeNull();
  });

  it("offers only eligible unused accounts and archives with confirmation", async () => {
    const user = userEvent.setup();
    const api = createApi();
    const onChanged = vi.fn().mockResolvedValue(undefined);
    render(
      <SavingsGoalsPanel
        api={api}
        plan={plan}
        accounts={accounts}
        canEdit
        onChanged={onChanged}
      />
    );

    await user.click(screen.getByRole("button", { name: "เพิ่มเป้าหมาย" }));
    expect(screen.getByRole("option", { name: "เงินสดฉุกเฉิน" })).toBeEnabled();
    expect(screen.getByRole("option", { name: /เงินออม.*มีเป้าหมายแล้ว/ })).toBeDisabled();
    expect(screen.queryByRole("option", { name: /บัตรเครดิต/ })).toBeNull();
    expect(screen.queryByRole("option", { name: /เงินกู้/ })).toBeNull();

    vi.spyOn(window, "confirm").mockReturnValue(true);
    await user.click(screen.getByRole("button", { name: "เก็บเป้าหมาย เงินสำรอง" }));
    expect(api.archiveSavingsGoal).toHaveBeenCalledWith(goalId, { version: 3 });
    expect(onChanged).toHaveBeenCalledOnce();
  });
});

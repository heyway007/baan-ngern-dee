import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { generateInstallmentSchedule } from "@systems-credit/domain";

import type {
  LocalInstallmentContract,
  LocalInstallmentScheduleRow
} from "../../lib/local-finance-api";
import { PayoffSimulator } from "./payoff-simulator";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const contractId = "22222222-2222-4222-8222-222222222222";
const accountId = "33333333-3333-4333-8333-333333333333";

function flatContract(): LocalInstallmentContract {
  return {
    id: contractId,
    workspaceId,
    name: "หนี้ดอกเบี้ยคงที่",
    kind: "debt",
    originalPrincipal: "12000.00",
    downPayment: "0.00",
    financedPrincipal: "12000.00",
    financedFees: "0.00",
    currency: "THB",
    interestMethod: "flat",
    annualRate: "12",
    periods: 12,
    firstDueDate: "2026-08-01",
    status: "active",
    version: 1
  };
}

function flatSchedule(): LocalInstallmentScheduleRow[] {
  return generateInstallmentSchedule({
    principal: "12000.00",
    financedFees: "0.00",
    currency: "THB",
    interestMethod: "flat",
    annualRate: "12",
    periods: 12,
    firstDueDate: "2026-08-01"
  }).map((row) => ({
    ...row,
    paidPrincipal: "0.00",
    paidInterest: "0.00",
    paidFees: "0.00",
    paidPenalty: "0.00",
    scheduledPenalty: "0.00",
    status: "upcoming"
  }));
}

describe("PayoffSimulator", () => {
  it("previews a creditor payoff quote and posts only after confirmation", async () => {
    const user = userEvent.setup();
    const postInstallmentPayoff = vi.fn().mockResolvedValue({
      payoffId: "44444444-4444-4444-8444-444444444444",
      action: "payoff",
      principalPayment: "12000.00",
      interestDue: "500.00",
      feesDue: "100.00",
      totalCashRequired: "12600.00",
      remainingPrincipal: "0.00",
      interestSaved: "940.00",
      contractStatus: "paid_off",
      accountBalance: {
        accountId,
        amount: "7400.00",
        currency: "THB"
      }
    });
    const onPosted = vi.fn();

    render(
      <PayoffSimulator
        api={{ postInstallmentPayoff }}
        contract={flatContract()}
        schedule={flatSchedule()}
        accounts={[
          {
            id: accountId,
            workspaceId,
            name: "บัญชีปิดยอด",
            type: "bank",
            currency: "THB",
            version: 1
          }
        ]}
        onPosted={onPosted}
      />
    );

    await user.click(
      screen.getByRole("button", { name: "ปิดยอดทั้งหมด" })
    );
    expect(
      screen.getByText("฿13,440.00", { exact: true })
    ).toBeInTheDocument();

    await user.clear(
      screen.getByLabelText("ดอกเบี้ยตามใบเสนอ")
    );
    await user.type(
      screen.getByLabelText("ดอกเบี้ยตามใบเสนอ"),
      "500.00"
    );
    await user.clear(
      screen.getByLabelText("ค่าธรรมเนียมตามใบเสนอ")
    );
    await user.type(
      screen.getByLabelText("ค่าธรรมเนียมตามใบเสนอ"),
      "100.00"
    );

    expect(
      screen.getByText("฿12,600.00", { exact: true })
    ).toBeInTheDocument();
    expect(postInstallmentPayoff).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("checkbox", {
        name: "ยืนยันใบเสนอและยอดที่จะชำระ"
      })
    );
    await user.click(
      screen.getByRole("button", {
        name: "ยืนยันปิดยอด ฿12,600.00"
      })
    );

    expect(postInstallmentPayoff).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId,
        contractId,
        accountId,
        action: "payoff",
        expectedRemainingPrincipal: "12000.00",
        quotedInterest: "500.00",
        quotedFees: "100.00",
        currency: "THB"
      })
    );
    expect(onPosted).toHaveBeenCalledTimes(1);
  });
});
